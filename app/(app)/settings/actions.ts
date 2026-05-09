"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import {
  getPlatformDef,
  type CredentialPlatform,
  PLATFORMS,
} from "./credentialSchemas";
import type { Database } from "@/lib/supabase/types";

const VALID_PLATFORMS = new Set(PLATFORMS.map((p) => p.platform));

export interface SaveCredentialsResult {
  ok: boolean;
  error?: string;
}

interface FormActionState {
  ok: boolean;
  error?: string;
}

/**
 * Save credentials for a platform. Admin-only. (Legacy: replaces all stored
 * fields with the values posted; used by the inline ApiConnectionCard. The
 * new full-page edit form below uses upsertCredential instead.)
 */
export async function saveCredentials(
  formData: FormData,
): Promise<SaveCredentialsResult> {
  await requireAdmin();

  const platformRaw = String(formData.get("platform") ?? "");
  if (!VALID_PLATFORMS.has(platformRaw as CredentialPlatform)) {
    return { ok: false, error: "Unknown platform." };
  }
  const platform = platformRaw as CredentialPlatform;
  const def = getPlatformDef(platform);

  const credentials: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of def.fields) {
    const value = String(formData.get(`field_${field.key}`) ?? "").trim();
    if (value) credentials[field.key] = value;
    else if (field.required) missing.push(field.label);
  }

  if (missing.length) {
    return {
      ok: false,
      error: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("api_credentials")
    .upsert(
      {
        platform,
        credentials,
        is_active: true,
        last_validated_at: null,
      },
      { onConflict: "platform" },
    );

  if (error) {
    return { ok: false, error: `Save failed: ${error.message}` };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Disconnect a platform — soft toggle, keeps the row but flips is_active.
 */
export async function setPlatformActive(
  platform: CredentialPlatform,
  isActive: boolean,
): Promise<SaveCredentialsResult> {
  await requireAdmin();

  if (!VALID_PLATFORMS.has(platform)) {
    return { ok: false, error: "Unknown platform." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("api_credentials")
    .update({ is_active: isActive })
    .eq("platform", platform);

  if (error) {
    return { ok: false, error: `Update failed: ${error.message}` };
  }

  revalidatePath("/settings");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// New full-page edit form server actions (sprint 2)
// ---------------------------------------------------------------------------

function readString(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readInt(form: FormData, key: string): number | null {
  const v = form.get(key);
  if (typeof v !== "string" || v.trim().length === 0) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) && Math.trunc(n) === n ? n : null;
}

type MlsFeedUpdate = Database["public"]["Tables"]["mls_feeds"]["Update"];

/**
 * Upsert one mls_feeds row by short_code. Admin-only.
 *
 * Secret fields (password, api_key, api_secret): an empty form value means
 * "keep the existing value" — those keys are simply omitted from the patch.
 */
export async function upsertMlsFeed(
  shortCode: string,
  _prev: FormActionState | null,
  form: FormData,
): Promise<FormActionState> {
  await requireAdmin();

  if (!shortCode) {
    return { ok: false, error: "Missing feed short_code." };
  }

  const admin = createAdminClient();

  // First fetch current feed_type — it determines which subset of columns
  // to read off the form.
  const { data: existing, error: fetchErr } = await admin
    .from("mls_feeds")
    .select("feed_type")
    .eq("short_code", shortCode)
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, error: `Lookup failed: ${fetchErr.message}` };
  }
  if (!existing) {
    return { ok: false, error: `No feed found with short_code='${shortCode}'.` };
  }

  const name = readString(form, "name");
  if (!name) {
    return { ok: false, error: "Display name is required." };
  }

  const patch: MlsFeedUpdate = {
    name,
    description: readString(form, "description"),
    office_filter: readString(form, "office_filter"),
    status_filter: readString(form, "status_filter"),
    notes: readString(form, "notes"),
    max_records: readInt(form, "max_records"),
    updated_at: new Date().toISOString(),
  };

  if (existing.feed_type === "rets") {
    patch.rets_url = readString(form, "rets_url");
    patch.username = readString(form, "username");
    patch.rets_version = readString(form, "rets_version");
    // Password: only persist when non-empty (keeps existing on blank).
    const newPassword = readString(form, "password");
    if (newPassword !== null) patch.password = newPassword;
  } else {
    patch.base_url = readString(form, "base_url");
    const newApiKey = readString(form, "api_key");
    if (newApiKey !== null) patch.api_key = newApiKey;
    const newApiSecret = readString(form, "api_secret");
    if (newApiSecret !== null) patch.api_secret = newApiSecret;
  }

  const { error } = await admin
    .from("mls_feeds")
    .update(patch)
    .eq("short_code", shortCode);

  if (error) {
    return { ok: false, error: `Save failed: ${error.message}` };
  }

  revalidatePath("/settings");
  redirect("/settings");
}

/**
 * Trigger an immediate sync for one MLS feed. Admin-only.
 *
 * Invokes the mls-rets-sync Edge Function (CMC + SJSR only — Bright is RESO
 * Web API and not yet wired up here). Returns the raw result so the UI can
 * surface counts + class-level errors without polling.
 *
 * The Edge Function itself updates mls_feeds.last_sync_at /
 * last_validated_at / last_validated_ok and writes a sync_runs audit row per
 * (feed × property class), so the feed-edit page just needs to revalidate.
 */
export interface MlsFeedSyncResult {
  ok: boolean;
  feed_short_code: string;
  feed_name: string;
  duration_ms: number;
  classes: Array<{
    class: string;
    records_seen: number;
    records_upserted: number;
    error?: string;
  }>;
  errors: string[];
}

export async function syncMlsFeed(
  shortCode: string,
): Promise<MlsFeedSyncResult> {
  await requireAdmin();
  if (!shortCode) {
    return {
      ok: false,
      feed_short_code: "",
      feed_name: "",
      duration_ms: 0,
      classes: [],
      errors: ["Missing feed short_code"],
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      ok: false,
      feed_short_code: shortCode,
      feed_name: "",
      duration_ms: 0,
      classes: [],
      errors: [
        "Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
      ],
    };
  }

  // Bright handled separately (RESO Web API, not RETS).
  if (shortCode !== "cmc" && shortCode !== "sjsr") {
    return {
      ok: false,
      feed_short_code: shortCode,
      feed_name: "",
      duration_ms: 0,
      classes: [],
      errors: [
        `Sync now is currently wired for CMC + SJSR only. (${shortCode} feed type is not yet supported.)`,
      ],
    };
  }

  const fnUrl = `${url}/functions/v1/mls-rets-sync`;
  try {
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ feed_short_code: shortCode }),
      cache: "no-store",
    });
    const body = await res.text();
    let parsed: MlsFeedSyncResult;
    try {
      parsed = JSON.parse(body) as MlsFeedSyncResult;
    } catch {
      parsed = {
        ok: false,
        feed_short_code: shortCode,
        feed_name: "",
        duration_ms: 0,
        classes: [],
        errors: [`HTTP ${res.status}: ${body.slice(0, 300)}`],
      };
    }
    revalidatePath("/settings");
    revalidatePath(`/settings/feeds/${shortCode}/edit`);
    revalidatePath("/listings");
    return parsed;
  } catch (e) {
    return {
      ok: false,
      feed_short_code: shortCode,
      feed_name: "",
      duration_ms: 0,
      classes: [],
      errors: [(e as Error).message],
    };
  }
}

/**
 * Toggle the is_active flag for one feed. Admin-only.
 * Form must POST with field "is_active" = "1" | "0".
 */
export async function toggleMlsFeedActive(
  shortCode: string,
  formData: FormData,
): Promise<void> {
  await requireAdmin();

  if (!shortCode) return;

  const admin = createAdminClient();
  const desired = String(formData.get("is_active") ?? "") === "1";

  const { error } = await admin
    .from("mls_feeds")
    .update({ is_active: desired, updated_at: new Date().toISOString() })
    .eq("short_code", shortCode);

  if (error) {
    console.error("toggleMlsFeedActive:", error);
  }

  revalidatePath("/settings");
}

/**
 * Upsert one api_credentials row by platform. Admin-only.
 *
 * Secret fields work the same way as mls_feeds: empty form value means
 * "keep what's already stored". The credentials jsonb is merged, not
 * replaced — non-secret fields can be cleared by submitting an empty
 * value (we delete the key); secrets cannot be cleared from the form
 * (admin must use SQL or the legacy bulk-replace flow).
 */
export async function upsertCredential(
  platform: CredentialPlatform,
  _prev: FormActionState | null,
  form: FormData,
): Promise<FormActionState> {
  await requireAdmin();

  if (!VALID_PLATFORMS.has(platform)) {
    return { ok: false, error: `Unknown platform: ${platform}` };
  }

  const def = getPlatformDef(platform);
  const admin = createAdminClient();

  // Load existing row so we can merge.
  const { data: existing, error: fetchErr } = await admin
    .from("api_credentials")
    .select("credentials, is_active")
    .eq("platform", platform)
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, error: `Lookup failed: ${fetchErr.message}` };
  }

  const existingCreds: Record<string, unknown> =
    existing?.credentials && typeof existing.credentials === "object"
      ? { ...(existing.credentials as Record<string, unknown>) }
      : {};

  const missing: string[] = [];

  for (const field of def.fields) {
    const raw = form.get(`field_${field.key}`);
    const value = typeof raw === "string" ? raw.trim() : "";

    if (field.secret) {
      // Blank means keep — only update on non-empty.
      if (value.length > 0) {
        existingCreds[field.key] = value;
      } else if (field.required && !existingCreds[field.key]) {
        missing.push(field.label);
      }
    } else {
      // Non-secret: blank means clear. Update.
      if (value.length > 0) {
        existingCreds[field.key] = value;
      } else {
        delete existingCreds[field.key];
        if (field.required) missing.push(field.label);
      }
    }
  }

  if (missing.length) {
    return {
      ok: false,
      error: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
    };
  }

  const isActive = String(form.get("is_active") ?? "") === "1";

  // Cast the merged credentials object back to Json. The database column is
  // typed as `Json | undefined`, which is intentionally narrower than
  // Record<string, unknown>; in practice we only ever store
  // string-keyed/string-valued maps.
  const credsForDb = existingCreds as unknown as Database["public"]["Tables"]["api_credentials"]["Insert"]["credentials"];

  const { error } = await admin.from("api_credentials").upsert(
    {
      platform,
      credentials: credsForDb,
      is_active: isActive,
      // Saving credentials does not validate them; null out so a stale
      // "last validated" timestamp doesn't lie about the new key.
      last_validated_at: null,
    },
    { onConflict: "platform" },
  );

  if (error) {
    return { ok: false, error: `Save failed: ${error.message}` };
  }

  revalidatePath("/settings");
  redirect("/settings");
}
