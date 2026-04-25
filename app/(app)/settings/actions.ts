"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import {
  getPlatformDef,
  type CredentialPlatform,
  PLATFORMS,
} from "./credentialSchemas";

const VALID_PLATFORMS = new Set(PLATFORMS.map((p) => p.platform));

export interface SaveCredentialsResult {
  ok: boolean;
  error?: string;
}

/**
 * Save credentials for a platform. Admin-only.
 * Stores the credentials JSON via the service-role client (bypasses RLS).
 * Returns nothing about the credentials themselves — only success/failure.
 */
export async function saveCredentials(
  formData: FormData,
): Promise<SaveCredentialsResult> {
  await requireAdmin();

  const platformRaw = String(formData.get("platform") ?? "");
  if (!VALID_PLATFORMS.has(platformRaw as CredentialPlatform)) {
    return { ok: false, error: "Unknown platform." };
  }
  const platform = platformRaw as CredentialPlatform;
  const def = getPlatformDef(platform);

  // Collect known fields only — ignore anything the client posts that we
  // didn't ask for, to avoid storing garbage.
  const credentials: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of def.fields) {
    const value = String(formData.get(`field_${field.key}`) ?? "").trim();
    if (value) credentials[field.key] = value;
    else if (field.required) missing.push(field.label);
  }

  if (missing.length) {
    return {
      ok: false,
      error: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("api_credentials")
    .upsert(
      {
        platform,
        credentials,
        is_active: true,
        // Phase 1 saves credentials but does not validate them. Phase 2 adds
        // real per-platform validation that will set last_validated_at.
        last_validated_at: null,
      },
      { onConflict: "platform" },
    );

  if (error) {
    return { ok: false, error: `Save failed: ${error.message}` };
  }

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Disconnect a platform — soft toggle, keeps the row but flips is_active.
 * Useful for "pause" without losing credentials. Admin-only.
 */
export async function setPlatformActive(
  platform: CredentialPlatform,
  isActive: boolean,
): Promise<SaveCredentialsResult> {
  await requireAdmin();

  if (!VALID_PLATFORMS.has(platform)) {
    return { ok: false, error: "Unknown platform." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("api_credentials")
    .update({ is_active: isActive })
    .eq("platform", platform);

  if (error) {
    return { ok: false, error: `Update failed: ${error.message}` };
  }

  revalidatePath("/settings");
  return { ok: true };
}
