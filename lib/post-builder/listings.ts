import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PostBuilderListing, PostType } from "./types";
import type { PostBuilderListingWithOH } from "./listing-html-utils";

/**
 * Status-aware listing fetcher for the Post Builder UI.
 *
 * Each post_type has different "what counts as eligible" logic:
 *   - just_listed     → status='active', recent listing_date (default 60d)
 *   - just_sold       → status='sold', recent close_date (default 60d)
 *   - under_contract  → status='pending'
 *   - open_house      → status IN ('active','pending') AND has an open_houses
 *                       row in next 14d (pending = under contract but the open
 *                       house is still on the calendar; see 2026-08-14 note)
 *
 * All return the same PostBuilderListingWithOH shape so the UI doesn't
 * need to branch on post_type for rendering.
 *
 * Hero photo is required (no point picking a listing we can't render).
 */

interface FetchOptions {
  post_type: PostType;
  /** How far back to look for listing_date / close_date. Default 60 days. */
  windowDays?: number;
  /** Cap on returned rows. Default 200 — Alliance inventory is well under this. */
  limit?: number;
}

interface PropertyRow {
  id: string;
  mls_number: string;
  source_mls: string | null;
  status: "active" | "pending" | "sold" | "expired";
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  close_price: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  square_feet: number | null;
  property_type: string | null;
  public_remarks: string | null;
  hero_image_url: string | null;
  listing_office_name: string | null;
  agent_name: string | null;
  listing_date: string | null;
  close_date: string | null;
  unit_number: string | null;
  office_id: string | null;
  alliance_role: "listing" | "buyer" | "both" | null;
  buyer_agent_name: string | null;
  buyer_office_name: string | null;
}

export async function fetchListingsForPostBuilder(
  opts: FetchOptions,
): Promise<PostBuilderListingWithOH[]> {
  const supabase = createAdminClient();
  const windowDays = opts.windowDays ?? 60;
  const limit = opts.limit ?? 200;

  // Build base query — same field set for all post types.
  let q = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, zip, list_price, close_price, bedrooms, bathrooms_full, bathrooms_half, square_feet, property_type, public_remarks, hero_image_url, listing_office_name, agent_name, listing_date, close_date, unit_number, office_id, alliance_role, buyer_agent_name, buyer_office_name",
    )
    .not("hero_image_url", "is", null)
    // 2026-08-04 — the caller's limit must NOT truncate the candidate pool for
    // post types that are post-filtered below. open_house filters the fetched
    // rows down to those with an upcoming open_houses row, so a small limit
    // (the template editor passes limit: 1) would fetch one arbitrary active
    // listing, find no OH for it, and return [] — which made OH template
    // previews hydrate against a just_listed sample and render literal
    // {open_house_date} tokens. Fetch a full pool here and apply the caller's
    // cap at the very end instead (see the slice on the return).
    .limit(opts.post_type === "open_house" ? Math.max(limit, 200) : limit);

  switch (opts.post_type) {
    case "just_listed": {
      const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      q = q
        .eq("status", "active")
        .gte("listing_date", cutoff)
        .order("listing_date", { ascending: false });
      break;
    }
    case "just_sold": {
      const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      q = q
        .eq("status", "sold")
        .gte("close_date", cutoff)
        .order("close_date", { ascending: false });
      break;
    }
    case "under_contract": {
      q = q.eq("status", "pending").order("status_changed_at", { ascending: false });
      break;
    }
    case "open_house": {
      // nullsFirst: false — a NULL listing_date sorts FIRST under DESC in
      // Postgres, so rows with no listing date would otherwise crowd out real
      // candidates in a small-limit query.
      //
      // 2026-08-14 (John): "Show the scheduled open house, even if it shows
      // as pending." A listing that goes under contract keeps its advertised
      // open house on the MLS calendar, and somebody still has to stand in
      // that house on Sunday. Filtering to status='active' meant the
      // dashboard Open Houses card listed it (getUpcomingOpenHouses never
      // filtered on status) while the multi-OH picker silently dropped it —
      // two surfaces disagreeing about the same weekend. What defines this
      // card is having an upcoming open_houses row, not the contract status,
      // so pending is allowed in and the row carries a badge instead.
      // 'sold' and 'expired' stay out: those open houses are cancelled.
      q = q
        .in("status", ["active", "pending"])
        .order("listing_date", { ascending: false, nullsFirst: false });
      break;
    }
    case "price_reduction": {
      // Path A: show all active listings, ordered by most recent first.
      // We don't yet track price history, so the user picks which listings
      // had reductions. Path B (auto-detect) lands later — see Phase 6 plan.
      q = q
        .eq("status", "active")
        .order("listing_date", { ascending: false, nullsFirst: false });
      break;
    }
  }

  const { data, error } = await q;
  if (error) {
    console.error("[post-builder/listings] fetch error:", error);
    return [];
  }
  const rows = (data ?? []) as PropertyRow[];

  let listings: PostBuilderListingWithOH[] = rows.map((r) => toListing(r));

  // 2026-08-07 (John) — attach office short_code + division so the Multi-OH
  // wizard can batch its picker by division the way the dashboard Open Houses
  // card already does. One bulk query for the whole page; runs for every post
  // type because it costs a single round trip and callers shouldn't have to
  // opt in to knowing which office a listing belongs to.
  await attachOfficeMeta(supabase, rows, listings);

  // Open House: filter to listings with an upcoming open_houses row, and
  // attach the soonest one's start_at + end_at.
  if (opts.post_type === "open_house" && listings.length > 0) {
    const mlsNumbers = listings.map((l) => l.mls_number);
    const { data: ohRows, error: ohError } = await supabase
      .from("open_houses")
      .select("mls_number, start_at, end_at, comments")
      .in("mls_number", mlsNumbers)
      .gte("start_at", new Date().toISOString())
      .lte(
        "start_at",
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      )
      .order("start_at", { ascending: true });
    if (ohError) {
      console.error("[post-builder/listings] open_houses fetch error:", ohError);
      return [];
    }
    const nextOhByMls = new Map<
      string,
      { start_at: string; end_at: string | null; comments: string | null }
    >();
    for (const oh of ohRows ?? []) {
      if (!nextOhByMls.has(oh.mls_number)) {
        nextOhByMls.set(oh.mls_number, {
          start_at: oh.start_at,
          end_at: oh.end_at,
          comments: oh.comments ?? null,
        });
      }
    }
    listings = listings
      .filter((l) => nextOhByMls.has(l.mls_number))
      .map((l) => {
        const oh = nextOhByMls.get(l.mls_number);
        return oh
          ? {
              ...l,
              oh_start_at: oh.start_at,
              oh_end_at: oh.end_at,
              oh_comments: oh.comments,
            }
          : l;
      });

    // 2026-08-07 (John): "We would also like them to be listed in the order
    // they will actually be happening, meaning Saturday open houses will show
    // before Sunday open houses and the ones that start early in the morning
    // will be first in the list."
    //
    // The base query orders by listing_date DESC, which is meaningless for
    // open houses: it sorts by when the property came on the market, not by
    // when its open house happens. Re-sort by the start time we just attached.
    //
    // This also makes the .slice(limit) below keep the SOONEST open houses
    // instead of an arbitrary set, which starts to matter the moment the
    // candidate pool exceeds the cap.
    listings.sort((a, b) => {
      const at = a.oh_start_at
        ? Date.parse(a.oh_start_at)
        : Number.MAX_SAFE_INTEGER;
      const bt = b.oh_start_at
        ? Date.parse(b.oh_start_at)
        : Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      // Same start time: stable and readable, so the list doesn't reshuffle
      // between renders.
      return (a.address ?? "").localeCompare(b.address ?? "");
    });
  }

  // Apply the caller's cap here, after any post-filtering, so a small limit
  // never starves a filtered bucket (see the .limit comment above).
  return listings.slice(0, limit);
}

/**
 * Resolve properties.office_id to the office short_code + division and write
 * them onto the listing objects in place. Best effort: a failed lookup leaves
 * both fields null, which downstream renders as an ungrouped list rather than
 * an error.
 */
async function attachOfficeMeta(
  supabase: ReturnType<typeof createAdminClient>,
  rows: PropertyRow[],
  listings: PostBuilderListingWithOH[],
): Promise<void> {
  const officeIds = Array.from(
    new Set(rows.map((r) => r.office_id).filter((x): x is string => !!x)),
  );
  if (officeIds.length === 0) return;

  const { data, error } = await supabase
    .from("offices")
    .select("id, short_code, division")
    .in("id", officeIds);
  if (error) {
    console.error("[post-builder/listings] office lookup failed:", error.message);
    return;
  }

  const byId = new Map<string, { short_code: string; division: string | null }>();
  for (const o of (data ?? []) as Array<{
    id: string;
    short_code: string;
    division: string | null;
  }>) {
    byId.set(o.id, { short_code: o.short_code, division: o.division });
  }

  // rows and listings are index-aligned: listings was built with rows.map().
  rows.forEach((row, i) => {
    const office = row.office_id ? byId.get(row.office_id) : undefined;
    if (!office || !listings[i]) return;
    listings[i].office_short_code = office.short_code;
    listings[i].division = office.division;
  });
}

function toListing(r: PropertyRow): PostBuilderListingWithOH {
  // 2026-08-15 (John) — "It needs to always be the C21 Alliance Agent."
  // On buyer-side sales (alliance_role='buyer') properties.agent_name holds
  // the CO-OP listing agent (e.g. 507 E Orchid: Joan Morey / Long & Foster)
  // while OUR agent is buyer_agent_name (Barbara Hunt). Every Post Builder
  // surface — the Agent Name layer plus the name-keyed photo and phone
  // lookups — reads agent_name off this shape, so the swap happens here,
  // once, for all of them. Mirrors the 5/19 rule: co-op agents are NEVER
  // featured. 'both' keeps agent_name (we're on the list side too).
  const allianceBuyerSide = r.alliance_role === "buyer";
  const displayAgent =
    allianceBuyerSide && r.buyer_agent_name?.trim()
      ? r.buyer_agent_name
      : r.agent_name;
  const displayOffice =
    allianceBuyerSide && r.buyer_office_name?.trim()
      ? r.buyer_office_name
      : r.listing_office_name;
  return {
    id: r.id,
    mls_number: r.mls_number,
    source_mls: (r.source_mls as PostBuilderListing["source_mls"]) ?? null,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    list_price: r.list_price,
    close_price: r.close_price,
    bedrooms: r.bedrooms,
    bathrooms_full: r.bathrooms_full,
    bathrooms_half: r.bathrooms_half,
    square_feet: r.square_feet,
    property_type: r.property_type,
    public_remarks: r.public_remarks,
    hero_image_url: r.hero_image_url,
    listing_office_name: displayOffice,
    agent_name: displayAgent,
    listing_date: r.listing_date,
    status: r.status,
    unit_number: r.unit_number,
    // 2026-05-24 — PostBuilderListingWithOH adds these three OH event
    // fields to the base PostBuilderListing. Filled later by the OH
    // attach loop above when an OH row matches; null on first construction.
    oh_start_at: null,
    oh_end_at: null,
    oh_comments: null,
  };
}
