"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  consumeAccountLink,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth-links/account-links";

export interface SetPasswordResult {
  ok: boolean;
  error?: string;
}

/**
 * Public action behind /set-password. The emailed token is the only proof of
 * identity, and it is consumed HERE (on submit), never on page load.
 */
export async function setPasswordAction(
  _prev: SetPasswordResult | null,
  form: FormData,
): Promise<SetPasswordResult> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm_password") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password !== confirm) {
    return { ok: false, error: "The two passwords do not match." };
  }

  const result = await consumeAccountLink(token, password);
  if (!result.ok) return { ok: false, error: result.error };

  // Sign them straight in. This also replaces any other session that happens
  // to be in this browser (an admin testing the link, a shared office Mac).
  const supabase = await createClient();
  await supabase.auth.signOut().catch(() => undefined);
  const { error } = await supabase.auth.signInWithPassword({
    email: result.email,
    password,
  });
  if (error) {
    // Password IS set at this point; send them to sign in by hand.
    redirect("/login");
  }

  revalidatePath("/", "layout");
  redirect("/");
}
