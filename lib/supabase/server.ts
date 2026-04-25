/**
 * Server-side Supabase client (server components, route handlers, server actions).
 * Uses the public anon key + the user's session cookies, so RLS still applies
 * exactly as it would in the browser. The user's auth context is preserved.
 *
 * For privileged operations that bypass RLS (e.g. reading/writing api_credentials),
 * use lib/supabase/admin.ts instead.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored when middleware is refreshing sessions.
          }
        },
      },
    },
  );
}
