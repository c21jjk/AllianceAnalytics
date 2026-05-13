import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-only fetchers for the dashboard "Open Houses" card and the listing
 * detail page's per-listing OH section. Backed by the public.open_houses
 * table, populated by the mls-rets-sync Edge Function's OpenHouse pass.
 *
 * Window default: 7 days forward + just-ended (last 6 hours), so an OH that
 * wrapped up an hour ago still surfaces on Larissa's afternoon review. Past
 * OHs older than 6 hours drop out of upcoming-listings views.
 */

export interface UpcomingOpenHouse {
  id: string;
  mls_number: string;
  start_at: string;
  end_at: string | null;
  comments: string | null;
  /** Joined from properties — null when the OH arrived before the property
   *  replicated (rare; resolves on next sync). */
  address: string | null;
  city: string | null;
  state: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  list_price: number | null;
  /** Office short_code from the listing's office record (e.g. "WWC"). */
  office_short_code: string | null;
}

interface DbOpenHouseRow {
  id: string;
  mls_number: string;
  property_id: string | null;
  start_at: string;
  end_at: string | null;
  comments: string | null;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  list_price: number | null;
  office_id: string | null;
}

interface DbOfficeRow {
  id: string;
  short_code: string;
}

export interface GetUpcomingOpenHousesOptions {
  /** Default 7 days. */
  windowDays?: number;
  /** Office short_code filter. Null/undefined returns all offices. */
  office_short_code?: string | null;
  /** Max rows. Default 25. */
  limit?: number;
}

/**
 * Return the next batch of Alliance Open Houses within the window. Joined
 * to properties for address + agent + hero photo. Sorted chronologically.
 * Past OHs that ended more than 6 hours ago are filtered out.
 */
export async function getUpcomingOpenHouses(
  opts: GetUpcomingOpenHousesOptions = {},
): Promise<UpcomingOpenHouse[]> {
  const supabase = createAdminClient();
  const windowDays = opts.windowDays ?? 7;
  const limit = opts.limit ?? 25;

  // Lower bound: 6 hours ago — keeps just-ended OHs visible briefly so
  // Larissa can still see today's earlier OHs on a 4pm review.
  const startCutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const endCutoff = new Date(
    Date.now() + windowDays * 86400_000,
  ).toISOString();

  const { data: ohRows, error: ohErr } = await supabase
    .from("open_houses")
    .select("id, mls_number, property_id, start_at, end_at, comments")
    .gte("start_at", startCutoff)
    .lte("start_at", endCutoff)
    .order("start_at", { ascending: true })
    .limit(limit);

  if (ohErr) {
    console.error("getUpcomingOpenHouses:", ohErr);
    return [];
  }
  const ohList = (ohRows ?? []) as DbOpenHouseRow[];
  if (ohList.length === 0) return [];

  // Hydrate property rows. property_id may be null on freshly-arrived OHs
  // — fall back to mls_number lookup so the row still renders.
  const propertyIds = Array.from(
    new Set(
      ohList.map((o) => o.property_id).filter((x): x is string => !!x),
    ),
  );
  const mlsNumbers = Array.from(new Set(ohList.map((o) => o.mls_number)));

  const propertyById = new Map<string, DbPropertyRow>();
  const propertyByMls = new Map<string, DbPropertyRow>();
  if (propertyIds.length > 0) {
    const { data: byId } = await supabase
      .from("properties")
      .select(
        "id, mls_number, address, city, state, hero_image_url, agent_name, list_price, office_id",
      )
      .in("id", propertyIds);
    for (const p of (byId ?? []) as DbPropertyRow[]) {
      propertyById.set(p.id, p);
      propertyByMls.set(p.mls_number, p);
    }
  }
  // Any OH rows still missing property_id — look up by mls_number.
  const missingMls = ohList
    .filter((o) => !o.property_id || !propertyById.has(o.property_id))
    .map((o) => o.mls_number);
  if (missingMls.length > 0) {
    const { data: byMls } = await supabase
      .from("properties")
      .select(
        "id, mls_number, address, city, state, hero_image_url, agent_name, list_price, office_id",
      )
      .in("mls_number", Array.from(new Set(missingMls)));
    for (const p of (byMls ?? []) as DbPropertyRow[]) {
      propertyByMls.set(p.mls_number, p);
    }
  }

  // Office short_code hydration.
  const officeIds = Array.from(
    new Set(
      Array.from(propertyByMls.values())
        .map((p) => p.office_id)
        .filter((x): x is string => !!x),
    ),
  );
  const officeShortByID = new Map<string, string>();
  if (officeIds.length > 0) {
    const { data: officeRows } = await supabase
      .from("offices")
      .select("id, short_code")
      .in("id", officeIds);
    for (const o of (officeRows ?? []) as DbOfficeRow[]) {
      officeShortByID.set(o.id, o.short_code);
    }
  }

  let scopedMlsNumbers: Set<string> | null = null;
  if (opts.office_short_code) {
    // Build the set of MLS numbers whose office matches the filter.
    scopedMlsNumbers = new Set();
    for (const [mls, p] of propertyByMls.entries()) {
      if (
        p.office_id &&
        officeShortByID.get(p.office_id) === opts.office_short_code
      ) {
        scopedMlsNumbers.add(mls);
      }
    }
  }

  const out: UpcomingOpenHouse[] = [];
  for (const oh of ohList) {
    if (scopedMlsNumbers && !scopedMlsNumbers.has(oh.mls_number)) continue;
    const property =
      (oh.property_id && propertyById.get(oh.property_id)) ||
      propertyByMls.get(oh.mls_number) ||
      null;
    out.push({
      id: oh.id,
      mls_number: oh.mls_number,
      start_at: oh.start_at,
      end_at: oh.end_at,
      comments: oh.comments,
      address: property?.address ?? null,
      city: property?.city ?? null,
      state: property?.state ?? null,
      hero_image_url: property?.hero_image_url ?? null,
      agent_name: property?.agent_name ?? null,
      list_price:
        property?.list_price === null || property?.list_price === undefined
          ? null
          : Number(property.list_price),
      office_short_code:
        property?.office_id
          ? officeShortByID.get(property.office_id) ?? null
          : null,
    });
  }
  return out;
  // mlsNumbers var is unused below — keep for future debug uses.
  void mlsNumbers;
}

/**
 * Per-listing OH lookup for the property detail page. Returns OHs from
 * 6 hours ago through 90 days out for a single property — useful for
 * seeing a listing's full near-term OH schedule.
 */
export async function getOpenHousesForProperty(
  propertyId: string,
): Promise<UpcomingOpenHouse[]> {
  if (!propertyId) return [];
  const supabase = createAdminClient();
  const startCutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const endCutoff = new Date(Date.now() + 90 * 86400_000).toISOString();

  const { data: ohRows, error } = await supabase
    .from("open_houses")
    .select("id, mls_number, property_id, start_at, end_at, comments")
    .eq("property_id", propertyId)
    .gte("start_at", startCutoff)
    .lte("start_at", endCutoff)
    .order("start_at", { ascending: true });
  if (error) {
    console.error("getOpenHousesForProperty:", error);
    return [];
  }
  const ohList = (ohRows ?? []) as DbOpenHouseRow[];
  if (ohList.length === 0) return [];

  // Single-property fetch — pull just this property's metadata.
  const { data: p } = await supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, hero_image_url, agent_name, list_price, office_id",
    )
    .eq("id", propertyId)
    .maybeSingle();
  const property = (p ?? null) as DbPropertyRow | null;
  let officeShortCode: string | null = null;
  if (property?.office_id) {
    const { data: o } = await supabase
      .from("offices")
      .select("short_code")
      .eq("id", property.office_id)
      .maybeSingle();
    officeShortCode = (o?.short_code as string | undefined) ?? null;
  }

  return ohList.map((oh) => ({
    id: oh.id,
    mls_number: oh.mls_number,
    start_at: oh.start_at,
    end_at: oh.end_at,
    comments: oh.comments,
    address: property?.address ?? null,
    city: property?.city ?? null,
    state: property?.state ?? null,
    hero_image_url: property?.hero_image_url ?? null,
    agent_name: property?.agent_name ?? null,
    list_price:
      property?.list_price === null || property?.list_price === undefined
        ? null
        : Number(property.list_price),
    office_short_code: officeShortCode,
  }));
}
