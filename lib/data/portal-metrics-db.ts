/**
 * Read helpers for ListTrac portal traffic metrics.
 *
 * All read paths go through the dedupe view `v_listing_portal_metrics_unified`
 * which merges CMC/SJSR twins (per project memory: CMC is the primary MLS for
 * Cape May cross-listings, so we attribute portal traffic to the CMC twin
 * when both feeds report).
 *
 * Date math here uses ISO 'YYYY-MM-DD' strings to stay aligned with the
 * `metric_date` column type (date, not timestamptz).
 *
 * NOTE: The new tables/views (`listing_portal_metrics`, `portal_bundles`,
 * `v_listing_portal_metrics_unified`, `v_listing_canonical_mls`) aren't yet
 * in the generated `Database` type, so this file uses an untyped Supabase
 * client (cast through unknown) and explicit row interfaces below. Regenerate
 * types via Supabase CLI/MCP after this lands to fold them in cleanly.
 */
import { createAdminClient } from "@/lib/supabase/admin";

interface PortalMetricRow {
  portal_name: string;
  portal_type: string | null;
  metric_date: string;
  views: number | null;
  inquiries: number | null;
  shares: number | null;
  favorites: number | null;
  gallery_opens: number | null;
  vtour_opens: number | null;
}

interface CanonicalRow {
  canonical_mls: string | null;
}

interface BundleRowRaw {
  slug: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  portal_bundle_members: { portal_name: string }[] | null;
}

/** Permissive client used only for the new tables/views not yet in Database. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedSupabase = any;

function getUntypedClient(): UntypedSupabase {
  return createAdminClient() as unknown as UntypedSupabase;
}

export interface PortalTrafficBreakdown {
  /** The MLS# we actually queried by (canonical CMC# if cross-listed, else own). */
  canonical_mls: string;
  /** Whether we found any rows at all. False → "Data not available" empty state. */
  has_data: boolean;
  /** Sum across all portals, all days in window. */
  total_views: number;
  total_inquiries: number;
  total_shares: number;
  total_favorites: number;
  total_gallery_opens: number;
  total_vtour_opens: number;
  /** Days from window-start to window-end with any non-zero activity. */
  days_with_activity: number;
  /** Date range actually returned by ListTrac (may be narrower than queried). */
  first_date: string | null;
  last_date: string | null;
  /** Per-portal rollup, sorted by views desc. */
  per_portal: Array<{
    portal_name: string;
    portal_type: string | null;
    views: number;
    inquiries: number;
    shares: number;
    favorites: number;
    gallery_opens: number;
    vtour_opens: number;
  }>;
  /** Bundle rollups (e.g. CIH, Big Portals). */
  per_bundle: Array<{
    slug: string;
    display_name: string;
    description: string | null;
    views: number;
    inquiries: number;
    shares: number;
    favorites: number;
    gallery_opens: number;
    vtour_opens: number;
    portal_count: number;
  }>;
  /** Daily totals across all portals, ascending — for sparklines. */
  daily: Array<{ metric_date: string; views: number }>;
  /** Number of days in the requested window (inclusive). */
  window_days: number;
}

/**
 * Look up the canonical MLS# for a given (mls_number, source_mls). When the
 * property is an SJSR twin of a CMC listing, returns the CMC MLS#. Otherwise
 * returns the property's own MLS#.
 */
async function resolveCanonicalMls(
  mlsNumber: string,
  sourceMls: "cmc" | "sjsr",
): Promise<string> {
  const supabase = getUntypedClient();
  const { data, error } = await supabase
    .from("v_listing_canonical_mls")
    .select("canonical_mls")
    .eq("mls_number", mlsNumber)
    .eq("source_mls", sourceMls)
    .maybeSingle();
  if (error || !data) return mlsNumber;
  const row = data as CanonicalRow;
  return row.canonical_mls ?? mlsNumber;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch the portal-traffic rollup for one listing over the last N days.
 *
 * Default window is the trailing 90 days (good balance: shows the whole
 * "this listing is on the market" arc for typical Cape May DOM, without
 * dragging in stale prior-listing-cycle data).
 */
export async function fetchPortalTrafficForListing(
  mlsNumber: string,
  sourceMls: "cmc" | "sjsr",
  windowDays = 90,
): Promise<PortalTrafficBreakdown> {
  const supabase = getUntypedClient();
  const canonical = await resolveCanonicalMls(mlsNumber, sourceMls);

  const now = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - windowDays);
  const startIso = toIso(start);
  const endIso = toIso(now);

  // Per-portal/per-day rows from the dedupe view.
  const { data: rowsRaw, error } = await supabase
    .from("v_listing_portal_metrics_unified")
    .select(
      "portal_name, portal_type, metric_date, views, inquiries, shares, favorites, gallery_opens, vtour_opens",
    )
    .eq("mls_number", canonical)
    .gte("metric_date", startIso)
    .lte("metric_date", endIso);

  if (error) {
    throw new Error(`portal metrics read failed: ${error.message}`);
  }

  const rows = (rowsRaw ?? []) as PortalMetricRow[];

  const empty: PortalTrafficBreakdown = {
    canonical_mls: canonical,
    has_data: false,
    total_views: 0,
    total_inquiries: 0,
    total_shares: 0,
    total_favorites: 0,
    total_gallery_opens: 0,
    total_vtour_opens: 0,
    days_with_activity: 0,
    first_date: null,
    last_date: null,
    per_portal: [],
    per_bundle: [],
    daily: [],
    window_days: windowDays,
  };

  if (rows.length === 0) return empty;

  type PortalAgg = {
    portal_name: string;
    portal_type: string | null;
    views: number;
    inquiries: number;
    shares: number;
    favorites: number;
    gallery_opens: number;
    vtour_opens: number;
  };
  const portalMap = new Map<string, PortalAgg>();
  const dayMap = new Map<string, number>();
  const datesWithActivity = new Set<string>();
  let totalViews = 0;
  let totalInq = 0;
  let totalShr = 0;
  let totalFav = 0;
  let totalGal = 0;
  let totalVtr = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of rows) {
    const views = Number(r.views) || 0;
    const inq = Number(r.inquiries) || 0;
    const shr = Number(r.shares) || 0;
    const fav = Number(r.favorites) || 0;
    const gal = Number(r.gallery_opens) || 0;
    const vtr = Number(r.vtour_opens) || 0;

    let p = portalMap.get(r.portal_name);
    if (!p) {
      p = {
        portal_name: r.portal_name,
        portal_type: r.portal_type ?? null,
        views: 0,
        inquiries: 0,
        shares: 0,
        favorites: 0,
        gallery_opens: 0,
        vtour_opens: 0,
      };
      portalMap.set(r.portal_name, p);
    }
    p.views += views;
    p.inquiries += inq;
    p.shares += shr;
    p.favorites += fav;
    p.gallery_opens += gal;
    p.vtour_opens += vtr;

    totalViews += views;
    totalInq += inq;
    totalShr += shr;
    totalFav += fav;
    totalGal += gal;
    totalVtr += vtr;

    if (views > 0 || inq > 0 || shr > 0 || fav > 0 || gal > 0 || vtr > 0) {
      datesWithActivity.add(r.metric_date);
    }
    if (!minDate || r.metric_date < minDate) minDate = r.metric_date;
    if (!maxDate || r.metric_date > maxDate) maxDate = r.metric_date;

    dayMap.set(r.metric_date, (dayMap.get(r.metric_date) ?? 0) + views);
  }

  // Bundle aggregation — pull bundle definitions + membership.
  const { data: bundleRowsRaw } = await supabase
    .from("portal_bundles")
    .select(
      "id, slug, display_name, description, sort_order, portal_bundle_members ( portal_name )",
    )
    .order("sort_order", { ascending: true });

  const bundleRows = (bundleRowsRaw ?? []) as BundleRowRaw[];

  type BundleAgg = {
    slug: string;
    display_name: string;
    description: string | null;
    views: number;
    inquiries: number;
    shares: number;
    favorites: number;
    gallery_opens: number;
    vtour_opens: number;
    portal_count: number;
  };
  const bundles: BundleAgg[] = [];
  for (const b of bundleRows) {
    const memberSet = new Set(
      (b.portal_bundle_members ?? []).map((m) => m.portal_name),
    );
    const agg: BundleAgg = {
      slug: b.slug,
      display_name: b.display_name,
      description: b.description ?? null,
      views: 0,
      inquiries: 0,
      shares: 0,
      favorites: 0,
      gallery_opens: 0,
      vtour_opens: 0,
      portal_count: 0,
    };
    for (const [name, p] of portalMap.entries()) {
      if (!memberSet.has(name)) continue;
      agg.views += p.views;
      agg.inquiries += p.inquiries;
      agg.shares += p.shares;
      agg.favorites += p.favorites;
      agg.gallery_opens += p.gallery_opens;
      agg.vtour_opens += p.vtour_opens;
      agg.portal_count++;
    }
    bundles.push(agg);
  }

  // Daily ascending
  const daily = Array.from(dayMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([metric_date, views]) => ({ metric_date, views }));

  // Per-portal sorted by views desc
  const perPortal = Array.from(portalMap.values()).sort(
    (a, b) => b.views - a.views,
  );

  return {
    canonical_mls: canonical,
    has_data: totalViews > 0 || perPortal.length > 0,
    total_views: totalViews,
    total_inquiries: totalInq,
    total_shares: totalShr,
    total_favorites: totalFav,
    total_gallery_opens: totalGal,
    total_vtour_opens: totalVtr,
    days_with_activity: datesWithActivity.size,
    first_date: minDate,
    last_date: maxDate,
    per_portal: perPortal,
    per_bundle: bundles,
    daily,
    window_days: windowDays,
  };
}

// ---------------------------------------------------------------------------
//  Portal Strip — 5 fixed slots: Zillow / Realtor.com / Trulia / CIH / Other
// ---------------------------------------------------------------------------
//
// Used by the post card, main property card, and Owner Story. Always returns
// all 5 slots so the UI never has to handle a "portal didn't come back" case
// — missing portals just render as zero/empty.
//
// Redfin + Homes.com were removed 2026-05-29: ListTrac returns zero rows for
// both for this org (phantom slots). Every portal that isn't Zillow/Realtor/
// Trulia/CIH now rolls into the "Other Portals" catch-all so real traffic
// (BHHS, CoreLogic OneHome, RE/MAX, etc.) is never silently dropped.

/** Stable keys used by the UI to pick logos + colors. */
export type PortalStripKey = "zillow" | "realtor" | "trulia" | "cih" | "other";

export interface PortalStripSlot {
  /** Stable identity for the UI (logo lookup, sort order). */
  key: PortalStripKey;
  /** Display name shown to humans. */
  display_name: string;
  views: number;
  /** Number of saves, or null when the portal doesn't report saves at all. */
  saves: number | null;
  /** True only if we have any non-zero metric for this slot in window. */
  has_data: boolean;
  /**
   * Whether saves are *trackable* for this portal. The big consumer portals
   * (Zillow/Realtor/Trulia) never pass saves through ListTrac; only certain
   * IDX/MLS sources do. Retained on the data shape for completeness, but the
   * UI no longer surfaces saves — across the whole org ListTrac has reported
   * ~20 saves ever vs. 117k+ views, so views is the only meaningful metric.
   */
  saves_trackable: boolean;
}

export interface PortalStrip {
  canonical_mls: string;
  /** True if ANY slot has data. */
  has_data: boolean;
  total_views: number;
  total_saves: number;
  /** Date range actually observed in window (may be narrower than asked). */
  first_date: string | null;
  last_date: string | null;
  /** Number of days requested in the window. */
  window_days: number;
  slots: PortalStripSlot[];
}

/**
 * Mapping of strip slot → set of `portal_name` values in
 * listing_portal_metrics. Multiple sitenames roll up into the same slot
 * (e.g., RE/MAX.com + REMAX.com → other; centric for CIH is the bundle).
 *
 * Slot order here is the order shown in the UI.
 */
const STRIP_PORTAL_MAP: Array<{
  key: PortalStripKey;
  display_name: string;
  /** Member portals (matched against listing_portal_metrics.portal_name). */
  members: string[];
  /** Whether ListTrac historically reports saves for any of these portals. */
  saves_trackable: boolean;
}> = [
  {
    key: "zillow",
    display_name: "Zillow",
    members: ["Zillow.com", "Zillow", "zillow.com"],
    saves_trackable: false,
  },
  {
    key: "realtor",
    display_name: "Realtor.com",
    members: ["Realtor.com", "realtor.com"],
    saves_trackable: false,
  },
  {
    key: "trulia",
    display_name: "Trulia",
    members: ["Trulia", "trulia.com"],
    saves_trackable: false,
  },
  {
    key: "cih",
    display_name: "CIH brand network",
    // CIH membership is data-driven via portal_bundles, but for the strip
    // we duplicate the allowlist inline to keep this a single DB round-trip.
    // Stays in sync with the seed in 20260526_001 — update both if the
    // bundle changes.
    members: [
      "century21.com",
      "century21global.com",
      "Coldwell Banker",
      "coldwellbanker.com",
      "coldwellbankerhomes.com",
      "CBCworldwide.com",
      "sothebysrealty.com",
      "sir.com",
      "BHGRE.com",
      "bhgre.com",
      "Corcoran.com",
      "corcoran.com",
      "era.com",
      "ERA.com",
      "compass.com",
      "Compass",
      "NRT",
    ],
    saves_trackable: true,
  },
];

export interface PortalStripWindow {
  /** Trailing N days from now. Mutually exclusive with `since`. */
  trailing_days?: number;
  /**
   * ISO date string. Window is [since, today]. Overrides trailing_days.
   * Used by Owner Story + Main Property Card (since-listing).
   */
  since?: string | null;
}

/**
 * Fetch the 5-slot portal strip for one listing. Always returns all 5
 * slots; zero-data slots render empty.
 */
export async function fetchPortalStrip(
  mlsNumber: string,
  sourceMls: "cmc" | "sjsr",
  window: PortalStripWindow = {},
): Promise<PortalStrip> {
  const supabase = getUntypedClient();
  const canonical = await resolveCanonicalMls(mlsNumber, sourceMls);

  const now = new Date();
  let startIso: string;
  let trailingDays: number;
  if (window.since) {
    startIso = window.since.slice(0, 10);
    const startDate = new Date(window.since);
    trailingDays = Math.max(
      1,
      Math.round((now.getTime() - startDate.getTime()) / 86_400_000),
    );
  } else {
    const trailing = window.trailing_days ?? 30;
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - trailing);
    startIso = toIso(startDate);
    trailingDays = trailing;
  }
  const endIso = toIso(now);

  const { data: rowsRaw, error } = await supabase
    .from("v_listing_portal_metrics_unified")
    .select("portal_name, metric_date, views, favorites")
    .eq("mls_number", canonical)
    .gte("metric_date", startIso)
    .lte("metric_date", endIso);

  if (error) {
    throw new Error(`portal strip read failed: ${error.message}`);
  }

  type StripRow = {
    portal_name: string;
    metric_date: string;
    views: number | null;
    favorites: number | null;
  };
  const rows = (rowsRaw ?? []) as StripRow[];

  // Membership lookup
  const memberToKey = new Map<string, PortalStripKey>();
  for (const def of STRIP_PORTAL_MAP) {
    for (const m of def.members) memberToKey.set(m, def.key);
  }

  // Sum per slot
  const sums = new Map<PortalStripKey, { views: number; saves: number }>();
  let totalViews = 0;
  let totalSaves = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of rows) {
    // Anything not explicitly mapped to a named slot rolls into "other" so
    // real traffic (BHHS, OneHome, RE/MAX, the long tail) is never dropped.
    const key: PortalStripKey = memberToKey.get(r.portal_name) ?? "other";
    const v = Number(r.views) || 0;
    const s = Number(r.favorites) || 0;
    let entry = sums.get(key);
    if (!entry) {
      entry = { views: 0, saves: 0 };
      sums.set(key, entry);
    }
    entry.views += v;
    entry.saves += s;
    totalViews += v;
    totalSaves += s;
    if (!minDate || r.metric_date < minDate) minDate = r.metric_date;
    if (!maxDate || r.metric_date > maxDate) maxDate = r.metric_date;
  }

  // Named slots first (in map order), then the "Other Portals" catch-all.
  const slotDefs: Array<{
    key: PortalStripKey;
    display_name: string;
    saves_trackable: boolean;
  }> = [
    ...STRIP_PORTAL_MAP.map((d) => ({
      key: d.key,
      display_name: d.display_name,
      saves_trackable: d.saves_trackable,
    })),
    { key: "other", display_name: "Other Portals", saves_trackable: false },
  ];

  const slots: PortalStripSlot[] = slotDefs.map((def) => {
    const got = sums.get(def.key) ?? { views: 0, saves: 0 };
    return {
      key: def.key,
      display_name: def.display_name,
      views: got.views,
      saves: def.saves_trackable ? got.saves : null,
      has_data: got.views > 0 || got.saves > 0,
      saves_trackable: def.saves_trackable,
    };
  });

  return {
    canonical_mls: canonical,
    has_data: totalViews > 0 || totalSaves > 0,
    total_views: totalViews,
    total_saves: totalSaves,
    first_date: minDate,
    last_date: maxDate,
    window_days: trailingDays,
    slots,
  };
}

// ---------------------------------------------------------------------------
//  Building rollup — combine portal traffic across all units of a building
// ---------------------------------------------------------------------------

export interface BuildingMember {
  mls_number: string;
  source_mls: "cmc" | "sjsr" | null;
  status: string;
  address: string | null;
  list_price: number | null;
  listing_date: string | null;
  /** This unit's individual view contribution to the building total. */
  views: number;
}

export interface BuildingRollup {
  /** Stable key (normalized address). */
  building_key: string;
  display_address: string;
  display_city: string | null;
  member_count: number;
  active_count: number;
  pending_count: number;
  sold_count: number;
  /** Combined portal strip across every unit. */
  strip: PortalStrip;
  /** Per-unit breakdown for the UI table. */
  members: BuildingMember[];
}

interface BuildingViewRow {
  building_key: string;
  display_address: string;
  display_city: string | null;
  member_count: number;
  active_count: number;
  pending_count: number;
  sold_count: number;
  primary_mls: string;
  members: Array<{
    mls_number: string;
    source_mls: "cmc" | "sjsr" | null;
    address: string | null;
    status: string;
    list_price: number | null;
    listing_date: string | null;
  }>;
}

/**
 * Look up the building (if any) that contains a given MLS#. Returns null
 * when the listing isn't part of a 2+-unit building.
 */
async function findBuildingForMls(
  mlsNumber: string,
): Promise<BuildingViewRow | null> {
  const supabase = getUntypedClient();
  // v_listing_buildings.members is jsonb[] with mls_number embedded. We
  // filter using a containment check on the jsonb array.
  const { data, error } = await supabase
    .from("v_listing_buildings")
    .select(
      "building_key, display_address, display_city, member_count, active_count, pending_count, sold_count, primary_mls, members",
    );
  if (error || !data) return null;
  for (const row of data as BuildingViewRow[]) {
    if (row.members.some((m) => m.mls_number === mlsNumber)) return row;
  }
  return null;
}

/**
 * Fetch the portal-traffic rollup for the building that contains the given
 * listing. Returns null when the listing isn't part of a multi-unit
 * building. Window defaults to "since the earliest listing_date among
 * members" so the rollup tells the building's full lifetime story.
 */
export async function fetchBuildingPortalTraffic(
  mlsNumber: string,
): Promise<BuildingRollup | null> {
  const building = await findBuildingForMls(mlsNumber);
  if (!building) return null;

  // Earliest listing_date among members = window start. Falls back to 365
  // days if nothing parseable.
  const memberDates = building.members
    .map((m) => (m.listing_date ? new Date(m.listing_date).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const windowStart =
    memberDates.length > 0
      ? new Date(Math.min(...memberDates))
      : (() => {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - 365);
          return d;
        })();

  // Pull each member's strip in one batched call against the dedupe view.
  const memberStripInputs = building.members
    .filter(
      (m): m is typeof m & { source_mls: "cmc" | "sjsr" } =>
        m.source_mls === "cmc" || m.source_mls === "sjsr",
    )
    .map((m) => ({
      mls_number: m.mls_number,
      source_mls: m.source_mls,
      listing_date: windowStart.toISOString().slice(0, 10),
    }));

  const strips = await fetchPortalStripsForListings(memberStripInputs);

  // Combine per-member strips into one building strip.
  const combinedSlots: Record<PortalStripKey, { views: number; saves: number; saves_trackable: boolean }> = {
    zillow:  { views: 0, saves: 0, saves_trackable: false },
    realtor: { views: 0, saves: 0, saves_trackable: false },
    trulia:  { views: 0, saves: 0, saves_trackable: false },
    cih:     { views: 0, saves: 0, saves_trackable: true },
    other:   { views: 0, saves: 0, saves_trackable: false },
  };
  let totalViews = 0;
  let totalSaves = 0;
  const memberRows: BuildingMember[] = [];
  for (const m of building.members) {
    const key =
      m.source_mls === "cmc" || m.source_mls === "sjsr"
        ? `${m.source_mls}|${m.mls_number}`
        : null;
    const memberStrip = key ? strips.get(key) : null;
    let memberViews = 0;
    if (memberStrip) {
      for (const slot of memberStrip.slots) {
        combinedSlots[slot.key].views += slot.views;
        if (slot.saves !== null) {
          combinedSlots[slot.key].saves += slot.saves;
          combinedSlots[slot.key].saves_trackable = true;
        }
        memberViews += slot.views;
      }
      totalViews += memberStrip.total_views;
      totalSaves += memberStrip.total_saves;
    }
    memberRows.push({
      mls_number: m.mls_number,
      source_mls: m.source_mls,
      status: m.status,
      address: m.address,
      list_price: m.list_price,
      listing_date: m.listing_date,
      views: memberViews,
    });
  }

  const slotOrder: PortalStripKey[] = ["zillow", "realtor", "trulia", "cih", "other"];
  const slots = slotOrder.map((k) => ({
    key: k,
    display_name:
      k === "realtor" ? "Realtor.com" :
      k === "cih"     ? "CIH brand network" :
      k === "other"   ? "Other Portals" :
      k.charAt(0).toUpperCase() + k.slice(1),
    views: combinedSlots[k].views,
    saves: combinedSlots[k].saves_trackable ? combinedSlots[k].saves : null,
    has_data: combinedSlots[k].views > 0 || combinedSlots[k].saves > 0,
    saves_trackable: combinedSlots[k].saves_trackable,
  }));

  const strip: PortalStrip = {
    canonical_mls: building.primary_mls,
    has_data: totalViews > 0 || totalSaves > 0,
    total_views: totalViews,
    total_saves: totalSaves,
    first_date: null,
    last_date: null,
    window_days: Math.max(
      1,
      Math.round((Date.now() - windowStart.getTime()) / 86_400_000),
    ),
    slots,
  };

  return {
    building_key: building.building_key,
    display_address: building.display_address,
    display_city: building.display_city,
    member_count: building.member_count,
    active_count: building.active_count,
    pending_count: building.pending_count,
    sold_count: building.sold_count,
    strip,
    members: memberRows.sort((a, b) => b.views - a.views),
  };
}

/**
 * Convenience: fetch portal strips for many listings in one round-trip
 * (used by /properties list view to avoid N+1).
 */
export async function fetchPortalStripsForListings(
  listings: Array<{ mls_number: string; source_mls: "cmc" | "sjsr"; listing_date?: string | null }>,
): Promise<Map<string, PortalStrip>> {
  const supabase = getUntypedClient();
  if (listings.length === 0) return new Map();

  // Resolve canonical MLS for each input
  // Pull canonical map in one query
  const { data: canonRaw } = await supabase
    .from("v_listing_canonical_mls")
    .select("mls_number, source_mls, canonical_mls")
    .in(
      "mls_number",
      listings.map((l) => l.mls_number),
    );
  type CanonRow = { mls_number: string; source_mls: string; canonical_mls: string };
  const canonRows = (canonRaw ?? []) as CanonRow[];
  const canonMap = new Map<string, string>();
  for (const c of canonRows) {
    canonMap.set(`${c.source_mls}|${c.mls_number}`, c.canonical_mls);
  }

  // Build input → canonical lookup; default to own MLS#
  const inputs = listings.map((l) => {
    const canonical =
      canonMap.get(`${l.source_mls}|${l.mls_number}`) ?? l.mls_number;
    return {
      input_key: `${l.source_mls}|${l.mls_number}`,
      mls_number: l.mls_number,
      source_mls: l.source_mls,
      listing_date: l.listing_date ?? null,
      canonical,
    };
  });

  const canonSet = Array.from(new Set(inputs.map((i) => i.canonical)));

  // Default window: 1-year cap for performance (sellers rarely listed >1yr)
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 365);
  const startIso = toIso(start);
  const endIso = toIso(new Date());

  const { data: rowsRaw } = await supabase
    .from("v_listing_portal_metrics_unified")
    .select("mls_number, portal_name, metric_date, views, favorites")
    .in("mls_number", canonSet)
    .gte("metric_date", startIso)
    .lte("metric_date", endIso);

  type BatchRow = {
    mls_number: string;
    portal_name: string;
    metric_date: string;
    views: number | null;
    favorites: number | null;
  };
  const rows = (rowsRaw ?? []) as BatchRow[];

  const memberToKey = new Map<string, PortalStripKey>();
  for (const def of STRIP_PORTAL_MAP) {
    for (const m of def.members) memberToKey.set(m, def.key);
  }

  // Bucket rows by canonical MLS#
  type Bucket = {
    rows: BatchRow[];
    minDate: string | null;
    maxDate: string | null;
  };
  const byCanonical = new Map<string, Bucket>();
  for (const r of rows) {
    let b = byCanonical.get(r.mls_number);
    if (!b) {
      b = { rows: [], minDate: null, maxDate: null };
      byCanonical.set(r.mls_number, b);
    }
    b.rows.push(r);
    if (!b.minDate || r.metric_date < b.minDate) b.minDate = r.metric_date;
    if (!b.maxDate || r.metric_date > b.maxDate) b.maxDate = r.metric_date;
  }

  const result = new Map<string, PortalStrip>();
  for (const inp of inputs) {
    // Effective window: listing_date (if present) → today, else 365.
    const windowStart = inp.listing_date
      ? new Date(inp.listing_date)
      : new Date(startIso);
    const windowStartIso = toIso(windowStart);

    const bucket = byCanonical.get(inp.canonical);
    const filtered = (bucket?.rows ?? []).filter(
      (r) => r.metric_date >= windowStartIso,
    );

    const sums = new Map<PortalStripKey, { views: number; saves: number }>();
    let totalViews = 0;
    let totalSaves = 0;
    let minDate: string | null = null;
    let maxDate: string | null = null;
    for (const r of filtered) {
      const key = memberToKey.get(r.portal_name);
      if (!key) continue;
      const v = Number(r.views) || 0;
      const s = Number(r.favorites) || 0;
      let entry = sums.get(key);
      if (!entry) {
        entry = { views: 0, saves: 0 };
        sums.set(key, entry);
      }
      entry.views += v;
      entry.saves += s;
      totalViews += v;
      totalSaves += s;
      if (!minDate || r.metric_date < minDate) minDate = r.metric_date;
      if (!maxDate || r.metric_date > maxDate) maxDate = r.metric_date;
    }

    const slots: PortalStripSlot[] = STRIP_PORTAL_MAP.map((def) => {
      const got = sums.get(def.key) ?? { views: 0, saves: 0 };
      return {
        key: def.key,
        display_name: def.display_name,
        views: got.views,
        saves: def.saves_trackable ? got.saves : null,
        has_data: got.views > 0 || got.saves > 0,
        saves_trackable: def.saves_trackable,
      };
    });

    const trailingDays = Math.max(
      1,
      Math.round((Date.now() - windowStart.getTime()) / 86_400_000),
    );

    result.set(inp.input_key, {
      canonical_mls: inp.canonical,
      has_data: totalViews > 0 || totalSaves > 0,
      total_views: totalViews,
      total_saves: totalSaves,
      first_date: minDate,
      last_date: maxDate,
      window_days: trailingDays,
      slots,
    });
  }

  return result;
}
