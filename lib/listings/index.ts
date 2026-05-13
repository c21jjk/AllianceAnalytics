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
 * Search listings for the per-post Classify panel.
 *
 * Matches MLS number prefix OR address/city substring (case-insensitive).
 * Returns active + pending listings (always), plus sold listings that
 * closed within the last 14 days — so Larissa can tag a "Just Sold" post
 * to the right listing without digging through historical inventory.
 *
 * Expired/withdrawn listings are intentionally excluded — those shouldn't
 * be linkable to new posts.
 */
export async function searchListings(
  query: string,
  opts?: { limit?: number },
): Promise<Listing[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const supabase = createListingsAdminClient();

  const escaped = trimmed.replace(/[%,]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;
  const limit = opts?.limit ?? 12;

  // Sold-window cutoff: 14 days ago. Only sold listings closed since then
  // are linkable; older closed inventory is excluded.
  const soldCutoff = new Date(Date.now() - 14 * 86400_000)
    .toISOString()
    .slice(0, 10);

  // Status filter: (status IN (active, pending)) OR (status = sold AND
  // close_date >= soldCutoff). Run as two queries to keep the SQL simple
  // and the result sets small — Supabase's PostgREST `or` syntax doesn't
  // mix well with the existing text-match `or` filter.
  const textFilter = [
    `mls_number.ilike.${pattern}`,
    `address.ilike.${pattern}`,
    `city.ilike.${pattern}`,
  ].join(",");

  const [activeResp, soldResp] = await Promise.all([
    supabase
      .from("active_listings")
      .select(
        "id, mls_number, address, city, state, zip, list_price, status, hero_image_url, listing_date, close_date, close_price, synced_at",
      )
      .in("status", ["active", "pending"])
      .or(textFilter)
      .order("synced_at", { ascending: false })
      .limit(limit),
    supabase
      .from("active_listings")
      .select(
        "id, mls_number, address, city, state, zip, list_price, status, hero_image_url, listing_date, close_date, close_price, synced_at",
      )
      .eq("status", "sold")
      .gte("close_date", soldCutoff)
      .or(textFilter)
      .order("close_date", { ascending: false })
      .limit(limit),
  ]);
  if (activeResp.error) console.error("searchListings active:", activeResp.error);
  if (soldResp.error) console.error("searchListings sold:", soldResp.error);

  // Merge + dedup by mls_number (active+pending wins over sold for the same MLS).
  const out: Listing[] = [];
  const seen = new Set<string>();
  for (const r of (activeResp.data ?? []) as Listing[]) {
    if (seen.has(r.mls_number)) continue;
    seen.add(r.mls_number);
    out.push(r);
  }
  for (const r of (soldResp.data ?? []) as Listing[]) {
    if (seen.has(r.mls_number)) continue;
    seen.add(r.mls_number);
    out.push(r);
  }
  return out.slice(0, limit);
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
