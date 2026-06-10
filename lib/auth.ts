import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "user";

export interface AuthProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
}

/**
 * Returns the authenticated user + their profile row.
 * Returns null if not signed in, if the profile row is missing, OR if the
 * profile is marked inactive — deactivated accounts must not retain API
 * access through routes that only call getCurrentProfile().
 *
 * why: wrapped in React cache() so layout + page (and any API helper in the
 * same request) share ONE auth round-trip instead of re-hitting Supabase
 * per call. cache() is per-request in RSC, so there is no cross-user leak.
 */
export const getCurrentProfile = cache(
  async (): Promise<AuthProfile | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (error || !profile) return null;
    // why: a deactivated account keeps a valid Supabase session until it
    // expires; treating inactive as "no profile" closes API access on every
    // route that gates on getCurrentProfile() alone. The session is torn
    // down here too: without signOut, the middleware still sees a valid
    // session, bounces /login back to /, requireUser bounces / back to
    // /login, and a disabled user gets an infinite redirect loop.
    if (!(profile as AuthProfile).is_active) {
      await supabase.auth.signOut().catch(() => undefined);
      return null;
    }
    return profile as AuthProfile;
  },
);

/**
 * Hard-redirects to /login if not authenticated (which now includes
 * deactivated accounts — getCurrentProfile returns null for them).
 */
export async function requireUser(): Promise<AuthProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

/**
 * Hard-redirects to "/" if the user is signed in but not an admin.
 */
export async function requireAdmin(): Promise<AuthProfile> {
  const profile = await requireUser();
  if (profile.role !== "admin") redirect("/");
  return profile;
}
