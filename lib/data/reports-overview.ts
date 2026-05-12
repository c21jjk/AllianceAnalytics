import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CompanyAnalyticsRollup,
  ReportDelivery,
} from "@/lib/types/report";

/**
 * Live fetchers for the /reports page. Replaces the fixture-driven Phase 1
 * versions in lib/fixtures/reports.ts.
 *
 * Both functions degrade gracefully — when no reports exist yet (which is the
 * expected state for a fresh deployment), they return empty/zero-shaped
 * results and the page renders empty states with a CTA pointing at the
 * "Generate Seller Report" flow on each listing.
 */

interface DbReportRow {
  id: string;
  property_id: string;
  report_token: string;
  generated_at: string | null;
  period_start: string | null;
  period_end: string | null;
  post_ids: string[];
  kpis: Record<string, unknown>;
}

interface DbPropertyMiniRow {
  id: string;
  mls_number: string;
  address: string | null;
  list_price: number | null;
}

interface DbDeliveryRow {
  id: string;
  report_id: string;
  channel: "email" | "link";
  status: "pending" | "sent" | "viewed";
  sent_at: string | null;
  viewed_at: string | null;
  view_count: number;
  share_token: string;
  recipient_name: string | null;
  recipient_email: string | null;
}

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Company-wide rollup for the report-distribution surface. Counts reports
 * generated within the window, distinct properties covered, the sum of those
 * listings' list prices (so we can say "$N of inventory marketed"), total
 * reach delivered (sum of kpis.total_reach across reports), engagements, and
 * the view rate (viewed deliveries / sent deliveries — pending excluded).
 */
export async function getCompanyReportRollup(
  windowDays: number,
): Promise<CompanyAnalyticsRollup> {
  const supabase = createAdminClient();
  const cutoffIso = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const label =
    windowDays === 30
      ? "Last 30 days"
      : windowDays === 90
        ? "Last 90 days"
        : `Last ${windowDays} days`;

  // 1) Reports generated in the window.
  const { data: reportRows, error: reportErr } = await supabase
    .from("reports")
    .select("id, property_id, generated_at, kpis")
    .gte("generated_at", cutoffIso);

  if (reportErr) {
    console.error("getCompanyReportRollup: reports error", reportErr);
    return emptyRollup(label, windowDays);
  }

  const reports = (reportRows ?? []) as Array<{
    id: string;
    property_id: string;
    generated_at: string | null;
    kpis: Record<string, unknown> | null;
  }>;

  if (reports.length === 0) return emptyRollup(label, windowDays);

  // 2) Distinct property ids → fetch list_price for inventory sum.
  const propertyIds = Array.from(new Set(reports.map((r) => r.property_id)));
  const { data: propertyRows } = await supabase
    .from("properties")
    .select("id, list_price")
    .in("id", propertyIds);
  const priceById = new Map<string, number>();
  for (const row of (propertyRows ?? []) as Array<{
    id: string;
    list_price: number | null;
  }>) {
    if (row.list_price !== null) priceById.set(row.id, Number(row.list_price));
  }

  // 3) Reach + engagements from kpis JSON.
  let total_reach_delivered = 0;
  let total_engagements_delivered = 0;
  for (const r of reports) {
    const k = r.kpis ?? {};
    total_reach_delivered += readNum(k.total_reach);
    total_engagements_delivered += readNum(k.total_engagements);
  }

  // 4) Inventory $ — sum list_price for distinct properties.
  let total_inventory_usd = 0;
  for (const pid of propertyIds) {
    total_inventory_usd += priceById.get(pid) ?? 0;
  }

  // 5) View rate from deliveries on these reports.
  const reportIds = reports.map((r) => r.id);
  const { data: deliveryRows } = await supabase
    .from("report_deliveries")
    .select("status")
    .in("report_id", reportIds);

  let sentCount = 0;
  let viewedCount = 0;
  for (const d of (deliveryRows ?? []) as Array<{ status: string }>) {
    if (d.status === "sent") sentCount += 1;
    if (d.status === "viewed") {
      viewedCount += 1;
      sentCount += 1; // viewed implies sent
    }
  }
  const view_rate = sentCount === 0 ? 0 : viewedCount / sentCount;

  return {
    label,
    window_days: windowDays,
    reports_sent: reports.length,
    properties_covered: propertyIds.length,
    total_inventory_usd,
    total_reach_delivered,
    total_engagements_delivered,
    view_rate,
    generated_at: new Date().toISOString(),
  };
}

function emptyRollup(
  label: string,
  windowDays: number,
): CompanyAnalyticsRollup {
  return {
    label,
    window_days: windowDays,
    reports_sent: 0,
    properties_covered: 0,
    total_inventory_usd: 0,
    total_reach_delivered: 0,
    total_engagements_delivered: 0,
    view_rate: 0,
    generated_at: new Date().toISOString(),
  };
}

export interface RecentDeliveryWithAddress extends ReportDelivery {
  /** Address for the property — surfaced in the table so we don't need
   *  addressByMls lookup in the component. */
  address: string | null;
}

/**
 * Recent report deliveries — joined report_deliveries + reports + properties
 * + report_recipients (for recipient name + email). Sorted newest-first by
 * sent_at, with pending rows at the bottom.
 *
 * Returns an empty array (not throws) on any DB error so the page renders.
 */
export async function getRecentDeliveries(
  limit: number = 25,
): Promise<RecentDeliveryWithAddress[]> {
  const supabase = createAdminClient();

  // 1) Deliveries — newest first.
  const { data: deliveryRows, error: deliveryErr } = await supabase
    .from("report_deliveries")
    .select(
      "id, report_id, channel, status, sent_at, viewed_at, view_count, share_token, recipient_name, recipient_email",
    )
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (deliveryErr) {
    console.error("getRecentDeliveries: deliveries error", deliveryErr);
    return [];
  }

  const deliveries = (deliveryRows ?? []) as DbDeliveryRow[];
  if (deliveries.length === 0) return [];

  // 2) Reports → property ids.
  const reportIds = Array.from(new Set(deliveries.map((d) => d.report_id)));
  const { data: reportRows } = await supabase
    .from("reports")
    .select("id, property_id, report_token")
    .in("id", reportIds);

  const propertyIdByReportId = new Map<string, string>();
  const tokenByReportId = new Map<string, string>();
  for (const r of (reportRows ?? []) as Array<{
    id: string;
    property_id: string;
    report_token: string;
  }>) {
    propertyIdByReportId.set(r.id, r.property_id);
    tokenByReportId.set(r.id, r.report_token);
  }

  // 3) Properties — mls + address.
  const propertyIds = Array.from(
    new Set(
      Array.from(propertyIdByReportId.values()).filter((x) => Boolean(x)),
    ),
  );
  const propertyById = new Map<
    string,
    { mls_number: string; address: string | null }
  >();
  if (propertyIds.length > 0) {
    const { data: propertyRows } = await supabase
      .from("properties")
      .select("id, mls_number, address")
      .in("id", propertyIds);
    for (const p of (propertyRows ?? []) as Array<{
      id: string;
      mls_number: string;
      address: string | null;
    }>) {
      propertyById.set(p.id, { mls_number: p.mls_number, address: p.address });
    }
  }

  // 4) Fall back to report_recipients when the delivery row doesn't carry
  //    recipient_name/email directly (link channel deliveries often don't).
  const reportsNeedingRecipientHydration = reportIds.filter((rid) =>
    deliveries.some(
      (d) =>
        d.report_id === rid &&
        (d.recipient_name === null || d.recipient_email === null),
    ),
  );
  const recipientHintByReportId = new Map<
    string,
    { name: string | null; email: string }
  >();
  if (reportsNeedingRecipientHydration.length > 0) {
    const { data: recipientRows } = await supabase
      .from("report_recipients")
      .select("report_id, name, email, created_at")
      .in("report_id", reportsNeedingRecipientHydration)
      .order("created_at", { ascending: true });
    for (const r of (recipientRows ?? []) as Array<{
      report_id: string;
      name: string | null;
      email: string;
    }>) {
      if (!recipientHintByReportId.has(r.report_id)) {
        // First-added recipient wins — typically the seller.
        recipientHintByReportId.set(r.report_id, {
          name: r.name,
          email: r.email,
        });
      }
    }
  }

  // 5) Shape final rows.
  const out: RecentDeliveryWithAddress[] = deliveries.map((d) => {
    const propertyId = propertyIdByReportId.get(d.report_id);
    const property = propertyId ? propertyById.get(propertyId) : undefined;
    const recipientHint = recipientHintByReportId.get(d.report_id);
    const recipient_name =
      d.recipient_name ?? recipientHint?.name ?? "Pending recipient";
    const recipient_email =
      d.recipient_email ?? recipientHint?.email ?? "no-recipient@pending";

    return {
      id: d.id,
      report_id: d.report_id,
      mls: property?.mls_number ?? "—",
      address: property?.address ?? null,
      recipient_name,
      recipient_email,
      channel: d.channel,
      status: d.status,
      sent_at: d.sent_at,
      viewed_at: d.viewed_at,
      view_count: d.view_count,
      share_token: d.share_token,
    };
  });

  return out;
}

/**
 * Count of report rows in the database. Cheap query used for the page
 * footnote. Returns 0 on any error.
 */
export async function countAllReports(): Promise<number> {
  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true });
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Count of delivery rows in the database. Cheap query for the page footnote.
 */
export async function countAllDeliveries(): Promise<number> {
  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("report_deliveries")
      .select("id", { count: "exact", head: true });
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

// Unused — kept for type-narrowing exports if needed.
export type { DbReportRow, DbPropertyMiniRow };
