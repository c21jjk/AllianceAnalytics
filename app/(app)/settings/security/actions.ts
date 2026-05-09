"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Self-service password change for the currently signed-in user.
 *
 * Verifies the current password by attempting a re-signin first (so an
 * attacker with a stolen session can't change the password without proof of
 * the current one), then calls auth.updateUser to set the new password.
 *
 * No email-verification round-trip; the change takes effect immediately.
 */
export interface ChangePasswordResult {
  ok: boolean;
  error?: string;
}

export async function changeOwnPasswordAction(
  _prev: ChangePasswordResult | null,
  form: FormData,
): Promise<ChangePasswordResult> {
  const me = await requireUser();

  const current = String(form.get("current_password") ?? "");
  const next = String(form.get("new_password") ?? "");
  const confirm = String(form.get("confirm_password") ?? "");

  if (!current || !next || !confirm) {
    return { ok: false, error: "All three fields are required." };
  }
  if (next.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters." };
  }
  if (next !== confirm) {
    return { ok: false, error: "New password and confirmation do not match." };
  }
  if (next === current) {
    return {
      ok: false,
      error: "New password must be different from the current password.",
    };
  }

  const supabase = await createClient();

  // Verify current password by re-signing in. This rotates the session
  // (Supabase issues fresh tokens), which is the safe behavior anyway.
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: me.email,
    password: current,
  });
  if (signInErr) {
    return { ok: false, error: "Current password is incorrect." };
  }

  const { error: updateErr } = await supabase.auth.updateUser({
    password: next,
  });
  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }

  revalidatePath("/settings/security");
  return { ok: true };
}
