"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  EngagementDetail,
  EngagementRateDetail,
  FollowersDetail,
  MetricDetail,
  MetricKind,
  PostsPublishedDetail,
  ReachDetail,
} from "@/lib/data/metric-details";
import { loadMetricDetailAction } from "@/app/(app)/metric-detail-action";
import {
  formatCompactNumber,
  formatNumber,
  formatShortDate,
} from "@/lib/format";

interface MetricDetailDialogProps {
  open: boolean;
  kind: MetricKind | null;
  days: number;
  officeShortCode: string | null;
  onClose: () => void;
}

const TITLES: Record<MetricKind, string> = {
  reach: "Reach",
  engagement: "Engagement",
  engagement_rate: "Engagement rate",
  posts_published: "Posts published",
  followers: "Followers",
};

const SUBTITLES: Record<MetricKind, string> = {
  reach: "How many distinct accounts saw our content",
  engagement: "Reactions, comments, shares, and saves",
  engagement_rate: "Engagement per impression — filters viral spikes",
  posts_published: "Cadence + mix of what we shipped",
  followers: "Audience size across all three platforms",
};

const PLATFORM_COLORS = {
  facebook: "#1877F2",
  instagram: "#E1306C",
  tiktok: "#111111",
} as const;

const GOLD = "#C9A84C";

/**
 * Click-to-expand metric detail modal anchored on the dashboard KPI strip.
 *
 * Each tile (Reach / Engagement / Engagement rate / Posts published /
 * Followers) opens its own body, all rendered through Recharts. The window
 * inherits the dashboard's active range — so opening a 30-day tile drills
 * into the same data the headline number was computed from.
 *
 * Behaviors:
 *   - ESC closes
 *   - Backdrop click closes
 *   - Reopening with a new kind refetches via server action
 *   - Loading skeleton during initial fetch (no flash of empty state)
 */
export default function MetricDetailDialog({
  open,
  kind,
  days,
  officeShortCode,
  onClose,
}: MetricDetailDialogProps) {
  const [detail, setDetail] = useState<MetricDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fetch on (open + kind + days) change.
  useEffect(() => {
    if (!open || !kind) return;
    setDetail(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await loadMetricDetailAction({
          kind,
          days,
          office_short_code: officeShortCode,
        });
        setDetail(result);
      } catch (e) {
        setError((e as Error).message ?? "Failed to load detail.");
      }
    });
  }, [open, kind, days, officeShortCode]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !kind) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${TITLES[kind]} detail`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/40 backdrop-blur-sm p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl ring-1 ring-neutral-200 mt-4 mb-12"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-neutral-100">
          <div className="min-w-0">
            <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
              Last {days} days
            </div>
            <h2 className="text-xl font-semibold text-neutral-900">
              {TITLES[kind]}
            </h2>
            <p className="text-sm text-neutral-500 mt-0.5">{SUBTITLES[kind]}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full w-8 h-8 inline-flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 transition"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="px-6 pt-5 pb-6">
          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              Couldn&apos;t load this metric: {error}
            </div>
          ) : null}
          {!detail && !error ? <LoadingSkeleton /> : null}
          {detail && !error ? <DetailBody detail={detail} /> : null}
          {isPending && detail ? (
            <div className="text-[11px] text-neutral-400 mt-2">Refreshing…</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-64 rounded-xl bg-neutral-100" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-40 rounded-xl bg-neutral-100" />
        <div className="h-40 rounded-xl bg-neutral-100" />
      </div>
      <div className="h-32 rounded-xl bg-neutral-100" />
    </div>
  );
}

function DetailBody({ detail }: { detail: MetricDetail }) {
  switch (detail.kind) {
    case "reach":
      return <ReachBody detail={detail} />;
    case "engagement":
      return <EngagementBody detail={detail} />;
    case "engagement_rate":
      return <EngagementRateBody detail={detail} />;
    case "posts_published":
      return <PostsPublishedBody detail={detail} />;
    case "followers":
      return <FollowersBody detail={detail} />;
  }
}

// ===========================================================================
// Reach
// ===========================================================================

function ReachBody({ detail }: { detail: ReachDetail }) {
  const total = useMemo(
    () => detail.daily.reduce((s, d) => s + d.total, 0),
    [detail.daily],
  );
  const data = useMemo(
    () =>
      detail.daily.map((d) => ({
        ...d,
        dateLabel: shortDayLabel(d.date),
      })),
    [detail.daily],
  );
  return (
    <div className="space-y-5">
      <SummaryRow
        items={[
          { label: "Total reach", value: formatNumber(total) },
          {
            label: "Best day",
            value: bestDayLabel(detail.daily.map((d) => ({ date: d.date, value: d.total }))),
          },
          {
            label: "Avg / day",
            value: formatCompactNumber(total / Math.max(1, detail.daily.length)),
          },
        ]}
      />
      <ChartCard title="Daily reach by platform">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
              tickFormatter={(v) => formatCompactNumber(v as number)}
              width={40}
            />
            <Tooltip
              content={<NumericTooltip />}
              formatter={(value) => formatNumber(value as number)}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Area
              type="monotone"
              dataKey="instagram"
              name="Instagram"
              stackId="1"
              stroke={PLATFORM_COLORS.instagram}
              fill={PLATFORM_COLORS.instagram}
              fillOpacity={0.45}
            />
            <Area
              type="monotone"
              dataKey="facebook"
              name="Facebook"
              stackId="1"
              stroke={PLATFORM_COLORS.facebook}
              fill={PLATFORM_COLORS.facebook}
              fillOpacity={0.45}
            />
            <Area
              type="monotone"
              dataKey="tiktok"
              name="TikTok"
              stackId="1"
              stroke={PLATFORM_COLORS.tiktok}
              fill={PLATFORM_COLORS.tiktok}
              fillOpacity={0.45}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
      <TopPostsTable
        title="Top posts by reach"
        posts={detail.top_posts}
        metricLabel="Reach"
        metricKey="reach"
      />
    </div>
  );
}

// ===========================================================================
// Engagement
// ===========================================================================

function EngagementBody({ detail }: { detail: EngagementDetail }) {
  const totals = detail.totals_by_type;
  const grand = totals.likes + totals.comments + totals.shares + totals.saves;
  const data = useMemo(
    () =>
      detail.daily_by_type.map((d) => ({
        ...d,
        dateLabel: shortDayLabel(d.date),
      })),
    [detail.daily_by_type],
  );
  const platformData = useMemo(
    () =>
      detail.daily_by_platform.map((d) => ({
        ...d,
        dateLabel: shortDayLabel(d.date),
      })),
    [detail.daily_by_platform],
  );

  return (
    <div className="space-y-5">
      <SummaryRow
        items={[
          { label: "Total engagement", value: formatNumber(grand) },
          { label: "Likes", value: formatNumber(totals.likes) },
          { label: "Comments", value: formatNumber(totals.comments) },
          {
            label: "Shares + saves",
            value: formatNumber(totals.shares + totals.saves),
          },
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Daily engagement by reaction type">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11, fill: "#737373" }}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#737373" }}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
                tickFormatter={(v) => formatCompactNumber(v as number)}
                width={40}
              />
              <Tooltip content={<NumericTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="likes" name="Likes" stackId="1" fill="#C9A84C" />
              <Bar dataKey="comments" name="Comments" stackId="1" fill="#7C8DA8" />
              <Bar dataKey="shares" name="Shares" stackId="1" fill="#5B7553" />
              <Bar dataKey="saves" name="Saves" stackId="1" fill="#9B5C5C" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Daily engagement by platform">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={platformData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 11, fill: "#737373" }}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#737373" }}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
                tickFormatter={(v) => formatCompactNumber(v as number)}
                width={40}
              />
              <Tooltip content={<NumericTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="facebook"
                name="Facebook"
                stackId="1"
                fill={PLATFORM_COLORS.facebook}
              />
              <Bar
                dataKey="instagram"
                name="Instagram"
                stackId="1"
                fill={PLATFORM_COLORS.instagram}
              />
              <Bar
                dataKey="tiktok"
                name="TikTok"
                stackId="1"
                fill={PLATFORM_COLORS.tiktok}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <TopPostsTable
        title="Top posts by engagement"
        posts={detail.top_posts}
        metricLabel="Engagement"
        metricKey="engagement"
      />
    </div>
  );
}

// ===========================================================================
// Engagement rate
// ===========================================================================

function EngagementRateBody({ detail }: { detail: EngagementRateDetail }) {
  const data = useMemo(
    () =>
      detail.daily.map((d) => ({
        ...d,
        dateLabel: shortDayLabel(d.date),
        // Express rates as percentages for the chart axes.
        facebookPct: d.facebook * 100,
        instagramPct: d.instagram * 100,
        tiktokPct: d.tiktok * 100,
        totalPct: d.total * 100,
      })),
    [detail.daily],
  );
  return (
    <div className="space-y-5">
      <SummaryRow
        items={[
          {
            label: "Median post rate",
            value: `${(detail.median_rate * 100).toFixed(2)}%`,
          },
          {
            label: "Top quartile",
            value: `${(detail.p75_rate * 100).toFixed(2)}%`,
          },
          {
            label: "Posts evaluated",
            value: formatNumber(
              detail.distribution.reduce((s, b) => s + b.count, 0),
            ),
          },
        ]}
      />
      <ChartCard title="Daily engagement rate by platform">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
              tickFormatter={(v) => `${(v as number).toFixed(0)}%`}
              width={40}
            />
            <Tooltip
              content={<PercentTooltip />}
              formatter={(value) => `${(value as number).toFixed(2)}%`}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="facebookPct"
              name="Facebook"
              stroke={PLATFORM_COLORS.facebook}
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="instagramPct"
              name="Instagram"
              stroke={PLATFORM_COLORS.instagram}
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="tiktokPct"
              name="TikTok"
              stroke={PLATFORM_COLORS.tiktok}
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="totalPct"
              name="All platforms"
              stroke={GOLD}
              strokeDasharray="4 4"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Per-post engagement rate distribution">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={detail.distribution}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
              allowDecimals={false}
              width={32}
            />
            <Tooltip
              content={<NumericTooltip />}
              formatter={(value) => `${value} post${value === 1 ? "" : "s"}`}
            />
            <Bar dataKey="count" fill={GOLD} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ===========================================================================
// Posts published
// ===========================================================================

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function PostsPublishedBody({ detail }: { detail: PostsPublishedDetail }) {
  const total = useMemo(
    () => detail.daily_by_platform.reduce((s, d) => s + d.total, 0),
    [detail.daily_by_platform],
  );
  const data = useMemo(
    () =>
      detail.daily_by_platform.map((d) => ({
        ...d,
        dateLabel: shortDayLabel(d.date),
      })),
    [detail.daily_by_platform],
  );
  const heatmapMax = useMemo(() => {
    let m = 0;
    for (const row of detail.heatmap) for (const v of row) if (v > m) m = v;
    return m;
  }, [detail.heatmap]);

  return (
    <div className="space-y-5">
      <SummaryRow
        items={[
          { label: "Total posts", value: formatNumber(total) },
          {
            label: "Avg / day",
            value: (total / Math.max(1, detail.daily_by_platform.length)).toFixed(1),
          },
          {
            label: "Most active day",
            value: bestDayLabel(detail.daily_by_platform.map((d) => ({
              date: d.date,
              value: d.total,
            }))),
          },
        ]}
      />
      <ChartCard title="Daily posts by platform">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
              allowDecimals={false}
              width={28}
            />
            <Tooltip content={<NumericTooltip />} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Bar
              dataKey="facebook"
              name="Facebook"
              stackId="1"
              fill={PLATFORM_COLORS.facebook}
            />
            <Bar
              dataKey="instagram"
              name="Instagram"
              stackId="1"
              fill={PLATFORM_COLORS.instagram}
            />
            <Bar
              dataKey="tiktok"
              name="TikTok"
              stackId="1"
              fill={PLATFORM_COLORS.tiktok}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Posting heatmap (day × hour, UTC)">
          <Heatmap heatmap={detail.heatmap} max={heatmapMax} />
        </ChartCard>
        <ChartCard title="By editorial category">
          {detail.by_category.length === 0 ? (
            <div className="text-sm text-neutral-500 py-8 text-center">
              No categorized posts in this window.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={detail.by_category}
                layout="vertical"
                margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e5e7eb"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#737373" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e5e7eb" }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={{ fontSize: 11, fill: "#737373" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e5e7eb" }}
                  width={92}
                />
                <Tooltip content={<NumericTooltip />} />
                <Bar dataKey="count" fill={GOLD} radius={[0, 3, 3, 0]}>
                  {detail.by_category.map((_, i) => (
                    <Cell key={i} fill={GOLD} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function Heatmap({ heatmap, max }: { heatmap: number[][]; max: number }) {
  const safeMax = max > 0 ? max : 1;
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] tabular-nums">
        <thead>
          <tr>
            <th className="w-8" />
            {Array.from({ length: 24 }).map((_, h) => (
              <th
                key={h}
                className="text-neutral-400 font-normal px-0.5 text-center"
              >
                {h % 3 === 0 ? h : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heatmap.map((row, dow) => (
            <tr key={dow}>
              <td className="text-neutral-500 pr-2 font-medium">
                {DOW_LABELS[dow]}
              </td>
              {row.map((v, h) => {
                const intensity = v / safeMax;
                return (
                  <td
                    key={h}
                    title={`${DOW_LABELS[dow]} ${h}:00 — ${v} post${v === 1 ? "" : "s"}`}
                    className="p-0.5"
                  >
                    <div
                      className="w-4 h-4 rounded-[2px]"
                      style={{
                        backgroundColor: intensity === 0
                          ? "#F5F5F5"
                          : `rgba(201, 168, 76, ${0.18 + intensity * 0.82})`,
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Followers
// ===========================================================================

function FollowersBody({ detail }: { detail: FollowersDetail }) {
  const data = useMemo(
    () =>
      detail.series.map((s) => ({
        ...s,
        dateLabel: shortDayLabel(s.date),
      })),
    [detail.series],
  );
  return (
    <div className="space-y-5">
      <SummaryRow
        items={detail.velocity.map((v) => ({
          label: PLATFORM_DISPLAY[v.platform],
          value:
            v.current === null ? "—" : formatNumber(v.current),
          delta: deltaDescriptor(v.window_delta),
        }))}
      />
      <ChartCard
        title={`Audience over the last ${detail.days} days`}
        subtitle="Per-platform follower counts (missing snapshots carry forward)"
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#737373" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
              tickFormatter={(v) => formatCompactNumber(v as number)}
              width={48}
            />
            <Tooltip
              content={<NumericTooltip />}
              formatter={(value) =>
                value === null ? "—" : formatNumber(value as number)
              }
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="facebook"
              name="Facebook"
              stroke={PLATFORM_COLORS.facebook}
              dot={false}
              strokeWidth={2}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="instagram"
              name="Instagram"
              stroke={PLATFORM_COLORS.instagram}
              dot={false}
              strokeWidth={2}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="tiktok"
              name="TikTok"
              stroke={PLATFORM_COLORS.tiktok}
              dot={false}
              strokeWidth={2}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="total"
              name="Total audience"
              stroke={GOLD}
              strokeDasharray="4 4"
              dot={false}
              strokeWidth={2}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Growth velocity">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-neutral-500 uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3 font-medium">Platform</th>
                <th className="py-2 pr-3 font-medium text-right">Current</th>
                <th className="py-2 pr-3 font-medium text-right">7-day</th>
                <th className="py-2 pr-3 font-medium text-right">
                  Window ({detail.days}d)
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {detail.velocity.map((v) => (
                <tr key={v.platform} className="border-t border-neutral-100">
                  <td className="py-2 pr-3 font-medium text-neutral-700">
                    {PLATFORM_DISPLAY[v.platform]}
                  </td>
                  <td className="py-2 pr-3 text-right text-neutral-900">
                    {v.current === null ? "—" : formatNumber(v.current)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <DeltaText delta={v.wow_delta} />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <DeltaText delta={v.window_delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

const PLATFORM_DISPLAY: Record<"facebook" | "instagram" | "tiktok", string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

// ===========================================================================
// Shared sub-components
// ===========================================================================

interface SummaryItem {
  label: string;
  value: string;
  delta?: { tone: "up" | "down" | "flat" | "none"; text: string } | null;
}

function SummaryRow({ items }: { items: SummaryItem[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-xl bg-neutral-50 ring-1 ring-neutral-200 px-3 py-2.5"
        >
          <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            {it.label}
          </div>
          <div className="text-lg font-semibold text-neutral-900 tabular-nums leading-tight mt-0.5">
            {it.value}
          </div>
          {it.delta ? (
            <div
              className={clsx(
                "text-[11px] mt-0.5 tabular-nums",
                it.delta.tone === "up"
                  ? "text-emerald-600"
                  : it.delta.tone === "down"
                    ? "text-rose-600"
                    : "text-neutral-500",
              )}
            >
              {it.delta.text}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl ring-1 ring-neutral-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {subtitle ? (
          <span className="text-[11px] text-neutral-500 truncate">{subtitle}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

interface TooltipPayloadEntry {
  name?: string | number;
  value?: number;
  color?: string;
}

function NumericTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md bg-white shadow-md ring-1 ring-neutral-200 px-2.5 py-1.5 text-[11px]">
      <div className="font-medium text-neutral-700 mb-0.5">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 tabular-nums">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: p.color }}
            aria-hidden="true"
          />
          <span className="text-neutral-600">{p.name}:</span>
          <span className="font-semibold text-neutral-900">
            {p.value === null || p.value === undefined ? "—" : formatNumber(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PercentTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md bg-white shadow-md ring-1 ring-neutral-200 px-2.5 py-1.5 text-[11px]">
      <div className="font-medium text-neutral-700 mb-0.5">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 tabular-nums">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: p.color }}
            aria-hidden="true"
          />
          <span className="text-neutral-600">{p.name}:</span>
          <span className="font-semibold text-neutral-900">
            {typeof p.value === "number" ? `${p.value.toFixed(2)}%` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function TopPostsTable({
  title,
  posts,
  metricLabel,
  metricKey,
}: {
  title: string;
  posts: Array<{
    id: string;
    platform: "facebook" | "instagram" | "tiktok";
    posted_at: string;
    permalink: string | null;
    thumbnail_url: string | null;
    caption: string;
    reach: number;
    engagement: number;
  }>;
  metricLabel: string;
  metricKey: "reach" | "engagement";
}) {
  if (posts.length === 0) {
    return (
      <ChartCard title={title}>
        <div className="text-sm text-neutral-500 py-6 text-center">
          No qualifying posts in this window yet.
        </div>
      </ChartCard>
    );
  }
  return (
    <ChartCard title={title}>
      <ul className="divide-y divide-neutral-100">
        {posts.map((p) => (
          <li key={p.id} className="flex items-start gap-3 py-2.5">
            <div className="shrink-0 w-12 h-12 rounded-md overflow-hidden bg-neutral-100 ring-1 ring-neutral-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.thumbnail_url ? (
                <img
                  src={p.thumbnail_url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : null}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px] text-neutral-500 mb-0.5">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: PLATFORM_COLORS[p.platform] }}
                  aria-hidden="true"
                />
                <span>{PLATFORM_DISPLAY[p.platform]}</span>
                <span className="text-neutral-300">·</span>
                <span>{formatShortDate(p.posted_at)}</span>
              </div>
              <p className="text-xs text-neutral-700 line-clamp-2">
                {p.caption || (
                  <span className="text-neutral-400 italic">No caption</span>
                )}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold text-neutral-900 tabular-nums">
                {formatNumber(p[metricKey])}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                {metricLabel}
              </div>
              {p.permalink ? (
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-gold-600 underline hover:text-gold-700"
                >
                  Open
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

function DeltaText({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-neutral-400">—</span>;
  if (delta === 0) return <span className="text-neutral-500">·</span>;
  const tone = delta > 0 ? "text-emerald-600" : "text-rose-600";
  const arrow = delta > 0 ? "▲" : "▼";
  return (
    <span className={clsx("font-medium tabular-nums", tone)}>
      {arrow} {formatNumber(Math.abs(delta))}
    </span>
  );
}

function deltaDescriptor(
  delta: number | null,
): { tone: "up" | "down" | "flat" | "none"; text: string } | null {
  if (delta === null) return { tone: "none", text: "no prior data" };
  if (delta === 0) return { tone: "flat", text: "no change" };
  const arrow = delta > 0 ? "▲" : "▼";
  return {
    tone: delta > 0 ? "up" : "down",
    text: `${arrow} ${formatNumber(Math.abs(delta))} in window`,
  };
}

function shortDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function bestDayLabel(rows: Array<{ date: string; value: number }>): string {
  if (rows.length === 0) return "—";
  let best = rows[0];
  for (const r of rows) if (r.value > best.value) best = r;
  if (best.value === 0) return "—";
  return `${shortDayLabel(best.date)} · ${formatCompactNumber(best.value)}`;
}

// Suppress lint warning on unused import — `useCallback` is reserved for
// follow-on iterations (back/forward kind switching). Touching the var here
// keeps eslint happy without dragging in a /* eslint-disable */ comment.
void useCallback;
