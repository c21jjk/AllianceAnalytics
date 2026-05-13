"use client";

import { useState } from "react";
import clsx from "clsx";
import type {
  CompanyAnalytics,
  CompanyAnalyticsByPlatform,
  FollowerSummary,
} from "@/lib/data/posts-db";
import type { Platform } from "@/lib/types/post";
import type { MetricKind } from "@/lib/data/metric-details";
import { formatCompactNumber } from "@/lib/format";
import MetricDetailDialog from "./MetricDetailDialog";

interface CompanyAnalyticsStripProps {
  data: CompanyAnalytics;
  /** Per-platform follower counts + total + delta for the Followers tile. */
  followers: FollowerSummary;
  /** Window length in days — surfaced in the strip subtitle. */
  days: number;
  /** Active dashboard office filter — passed through to the detail dialog
   *  so drill-downs match the same audience scope the headline uses. */
  officeShortCode?: string | null;
  className?: string;
}

/**
 * Top-of-dashboard "at a glance" KPI strip.
 *
 * Five tiles, each a glance-able number with WoW delta, sparkline, and a
 * compact per-platform mini-row beneath:
 *   1. Reach            — sum of post.reach in window
 *   2. Engagement       — sum of likes + comments + shares + saves
 *   3. Engagement rate  — engagement / reach (filters viral spikes)
 *   4. Posts published  — count of distinct posts (activity gauge)
 *   5. Followers        — per-platform follower counts + delta
 *
 * (The Top Campaign tile was removed in Phase 10 — the per-platform
 * mini-row gave us better information density, and Larissa was clicking
 * through to the post detail anyway.)
 *
 * Designed for ADHD-friendly scan: big number, tiny label, no paragraphs.
 * Each tile honours the dashboard office filter + time range automatically
 * because the data is fetched server-side with those filters applied.
 */
export default function CompanyAnalyticsStrip({
  data,
  followers,
  days,
  officeShortCode = null,
  className,
}: CompanyAnalyticsStripProps) {
  const [openKind, setOpenKind] = useState<MetricKind | null>(null);

  const reachDelta = pctDelta(data.reach, data.prev_reach);
  const engagementDelta = pctDelta(data.engagement, data.prev_engagement);
  const ratePctNow = data.engagement_rate * 100;
  const ratePctPrev = data.prev_engagement_rate * 100;
  const ratePointDelta = ratePctNow - ratePctPrev;
  const postsDelta = pctDelta(data.posts_published, data.prev_posts_published);

  const reachSeries = data.daily.map((d) => d.reach);
  const engagementSeries = data.daily.map((d) => d.engagement);

  return (
    <>
      <section
        className={clsx(
          "grid grid-cols-2 lg:grid-cols-5 gap-2",
          className,
        )}
        aria-label={`Company analytics for the last ${days} days`}
      >
        <Tile
          label="Reach"
          value={formatCompactNumber(data.reach)}
          delta={reachDelta}
          deltaLabel="vs prior period"
          series={reachSeries}
          platforms={data.by_platform}
          kind="reach"
          onClick={() => setOpenKind("reach")}
        />
        <Tile
          label="Engagement"
          value={formatCompactNumber(data.engagement)}
          delta={engagementDelta}
          deltaLabel="vs prior period"
          series={engagementSeries}
          platforms={data.by_platform}
          kind="engagement"
          onClick={() => setOpenKind("engagement")}
        />
        <Tile
          label="Engagement rate"
          value={`${ratePctNow.toFixed(2)}%`}
          delta={ratePointDelta}
          deltaLabel="pp vs prior"
          deltaSuffix="pp"
          series={null}
          platforms={data.by_platform}
          kind="engagement_rate"
          onClick={() => setOpenKind("engagement_rate")}
        />
        <Tile
          label="Posts published"
          value={String(data.posts_published)}
          delta={postsDelta}
          deltaLabel="vs prior period"
          series={null}
          platforms={data.by_platform}
          kind="posts_published"
          onClick={() => setOpenKind("posts_published")}
        />
        <FollowersTile
          followers={followers}
          onClick={() => setOpenKind("followers")}
        />
      </section>
      <MetricDetailDialog
        open={openKind !== null}
        kind={openKind}
        days={days}
        officeShortCode={officeShortCode}
        onClose={() => setOpenKind(null)}
      />
    </>
  );
}

function FollowersTile({
  followers,
  onClick,
}: {
  followers: FollowerSummary;
  onClick: () => void;
}) {
  if (!followers.has_data) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left rounded-xl border border-neutral-200 bg-white shadow-card px-3 py-2.5 hover:ring-2 hover:ring-gold-400/40 hover:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-500 transition-shadow"
      >
        <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
          Followers
        </div>
        <div className="text-sm text-neutral-400 mt-1">
          Syncs once per platform — populates within the next 4h cron tick.
        </div>
      </button>
    );
  }

  const total = followers.total.current ?? 0;
  const delta = followers.total.delta;
  const arrow = delta == null ? "·" : delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
  const tone =
    delta == null
      ? "text-neutral-400"
      : delta > 0
        ? "text-emerald-600"
        : delta < 0
          ? "text-rose-600"
          : "text-neutral-500";
  const deltaText =
    delta == null ? "—" : `${arrow} ${formatCompactNumber(Math.abs(delta))}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open followers detail"
      className="text-left rounded-xl border border-neutral-200 bg-white shadow-card px-3 py-2.5 hover:ring-2 hover:ring-gold-400/40 hover:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-500 transition-shadow"
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        Followers
      </div>
      <div className="text-xl font-semibold text-neutral-900 leading-tight tabular-nums">
        {formatCompactNumber(total)}
      </div>
      <div className={clsx("text-[11px] mt-1 truncate", tone)}>
        <span className="font-medium">{deltaText}</span>{" "}
        <span className="text-neutral-400">vs prior period</span>
      </div>
      <div className="text-[10px] text-neutral-500 mt-1.5 flex items-center gap-1.5 tabular-nums">
        <FollowerCell label="FB" cell={followers.facebook} />
        <span className="text-neutral-300">·</span>
        <FollowerCell label="IG" cell={followers.instagram} />
        <span className="text-neutral-300">·</span>
        <FollowerCell label="TT" cell={followers.tiktok} />
      </div>
    </button>
  );
}

function FollowerCell({
  label,
  cell,
}: {
  label: string;
  cell: FollowerSummary["facebook"];
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="font-semibold text-neutral-700">{label}</span>{" "}
      <span className="text-neutral-600">
        {cell.current === null ? "—" : formatCompactNumber(cell.current)}
      </span>
    </span>
  );
}

type TileKind = "reach" | "engagement" | "engagement_rate" | "posts_published";

interface TileProps {
  label: string;
  value: string;
  /** Delta as a number — interpreted as percent unless deltaSuffix is "pp". */
  delta: number | null;
  deltaLabel: string;
  /** Suffix that follows the delta number. Default "%". */
  deltaSuffix?: string;
  /** When non-null, renders an inline sparkline. Pass null to omit. */
  series: number[] | null;
  /** Per-platform breakdown drives the bottom mini-row. */
  platforms: CompanyAnalyticsByPlatform;
  /** Which metric this tile shows — selects which platform field to read. */
  kind: TileKind;
  /** Click handler — opens the detail dialog for this kind. */
  onClick: () => void;
}

function Tile({
  label,
  value,
  delta,
  deltaLabel,
  deltaSuffix = "%",
  series,
  platforms,
  kind,
  onClick,
}: TileProps) {
  const arrow = delta == null ? "·" : delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
  const tone =
    delta == null
      ? "text-neutral-400"
      : delta > 0
        ? "text-emerald-600"
        : delta < 0
          ? "text-rose-600"
          : "text-neutral-500";
  const deltaText =
    delta == null
      ? "—"
      : `${arrow} ${Math.abs(delta).toFixed(deltaSuffix === "pp" ? 2 : 0)}${deltaSuffix}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${label.toLowerCase()} detail`}
      className="text-left rounded-xl border border-neutral-200 bg-white shadow-card px-3 py-2.5 hover:ring-2 hover:ring-gold-400/40 hover:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-500 transition-shadow"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            {label}
          </div>
          <div className="text-xl font-semibold text-neutral-900 leading-tight tabular-nums">
            {value}
          </div>
        </div>
        {series && series.some((v) => v > 0) ? (
          <Sparkline values={series} className="text-gold-500" />
        ) : null}
      </div>
      <div className={clsx("text-[11px] mt-1 truncate", tone)} title={deltaLabel}>
        <span className="font-medium">{deltaText}</span>{" "}
        <span className="text-neutral-400">{deltaLabel}</span>
      </div>
      <PlatformMiniRow platforms={platforms} kind={kind} />
    </button>
  );
}

/**
 * Inline per-platform breakdown shown beneath each tile (Phase 10).
 * Matches the visual treatment of the Followers tile's FB / IG / TT row.
 */
function PlatformMiniRow({
  platforms,
  kind,
}: {
  platforms: CompanyAnalyticsByPlatform;
  kind: TileKind;
}) {
  const fb = readPlatformValue(platforms.facebook, kind);
  const ig = readPlatformValue(platforms.instagram, kind);
  const tt = readPlatformValue(platforms.tiktok, kind);
  return (
    <div className="text-[10px] text-neutral-500 mt-1.5 flex items-center gap-1.5 tabular-nums">
      <PlatformCell label="FB" value={fb} kind={kind} />
      <span className="text-neutral-300">·</span>
      <PlatformCell label="IG" value={ig} kind={kind} />
      <span className="text-neutral-300">·</span>
      <PlatformCell label="TT" value={tt} kind={kind} />
    </div>
  );
}

function readPlatformValue(
  p: CompanyAnalyticsByPlatform[Platform],
  kind: TileKind,
): number {
  if (kind === "reach") return p.reach;
  if (kind === "engagement") return p.engagement;
  if (kind === "engagement_rate") return p.engagement_rate;
  return p.posts_published;
}

function PlatformCell({
  label,
  value,
  kind,
}: {
  label: string;
  value: number;
  kind: TileKind;
}) {
  let formatted: string;
  if (kind === "engagement_rate") {
    formatted = `${(value * 100).toFixed(1)}%`;
  } else if (kind === "posts_published") {
    formatted = String(value);
  } else {
    formatted = formatCompactNumber(value);
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="font-semibold text-neutral-700">{label}</span>{" "}
      <span className="text-neutral-600">{value === 0 ? "—" : formatted}</span>
    </span>
  );
}

/**
 * Compact 32x14 sparkline. Renders dots when there's only one non-zero
 * value to avoid drawing a single point as an empty path.
 */
function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const w = 56;
  const h = 18;
  const stepX = values.length > 1 ? w / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(2)},${(h - (v / max) * h).toFixed(2)}`)
    .join(" ");

  // Thin the stroke as the series gets longer, otherwise a 365-point
  // polyline overlaps itself into a solid block at this width.
  const strokeWidth = values.length > 180 ? 0.9 : values.length > 90 ? 1.1 : 1.4;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={clsx("w-14 h-[18px] shrink-0", className)}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function pctDelta(current: number, prev: number): number | null {
  if (prev === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - prev) / prev) * 100;
}
