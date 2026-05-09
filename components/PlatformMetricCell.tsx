import clsx from "clsx";
import type { Platform } from "@/lib/types/post";
import type { PlatformPosting } from "@/lib/types/group";
import { formatCompactNumber, formatPercent } from "@/lib/format";

interface PlatformMetricCellProps {
  platform: Platform | "total";
  /**
   * Postings for this platform tile. Empty array → "pending" muted state.
   * Ignored entirely for the "total" variant — pass totals via the *_override
   * props instead.
   */
  postings?: PlatformPosting[];
  /** Used by the total tile: combined reach across platforms. */
  totalReach?: number;
  /** Used by the total tile: combined engagements across platforms. */
  totalEngagements?: number;
  /** Used by the total tile: 0-1 engagement rate decimal. */
  engagementRate?: number;
  className?: string;
}

const HEADER: Record<Platform | "total", string> = {
  facebook: "FB",
  instagram: "IG",
  tiktok: "TT",
  total: "Total",
};

const PRIMARY_LABEL: Record<Platform | "total", string> = {
  facebook: "Reach",
  instagram: "Reach",
  tiktok: "Plays",
  total: "Reach",
};

/**
 * Single tile in the per-platform metrics row of a GroupCard.
 *
 * Renders one of three states:
 *   1. Total tile (platform="total") — uses the *_override props
 *   2. Pending tile (postings.length === 0) — used for FB while ingestion is parked
 *   3. Active tile — primary metric (reach/plays) on top, engagements below
 */
export default function PlatformMetricCell({
  platform,
  postings = [],
  totalReach,
  totalEngagements,
  engagementRate,
  className,
}: PlatformMetricCellProps) {
  // Total tile
  if (platform === "total") {
    return (
      <div
        className={clsx(
          "flex flex-col gap-0.5 rounded-lg bg-gold-50 ring-1 ring-gold-100 px-3 py-2",
          className,
        )}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gold-800">
          Total
        </div>
        <div className="text-lg font-semibold tabular-nums text-neutral-900 leading-tight">
          {formatCompactNumber(totalReach ?? 0)}
        </div>
        <div className="text-[11px] text-neutral-600 tabular-nums">
          {formatCompactNumber(totalEngagements ?? 0)} engagements
          {engagementRate !== undefined && engagementRate > 0 ? (
            <span className="text-neutral-400">
              {" "}
              · {formatPercent(engagementRate, 1)}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // Empty state: no postings on this platform for this group.
  // We deliberately do NOT label this "pending / re-pair needed" — that
  // implied a feed-level breakage. Most of the time the post simply wasn't
  // shared to this platform (e.g., a still photo skips TikTok). Feed-level
  // health lives on /settings; this tile just acknowledges the absence.
  if (postings.length === 0) {
    return (
      <div
        className={clsx(
          "flex flex-col gap-0.5 rounded-lg bg-neutral-50 ring-1 ring-neutral-200 px-3 py-2",
          className,
        )}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          {HEADER[platform]}
        </div>
        <div className="text-sm font-medium text-neutral-500 leading-tight">
          Not posted
        </div>
        <div className="text-[11px] text-neutral-400">
          on {HEADER[platform]}
        </div>
      </div>
    );
  }

  // Active tile — sum across all postings on this platform (usually 1)
  const reach = postings.reduce((sum, p) => sum + p.reach, 0);
  const engagements = postings.reduce((sum, p) => sum + p.engagements, 0);

  return (
    <div
      className={clsx(
        "flex flex-col gap-0.5 rounded-lg bg-white ring-1 ring-neutral-200 px-3 py-2",
        className,
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {HEADER[platform]}
      </div>
      <div className="text-lg font-semibold tabular-nums text-neutral-900 leading-tight">
        {formatCompactNumber(reach)}
      </div>
      <div className="text-[11px] text-neutral-500 tabular-nums">
        {formatCompactNumber(engagements)} {PRIMARY_LABEL[platform] === "Plays" ? "engagements" : "engagements"}
      </div>
    </div>
  );
}
