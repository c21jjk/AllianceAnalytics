/**
 * Service-role Supabase client. BYPASSES Row Level Security.
 *
 * STRICT RULES:
 *   1. NEVER import this from a "use client" file.
 *   2. NEVER pass any value derived from this client back to the browser
 *      without explicit allow-listing of safe fields. In particular, the
 *      `credentials` JSON column on api_credentials must never leave the
 *      server boundary.
 *   3. Use this only inside server actions or route handlers for operations
 *      that legitimately require RLS bypass (api_credentials read/write,
 *      auth admin user management).
 */
import "server-only";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "./types";

type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | null = null;

export function createAdminClient(): AdminClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase admin env vars. " +
        "Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  cached = createSupabaseClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
