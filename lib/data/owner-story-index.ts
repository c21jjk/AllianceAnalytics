import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

/**
 * Data fetcher for the Owner Pages index on /reports.
 *
 * Returns one row per property with:
 *   - listing identity (mls, address, status, hero image)
 *   - story-page link path (always present after Phase 2 backfill)
 *   - view stats (total + last viewed)
 *
 * One bulk SELECT for reports+properties, one bulk SELECT for view counts
 * grouped by report_id. Joined in JS so the response shape stays simple
 * even after Postgres-side aggregation tweaks.
 *
 * Sorted by `most_recent_view DESC NULLS LAST, generated_at DESC NULLS LAST,
 * listing_date DESC` — pages with recent activity float to the top, then
 * generated reports, then newest listings.
 */

export type OwnerStoryIndexStatus =
  Database["public"]["Enums"]["property_status"];

export interface OwnerStoryIndexRow {
  property_id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  status: OwnerStoryIndexStatus;
  listing_office_name: string | null;
  list_price: number | null;
  listing_date: string | null;
  story_url_path: string;
  /** True when the legacy formal report has been generated (kpis populated). */
  has_generated_report: boolean;
  total_views: number;
  last_viewed_at: string | null;
  /**
   * Building consolidation: id of the building this listing belongs to, or
   * null for standalone listings. When set, the index shows ONE row per
   * building (the primary unit) with a unit-count badge.
   */
  building_id: string | null;
  /** Number of MLS units in the building (1 for standalone listings). */
  building_unit_count: number;
}

export async function fetchOwnerStoryIndex(): Promise<OwnerStoryIndexRow[]> {
  const supabase = createAdminClient();

  // 1) Reports → properties join. Phase 2 backfill guarantees one report
  //    row per property; we still left-join semantics by selecting from
  //    reports and embedding properties.
  const { data: reportRows, error: reportErr } = await supabase
    .from("reports")
    .select(
      "id, report_token, property_id, generated_at, properties(id, mls_number, address, city, state, hero_image_url, agent_name, status, listing_office_name, list_price, listing_date, building_id)",
    );
  if (reportErr || !reportRows) return [];

  // 2) Aggregate view counts + last view timestamps per report_id.
  //    Single fetch of all (report_id, viewed_at) rows; bucket in JS.
  //    Volume is small — even at 120 listings × dozens of views the row
  //    count is in the low thousands at peak.
  const reportIds = reportRows.map((r) => r.id);
  const viewsByReport = new Map<
    string,
    { total: number; last_viewed_at: string | null }
  >();
  if (reportIds.length > 0) {
    const { data: viewRows } = await supabase
      .from("owner_story_views")
      .select("report_id, viewed_at")
      .in("report_id", reportIds)
      .order("viewed_at", { ascending: false });
    for (const v of (viewRows ?? []) as Array<{
      report_id: string;
      viewed_at: string;
    }>) {
      const existing = viewsByReport.get(v.report_id);
      if (existing) {
        existing.total += 1;
      } else {
        viewsByReport.set(v.report_id, {
          total: 1,
          last_viewed_at: v.viewed_at,
        });
      }
    }
  }

  // 2b) Building consolidation — load buildings so we can collapse each
  //     multi-unit building down to a single index row (its primary unit) with
  //     a unit-count badge. `buildings` / `properties.building_id` aren't in
  //     the generated Database type yet, so use a permissive client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as unknown as any;
  const { data: buildingRows } = await untyped
    .from("buildings")
    .select("id, primary_property_id");
  const primaryByBuilding = new Map<string, string | null>();
  for (const b of (buildingRows ?? []) as Array<{
    id: string;
    primary_property_id: string | null;
  }>) {
    primaryByBuilding.set(b.id, b.primary_property_id);
  }
  // Member count per building (from properties.building_id).
  const { data: memberCountRows } = await untyped
    .from("properties")
    .select("building_id")
    .not("building_id", "is", null);
  const unitCountByBuilding = new Map<string, number>();
  for (const m of (memberCountRows ?? []) as Array<{ building_id: string }>) {
    unitCountByBuilding.set(
      m.building_id,
      (unitCountByBuilding.get(m.building_id) ?? 0) + 1,
    );
  }

  // 3) Shape + filter (drop rows whose property has been deleted out from
  //    under their report — defensive against orphans).
  type ReportRow = (typeof reportRows)[number];
  const raw: OwnerStoryIndexRow[] = [];
  for (const r of reportRows as ReportRow[]) {
    const propAny = Array.isArray(r.properties)
      ? r.properties[0]
      : r.properties;
    if (!propAny) continue;
    const prop = propAny as typeof propAny & { building_id: string | null };
    const stats = viewsByReport.get(r.id);
    const buildingId = prop.building_id ?? null;
    raw.push({
      property_id: prop.id,
      mls_number: prop.mls_number,
      address: prop.address,
      city: prop.city,
      state: prop.state,
      hero_image_url: prop.hero_image_url,
      agent_name: prop.agent_name,
      status: prop.status,
      listing_office_name: prop.listing_office_name,
      list_price:
        prop.list_price === null || prop.list_price === undefined
          ? null
          : Number(prop.list_price),
      listing_date: prop.listing_date,
      story_url_path: `/home/${r.report_token}`,
      has_generated_report: r.generated_at !== null,
      total_views: stats?.total ?? 0,
      last_viewed_at: stats?.last_viewed_at ?? null,
      building_id: buildingId,
      building_unit_count: buildingId
        ? unitCountByBuilding.get(buildingId) ?? 1
        : 1,
    });
  }

  // 3b) Collapse building members → one row per building (its primary unit).
  //     If the primary unit has no report row in this set, fall back to the
  //     member with the most views, then newest listing_date.
  const collapsed = collapseBuildings(raw, primaryByBuilding);

  // 4) Phase 7 — dedupe cross-MLS mirrors. When the SAME listing appears
  //    in BOTH CMC and SJSR feeds at the same (street, city, list_price),
  //    pick a single canonical row. Preference: more views > newer
  //    listing_date > stable mls_number order. The losing row is dropped
  //    from the index (its `/r/[token]` still resolves directly).
  //
  //    Multi-unit cases (multiple distinct MLS rows at the same street
  //    address but DIFFERENT prices) are intentionally left alone — they
  //    are real separate listings.
  const out = dedupeCrossMlsMirrors(collapsed);

  // 5) Sort — recent activity first, then generated reports, then newest.
  out.sort((a, b) => {
    const lva = a.last_viewed_at ? new Date(a.last_viewed_at).getTime() : 0;
    const lvb = b.last_viewed_at ? new Date(b.last_viewed_at).getTime() : 0;
    if (lvb !== lva) return lvb - lva;
    if (a.has_generated_report !== b.has_generated_report) {
      return a.has_generated_report ? -1 : 1;
    }
    const lda = a.listing_date ? new Date(a.listing_date).getTime() : 0;
    const ldb = b.listing_date ? new Date(b.listing_date).getTime() : 0;
    return ldb - lda;
  });

  return out;
}

/**
 * Collapse building members into ONE index row per building. Rows without a
 * building_id pass through untouched. For each building we keep the primary
 * unit's row (the one whose property_id === buildings.primary_property_id);
 * when that primary has no report row in this set we fall back to the member
 * with the most views, then newest listing_date. The surviving row's
 * total_views is replaced with the SUM across all members so the index reflects
 * the whole building's activity, and building_unit_count carries the badge.
 */
function collapseBuildings(
  rows: OwnerStoryIndexRow[],
  primaryByBuilding: Map<string, string | null>,
): OwnerStoryIndexRow[] {
  const standalone: OwnerStoryIndexRow[] = [];
  const byBuilding = new Map<string, OwnerStoryIndexRow[]>();
  for (const r of rows) {
    if (!r.building_id) {
      standalone.push(r);
      continue;
    }
    const arr = byBuilding.get(r.building_id) ?? [];
    arr.push(r);
    byBuilding.set(r.building_id, arr);
  }

  const out: OwnerStoryIndexRow[] = [...standalone];
  for (const [buildingId, members] of byBuilding) {
    const primaryId = primaryByBuilding.get(buildingId) ?? null;
    let winner =
      members.find((m) => m.property_id === primaryId) ??
      members
        .slice()
        .sort((a, b) => {
          if (b.total_views !== a.total_views) {
            return b.total_views - a.total_views;
          }
          const lda = a.listing_date ? new Date(a.listing_date).getTime() : 0;
          const ldb = b.listing_date ? new Date(b.listing_date).getTime() : 0;
          return ldb - lda;
        })[0];
    if (!winner) continue;
    const combinedViews = members.reduce((sum, m) => sum + m.total_views, 0);
    const lastViewed = members.reduce<string | null>((acc, m) => {
      if (!m.last_viewed_at) return acc;
      if (!acc) return m.last_viewed_at;
      return new Date(m.last_viewed_at) > new Date(acc) ? m.last_viewed_at : acc;
    }, null);
    winner = {
      ...winner,
      total_views: combinedViews,
      last_viewed_at: lastViewed,
      building_unit_count: members.length,
    };
    out.push(winner);
  }
  return out;
}

function dedupeKey(row: OwnerStoryIndexRow): string {
  const street = (row.address ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const city = (row.city ?? "").trim().toLowerCase();
  const price = row.list_price ?? 0;
  return `${street}|${city}|${price}`;
}

function dedupeCrossMlsMirrors(
  rows: OwnerStoryIndexRow[],
): OwnerStoryIndexRow[] {
  const groups = new Map<string, OwnerStoryIndexRow[]>();
  for (const r of rows) {
    const key = dedupeKey(r);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out: OwnerStoryIndexRow[] = [];
  for (const [, arr] of groups) {
    if (arr.length === 1) {
      out.push(arr[0]!);
      continue;
    }
    // Multiple rows at same (street, city, price). Pick canonical:
    //   most views → newest listing_date → lowest mls_number string
    const winner = arr.slice().sort((a, b) => {
      if (b.total_views !== a.total_views) {
        return b.total_views - a.total_views;
      }
      const lda = a.listing_date ? new Date(a.listing_date).getTime() : 0;
      const ldb = b.listing_date ? new Date(b.listing_date).getTime() : 0;
      if (ldb !== lda) return ldb - lda;
      return a.mls_number.localeCompare(b.mls_number);
    })[0];
    if (winner) out.push(winner);
  }
  return out;
}
