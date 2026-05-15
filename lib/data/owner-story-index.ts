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
}

export async function fetchOwnerStoryIndex(): Promise<OwnerStoryIndexRow[]> {
  const supabase = createAdminClient();

  // 1) Reports → properties join. Phase 2 backfill guarantees one report
  //    row per property; we still left-join semantics by selecting from
  //    reports and embedding properties.
  const { data: reportRows, error: reportErr } = await supabase
    .from("reports")
    .select(
      "id, report_token, property_id, generated_at, properties(id, mls_number, address, city, state, hero_image_url, agent_name, status, listing_office_name, list_price, listing_date)",
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

  // 3) Shape + filter (drop rows whose property has been deleted out from
  //    under their report — defensive against orphans).
  type ReportRow = (typeof reportRows)[number];
  const raw: OwnerStoryIndexRow[] = [];
  for (const r of reportRows as ReportRow[]) {
    const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties;
    if (!prop) continue;
    const stats = viewsByReport.get(r.id);
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
    });
  }

  // 4) Phase 7 — dedupe cross-MLS mirrors. When the SAME listing appears
  //    in BOTH CMC and SJSR feeds at the same (street, city, list_price),
  //    pick a single canonical row. Preference: more views > newer
  //    listing_date > stable mls_number order. The losing row is dropped
  //    from the index (its `/r/[token]` still resolves directly).
  //
  //    Multi-unit cases (multiple distinct MLS rows at the same street
  //    address but DIFFERENT prices) are intentionally left alone — they
  //    are real separate listings.
  const out = dedupeCrossMlsMirrors(raw);

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
