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
