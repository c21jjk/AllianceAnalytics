import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "user";

export interface AuthProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
}

/**
 * Returns the authenticated user + their profile row.
 * Returns null if not signed in or if the profile row is missing.
 */
export async function getCurrentProfile(): Promise<AuthProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) return null;
  return profile as AuthProfile;
}

/**
 * Hard-redirects to /login if not authenticated. Use this in server components
 * for any route that requires sign-in.
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
