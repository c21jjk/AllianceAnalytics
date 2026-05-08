import clsx from "clsx";
import type { PropertyReport, PropertyRef } from "@/lib/types/report";
import { formatShortDate, formatCurrency } from "@/lib/format";

interface PropertyReportHeroProps {
  report: PropertyReport;
  property: PropertyRef;
  className?: string;
}

export default function PropertyReportHero({
  report,
  property,
  className,
}: PropertyReportHeroProps) {
  const periodStart = formatShortDate(report.period_start);
  const periodEnd = formatShortDate(report.period_end);
  const daysSpanned = Math.ceil(
    (new Date(report.period_end).getTime() -
      new Date(report.period_start).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  const postCount = report.post_ids.length;

  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 border-t-4 border-t-gold-500 bg-white",
        "shadow-card p-6 md:p-8",
        className,
      )}
    >
      {/* Eyebrow */}
      <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
        Property Report · MLS {property.mls}
      </div>

      {/* Address as h1 */}
      <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
        {property.address}
      </h1>

      {/* Period subline */}
      <p className="mt-1.5 text-sm text-neutral-600">
        Period: {periodStart} – {periodEnd} · {daysSpanned} days · {postCount}{" "}
        {postCount === 1 ? "post" : "posts"}
      </p>

      {/* Optional list price chip */}
      {property.list_price ? (
        <div className="mt-4 inline-flex items-center rounded-lg border border-gold-200 bg-gradient-to-br from-gold-50 to-white px-3 py-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            List Price
          </span>
          <span className="ml-2 text-sm font-semibold text-gold-700">
            {formatCurrency(property.list_price)}
          </span>
        </div>
      ) : null}

      {/* Hero narrative */}
      <p className="mt-6 max-w-3xl text-sm text-neutral-600 leading-relaxed">
        {report.narrative.hero}
      </p>
    </div>
  );
}
