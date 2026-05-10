/**
 * Server-only factory that returns a configured Anthropic client.
 *
 * Per project rules ("all login info in the site"): the API key is read from
 * the api_credentials table (platform='claude', is_active=true). The /settings
 * dashboard hosts the form for John to paste his key into. We fall back to the
 * ANTHROPIC_API_KEY env var so local dev / scripts still work without DB.
 *
 * If neither source has a key, getAnthropic() returns null. ALL callers must
 * handle null gracefully — the UI surfaces hide themselves rather than show
 * a broken state.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

let cachedClient: Anthropic | null | undefined;
let cacheStamp = 0;
/** Re-check the credential row at most once per 60s — long enough to avoid
 *  hammering the DB, short enough that pasting a key in /settings makes the
 *  insight strip light up within a minute on the next page render. */
const CACHE_TTL_MS = 60_000;

interface ClaudeCredentialPayload {
  api_key?: unknown;
}

async function readKeyFromDb(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("api_credentials")
      .select("credentials, is_active")
      .eq("platform", "claude")
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      console.error("[anthropic] readKeyFromDb error:", error);
      return null;
    }
    if (!data) return null;
    const creds = (data.credentials ?? {}) as ClaudeCredentialPayload;
    const raw = typeof creds.api_key === "string" ? creds.api_key.trim() : "";
    return raw.length > 0 ? raw : null;
  } catch (e) {
    console.error("[anthropic] readKeyFromDb threw:", e);
    return null;
  }
}

/**
 * Returns a memoized Anthropic client, or null if no API key is configured.
 *
 * Cache: 60s TTL. Fetches the key from `api_credentials` first, falls back to
 * the ANTHROPIC_API_KEY env var. Safe to call from any server context.
 */
export async function getAnthropic(): Promise<Anthropic | null> {
  const now = Date.now();
  if (cachedClient !== undefined && now - cacheStamp < CACHE_TTL_MS) {
    return cachedClient;
  }

  const dbKey = await readKeyFromDb();
  const envKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const apiKey = dbKey || envKey;

  if (!apiKey) {
    cachedClient = null;
    cacheStamp = now;
    return null;
  }

  cachedClient = new Anthropic({ apiKey });
  cacheStamp = now;
  return cachedClient;
}

/**
 * Cheap probe used by /settings — true when either the DB row or the env var
 * has a key, regardless of whether the SDK can actually authenticate.
 */
export async function isAnthropicConfigured(): Promise<boolean> {
  const client = await getAnthropic();
  return client !== null;
}

/** Models pinned for this codebase. */
export const ANTHROPIC_MODELS = {
  /** Fast, cheap — used for batch / low-stakes calls. */
  sonnet: "claude-sonnet-4-6",
  /** Heavyweight coaching — per-post insights and /coach long-form plans. */
  opus: "claude-opus-4-6",
} as const;
