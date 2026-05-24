/**
 * Shared resolver for the app's public base URL.
 *
 * Used by the headless render pipeline to construct URLs that Chromium can
 * actually navigate to. The headless renderer runs INSIDE a Vercel
 * serverless function and needs to fetch /render/template/<token> against
 * the app's PUBLIC custom domain — not the auto-generated .vercel.app URL,
 * which has Vercel Deployment Protection enabled and bounces unauthenticated
 * requests (Chromium included) to an auth wall.
 *
 * Resolution priority (first match wins):
 *   1. `system_config.public_app_url` — DB-stored override. Set via
 *      Supabase MCP / admin UI. Mirrors the DB-first / env-fallback
 *      pattern used for the Anthropic API key and the render-token
 *      signing secret. This is the path production should use.
 *   2. `RENDER_BASE_URL` env var — explicit override for one-off scripts
 *      or local dev when the DB is unreachable. Kept for back-compat
 *      with the previous inline resolvers.
 *   3. `VERCEL_URL` env var — Vercel auto-sets this to the deployment's
 *      .vercel.app URL on every deploy. Works fine when Deployment
 *      Protection is OFF; fails when it's ON (the case we're fixing).
 *   4. `http://localhost:3000` — dev fallback.
 *
 * Cache: 60s TTL, same as `lib/ai/anthropic.ts`. A URL change made via
 * the admin UI shows up within a minute on every warm function instance.
 *
 * Why a dedicated module (vs duplicating into each caller):
 *   Before this, `resolveBaseUrl` was duplicated in
 *   `lib/template-builder/renderer.ts` and
 *   `app/api/post-builder/design-and-render/route.ts`. The two could
 *   drift, and adding the DB-first lookup would have meant a 2x edit
 *   plus the risk of stale logic in the next caller that gets added.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

let cachedUrl: string | undefined;
let cacheStamp = 0;
/** 60s TTL — admin changes to system_config show up within a minute on
 *  every warm function instance, hot enough not to hammer the DB on each
 *  render-pipeline call. Matches the Anthropic / render-token cache. */
const CACHE_TTL_MS = 60_000;

async function readFromDb(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("system_config")
      .select("public_app_url")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      console.error("[app-url] readFromDb error:", error);
      return null;
    }
    const raw =
      data && typeof data.public_app_url === "string"
        ? data.public_app_url.trim()
        : "";
    return raw.length > 0 ? raw : null;
  } catch (e) {
    console.error("[app-url] readFromDb threw:", e);
    return null;
  }
}

/**
 * Resolve the app's public base URL — async, DB-backed, cached.
 *
 * Always returns a usable URL (never throws / never empty). Falls through
 * to localhost only when nothing else is configured, so dev still works.
 * Trailing slashes are stripped so callers can confidently concatenate
 * `${base}/render/template/${token}`.
 */
export async function getPublicAppUrl(): Promise<string> {
  const now = Date.now();
  if (cachedUrl !== undefined && now - cacheStamp < CACHE_TTL_MS) {
    return cachedUrl;
  }

  const dbUrl = await readFromDb();
  const envOverride = process.env.RENDER_BASE_URL?.trim() || null;
  const vercelHost = process.env.VERCEL_URL?.trim() || null;

  let resolved: string;
  if (dbUrl) {
    resolved = dbUrl;
  } else if (envOverride) {
    resolved = envOverride;
  } else if (vercelHost) {
    resolved = `https://${vercelHost}`;
  } else {
    resolved = "http://localhost:3000";
  }
  // Strip any trailing slash so concatenation stays clean.
  resolved = resolved.replace(/\/$/, "");

  cachedUrl = resolved;
  cacheStamp = now;
  return resolved;
}
