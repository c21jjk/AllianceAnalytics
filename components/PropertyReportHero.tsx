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
  const heroUrl = property.hero_image_url;

  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 border-t-4 border-t-gold-500 bg-white",
        "shadow-card overflow-hidden",
        className,
      )}
    >
      {/* Hero photo — only when we have one. Falls back gracefully on text-only header */}
      {heroUrl ? (
        <div className="relative w-full aspect-[16/9] sm:aspect-[21/9] bg-neutral-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroUrl}
            alt={`Cover photo for ${property.address}`}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Subtle bottom gradient so the eyebrow text below has a clean break */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/80 to-transparent"
          />
        </div>
      ) : null}

      <div className="p-6 md:p-8">
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
    </div>
  );
}
