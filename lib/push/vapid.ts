import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * VAPID key resolution — DB first, env fallback. Mirrors
 * lib/template-builder/render-token.ts:
 *
 * Why DB first: the project's standing rule is "env vars set via Vercel
 * MCP, never the dashboard" — and the Vercel MCP exposes no env-var
 * write tools. So the keypair lives in `api_credentials`
 * (platform='web_push', credentials = { public_key, private_key,
 * subject }), written via Supabase MCP with zero dashboard touches.
 *
 * Env fallback (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
 * VAPID_SUBJECT) kept for local dev.
 *
 * Cache: 60s TTL, same as the render-token secret.
 */

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

interface WebPushCredentialPayload {
  public_key?: unknown;
  private_key?: unknown;
  subject?: unknown;
}

let cached: VapidKeys | null | undefined;
let cacheStamp = 0;
const CACHE_TTL_MS = 60_000;

async function readFromDb(): Promise<VapidKeys | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("api_credentials")
      .select("credentials, is_active")
      .eq("platform", "web_push")
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      console.error("[push/vapid] readFromDb error:", error.message);
      return null;
    }
    if (!data) return null;
    const creds = (data.credentials ?? {}) as WebPushCredentialPayload;
    const publicKey =
      typeof creds.public_key === "string" ? creds.public_key.trim() : "";
    const privateKey =
      typeof creds.private_key === "string" ? creds.private_key.trim() : "";
    const subject =
      typeof creds.subject === "string" && creds.subject.trim()
        ? creds.subject.trim()
        : "mailto:jkcrumb@me.com";
    if (!publicKey || !privateKey) return null;
    return { publicKey, privateKey, subject };
  } catch (e) {
    console.error("[push/vapid] readFromDb threw:", e);
    return null;
  }
}

function readFromEnv(): VapidKeys | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT?.trim() || "mailto:jkcrumb@me.com",
  };
}

/** Resolve the VAPID keypair, or null when push isn't configured. */
export async function getVapidKeys(): Promise<VapidKeys | null> {
  const now = Date.now();
  if (cached !== undefined && now - cacheStamp < CACHE_TTL_MS) {
    return cached;
  }
  cached = (await readFromDb()) ?? readFromEnv();
  cacheStamp = now;
  return cached;
}
