import clsx from "clsx";
import type { BudgetAllocation } from "@/lib/types/strategy";
import { formatCurrency, formatPercent } from "@/lib/format";
import PlatformBadge from "./PlatformBadge";

interface BudgetSplitChartProps {
  allocation: BudgetAllocation;
  className?: string;
}

/**
 * Renders a horizontal stacked bar visualization of budget allocation across platforms.
 *
 * Shows:
 * - Header with total weekly budget
 * - Horizontal stacked bar with platform-colored segments
 * - Legend below with platform badges, share%, and weekly $
 */
export default function BudgetSplitChart({
  allocation,
  className,
}: BudgetSplitChartProps) {
  // Platform-specific colors for the bar segments
  const platformColors: Record<
    string,
    { bg: string; icon: React.ReactNode }
  > = {
    facebook: {
      bg: "bg-[#1877F2]",
      icon: null, // icon handled by PlatformBadge
    },
    instagram: {
      bg: "bg-gradient-to-r from-[#FEDA77] via-[#F58529] to-[#DD2A7B]",
      icon: null,
    },
    tiktok: {
      bg: "bg-neutral-900",
      icon: null,
    },
  };

  return (
    <div className={clsx("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-neutral-600">
          Weekly budget
        </span>
        <span className="text-lg font-semibold text-neutral-900">
          {formatCurrency(allocation.total_weekly_usd)}
        </span>
      </div>

      {/* Stacked horizontal bar */}
      <div className="space-y-2">
        <div className="relative h-3 rounded-full overflow-hidden ring-1 ring-neutral-200 bg-neutral-100">
          {allocation.slices.map((slice, idx) => {
            const width = `${(slice.share * 100).toFixed(1)}%`;
            const platformColor = platformColors[slice.platform];

            return (
              <div
                key={idx}
                className={clsx(
                  "absolute top-0 bottom-0 transition-all",
                  platformColor.bg,
                )}
                style={{
                  left: `${allocation.slices
                    .slice(0, idx)
                    .reduce((sum, s) => sum + s.share * 100, 0)
                    .toFixed(1)}%`,
                  width,
                }}
                title={`${slice.platform}: ${formatPercent(slice.share)}`}
              />
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-2">
        {allocation.slices.map((slice) => (
          <div
            key={slice.platform}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              <PlatformBadge platform={slice.platform} size="sm" />
              <span className="text-neutral-900 font-medium capitalize">
                {slice.platform}
              </span>
            </div>

            <div className="flex items-center gap-4 ml-auto whitespace-nowrap">
              <span className="text-neutral-600">
                {formatPercent(slice.share)}
              </span>
              <span className="text-neutral-900 font-semibold">
                {formatCurrency(slice.weekly_usd)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Optional rationale */}
      {allocation.rationale ? (
        <div className="pt-2 border-t border-neutral-200 text-sm text-neutral-600 leading-relaxed">
          {allocation.rationale}
        </div>
      ) : null}
    </div>
  );
}
