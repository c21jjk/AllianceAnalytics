import { requireUser } from "@/lib/auth";
import {
  COMPANY_ROLLUPS,
  REPORT_DELIVERIES,
  PROPERTY_REPORTS,
} from "@/lib/fixtures/reports";
import { PROPERTIES_BY_MLS } from "@/lib/fixtures/posts";
import PageHeader from "@/components/PageHeader";
import CompanyAnalyticsHero from "@/components/CompanyAnalyticsHero";
import RecentDeliveriesTable from "@/components/RecentDeliveriesTable";

export const metadata = { title: "Reports — Alliance Social" };

export default async function ReportsPage() {
  await requireUser();

  // Default to "Last 30 days" rollup; the 90-day surface in a smaller card below.
  const rollup30 =
    COMPANY_ROLLUPS.find((r) => r.window_days === 30) ?? COMPANY_ROLLUPS[0];
  const rollup90 = COMPANY_ROLLUPS.find((r) => r.window_days === 90);

  // Build address lookup for the deliveries table
  const addressByMls: Record<string, string> = Object.fromEntries(
    Object.values(PROPERTIES_BY_MLS).map((p) => [p.mls, p.address]),
  );

  // Sort deliveries by sent_at descending (pending at the bottom)
  const sortedDeliveries = [...REPORT_DELIVERIES].sort((a, b) => {
    const aT = a.sent_at ? new Date(a.sent_at).getTime() : 0;
    const bT = b.sent_at ? new Date(b.sent_at).getTime() : 0;
    return bT - aT;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Company-wide picture of every property report Alliance has delivered. The hero block is built to be screenshot-able for listing presentations and recruiting decks."
      />

      <CompanyAnalyticsHero rollup={rollup30} />

      {/* 90-day stripe — smaller, secondary view */}
      {rollup90 ? (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-4 md:p-5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            90-day view
          </div>
          <div className="mt-1 text-sm text-neutral-700 leading-relaxed max-w-3xl">
            Over the past 90 days, Alliance delivered{" "}
            <strong>{rollup90.reports_sent} reports</strong> across{" "}
            <strong>{rollup90.properties_covered} listings</strong>, reaching{" "}
            <strong>
              {rollup90.total_reach_delivered.toLocaleString()} buyers
            </strong>
            . {Math.round(rollup90.view_rate * 100)}% of sent reports were
            opened by the seller.
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Recent deliveries
          </h2>
          <p className="text-sm text-neutral-500">
            Every property report sent to a seller, plus pending sends.
          </p>
        </div>
        <RecentDeliveriesTable
          deliveries={sortedDeliveries}
          addressByMls={addressByMls}
        />
      </section>

      {/* Pipeline footnote */}
      <div className="text-xs text-neutral-500">
        {PROPERTY_REPORTS.length} property reports generated · {REPORT_DELIVERIES.length} total
        deliveries tracked.
      </div>
    </div>
  );
}
