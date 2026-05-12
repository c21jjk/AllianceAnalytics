import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-only fetchers for the dashboard's right-column cards:
 *   - getUnderContractListings  → status='pending' (a current state)
 *   - getRecentlySoldListings   → status='sold' AND close_date within window
 *
 * Both mirror the office-filter + result-shape conventions used by
 * `getListingsNeedingPosts` so the dashboard can render them with consistent
 * row layouts. Powered by the Phase 7 RETS sync additions that capture
 * close_date + close_price from Paragon.
 *
 * Neither fetcher applies any "needs coverage" gating — Larissa wants to see
 * every settled / pending listing so she can decide whether to make a post.
 */

type PropertyStatus = Database["public"]["Enums"]["property_status"];
type SourceMls = "cmc" | "sjsr" | "bright" | string | null;

/** Shared row shape between Recently Sold and Under Contract surfaces. */
export interface ListingMilestone {
  id: string;
  mls_number: string;
  source_mls: SourceMls;
  status: PropertyStatus;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  /**
   * The price to display prominently. For sold listings this is close_price;
   * for pending listings it's list_price. Callers shouldn't need to branch.
   */
  display_price: number | null;
  /**
   * The date that defines the row's "freshness." For sold = close_date,
   * for pending = listing_date (or updated_at when listing_date missing).
   */
  reference_date: string;
  reference_date_kind: "close_date" | "listing_date" | "updated_at";
  hero_image_url: string | null;
  agent_name: string | null;
  office_short_code: string | null;
}

export interface GetUnderContractOptions {
  office_short_code?: string | null;
  limit?: number;
}

export interface GetRecentlySoldOptions {
  /** Default 30 days. */
  windowDays?: number;
  office_short_code?: string | null;
  limit?: number;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  source_mls: string | null;
  status: PropertyStatus;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  listing_date: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  office_id: string | null;
  updated_at: string;
  close_date: string | null;
  close_price: number | null;
}

interface DbOfficeRow {
  id: string;
  short_code: string;
}

/**
 * Resolve a short_code to office_id. Returns null when the code doesn't match
 * a known office (filters out empty result sets cleanly).
 */
async function resolveOfficeFilter(
  supabase: ReturnType<typeof createAdminClient>,
  shortCode: string | null | undefined,
): Promise<{ ok: true; office_id: string | null } | { ok: false }> {
  if (!shortCode) return { ok: true, office_id: null };
  const { data, error } = await supabase
    .from("offices")
    .select("id")
    .eq("short_code", shortCode)
    .maybeSingle();
  if (error || !data) return { ok: false };
  return { ok: true, office_id: data.id };
}

/**
 * Hydrate office short_code labels onto the row set in one bulk query.
 */
async function attachOfficeLabels(
  supabase: ReturnType<typeof createAdminClient>,
  properties: DbPropertyRow[],
): Promise<Map<string, string>> {
  const officeIds = Array.from(
    new Set(
      properties.map((p) => p.office_id).filter((x): x is string => !!x),
    ),
  );
  const result = new Map<string, string>();
  if (officeIds.length === 0) return result;
  const { data: officeRows } = await supabase
    .from("offices")
    .select("id, short_code")
    .in("id", officeIds);
  for (const o of (officeRows ?? []) as DbOfficeRow[]) {
    result.set(o.id, o.short_code);
  }
  return result;
}

/**
 * Convert a DB row to the shared ListingMilestone shape for sold listings.
 * Sold rows display close_price and key off close_date.
 */
function rowToSold(
  p: DbPropertyRow,
  officeShortByID: Map<string, string>,
): ListingMilestone {
  return {
    id: p.id,
    mls_number: p.mls_number,
    source_mls: (p.source_mls as SourceMls) ?? null,
    status: p.status,
    address: p.address,
    city: p.city,
    state: p.state,
    list_price: p.list_price === null ? null : Number(p.list_price),
    display_price:
      p.close_price === null
        ? p.list_price === null
          ? null
          : Number(p.list_price)
        : Number(p.close_price),
    reference_date: p.close_date ?? p.updated_at,
    reference_date_kind: p.close_date ? "close_date" : "updated_at",
    hero_image_url: p.hero_image_url,
    agent_name: p.agent_name,
    office_short_code: p.office_id
      ? officeShortByID.get(p.office_id) ?? null
      : null,
  };
}

/**
 * Convert a DB row to the shared ListingMilestone shape for pending listings.
 * Pending rows display list_price and key off listing_date.
 */
function rowToPending(
  p: DbPropertyRow,
  officeShortByID: Map<string, string>,
): ListingMilestone {
  return {
    id: p.id,
    mls_number: p.mls_number,
    source_mls: (p.source_mls as SourceMls) ?? null,
    status: p.status,
    address: p.address,
    city: p.city,
    state: p.state,
    list_price: p.list_price === null ? null : Number(p.list_price),
    display_price: p.list_price === null ? null : Number(p.list_price),
    reference_date: p.listing_date ?? p.updated_at,
    reference_date_kind: p.listing_date ? "listing_date" : "updated_at",
    hero_image_url: p.hero_image_url,
    agent_name: p.agent_name,
    office_short_code: p.office_id
      ? officeShortByID.get(p.office_id) ?? null
      : null,
  };
}

/**
 * Currently-pending (under contract) listings, newest-first by listing_date.
 * Pending is a state, not a windowed event — we show ALL pending listings
 * regardless of when they were listed.
 */
export async function getUnderContractListings(
  opts: GetUnderContractOptions = {},
): Promise<ListingMilestone[]> {
  const supabase = createAdminClient();
  const limit = opts.limit ?? 25;

  const officeFilter = await resolveOfficeFilter(supabase, opts.office_short_code);
  if (!officeFilter.ok) return [];

  let query = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, list_price, listing_date, hero_image_url, agent_name, office_id, updated_at, close_date, close_price",
    )
    .eq("status", "pending")
    .order("listing_date", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (officeFilter.office_id) query = query.eq("office_id", officeFilter.office_id);

  const { data, error } = await query;
  if (error) {
    console.error("getUnderContractListings:", error);
    return [];
  }
  const properties = (data ?? []) as DbPropertyRow[];
  if (properties.length === 0) return [];

  const officeShortByID = await attachOfficeLabels(supabase, properties);
  return properties.map((p) => rowToPending(p, officeShortByID));
}

/**
 * Recently sold listings (close_date within the window, default 30 days).
 * Sorted newest-first by close_date. Falls back to updated_at sort for any
 * sold rows that don't carry close_date yet (early-RETS-sync edge case).
 */
export async function getRecentlySoldListings(
  opts: GetRecentlySoldOptions = {},
): Promise<ListingMilestone[]> {
  const supabase = createAdminClient();
  const windowDays = opts.windowDays ?? 30;
  const limit = opts.limit ?? 25;

  const officeFilter = await resolveOfficeFilter(supabase, opts.office_short_code);
  if (!officeFilter.ok) return [];

  const cutoffIso = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const cutoffDate = cutoffIso.slice(0, 10);

  // Either close_date is set and within the window, OR close_date is missing
  // and the row was updated within the window (covers listings that just
  // flipped to sold but haven't had close_date populated yet).
  let query = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, list_price, listing_date, hero_image_url, agent_name, office_id, updated_at, close_date, close_price",
    )
    .eq("status", "sold")
    .or(
      `close_date.gte.${cutoffDate},and(close_date.is.null,updated_at.gte.${cutoffIso})`,
    )
    .order("close_date", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (officeFilter.office_id) query = query.eq("office_id", officeFilter.office_id);

  const { data, error } = await query;
  if (error) {
    console.error("getRecentlySoldListings:", error);
    return [];
  }
  const properties = (data ?? []) as DbPropertyRow[];
  if (properties.length === 0) return [];

  const officeShortByID = await attachOfficeLabels(supabase, properties);
  return properties.map((p) => rowToSold(p, officeShortByID));
}
