import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  countAllDeliveries,
  countAllReports,
  getCompanyReportRollup,
  getRecentDeliveries,
} from "@/lib/data/reports-overview";
import { fetchOwnerStoryIndex } from "@/lib/data/owner-story-index";
import PageHeader from "@/components/PageHeader";
import CompanyAnalyticsHero from "@/components/CompanyAnalyticsHero";
import RecentDeliveriesTable from "@/components/RecentDeliveriesTable";
import OwnerStoryIndexTable from "@/components/OwnerStoryIndexTable";

export const metadata = { title: "Reports — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Reports / distribution dashboard.
 *
 * Live data now — replaced the fixture-driven Phase-1 prototype.
 * Pulls from `reports`, `report_deliveries`, `properties`, `report_recipients`
 * via lib/data/reports-overview.
 *
 * Empty-state behavior (no reports generated yet): the hero is replaced with
 * a CTA pointing the admin at the per-listing "Generate Seller Report" flow.
 * The deliveries table renders its own empty state.
 */
interface ReportsPageProps {
  searchParams?: Promise<{ view?: string | string[] }>;
}

/**
 * 2026-08-05 (John) — the Stories tab was folded in here. Both pages answered
 * the same question ("what did the seller get"), so they were two halves of
 * one idea competing for a slot in a 7-tab nav. `?view=stories` renders the
 * Owner Story index that used to live at /stories, which now redirects here
 * so old links and bookmarks keep working.
 */
export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  await requireUser();

  const sp = (await searchParams) ?? {};
  const rawView = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: "overview" | "stories" = rawView === "stories" ? "stories" : "overview";

  const [
    rollup30,
    rollup90,
    deliveries,
    totalReports,
    totalDeliveries,
  ] = await Promise.all([
    getCompanyReportRollup(30),
    getCompanyReportRollup(90),
    getRecentDeliveries(25),
    countAllReports(),
    countAllDeliveries(),
  ]);

  const hasAnyReports = totalReports > 0;
  const storyRows = view === "stories" ? await fetchOwnerStoryIndex() : [];

  // Build addressByMls from deliveries (live data already carries address,
  // but the table component accepts the lookup shape from the fixture era).
  const addressByMls: Record<string, string> = {};
  for (const d of deliveries) {
    if (d.address && !addressByMls[d.mls]) {
      addressByMls[d.mls] = d.address;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={
          view === "stories"
            ? "One link per listing — the seller-facing story page. Copy, preview, or open any campaign in a single click. Views are tracked automatically."
            : "Company-wide picture of every Seller Report Alliance has generated. The hero block is built to be screenshot-able for listing presentations and recruiting decks."
        }
      />

      <ReportsViewTabs current={view} />

      {view === "stories" ? (
        <OwnerStoryIndexTable rows={storyRows} />
      ) : (
      <>
      {hasAnyReports ? (
        <CompanyAnalyticsHero rollup={rollup30} />
      ) : (
        <EmptyReportsCTA />
      )}

      {/* 90-day stripe — only meaningful when there's data. */}
      {hasAnyReports && rollup90.reports_sent > 0 ? (
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
            Every Seller Report sent to a seller, plus pending sends. Email
            delivery activates once Resend is connected.
          </p>
        </div>
        <RecentDeliveriesTable
          deliveries={deliveries}
          addressByMls={addressByMls}
        />
      </section>

      {/* Pipeline footnote */}
      <div className="text-xs text-neutral-500">
        {totalReports} {totalReports === 1 ? "report" : "reports"} generated ·{" "}
        {totalDeliveries}{" "}
        {totalDeliveries === 1 ? "delivery" : "deliveries"} tracked.
      </div>
      </>
      )}
    </div>
  );
}

/**
 * Segmented control that swaps the page between the aggregate report numbers
 * and the per-listing Owner Story index. Plain links rather than client state
 * so each view is a real, shareable URL and stays server-rendered.
 */
function ReportsViewTabs({ current }: { current: "overview" | "stories" }) {
  const tabs: Array<{ key: "overview" | "stories"; label: string; href: string }> =
    [
      { key: "overview", label: "Report activity", href: "/reports" },
      { key: "stories", label: "Owner Stories", href: "/reports?view=stories" },
    ];
  return (
    <div
      role="tablist"
      aria-label="Reports view"
      className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1"
    >
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={
              active
                ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 shadow-sm"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Empty state — shown when no reports have been generated yet. Replaces the
 * CompanyAnalyticsHero so the page doesn't display zeros that look like a bug.
 */
function EmptyReportsCTA() {
  return (
    <div className="relative rounded-xl border border-gold-200 overflow-hidden bg-gradient-to-br from-gold-50 via-white to-white shadow-elevated p-8 md:p-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gold-200/40 blur-3xl"
      />
      <div className="relative max-w-2xl">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-700">
          No Seller Reports yet
        </div>
        <h2 className="mt-2 text-xl md:text-2xl font-semibold tracking-tight text-neutral-900 leading-snug">
          Generate your first Seller Report from any listing.
        </h2>
        <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
          Each report bundles the social media activity for a single listing
          into a branded summary your seller can view in their browser or
          download as a PDF. Once you generate the first one, this dashboard
          fills in: reports sent, listings covered, total reach delivered, and
          view rate as sellers open the link.
        </p>
        <div className="mt-5">
          <Link
            href="/properties"
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 bg-gold-500 text-white font-medium text-sm transition-colors hover:bg-gold-600"
          >
            Pick a listing to start
            <ArrowIcon />
          </Link>
        </div>
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
