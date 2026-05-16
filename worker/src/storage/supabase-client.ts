/**
 * Singleton Supabase admin client for the render worker.
 *
 * why a singleton: each `createClient` call instantiates its own fetch
 * keepalive pool + auth state machine. Creating a fresh client per
 * upload thrashes connections (new TLS handshakes, no pooled sockets)
 * and burns ~50ms of overhead the worker can't afford during a render
 * pipeline. One process-wide client is the standard pattern for
 * server-side @supabase/supabase-js usage.
 *
 * why service-role key: the worker writes to Storage on behalf of an
 * already-authenticated user that the main app has vetted. We don't
 * want to re-run RLS for every render — the worker is a trusted
 * backend service. The service-role key is gated to this module so
 * downstream code can't accidentally pass it somewhere user-facing.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "../lib/env.js";

// why: module-level cache. Reset is intentionally not exported — there
// is no legitimate reason to swap the admin client at runtime, and
// allowing reset would invite subtle bugs (mid-upload swap, partial
// keepalive cleanup).
let cached: SupabaseClient | null = null;

/**
 * Returns the shared Supabase admin client. Service-role key — bypasses
 * RLS. Used exclusively for Storage uploads inside the worker; never
 * exposed beyond this module.
 *
 * The client is lazily constructed on first call and reused for every
 * subsequent call within the same process. Safe to call from anywhere
 * inside `worker/src/storage/`.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached !== null) return cached;

  const env = loadEnv();

  // why: explicit `auth` options. The defaults persist a session to
  // localStorage (which doesn't exist in Node — emits a warning) and
  // try to auto-refresh tokens (irrelevant for a service-role key
  // that doesn't expire). Disabling both removes noise and avoids a
  // background timer that would keep the Node event loop alive.
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cached;
}
