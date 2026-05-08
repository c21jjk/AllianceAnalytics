import clsx from "clsx";
import type { CompanyAnalyticsRollup } from "@/lib/types/report";
import {
  formatCompactNumber,
  formatNumber,
  formatCurrency,
} from "@/lib/format";

interface CompanyAnalyticsHeroProps {
  rollup: CompanyAnalyticsRollup;
  className?: string;
}

/**
 * Pitch block for company-wide analytics. Designed to be screenshot-able for
 * agent recruiting and listing presentations.
 */
export default function CompanyAnalyticsHero({
  rollup,
  className,
}: CompanyAnalyticsHeroProps) {
  // Build the pitch as dynamic prose
  const pitch = `In the last ${rollup.window_days} days, Alliance delivered ${formatNumber(rollup.reports_sent)} property reports, reaching ${formatCompactNumber(rollup.total_reach_delivered)} buyers across 3 platforms, on ${formatCurrency(rollup.total_inventory_usd)} of inventory.`;

  const tiles = [
    {
      label: "Reports Sent",
      value: formatNumber(rollup.reports_sent),
    },
    {
      label: "Properties Covered",
      value: formatNumber(rollup.properties_covered),
    },
    {
      label: "Total Reach Delivered",
      value: formatCompactNumber(rollup.total_reach_delivered),
    },
    {
      label: "Inventory Value",
      value: formatCurrency(rollup.total_inventory_usd),
    },
  ];

  return (
    <div
      className={clsx(
        "relative rounded-xl border border-gold-200 overflow-hidden",
        "bg-gradient-to-br from-gold-50 via-white to-white",
        "shadow-elevated",
        "p-8 md:p-10",
        className,
      )}
    >
      {/* Decorative corner glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gold-200/40 blur-3xl"
      />

      <div className="relative space-y-8">
        {/* Hero prose pitch */}
        <div className="max-w-3xl">
          <p className="text-lg md:text-xl font-semibold tracking-tight text-neutral-900 leading-relaxed">
            {pitch}
          </p>
        </div>

        {/* 4-tile mini grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className={clsx(
                "rounded-lg border border-gold-200 bg-white/70 p-4",
                "flex flex-col",
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                {tile.label}
              </span>
              <span className="mt-2 text-xl md:text-2xl font-semibold tabular-nums text-neutral-900">
                {tile.value}
              </span>
            </div>
          ))}
        </div>

        {/* Export button — disabled for Phase 2 */}
        <div className="pt-2">
          <button
            disabled
            title="Snapshot PDF lands in Phase 2"
            className={clsx(
              "px-4 py-2 rounded-lg font-medium text-sm transition-all",
              "bg-gold-500 text-white",
              "opacity-50 cursor-not-allowed",
            )}
          >
            Export company snapshot
          </button>
        </div>
      </div>
    </div>
  );
}
