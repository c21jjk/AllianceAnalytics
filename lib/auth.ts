import "server-only";
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
 * Returns null if not signed in OR if the profile row is missing.
 *
 * NOTE: Does NOT enforce is_active — callers should use requireUser() if they
 * want disabled accounts bounced. This helper exists for read-only contexts
 * where it's safer to render an "account disabled" message than to redirect
 * mid-render.
 */
export async function getCurrentProfile(): Promise<AuthProfile | null> {
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
  return profile as AuthProfile;
}

/**
 * Hard-redirects to /login if not authenticated, OR if the profile row is
 * marked inactive. Disabled accounts are signed out so they can't keep using
 * a stale session.
 */
export async function requireUser(): Promise<AuthProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) {
    // Tear down the session so the user can't keep hitting protected pages.
    const supabase = await createClient();
    await supabase.auth.signOut().catch(() => undefined);
    redirect("/login?error=disabled");
  }
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
