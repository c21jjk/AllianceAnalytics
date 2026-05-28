/**
 * Template Builder — short-lived signed render tokens.
 *
 * The DB-template render pipeline works by:
 *   1. The server-side `renderDbTemplate()` signs a token carrying
 *      { template_id, listing_id, format, exp } using HMAC-SHA256.
 *   2. The renderer hands a URL like /render/template/<token> to headless
 *      Chromium.
 *   3. The /render/template/[token]/page.tsx route verifies the token,
 *      decodes the payload, and server-fetches the data needed to mount
 *      the canvas in a client component.
 *   4. Chromium screenshots the mounted canvas; we close the browser.
 *
 * Why signed tokens instead of session auth:
 *   • Headless Chromium has no cookie jar — it's a fresh browser per
 *     render. Passing the server's session cookie through is brittle.
 *   • The token IS the auth — possession of a valid signature proves the
 *     server-side renderer constructed this URL. Nothing else can.
 *   • Tokens are short-lived (default 5 minutes) so a leaked token has
 *     minimal blast radius. The render itself takes ~5-30s.
 *
 * Token shape: base64url(payload).base64url(signature)
 *   • payload  — JSON-stringified RenderTokenPayload
 *   • signature — HMAC-SHA256(payload) using process.env.RENDER_TOKEN_SECRET
 *
 * The signature covers ONLY the payload (no extra nonce) because the
 * `exp` field inside the payload already prevents replay attacks past
 * the expiry window. Cryptographically equivalent to JWT HS256 minus
 * the header byte — JWT adds nothing useful for an internal-only
 * service-to-service flow.
 */

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PostFormat } from "@/lib/post-builder/types";

/** Inside-the-system token payload. Serialized to JSON, base64url-encoded,
 *  HMAC-signed. Decoded on the receiving end. */
export interface RenderTokenPayload {
  /**
   * The template to render. For DB templates this is a UUID; for Phase 2
   * AI Design it can be any non-empty string (e.g., a synthetic
   * `ai_design:<post_type>_<variant>_<format>` tag) — when
   * `ai_schema_cache_id` is also set, the page IGNORES template_id and
   * loads the schema from the cache instead. Kept required so the token
   * shape stays back-compat with the existing DB-template path.
   */
  template_id: string;
  /** UUID of the properties row used as the binding context. */
  listing_id: string;
  format: PostFormat;
  /** Hosting agent override (Open House posts). Optional. */
  hosting_agent_name?: string | null;
  /**
   * Pre-formatted hosting-agent phone — already passed through
   * `formatPhone()` server-side. Carried in the token so the render page
   * can attach it to the MLSListingPayload's `hosting_agent` field
   * without a second cross-project DB lookup at render time.
   */
  hosting_agent_phone?: string | null;
  /**
   * Hosting-agent headshot URL resolved server-side from `brand_assets`
   * (via the existing `fetchAgentHeadshotUrl` helper). Same rationale as
   * the phone field — token carries the resolved value so the render
   * page doesn't repeat the lookup.
   */
  hosting_agent_photo_url?: string | null;
  /** Pre-formatted OH window label. Optional. */
  oh_window?: string | null;
  /**
   * Open-House session window override (multi-OH wizard). When set,
   * the render page stamps these onto the MLSListingPayload's
   * `openHouseStartUtc` / `openHouseEndUtc` before hydration, so the
   * `open_house_date` / `open_house_time` bound-field resolvers can
   * format them. Same rationale as the hosting_agent fields — token
   * carries the wizard-selected values so we don't re-read NULL
   * `properties.oh_start_at` / `oh_end_at` columns at render time.
   * Optional; non-multi-OH renders leave these unset.
   */
  open_house_start_utc?: string | null;
  open_house_end_utc?: string | null;
  /**
   * Phase 2 AI Design — when set, the render page reads the
   * `CanvasTemplateSchema` from `render_schema_cache.id = <this>` instead
   * of looking up template_id. This is how a freshly-generated AI design
   * (not persisted in `template_definitions`) reaches the headless
   * renderer. Optional; absent on every existing DB-template render path.
   */
  ai_schema_cache_id?: string | null;
  /** Unix epoch seconds. Token is invalid once now() > exp. */
  exp: number;
}

/** Default time-to-live. The full render pipeline (sign → Chromium boot →
 *  navigate → mount canvas → screenshot → upload) typically completes in
 *  10-30s; 5 minutes is comfortable headroom. */
const DEFAULT_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Secret resolution — DB first, env var fallback. Mirrors lib/ai/anthropic.ts
// ---------------------------------------------------------------------------
//
// Why DB first: the project's standing rule is "env vars set via Vercel MCP,
// never the dashboard." The Vercel MCP doesn't currently expose env-var
// write tools, so we store the signing secret in `api_credentials`
// (platform='render_token') instead. Supabase MCP can read/write that row
// without any dashboard touch.
//
// Env-var fallback (`RENDER_TOKEN_SECRET`) is kept for local dev and for
// scripts / one-off jobs that run outside the Next.js context where DB
// access is available but inconvenient. Production reads the DB row.
//
// Cache: 60s TTL — same as the Anthropic key. Long enough that a single
// render burst doesn't hammer the DB, short enough that rotating the
// secret via Supabase shows up within a minute.
interface RenderTokenCredentialPayload {
  secret?: unknown;
}

let cachedSecret: Buffer | null | undefined;
let cacheStamp = 0;
const SECRET_CACHE_TTL_MS = 60_000;

async function readSecretFromDb(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("api_credentials")
      .select("credentials, is_active")
      .eq("platform", "render_token")
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      console.error("[render-token] readSecretFromDb error:", error);
      return null;
    }
    if (!data) return null;
    const creds = (data.credentials ?? {}) as RenderTokenCredentialPayload;
    const raw = typeof creds.secret === "string" ? creds.secret.trim() : "";
    return raw.length > 0 ? raw : null;
  } catch (e) {
    console.error("[render-token] readSecretFromDb threw:", e);
    return null;
  }
}

/**
 * Resolve the HMAC signing secret. Returns a Buffer ready for crypto APIs.
 * Throws when neither source has a usable secret — callers (sign/verify)
 * surface that as "render token system not configured."
 *
 * Cache invariant: a single secret value lives for up to 60s. A rotation
 * via Supabase shows up on the next request after the TTL expires.
 */
async function getSecret(): Promise<Buffer> {
  const now = Date.now();
  if (cachedSecret !== undefined && now - cacheStamp < SECRET_CACHE_TTL_MS) {
    if (cachedSecret === null) {
      throw new Error(
        "render-token secret not configured — set api_credentials platform='render_token' or RENDER_TOKEN_SECRET env var (need >= 32 chars).",
      );
    }
    return cachedSecret;
  }

  const dbSecret = await readSecretFromDb();
  const envSecret = process.env.RENDER_TOKEN_SECRET?.trim() || null;
  const raw = dbSecret || envSecret;

  if (!raw || raw.length < 32) {
    cachedSecret = null;
    cacheStamp = now;
    throw new Error(
      "render-token secret not configured — set api_credentials platform='render_token' or RENDER_TOKEN_SECRET env var (need >= 32 chars).",
    );
  }

  cachedSecret = Buffer.from(raw, "utf8");
  cacheStamp = now;
  return cachedSecret;
}

/** Base64URL (RFC 4648 §5) — like base64 but with - and _ instead of + and
 *  /, and no = padding. Safe to drop straight into URL path segments. */
function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): Buffer {
  // Re-pad to a multiple of 4 so Buffer.from base64 doesn't choke.
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Sign a payload. Returns the opaque token string suitable for a URL path
 * segment. The `exp` field is filled in here (caller passes everything
 * else); pass `ttl_seconds` to override the default 5-minute window.
 *
 * Async because the secret comes from Supabase. The DB lookup is memoized
 * for 60s so the per-call cost is sub-ms in steady state — the first call
 * after a cold start (or a 60s gap) does a single DB roundtrip.
 */
export async function signRenderToken(
  payload: Omit<RenderTokenPayload, "exp">,
  ttl_seconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const full: RenderTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttl_seconds,
  };
  const payloadJson = JSON.stringify(full);
  const payloadBuf = Buffer.from(payloadJson, "utf8");
  const secret = await getSecret();
  const sig = createHmac("sha256", secret).update(payloadBuf).digest();
  return `${base64UrlEncode(payloadBuf)}.${base64UrlEncode(sig)}`;
}

/**
 * Verify + decode a token. Throws on any tampering, expiry, or shape
 * violation. Callers catch the error and 404 (don't surface the reason —
 * it's a service-to-service contract).
 *
 * Async because the secret comes from Supabase — see signRenderToken
 * for the cache rationale.
 */
export async function verifyRenderToken(
  token: string,
): Promise<RenderTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("malformed token (expected payload.signature)");
  }
  const [payloadPart, sigPart] = parts;
  let payloadBuf: Buffer;
  let sigBuf: Buffer;
  try {
    payloadBuf = base64UrlDecode(payloadPart);
    sigBuf = base64UrlDecode(sigPart);
  } catch {
    throw new Error("malformed token (base64url decode failed)");
  }

  // Recompute the expected signature and constant-time compare.
  const secret = await getSecret();
  const expected = createHmac("sha256", secret).update(payloadBuf).digest();
  // timingSafeEqual requires equal lengths; differing length is "wrong sig"
  // regardless of content, so reject without comparing.
  if (expected.length !== sigBuf.length) {
    throw new Error("invalid signature");
  }
  if (!timingSafeEqual(expected, sigBuf)) {
    throw new Error("invalid signature");
  }

  let payload: RenderTokenPayload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8")) as RenderTokenPayload;
  } catch {
    throw new Error("payload is not valid JSON");
  }

  if (
    typeof payload.template_id !== "string" ||
    typeof payload.listing_id !== "string" ||
    typeof payload.format !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("payload missing required fields");
  }

  if (Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error("token expired");
  }

  return payload;
}
