/**
 * Listings data layer.
 *
 * Reads from the dedicated "Alliance Listings" Supabase project
 * (umziekblnbobkezbbupg) — NOT the AllianceAnalytics DB.
 *
 * Two consumers:
 *   1. The Listings admin pages (/listings/*) — full CRUD by Alliance staff.
 *   2. The Classify panel on /posts/[id] — search-as-you-type to attach a
 *      post to a specific listing.
 *
 * Replication into AllianceAnalytics' `properties` table is handled by
 * the listings-sync Edge Function on the AllianceAnalytics project.
 */
import "server-only";
import { createListingsAdminClient } from "@/lib/supabase/listings-admin";
import type {
  ActiveListingInsert,
  ActiveListingRow,
  ActiveListingUpdate,
} from "@/lib/supabase/listings-types";

export type Listing = ActiveListingRow;

/**
 * List recent active/pending listings (most recently synced first).
 * Used as the default Listings index view.
 */
export async function listListings(opts?: {
  status?: ActiveListingRow["status"][];
  limit?: number;
}): Promise<Listing[]> {
  const supabase = createListingsAdminClient();
  let q = supabase
    .from("active_listings")
    .select("*")
    .order("synced_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  const statuses = opts?.status ?? ["active", "pending"];
  if (statuses.length > 0) q = q.in("status", statuses);
  const { data, error } = await q;
  if (error) {
    console.error("listListings:", error);
    return [];
  }
  return (data ?? []) as Listing[];
}

/**
 * Search active listings for the per-post Classify panel.
 *
 * Matches MLS number prefix OR address/city substring (case-insensitive).
 * Limited to active+pending status by default — sold/expired listings are
 * usually not what a current post should be linked to.
 */
export async function searchListings(
  query: string,
  opts?: { limit?: number },
): Promise<Listing[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const supabase = createListingsAdminClient();

  // Build OR filter — Supabase PostgREST `or=` syntax.
  // mls_number.ilike, address.ilike, city.ilike
  const escaped = trimmed.replace(/[%,]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;
  const { data, error } = await supabase
    .from("active_listings")
    .select(
      "id, mls_number, address, city, state, zip, list_price, status, hero_image_url, listing_date",
    )
    .in("status", ["active", "pending"])
    .or(
      [
        `mls_number.ilike.${pattern}`,
        `address.ilike.${pattern}`,
        `city.ilike.${pattern}`,
      ].join(","),
    )
    .order("synced_at", { ascending: false })
    .limit(opts?.limit ?? 12);
  if (error) {
    console.error("searchListings:", error);
    return [];
  }
  return (data ?? []) as Listing[];
}

export async function getListingByMls(
  mlsNumber: string,
): Promise<Listing | null> {
  const supabase = createListingsAdminClient();
  const { data } = await supabase
    .from("active_listings")
    .select("*")
    .eq("mls_number", mlsNumber)
    .maybeSingle();
  return (data as Listing | null) ?? null;
}

export async function createListing(
  input: ActiveListingInsert,
): Promise<{ ok: true; row: Listing } | { ok: false; error: string }> {
  const supabase = createListingsAdminClient();
  const { data, error } = await supabase
    .from("active_listings")
    .insert(input)
    .select()
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }
  return { ok: true, row: data as Listing };
}

export async function updateListing(
  mlsNumber: string,
  patch: ActiveListingUpdate,
): Promise<{ ok: true; row: Listing } | { ok: false; error: string }> {
  const supabase = createListingsAdminClient();
  const { data, error } = await supabase
    .from("active_listings")
    .update(patch)
    .eq("mls_number", mlsNumber)
    .select()
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Update failed" };
  }
  return { ok: true, row: data as Listing };
}
