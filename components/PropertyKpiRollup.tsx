import clsx from "clsx";
import type { PropertyReportKpis } from "@/lib/types/report";
import {
  formatCompactNumber,
  formatPercent,
} from "@/lib/format";

interface PropertyKpiRollupProps {
  kpis: PropertyReportKpis;
  className?: string;
}

export default function PropertyKpiRollup({
  kpis,
  className,
}: PropertyKpiRollupProps) {
  const tiles = [
    {
      label: "Total Reach",
      value: formatCompactNumber(kpis.total_reach),
    },
    {
      label: "Total Engagements",
      value: formatCompactNumber(kpis.total_engagements),
    },
    {
      label: "Engagement Rate",
      value: formatPercent(kpis.engagement_rate),
    },
    {
      label: "Posts",
      value: kpis.post_count.toString(),
      sublabel: `across ${kpis.platforms_covered} ${kpis.platforms_covered === 1 ? "platform" : "platforms"}`,
    },
  ];

  return (
    <div
      className={clsx(
        "grid grid-cols-2 md:grid-cols-4 gap-3",
        className,
      )}
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={clsx(
            "rounded-lg border border-neutral-200 bg-white p-4",
            "flex flex-col",
          )}
        >
          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            {tile.label}
          </span>
          <span className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
            {tile.value}
          </span>
          {tile.sublabel ? (
            <span className="mt-1 text-[11px] text-neutral-500">
              {tile.sublabel}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
