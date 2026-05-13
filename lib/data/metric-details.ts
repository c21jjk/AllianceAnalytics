import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAudienceScopeFilter } from "./audience-scope-filter";
import type { Platform } from "@/lib/types/post";

/**
 * Fetchers that back the click-to-expand metric detail dialogs on the
 * dashboard KPI strip. One entry point per tile kind — keeps each shape
 * exactly as wide as the chart it feeds, so we don't pay for fields the
 * detail body doesn't render.
 *
 * Same audience-aware office filter as fetchCompanyAnalytics, so a tile
 * opened while the "Wildwood Crest" chip is active drills into the same
 * row set the headline number was computed from.
 *
 * Followers detail is account-scoped (no office filter) — platform_followers
 * is per-platform-account, not per-office. The dialog renders the company-
 * wide audience trend in that case, regardless of the office chip state.
 */

export type MetricKind =
  | "reach"
  | "engagement"
  | "engagement_rate"
  | "posts_published"
  | "followers";

// ---------------------------------------------------------------------------
// Discriminated-union shapes returned by getMetricDetail
// ---------------------------------------------------------------------------

export interface TopPost {
  id: string;
  platform: Platform;
  posted_at: string;
  permalink: string | null;
  thumbnail_url: string | null;
  caption: string;
  reach: number;
  engagement: number;
}

export interface DailyPlatformSplit {
  date: string;
  facebook: number;
  instagram: number;
  tiktok: number;
  total: number;
}

export interface ReachDetail {
  kind: "reach";
  days: number;
  daily: DailyPlatformSplit[];
  top_posts: TopPost[];
}

export interface EngagementDailySplit {
  date: string;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  total: number;
}

export interface EngagementDetail {
  kind: "engagement";
  days: number;
  daily_by_type: EngagementDailySplit[];
  daily_by_platform: DailyPlatformSplit[];
  totals_by_type: { likes: number; comments: number; shares: number; saves: number };
  top_posts: TopPost[];
}

export interface EngagementRateDailyPoint {
  date: string;
  facebook: number;
  instagram: number;
  tiktok: number;
  total: number;
}

export interface EngagementRateDetail {
  kind: "engagement_rate";
  days: number;
  daily: EngagementRateDailyPoint[];
  /** Per-post engagement rate distribution — bucketed for the histogram. */
  distribution: Array<{ bucket: string; count: number; lower: number; upper: number }>;
  /** Median + p75 engagement rate for the "is this normal?" callout. */
  median_rate: number;
  p75_rate: number;
}

export interface PostsPublishedDetail {
  kind: "posts_published";
  days: number;
  daily_by_platform: DailyPlatformSplit[];
  /** Day-of-week × hour-of-day heatmap (0-6 × 0-23). */
  heatmap: number[][];
  by_category: Array<{ category: string; count: number }>;
}

export interface FollowerSeriesPoint {
  /** YYYY-MM-DD. */
  date: string;
  facebook: number | null;
  instagram: number | null;
  tiktok: number | null;
  total: number | null;
}

export interface FollowersDetail {
  kind: "followers";
  days: number;
  series: FollowerSeriesPoint[];
  /** Latest counts + WoW + 30d delta per platform. */
  velocity: Array<{
    platform: Platform;
    current: number | null;
    wow_delta: number | null;
    window_delta: number | null;
  }>;
}

export type MetricDetail =
  | ReachDetail
  | EngagementDetail
  | EngagementRateDetail
  | PostsPublishedDetail
  | FollowersDetail;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface MetricDetailOptions {
  kind: MetricKind;
  days: number;
  office_short_code?: string | null;
}

export async function getMetricDetail(
  opts: MetricDetailOptions,
): Promise<MetricDetail> {
  switch (opts.kind) {
    case "reach":
      return fetchReachDetail(opts);
    case "engagement":
      return fetchEngagementDetail(opts);
    case "engagement_rate":
      return fetchEngagementRateDetail(opts);
    case "posts_published":
      return fetchPostsPublishedDetail(opts);
    case "followers":
      return fetchFollowersDetail(opts);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface PostRow {
  id: string;
  posted_at: string | null;
  platform: string;
  caption: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  permalink: string | null;
  category: string | null;
  group_id: string | null;
  metrics: Record<string, unknown> | null;
}

interface ParsedMetrics {
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagement: number;
}

function readNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parseMetrics(m: unknown): ParsedMetrics {
  const obj = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
  const reach = readNum(obj.reach);
  const likes = readNum(obj.likes);
  const comments = readNum(obj.comments);
  const shares = readNum(obj.shares);
  const saves = readNum(obj.saves);
  return { reach, likes, comments, shares, saves, engagement: likes + comments + shares + saves };
}

function asPlatform(value: string): Platform | null {
  if (value === "facebook" || value === "instagram" || value === "tiktok") return value;
  return null;
}

/**
 * Build the YYYY-MM-DD key list for the window, in chronological order.
 * Used so charts always render the full window even on zero-activity days.
 */
function buildDayKeys(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 86400_000);
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoff.getTime() + i * 86400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Fetch the post rows for the window with audience-aware office filtering.
 * Shared by the four post-driven detail kinds (everything except followers).
 */
async function fetchWindowPosts(
  days: number,
  office_short_code: string | null | undefined,
): Promise<PostRow[]> {
  const supabase = createAdminClient();
  const cutoffIso = new Date(Date.now() - days * 86400_000).toISOString();

  const audienceFilter = await buildAudienceScopeFilter(
    supabase,
    office_short_code ?? null,
  );
  if (audienceFilter.unknownOffice) return [];

  let allowedGroupIds: string[] | null = null;
  if (audienceFilter.allowedScopes) {
    const { data: groupRows } = await supabase
      .from("post_groups")
      .select("id")
      .in("audience_scope", audienceFilter.allowedScopes);
    allowedGroupIds = (groupRows ?? []).map((g) => g.id);
    if (allowedGroupIds.length === 0) return [];
  }

  let query = supabase
    .from("posts")
    .select(
      "id, posted_at, platform, caption, thumbnail_url, media_url, permalink, category, group_id, metrics",
    )
    .gte("posted_at", cutoffIso);
  if (allowedGroupIds) query = query.in("group_id", allowedGroupIds);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as PostRow[];
}

function topPosts(rows: PostRow[], by: "reach" | "engagement", n = 5): TopPost[] {
  return rows
    .map((r) => {
      const m = parseMetrics(r.metrics);
      const plat = asPlatform(r.platform) ?? "instagram";
      return {
        id: r.id,
        platform: plat,
        posted_at: r.posted_at ?? new Date(0).toISOString(),
        permalink: r.permalink,
        thumbnail_url: r.thumbnail_url ?? r.media_url ?? null,
        caption: (r.caption ?? "").slice(0, 140),
        reach: m.reach,
        engagement: m.engagement,
      };
    })
    .filter((p) => (by === "reach" ? p.reach > 0 : p.engagement > 0))
    .sort((a, b) => (b[by] ?? 0) - (a[by] ?? 0))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------

async function fetchReachDetail(opts: MetricDetailOptions): Promise<ReachDetail> {
  const rows = await fetchWindowPosts(opts.days, opts.office_short_code);
  const keys = buildDayKeys(opts.days);
  const byDay = new Map<string, { facebook: number; instagram: number; tiktok: number }>();
  for (const k of keys) byDay.set(k, { facebook: 0, instagram: 0, tiktok: 0 });
  for (const r of rows) {
    if (!r.posted_at) continue;
    const day = r.posted_at.slice(0, 10);
    const entry = byDay.get(day);
    if (!entry) continue;
    const plat = asPlatform(r.platform);
    if (!plat) continue;
    entry[plat] += parseMetrics(r.metrics).reach;
  }
  const daily: DailyPlatformSplit[] = keys.map((date) => {
    const e = byDay.get(date)!;
    return {
      date,
      facebook: e.facebook,
      instagram: e.instagram,
      tiktok: e.tiktok,
      total: e.facebook + e.instagram + e.tiktok,
    };
  });
  return {
    kind: "reach",
    days: opts.days,
    daily,
    top_posts: topPosts(rows, "reach"),
  };
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

async function fetchEngagementDetail(
  opts: MetricDetailOptions,
): Promise<EngagementDetail> {
  const rows = await fetchWindowPosts(opts.days, opts.office_short_code);
  const keys = buildDayKeys(opts.days);
  const byTypeByDay = new Map<string, { likes: number; comments: number; shares: number; saves: number }>();
  const byPlatByDay = new Map<string, { facebook: number; instagram: number; tiktok: number }>();
  for (const k of keys) {
    byTypeByDay.set(k, { likes: 0, comments: 0, shares: 0, saves: 0 });
    byPlatByDay.set(k, { facebook: 0, instagram: 0, tiktok: 0 });
  }
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaves = 0;
  for (const r of rows) {
    if (!r.posted_at) continue;
    const day = r.posted_at.slice(0, 10);
    const t = byTypeByDay.get(day);
    const p = byPlatByDay.get(day);
    if (!t || !p) continue;
    const m = parseMetrics(r.metrics);
    t.likes += m.likes;
    t.comments += m.comments;
    t.shares += m.shares;
    t.saves += m.saves;
    totalLikes += m.likes;
    totalComments += m.comments;
    totalShares += m.shares;
    totalSaves += m.saves;
    const plat = asPlatform(r.platform);
    if (plat) p[plat] += m.engagement;
  }
  const daily_by_type: EngagementDailySplit[] = keys.map((date) => {
    const e = byTypeByDay.get(date)!;
    return {
      date,
      likes: e.likes,
      comments: e.comments,
      shares: e.shares,
      saves: e.saves,
      total: e.likes + e.comments + e.shares + e.saves,
    };
  });
  const daily_by_platform: DailyPlatformSplit[] = keys.map((date) => {
    const e = byPlatByDay.get(date)!;
    return {
      date,
      facebook: e.facebook,
      instagram: e.instagram,
      tiktok: e.tiktok,
      total: e.facebook + e.instagram + e.tiktok,
    };
  });
  return {
    kind: "engagement",
    days: opts.days,
    daily_by_type,
    daily_by_platform,
    totals_by_type: {
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
      saves: totalSaves,
    },
    top_posts: topPosts(rows, "engagement"),
  };
}

// ---------------------------------------------------------------------------
// Engagement rate
// ---------------------------------------------------------------------------

async function fetchEngagementRateDetail(
  opts: MetricDetailOptions,
): Promise<EngagementRateDetail> {
  const rows = await fetchWindowPosts(opts.days, opts.office_short_code);
  const keys = buildDayKeys(opts.days);
  const reachByDay = new Map<string, { facebook: number; instagram: number; tiktok: number; total: number }>();
  const engByDay = new Map<string, { facebook: number; instagram: number; tiktok: number; total: number }>();
  for (const k of keys) {
    reachByDay.set(k, { facebook: 0, instagram: 0, tiktok: 0, total: 0 });
    engByDay.set(k, { facebook: 0, instagram: 0, tiktok: 0, total: 0 });
  }
  const perPostRates: number[] = [];
  for (const r of rows) {
    if (!r.posted_at) continue;
    const day = r.posted_at.slice(0, 10);
    const rs = reachByDay.get(day);
    const es = engByDay.get(day);
    if (!rs || !es) continue;
    const m = parseMetrics(r.metrics);
    rs.total += m.reach;
    es.total += m.engagement;
    const plat = asPlatform(r.platform);
    if (plat) {
      rs[plat] += m.reach;
      es[plat] += m.engagement;
    }
    if (m.reach > 0) perPostRates.push(m.engagement / m.reach);
  }
  const daily: EngagementRateDailyPoint[] = keys.map((date) => {
    const rs = reachByDay.get(date)!;
    const es = engByDay.get(date)!;
    function rate(num: number, denom: number) {
      return denom > 0 ? num / denom : 0;
    }
    return {
      date,
      facebook: rate(es.facebook, rs.facebook),
      instagram: rate(es.instagram, rs.instagram),
      tiktok: rate(es.tiktok, rs.tiktok),
      total: rate(es.total, rs.total),
    };
  });
  // Distribution histogram — fixed buckets at 0/1/2/3/5/8/12/20+%.
  const bucketEdges = [0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.2];
  const bucketLabels = ["0–1%", "1–2%", "2–3%", "3–5%", "5–8%", "8–12%", "12–20%", "20%+"];
  const counts = new Array(bucketLabels.length).fill(0);
  for (const r of perPostRates) {
    let idx = bucketEdges.findIndex((e, i) => i < bucketEdges.length - 1 && r < bucketEdges[i + 1]);
    if (idx === -1) idx = bucketLabels.length - 1;
    counts[idx] += 1;
  }
  const distribution = bucketLabels.map((label, i) => ({
    bucket: label,
    count: counts[i],
    lower: bucketEdges[i],
    upper: i < bucketEdges.length - 1 ? bucketEdges[i + 1] : 1,
  }));
  // Median + p75.
  const sorted = [...perPostRates].sort((a, b) => a - b);
  function quantile(q: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx];
  }
  return {
    kind: "engagement_rate",
    days: opts.days,
    daily,
    distribution,
    median_rate: quantile(0.5),
    p75_rate: quantile(0.75),
  };
}

// ---------------------------------------------------------------------------
// Posts published
// ---------------------------------------------------------------------------

async function fetchPostsPublishedDetail(
  opts: MetricDetailOptions,
): Promise<PostsPublishedDetail> {
  const rows = await fetchWindowPosts(opts.days, opts.office_short_code);
  const keys = buildDayKeys(opts.days);
  const byDay = new Map<string, { facebook: number; instagram: number; tiktok: number }>();
  for (const k of keys) byDay.set(k, { facebook: 0, instagram: 0, tiktok: 0 });
  // Heatmap: 7 rows (Sun..Sat) × 24 cols (hours).
  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const categoryCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.posted_at) continue;
    const day = r.posted_at.slice(0, 10);
    const entry = byDay.get(day);
    if (entry) {
      const plat = asPlatform(r.platform);
      if (plat) entry[plat] += 1;
    }
    const dt = new Date(r.posted_at);
    if (!Number.isNaN(dt.getTime())) {
      const dow = dt.getUTCDay(); // 0-6 (Sun..Sat)
      const hour = dt.getUTCHours();
      heatmap[dow][hour] += 1;
    }
    const cat = (r.category ?? "uncategorized") || "uncategorized";
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }
  const daily_by_platform: DailyPlatformSplit[] = keys.map((date) => {
    const e = byDay.get(date)!;
    return {
      date,
      facebook: e.facebook,
      instagram: e.instagram,
      tiktok: e.tiktok,
      total: e.facebook + e.instagram + e.tiktok,
    };
  });
  const by_category = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
  return {
    kind: "posts_published",
    days: opts.days,
    daily_by_platform,
    heatmap,
    by_category,
  };
}

// ---------------------------------------------------------------------------
// Followers
// ---------------------------------------------------------------------------

async function fetchFollowersDetail(
  opts: MetricDetailOptions,
): Promise<FollowersDetail> {
  const supabase = createAdminClient();
  // Pull enough history to cover both the window (up to 90d) and the WoW
  // delta — go back 1.5× the window so a 7d view still has prior numbers.
  const lookbackDays = Math.max(opts.days + 14, 45);
  const cutoffDate = new Date(Date.now() - lookbackDays * 86400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabase
    .from("platform_followers")
    .select("platform, captured_date, follower_count")
    .gte("captured_date", cutoffDate)
    .order("captured_date", { ascending: true });
  if (error || !data) {
    return {
      kind: "followers",
      days: opts.days,
      series: [],
      velocity: [
        { platform: "facebook", current: null, wow_delta: null, window_delta: null },
        { platform: "instagram", current: null, wow_delta: null, window_delta: null },
        { platform: "tiktok", current: null, wow_delta: null, window_delta: null },
      ],
    };
  }
  type Row = { platform: Platform; captured_date: string; follower_count: number };
  // Build a per-platform map of date → count.
  const byPlatform = new Map<Platform, Map<string, number>>();
  byPlatform.set("facebook", new Map());
  byPlatform.set("instagram", new Map());
  byPlatform.set("tiktok", new Map());
  for (const r of data as Row[]) {
    const m = byPlatform.get(r.platform);
    if (!m) continue;
    m.set(r.captured_date, Number(r.follower_count) || 0);
  }
  // Generate one row per day inside the window. If a platform has no snapshot
  // for the day, carry the most recent prior value forward (Postgres equivalent
  // of LAG with FILL).
  const keys = buildDayKeys(opts.days);
  const lastSeen: Record<Platform, number | null> = {
    facebook: null,
    instagram: null,
    tiktok: null,
  };
  // Prime lastSeen with the latest snapshot ≤ first day in window.
  const firstKey = keys[0];
  for (const p of ["facebook", "instagram", "tiktok"] as Platform[]) {
    const m = byPlatform.get(p)!;
    let best: number | null = null;
    for (const [date, count] of m.entries()) {
      if (date <= firstKey) best = count;
    }
    lastSeen[p] = best;
  }
  const series: FollowerSeriesPoint[] = keys.map((date) => {
    for (const p of ["facebook", "instagram", "tiktok"] as Platform[]) {
      const m = byPlatform.get(p)!;
      if (m.has(date)) lastSeen[p] = m.get(date)!;
    }
    const parts: number[] = [];
    if (lastSeen.facebook !== null) parts.push(lastSeen.facebook);
    if (lastSeen.instagram !== null) parts.push(lastSeen.instagram);
    if (lastSeen.tiktok !== null) parts.push(lastSeen.tiktok);
    const total = parts.length > 0 ? parts.reduce((s, n) => s + n, 0) : null;
    return {
      date,
      facebook: lastSeen.facebook,
      instagram: lastSeen.instagram,
      tiktok: lastSeen.tiktok,
      total,
    };
  });
  // Velocity table — current vs 7d ago + current vs first day in window.
  function valueOnOrBefore(p: Platform, isoDate: string): number | null {
    const m = byPlatform.get(p)!;
    let best: number | null = null;
    for (const [date, count] of m.entries()) {
      if (date <= isoDate) best = count;
    }
    return best;
  }
  const todayKey = new Date().toISOString().slice(0, 10);
  const wowKey = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const velocity = (["facebook", "instagram", "tiktok"] as Platform[]).map(
    (platform) => {
      const current = valueOnOrBefore(platform, todayKey);
      const prior7 = valueOnOrBefore(platform, wowKey);
      const priorWindow = valueOnOrBefore(platform, firstKey);
      return {
        platform,
        current,
        wow_delta: current !== null && prior7 !== null ? current - prior7 : null,
        window_delta:
          current !== null && priorWindow !== null ? current - priorWindow : null,
      };
    },
  );
  return {
    kind: "followers",
    days: opts.days,
    series,
    velocity,
  };
}
