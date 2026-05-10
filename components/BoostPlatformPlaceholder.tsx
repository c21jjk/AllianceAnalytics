import clsx from "clsx";
import PlatformBadge, { platformLabel } from "@/components/PlatformBadge";
import type { Platform } from "@/lib/types/post";
import { formatCompactNumber } from "@/lib/format";

interface BoostPlatformPlaceholderProps {
  platform: Platform;
  hasPosting: boolean;
  currentReach: number;
  className?: string;
}

/**
 * Per-platform boost stub. Renders a tile with the platform badge, current
 * reach (when this campaign actually has a posting on that platform), and a
 * disabled "Boost" button. No spend can leave this card today — clicks just
 * surface a tooltip explaining it's coming.
 *
 * The hard rule from the syndication memory still holds: every boost has to
 * pass through a human approval step before any dollars move. When this is
 * wired for real, the disabled button becomes a confirm modal with cost
 * estimate, then a Vercel server action that posts to the platform Ads API.
 */
export default function BoostPlatformPlaceholder({
  platform,
  hasPosting,
  currentReach,
  className,
}: BoostPlatformPlaceholderProps) {
  // Rough projection: a $40 boost typically lifts reach 30-50% on the
  // already-posted creative. Numbers shown are illustrative until the real
  // integration ships.
  const projectedLift = hasPosting
    ? Math.round(Math.max(currentReach * 0.4, 200))
    : 0;

  const disabledTooltip = !hasPosting
    ? `No ${platformLabel(platform)} posting in this campaign yet.`
    : `Real boosting integration is in progress. Until then, run the boost manually in ${platformLabel(platform)} Ads Manager.`;

  return (
    <div
      className={clsx(
        "rounded-lg border border-neutral-200 bg-white p-3 flex flex-col gap-2",
        !hasPosting && "opacity-60",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <PlatformBadge platform={platform} size="sm" showLabel />
        <span className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
          Stub
        </span>
      </div>

      {hasPosting ? (
        <dl className="text-[11px] text-neutral-600 space-y-0.5">
          <div className="flex items-center justify-between">
            <dt>Current reach</dt>
            <dd className="font-semibold tabular-nums text-neutral-900">
              {formatCompactNumber(currentReach)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt>Est. lift @ $40</dt>
            <dd className="font-semibold tabular-nums text-neutral-900">
              +{formatCompactNumber(projectedLift)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-[11px] text-neutral-500">
          Add a {platformLabel(platform)} posting to this campaign to enable
          a boost.
        </p>
      )}

      <button
        type="button"
        disabled
        title={disabledTooltip}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-neutral-100 text-neutral-400 cursor-not-allowed px-2.5 py-1.5 text-[11px] font-medium"
      >
        <SpendIcon />
        Boost on {platformLabel(platform)}
      </button>
    </div>
  );
}

function SpendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M12 3v18M16.5 7.5c-.5-1.5-2-2.5-4.5-2.5s-4.5 1-4.5 3 2 2.5 4.5 3 5 1 5 3.5-2 3.5-5 3.5-4.5-1-5-3"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
