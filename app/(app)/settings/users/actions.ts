"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin user-management server actions.
 *
 * All actions require the caller to be a current admin (`requireAdmin()`),
 * and use the service-role admin client for the underlying auth.users +
 * profiles writes. We never expose service-role calls to the browser.
 *
 * Notes:
 *   - There is no auth.users → profiles trigger; every action here that
 *     creates / updates / deletes an auth user also touches profiles in the
 *     same transaction-ish flow. (Supabase's admin API can't be wrapped in a
 *     SQL transaction with the table writes; we do best-effort sequencing.)
 *   - Self-actions (changeOwnPassword) live in `../security/actions.ts`. Those
 *     don't need admin role and use the user's own session, not service role.
 */

export type UserRole = "admin" | "user";

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set on inviteUser success — admin needs to share password with new user. */
  user_id?: string;
}

const VALID_ROLES: UserRole[] = ["admin", "user"];

function readString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function readBool(form: FormData, key: string): boolean {
  const v = form.get(key);
  return typeof v === "string" && (v === "1" || v.toLowerCase() === "true");
}

/**
 * Provision a new account. Sets initial password directly (no email
 * verification round-trip — admin shares the password with the user).
 */
export async function inviteUserAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const email = readString(form, "email").toLowerCase();
  const fullName = readString(form, "full_name");
  const password = readString(form, "password");
  const roleRaw = readString(form, "role");

  if (!email || !email.includes("@")) {
    return { ok: false, error: "A valid email address is required." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  const role: UserRole = (VALID_ROLES as string[]).includes(roleRaw)
    ? (roleRaw as UserRole)
    : "user";

  const admin = createAdminClient();

  // 1. Create the auth user, marked email_confirmed so they can sign in
  //    immediately without a verification email.
  const { data: createData, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });

  if (createErr || !createData?.user) {
    const msg = createErr?.message ?? "Auth user creation failed.";
    // Common case: email already exists. Map to a friendly message.
    if (/already.*registered|already.*exists|duplicate/i.test(msg)) {
      return {
        ok: false,
        error: `An account with ${email} already exists.`,
      };
    }
    return { ok: false, error: msg };
  }

  const userId = createData.user.id;

  // 2. Insert the matching profiles row. If it already exists (race or
  //    leftover row), update in place.
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        full_name: fullName.length > 0 ? fullName : null,
        role,
        is_active: true,
      },
      { onConflict: "id" },
    );

  if (profileErr) {
    // Best-effort rollback so we don't leave an auth user with no profile.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    return {
      ok: false,
      error: `Profile insert failed: ${profileErr.message}. Auth user rolled back.`,
    };
  }

  revalidatePath("/settings");
  revalidatePath("/settings/users");
  return { ok: true, user_id: userId };
}

/**
 * Update a user's role. Blocks demoting the last admin so the system never
 * ends up locked out of admin-only pages.
 */
export async function updateUserRoleAction(
  userId: string,
  newRole: UserRole,
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!userId) return { ok: false, error: "Missing user id" };
  if (!(VALID_ROLES as string[]).includes(newRole)) {
    return { ok: false, error: `Invalid role: ${newRole}` };
  }

  const admin = createAdminClient();

  // Fetch current state and admin count to enforce last-admin guard.
  const { data: target } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return { ok: false, error: "User not found." };
  if (target.role === newRole) {
    return { ok: true }; // no-op
  }

  if (target.role === "admin" && newRole === "user") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        error: "Cannot demote the last active admin.",
      };
    }
    if (target.id === me.id) {
      return {
        ok: false,
        error: "You cannot demote yourself while you are the last admin.",
      };
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
}

/**
 * Toggle is_active. Disabled users are bounced from any authenticated request
 * by `requireUser()` (with a forced sign-out).
 */
export async function setUserActiveAction(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!userId) return { ok: false, error: "Missing user id" };
  if (userId === me.id && !active) {
    return { ok: false, error: "You cannot disable your own account." };
  }

  const admin = createAdminClient();

  if (!active) {
    // Last-admin guard
    const { data: target } = await admin
      .from("profiles")
      .select("role, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (!target) return { ok: false, error: "User not found." };
    if (target.role === "admin" && target.is_active) {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true);
      if ((count ?? 0) <= 1) {
        return {
          ok: false,
          error: "Cannot disable the last active admin.",
        };
      }
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
}

/**
 * Hard delete an account: removes the auth.users row (cascades to sessions)
 * AND the profiles row. Blocks self-delete and last-admin delete.
 */
export async function deleteUserAction(userId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!userId) return { ok: false, error: "Missing user id" };
  if (userId === me.id) {
    return { ok: false, error: "You cannot delete your own account." };
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return { ok: false, error: "User not found." };

  if (target.role === "admin" && target.is_active) {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "Cannot delete the last active admin." };
    }
  }

  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    return { ok: false, error: `Auth delete failed: ${authErr.message}` };
  }
  // profiles.id has ON DELETE CASCADE in supabase auth schemas typically,
  // but be defensive — explicitly delete in case it's not configured.
  await admin.from("profiles").delete().eq("id", userId);

  revalidatePath("/settings/users");
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Admin escape hatch: set a user's password without knowing their current.
 * The admin types the new value; we display nothing afterward and leave it to
 * the admin to share with the user via a side channel.
 */
export async function adminResetPasswordAction(
  userId: string,
  newPassword: string,
): Promise<ActionResult> {
  await requireAdmin();
  if (!userId) return { ok: false, error: "Missing user id" };
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/users");
  return { ok: true };
}

// Re-export readBool so the form helpers can use it if we need toggle inputs.
export { readBool };
