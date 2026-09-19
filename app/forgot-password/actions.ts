"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createAccountLink } from "@/lib/auth-links/account-links";
import {
  sendInviteEmail,
  sendPasswordResetEmail,
} from "@/lib/email/account-emails";

export interface ForgotPasswordResult {
  /** True once the form has been handled, whatever happened behind it. */
  done: boolean;
  error?: string;
}

/**
 * Public action behind /forgot-password.
 *
 * Always answers the same way whether or not the email has an account, so
 * the form can't be used to find out who has a login. Unknown emails,
 * disabled accounts and throttled repeats all quietly send nothing.
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordResult | null,
  form: FormData,
): Promise<ForgotPasswordResult> {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@") || email.length > 254) {
    return { done: false, error: "Enter the email you sign in with." };
  }

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, full_name, is_active")
      .ilike("email", email)
      .maybeSingle();

    if (profile && profile.is_active !== false) {
      // Someone who was invited but never activated gets a fresh invite
      // rather than a "reset" for a password they never had.
      const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
      const neverSignedIn = !authUser?.user?.last_sign_in_at;
      const kind = neverSignedIn ? "invite" : "reset";

      const link = await createAccountLink({ userId: profile.id, kind });
      if (link.ok) {
        const sent =
          kind === "invite"
            ? await sendInviteEmail({
                to: profile.email,
                fullName: profile.full_name,
                inviterName: null,
                url: link.url,
              })
            : await sendPasswordResetEmail({
                to: profile.email,
                fullName: profile.full_name,
                url: link.url,
              });
        if (!sent.ok) {
          console.error("[forgot-password] email send failed:", sent.error);
        }
      } else if (link.reason === "error") {
        console.error("[forgot-password] link create failed:", link.error);
      }
    }
  } catch (e) {
    console.error("[forgot-password] unexpected:", e);
  }

  return { done: true };
}
