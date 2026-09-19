/**
 * lib/auth-links/account-links.ts
 *
 * One-time links for account activation (invite) and password reset.
 *
 * 2026-09-19 (John): "I also want the forgot password link on the login page
 * and a real time email invite... Dont create a password for Karina. I want
 * it created when she activates her account."
 *
 * Why our own tokens instead of Supabase's built-in invite / recovery emails:
 *   - Supabase's link is consumed on GET. Mail scanners (Outlook Safe Links
 *     and friends) prefetch links, which burns the token before the person
 *     ever clicks. Ours is only consumed when the password form is SUBMITTED.
 *   - Supabase's link lifetime is one project-wide dashboard setting, capped
 *     at 24h. An invite must not expire; a reset wants an hour.
 *   - The email goes through Resend with our branding, like every other email.
 *
 * Only the SHA-256 of the token is stored (account_link_tokens.token_hash).
 * The raw token exists only in the emailed URL. The table is service-role
 * only (RLS on, no policies).
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type AccountLinkKind = "invite" | "reset";

const APP_BASE_URL = "https://www.alliancesocialanalytics.com";

/**
 * 2026-09-19 (John): "The link should not expire." Invite links live until
 * they are used or replaced by a newer one. Reset links stay short-lived:
 * they can be requested by anyone who knows the email address.
 */
const LIFETIME_MS: Record<AccountLinkKind, number | null> = {
  invite: null,
  reset: 3600_000,
};
const NEVER = "9999-12-31T00:00:00.000Z";

/** No more than one email per user inside this window. */
const THROTTLE_MS = 2 * 60_000;

export const MIN_PASSWORD_LENGTH = 8;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// account_link_tokens isn't in the generated Database type yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function untypedAdmin(): any {
  return createAdminClient();
}

export type CreateLinkResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; reason: "throttled" | "error"; error?: string };

/**
 * Mint a fresh one-time link for a user. Any earlier unused links for the
 * same user are retired, so only the newest email ever works.
 */
export async function createAccountLink(args: {
  userId: string;
  kind: AccountLinkKind;
  createdBy?: string | null;
  /** Admin-triggered sends skip the throttle; the public form does not. */
  bypassThrottle?: boolean;
}): Promise<CreateLinkResult> {
  const db = untypedAdmin();
  const now = Date.now();

  if (!args.bypassThrottle) {
    const since = new Date(now - THROTTLE_MS).toISOString();
    const { data: recent } = await db
      .from("account_link_tokens")
      .select("id")
      .eq("user_id", args.userId)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) return { ok: false, reason: "throttled" };
  }

  // Retire older unused links.
  await db
    .from("account_link_tokens")
    .update({ used_at: new Date(now).toISOString() })
    .eq("user_id", args.userId)
    .is("used_at", null);

  const raw = randomBytes(32).toString("base64url");
  const life = LIFETIME_MS[args.kind];
  const expiresAt = life === null ? NEVER : new Date(now + life).toISOString();

  const { error } = await db.from("account_link_tokens").insert({
    user_id: args.userId,
    kind: args.kind,
    token_hash: hashToken(raw),
    expires_at: expiresAt,
    created_by: args.createdBy ?? null,
  });
  if (error) return { ok: false, reason: "error", error: error.message };

  return {
    ok: true,
    url: `${APP_BASE_URL}/set-password?token=${raw}`,
    expiresAt,
  };
}

export type PeekResult =
  | {
      valid: true;
      tokenId: string;
      userId: string;
      kind: AccountLinkKind;
      email: string;
      fullName: string | null;
    }
  | { valid: false; reason: "missing" | "used" | "expired" | "disabled" };

/** Read-only check. Never consumes the token, so a scanner GET is harmless. */
export async function peekAccountLink(raw: string): Promise<PeekResult> {
  if (!raw || raw.length < 20 || raw.length > 200) {
    return { valid: false, reason: "missing" };
  }
  const db = untypedAdmin();
  const { data: row } = await db
    .from("account_link_tokens")
    .select("id, user_id, kind, expires_at, used_at")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();

  if (!row) return { valid: false, reason: "missing" };
  if (row.used_at) return { valid: false, reason: "used" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: "expired" };
  }

  const { data: profile } = await db
    .from("profiles")
    .select("email, full_name, is_active")
    .eq("id", row.user_id)
    .maybeSingle();
  if (!profile || profile.is_active === false) {
    return { valid: false, reason: "disabled" };
  }

  return {
    valid: true,
    tokenId: row.id,
    userId: row.user_id,
    kind: row.kind as AccountLinkKind,
    email: profile.email,
    fullName: profile.full_name ?? null,
  };
}

export type ConsumeResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

/**
 * Burn the token and set the password. The token is claimed FIRST with a
 * conditional update (used_at is null), so two simultaneous submits cannot
 * both win.
 */
export async function consumeAccountLink(
  raw: string,
  newPassword: string,
): Promise<ConsumeResult> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const peek = await peekAccountLink(raw);
  if (!peek.valid) {
    return {
      ok: false,
      error: "This link is no longer valid.",
    };
  }

  const db = untypedAdmin();
  const { data: claimed } = await db
    .from("account_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", peek.tokenId)
    .is("used_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return {
      ok: false,
      error: "This link was already used.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(peek.userId, {
    password: newPassword,
  });
  if (error) {
    // Hand the token back so a rejected password (too weak, etc.) doesn't
    // strand the person with a dead link.
    await db
      .from("account_link_tokens")
      .update({ used_at: null })
      .eq("id", peek.tokenId);
    return { ok: false, error: error.message };
  }

  return { ok: true, email: peek.email };
}
