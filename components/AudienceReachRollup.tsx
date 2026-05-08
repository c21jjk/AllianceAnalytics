import clsx from "clsx";
import type { PropertyReport } from "@/lib/types/report";
import { formatCompactNumber, formatPercent } from "@/lib/format";
import PlatformBadge from "./PlatformBadge";

interface AudienceReachRollupProps {
  audience: PropertyReport["audience"];
  className?: string;
}

export default function AudienceReachRollup({
  audience,
  className,
}: AudienceReachRollupProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 bg-white shadow-card",
        "p-5 md:p-6",
        className,
      )}
    >
      {/* Reach by platform — stacked bar section */}
      <div className="mb-6 pb-6 border-b border-neutral-200">
        <h3 className="text-sm font-medium text-neutral-900 mb-3">
          Reach by Platform
        </h3>
        <div className="space-y-2">
          {/* Stacked bar */}
          <div className="relative h-3 rounded-full overflow-hidden ring-1 ring-neutral-200 bg-neutral-100">
            {audience.platform_share.map((slice, idx) => {
              const width = `${(slice.share * 100).toFixed(1)}%`;
              const platformColors: Record<string, string> = {
                facebook: "bg-[#1877F2]",
                instagram:
                  "bg-gradient-to-r from-[#FEDA77] via-[#F58529] to-[#DD2A7B]",
                tiktok: "bg-neutral-900",
              };

              return (
                <div
                  key={slice.platform}
                  className={clsx(
                    "absolute top-0 bottom-0 transition-all",
                    platformColors[slice.platform],
                  )}
                  style={{
                    left: `${audience.platform_share
                      .slice(0, idx)
                      .reduce((sum, s) => sum + s.share * 100, 0)
                      .toFixed(1)}%`,
                    width,
                  }}
                  title={`${slice.platform}: ${formatPercent(slice.share)} (${formatCompactNumber(slice.reach)} reach)`}
                />
              );
            })}
          </div>

          {/* Platform legend */}
          <div className="flex flex-wrap gap-3 text-xs mt-2">
            {audience.platform_share.map((slice) => (
              <div
                key={slice.platform}
                className="flex items-center gap-2"
              >
                <PlatformBadge platform={slice.platform} size="sm" />
                <span className="text-neutral-700 font-medium capitalize">
                  {formatPercent(slice.share)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Three-column layout: locations, age, gender */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Top locations */}
        <div>
          <h3 className="text-sm font-medium text-neutral-900 mb-3">
            Top Locations
          </h3>
          <div className="space-y-2">
            {audience.top_locations.map((loc) => (
              <div key={loc.label} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] text-neutral-600 truncate">
                      {loc.label}
                    </span>
                    <span className="text-[11px] font-semibold text-neutral-900 whitespace-nowrap">
                      {formatPercent(loc.share)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100 ring-1 ring-neutral-200 overflow-hidden">
                    <div
                      className="h-full bg-gold-500 transition-all"
                      style={{ width: `${(loc.share * 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Age buckets */}
        <div>
          <h3 className="text-sm font-medium text-neutral-900 mb-3">
            Age Groups
          </h3>
          <div className="space-y-2">
            {audience.age_buckets.map((age) => (
              <div key={age.label} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] text-neutral-600 truncate">
                      {age.label}
                    </span>
                    <span className="text-[11px] font-semibold text-neutral-900 whitespace-nowrap">
                      {formatPercent(age.share)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100 ring-1 ring-neutral-200 overflow-hidden">
                    <div
                      className="h-full bg-gold-500 transition-all"
                      style={{ width: `${(age.share * 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Gender split */}
        <div>
          <h3 className="text-sm font-medium text-neutral-900 mb-3">
            Gender
          </h3>
          <div className="space-y-2">
            {audience.gender_split.map((gender) => (
              <div key={gender.label} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] text-neutral-600 truncate">
                      {gender.label}
                    </span>
                    <span className="text-[11px] font-semibold text-neutral-900 whitespace-nowrap">
                      {formatPercent(gender.share)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100 ring-1 ring-neutral-200 overflow-hidden">
                    <div
                      className="h-full bg-gold-500 transition-all"
                      style={{ width: `${(gender.share * 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
