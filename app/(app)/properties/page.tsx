import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PROPERTIES_BY_MLS, postsForMls } from "@/lib/fixtures/posts";
import {
  PROPERTY_REPORTS,
  REPORT_DELIVERIES,
  findReport,
} from "@/lib/fixtures/reports";
import {
  formatCompactNumber,
  formatCurrency,
  formatRelativeTime,
} from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const metadata = { title: "Properties — Alliance Social" };

export default async function PropertiesPage() {
  await requireUser();

  // Build view models for each property card
  const cards = Object.values(PROPERTIES_BY_MLS).map((property) => {
    const posts = postsForMls(property.mls);
    const report = findReport(property.mls);
    const totalReach = posts.reduce((sum, p) => sum + p.metrics.reach, 0);
    const totalEngagements = posts.reduce(
      (sum, p) =>
        sum + p.metrics.likes + p.metrics.comments + p.metrics.shares + p.metrics.saves,
      0,
    );
    // Find latest delivery for this property's report (if any)
    const lastDelivery = report
      ? REPORT_DELIVERIES.filter((d) => d.report_id === report.id)
          .filter((d) => d.sent_at !== null)
          .sort(
            (a, b) =>
              new Date(b.sent_at ?? 0).getTime() -
              new Date(a.sent_at ?? 0).getTime(),
          )[0]
      : undefined;

    return {
      property,
      posts,
      report,
      totalReach,
      totalEngagements,
      lastDelivery,
    };
  });

  return (
    <div>
      <PageHeader
        title="Properties"
        description="Every active and recent listing tracked here. Click into a property to see the full report Alliance delivers to its seller."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map(
          ({
            property,
            posts,
            report,
            totalReach,
            totalEngagements,
            lastDelivery,
          }) => (
            <Link
              key={property.mls}
              href={`/properties/${property.mls}`}
              className="group rounded-xl border border-neutral-200 bg-white shadow-card hover:shadow-card-hover hover:border-gold-200 transition-all p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                    MLS {property.mls}
                  </div>
                  <h3 className="mt-1 text-base font-semibold text-neutral-900 truncate">
                    {property.address}
                  </h3>
                  {property.list_price ? (
                    <div className="mt-0.5 text-sm text-gold-700 font-semibold tabular-nums">
                      {formatCurrency(property.list_price)}
                    </div>
                  ) : null}
                </div>

                <DeliveryStatus
                  hasReport={!!report}
                  lastDeliveryAt={lastDelivery?.sent_at ?? null}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniStat label="Posts" value={posts.length.toString()} />
                <MiniStat
                  label="Reach"
                  value={formatCompactNumber(totalReach)}
                />
                <MiniStat
                  label="Engagements"
                  value={formatCompactNumber(totalEngagements)}
                />
              </div>

              <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-sm">
                <span className="text-neutral-500">
                  {report ? "View full report" : "Generate report"}
                </span>
                <span className="text-gold-700 group-hover:text-gold-800 font-medium inline-flex items-center gap-1">
                  Open
                  <svg
                    viewBox="0 0 24 24"
                    className="w-3.5 h-3.5"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M9 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </Link>
          ),
        )}
      </div>

      {/* Footnote tying this page to the Company Analytics rollup */}
      <div className="mt-6 text-xs text-neutral-500">
        Tracking{" "}
        <span className="font-medium text-neutral-700">
          {Object.keys(PROPERTIES_BY_MLS).length} properties
        </span>{" "}
        ·{" "}
        <span className="font-medium text-neutral-700">
          {PROPERTY_REPORTS.length} reports generated
        </span>
        . See the{" "}
        <Link href="/reports" className="text-gold-700 hover:text-gold-800">
          company-wide rollup
        </Link>
        .
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">
        {value}
      </div>
    </div>
  );
}

function DeliveryStatus({
  hasReport,
  lastDeliveryAt,
}: {
  hasReport: boolean;
  lastDeliveryAt: string | null;
}) {
  if (!hasReport) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-neutral-100 ring-1 ring-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
        No report
      </span>
    );
  }
  if (!lastDeliveryAt) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-50 ring-1 ring-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        Report ready
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
      Sent {formatRelativeTime(lastDeliveryAt)}
    </span>
  );
}
