import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export type CredentialPlatform =
  Database["public"]["Enums"]["credential_platform"];
export type ApiCredentialRow =
  Database["public"]["Tables"]["api_credentials"]["Row"];

export interface CredentialSummary {
  platform: CredentialPlatform;
  is_active: boolean;
  last_validated_at: string | null;
  has_value: boolean;
  configured_keys: string[];
  updated_at: string | null;
}

/**
 * Returns a sanitized list of credential rows for the index page.
 * IMPORTANT: actual credential values never leave this function — only
 * which keys are present and whether the row carries any value at all.
 */
export async function listCredentials(): Promise<CredentialSummary[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_credentials")
    .select(
      "platform, is_active, last_validated_at, credentials, updated_at",
    );
  if (error) {
    console.error("listCredentials:", error);
    return [];
  }
  const rows = data ?? [];
  return rows.map((r) => {
    const credObj =
      r.credentials && typeof r.credentials === "object"
        ? (r.credentials as Record<string, unknown>)
        : {};
    const keys = Object.keys(credObj).filter((k) => {
      const v = credObj[k];
      return typeof v === "string" ? v.trim().length > 0 : v != null;
    });
    return {
      platform: r.platform as CredentialPlatform,
      is_active: !!r.is_active,
      last_validated_at: r.last_validated_at ?? null,
      has_value: keys.length > 0,
      configured_keys: keys,
      updated_at: r.updated_at ?? null,
    };
  });
}

/**
 * Full row including the credentials jsonb. SERVER-ONLY — never serialize
 * the return value to the browser. The edit form prefills from this on the
 * server then renders only sanitized echoes (e.g. "••••" for secret fields).
 */
export async function getCredential(
  platform: CredentialPlatform,
): Promise<ApiCredentialRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_credentials")
    .select("*")
    .eq("platform", platform)
    .maybeSingle();
  if (error) {
    console.error("getCredential:", error);
    return null;
  }
  return data;
}
