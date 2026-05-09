import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export type OfficeRow = Database["public"]["Tables"]["offices"]["Row"];
export type OfficeInsert = Database["public"]["Tables"]["offices"]["Insert"];
export type OfficeUpdate = Database["public"]["Tables"]["offices"]["Update"];

export interface ListOfficesOptions {
  active_only?: boolean;
}

/**
 * Server-only data layer for the `offices` table. Uses the service-role
 * admin client for read consistency with other admin-side accessors.
 *
 * RLS allows authenticated SELECT, but going through admin keeps these
 * accessors safe to call from any server context (incl. server actions
 * that haven't yet authenticated the user).
 */
export async function listOffices(
  opts: ListOfficesOptions = {},
): Promise<OfficeRow[]> {
  const { active_only = true } = opts;
  const admin = createAdminClient();
  let query = admin.from("offices").select("*").order("name", { ascending: true });
  if (active_only) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error) {
    console.error("listOffices:", error);
    return [];
  }
  return data ?? [];
}

export async function getOffice(short_code: string): Promise<OfficeRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("offices")
    .select("*")
    .eq("short_code", short_code)
    .maybeSingle();
  if (error) {
    console.error("getOffice:", error);
    return null;
  }
  return data;
}

/**
 * Best-effort office inference from a city/zip pair. Used by future
 * ingestion pipelines to stamp posts.office_id when the post mentions a
 * town or zip we serve.
 *
 * Match precedence:
 *   1. zip exact match against offices.zip_codes_served
 *   2. city case-insensitive match against offices.towns_served
 *
 * Returns the office's id (uuid) or null when no office matches.
 */
export async function inferOfficeFromCityZip(
  city: string | null,
  zip: string | null,
): Promise<string | null> {
  const trimmedCity = city ? city.trim() : "";
  const trimmedZip = zip ? zip.trim() : "";
  if (!trimmedCity && !trimmedZip) return null;

  const offices = await listOffices({ active_only: true });
  if (offices.length === 0) return null;

  if (trimmedZip) {
    for (const office of offices) {
      const zips = office.zip_codes_served ?? [];
      if (zips.some((z) => z.trim() === trimmedZip)) {
        return office.id;
      }
    }
  }

  if (trimmedCity) {
    const lower = trimmedCity.toLowerCase();
    for (const office of offices) {
      const towns = office.towns_served ?? [];
      if (towns.some((t) => t.trim().toLowerCase() === lower)) {
        return office.id;
      }
    }
  }

  return null;
}

/**
 * Profile-completeness heuristic used by the offices index card.
 * "Complete" requires the qualitative fields admins are expected to fill,
 * plus a median price and at least one signature angle.
 */
export function isOfficeProfileComplete(office: OfficeRow): boolean {
  const hasText = (s: string | null | undefined): boolean =>
    typeof s === "string" && s.trim().length > 0;
  return (
    hasText(office.primary_buyer_demo) &&
    hasText(office.primary_seller_demo) &&
    hasText(office.seasonal_pattern) &&
    office.price_range_median !== null &&
    office.price_range_median !== undefined &&
    Array.isArray(office.signature_angles) &&
    office.signature_angles.length > 0
  );
}
