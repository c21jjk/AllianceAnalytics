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
  /** Pre-formatted OH window label. Optional. */
  oh_window?: string | null;
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

function getSecret(): Buffer {
  const secret = process.env.RENDER_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "RENDER_TOKEN_SECRET env var missing or too short (need >= 32 chars). " +
        "Set it via the Vercel MCP — see lib/template-builder/render-token.ts.",
    );
  }
  return Buffer.from(secret, "utf8");
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
 */
export function signRenderToken(
  payload: Omit<RenderTokenPayload, "exp">,
  ttl_seconds: number = DEFAULT_TTL_SECONDS,
): string {
  const full: RenderTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttl_seconds,
  };
  const payloadJson = JSON.stringify(full);
  const payloadBuf = Buffer.from(payloadJson, "utf8");
  const sig = createHmac("sha256", getSecret()).update(payloadBuf).digest();
  return `${base64UrlEncode(payloadBuf)}.${base64UrlEncode(sig)}`;
}

/**
 * Verify + decode a token. Throws on any tampering, expiry, or shape
 * violation. Callers catch the error and 404 (don't surface the reason —
 * it's a service-to-service contract).
 */
export function verifyRenderToken(token: string): RenderTokenPayload {
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
  const expected = createHmac("sha256", getSecret()).update(payloadBuf).digest();
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
