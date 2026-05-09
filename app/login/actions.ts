"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export async function signIn(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error, data } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { ok: false, error: "Invalid email or password." };
  }

  // Refuse sessions for disabled accounts. Tear down before any cookies are
  // committed so the disabled user never sees an authenticated state.
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle<{ is_active: boolean }>();
  if (!profile || profile.is_active === false) {
    await supabase.auth.signOut().catch(() => undefined);
    return {
      ok: false,
      error:
        "Your account has been disabled. Contact an admin if this is unexpected.",
    };
  }

  revalidatePath("/", "layout");
  // Validate redirect target — only allow same-origin relative paths.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(safeNext);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
