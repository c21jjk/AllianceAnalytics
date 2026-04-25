/**
 * Browser-side Supabase client.
 * Uses the public anon key. Subject to RLS.
 *
 * Never use this for api_credentials writes — that table has no policies and
 * blocks anon/authenticated access entirely. Use the server-side admin client
 * (lib/supabase/admin.ts) inside server actions instead.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
