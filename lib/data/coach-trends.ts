import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Platform } from "@/lib/types/post";
import type { TrendDirection, TrendNote } from "@/lib/types/strategy";

/**
 * Trend Watch derives "what's changed lately" from real post + follower data.
 * Pure math, no AI — surfaced on /coach as a list of observations Larissa
 * should know about but doesn't need to act on.
 *
 * Each observation is computed independently and only included when there's
 * meaningful data behind it. If a brokerage has fewer than ~5 posts in the
 * period, most trends are suppressed because the math is too noisy.
 *
 * Returned list is sorted by magnitude DESC so the strongest signals appear
 * first.
 */

interface DbPostRow {
  posted_at: string | null;
  platform: Platform;
  category: string | null;
  metrics: Record<string, unknown> | null;
}

interface DbFollowerRow {
  platform: Platform;
  captured_date: string;
  follower_count: number;
}

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function reachOf(metrics: Record<string, unknown> | null): number {
  if (!metrics) return 0;
  return readNum(metrics.reach) || readNum(metrics.impressions);
}

function engagementsOf(metrics: Record<string, unknown> | null): number {
  if (!metrics) return 0;
  return (
    readNum(metrics.likes) +
    readNum(metrics.comments) +
    readNum(metrics.shares) +
    readNum(metrics.saves)
  );
}

function pctChange(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return (current - prior) / prior;
}

function tsId(parts: string[]): string {
  return `trend_${parts.join("_")}`;
}

/**
 * Build the trend-watch observations from real database data. Returns an
 * empty array when there isn't enough data to compute meaningful trends.
 */
export async function getCoachTrends(opts: {
  /** Window for "current" period in days. Default 30. */
  windowDays?: number;
  /** Compare against the immediately-prior window of the same length. */
  comparisonWindowDays?: number;
} = {}): Promise<TrendNote[]> {
  const supabase = createAdminClient();
  const now = Date.now();
  const windowDays = opts.windowDays ?? 30;
  const compareDays = opts.comparisonWindowDays ?? windowDays;

  const currentStart = new Date(now - windowDays * 86400_000);
  const priorStart = new Date(now - (windowDays + compareDays) * 86400_000);
  const priorEnd = currentStart;

  // Pull all posts touching the combined window in a single query.
  const { data: postsRaw } = await supabase
    .from("posts")
    .select("posted_at, platform, category, metrics")
    .gte("posted_at", priorStart.toISOString());

  const posts = (postsRaw ?? []) as DbPostRow[];
  if (posts.length < 5) return [];

  const currentPosts: DbPostRow[] = [];
  const priorPosts: DbPostRow[] = [];
  for (const p of posts) {
    if (!p.posted_at) continue;
    const t = new Date(p.posted_at).getTime();
    if (t >= currentStart.getTime()) currentPosts.push(p);
    else if (t >= priorStart.getTime() && t < priorEnd.getTime()) {
      priorPosts.push(p);
    }
  }

  const generated_at = new Date().toISOString();
  const observations: TrendNote[] = [];

  // -----------------------------------------------------------------
  // 1) Per-platform reach delta vs. prior period.
  // -----------------------------------------------------------------
  const platforms: Platform[] = ["facebook", "instagram", "tiktok"];
  for (const platform of platforms) {
    const cur = currentPosts.filter((p) => p.platform === platform);
    const pri = priorPosts.filter((p) => p.platform === platform);
    if (cur.length < 2 && pri.length < 2) continue;

    const curReach = cur.reduce((s, p) => s + reachOf(p.metrics), 0);
    const priReach = pri.reduce((s, p) => s + reachOf(p.metrics), 0);
    const delta = pctChange(curReach, priReach);
    if (delta === null || Math.abs(delta) < 0.1) continue;

    const direction: TrendDirection = delta > 0 ? "up" : "down";
    const pct = Math.abs(Math.round(delta * 100));
    const headline = `${platformLabel(platform)} reach ${direction === "up" ? "up" : "down"} ${pct}% vs. prior ${compareDays} days`;
    const detail =
      `${platformLabel(platform)} delivered ${curReach.toLocaleString()} reach over the last ${windowDays} days ` +
      `across ${cur.length} ${cur.length === 1 ? "post" : "posts"}, ` +
      `compared to ${priReach.toLocaleString()} reach in the prior ${compareDays} days. ` +
      `${direction === "up" ? "Worth doubling down" : "Look for what changed"} on the platform mix.`;
    observations.push({
      id: tsId(["reach", platform]),
      direction,
      headline,
      detail,
      magnitude: 1 + Math.abs(delta),
      platforms: [platform],
      generated_at,
    });
  }

  // -----------------------------------------------------------------
  // 2) Top-performing post category this period.
  // -----------------------------------------------------------------
  const reachByCategory = new Map<string, number>();
  const countByCategory = new Map<string, number>();
  for (const p of currentPosts) {
    const cat = p.category ?? "other";
    reachByCategory.set(cat, (reachByCategory.get(cat) ?? 0) + reachOf(p.metrics));
    countByCategory.set(cat, (countByCategory.get(cat) ?? 0) + 1);
  }
  if (reachByCategory.size >= 2) {
    const sorted = Array.from(reachByCategory.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    const [topCat, topReach] = sorted[0];
    const [secondCat, secondReach] = sorted[1] ?? [null, 0];
    const ratio = secondReach > 0 ? topReach / secondReach : null;
    if (ratio !== null && ratio > 1.4) {
      const topCount = countByCategory.get(topCat) ?? 0;
      observations.push({
        id: tsId(["cat", topCat]),
        direction: "up",
        headline: `${capitalize(topCat)} posts pulling the most reach this ${windowDays}-day window`,
        detail:
          `${topCount} ${capitalize(topCat)} ${topCount === 1 ? "post" : "posts"} delivered ${topReach.toLocaleString()} reach, ` +
          `${ratio.toFixed(1)}× more than the next category (${secondCat ? capitalize(secondCat) : "other"}). ` +
          `If that pace holds, lean into it.`,
        magnitude: ratio,
        generated_at,
      });
    }
  }

  // -----------------------------------------------------------------
  // 3) Days-since-last-post per platform — flags neglect.
  // -----------------------------------------------------------------
  for (const platform of platforms) {
    const latestForPlatform = currentPosts
      .filter((p) => p.platform === platform && p.posted_at)
      .reduce<number>((max, p) => {
        const t = new Date(p.posted_at!).getTime();
        return t > max ? t : max;
      }, 0);
    if (latestForPlatform === 0) continue;
    const daysSince = Math.floor((now - latestForPlatform) / 86400_000);
    if (daysSince < 7) continue; // 1 week is the watch threshold
    observations.push({
      id: tsId(["stale", platform]),
      direction: "watch",
      headline: `${daysSince} days since the last ${platformLabel(platform)} post`,
      detail:
        `${platformLabel(platform)} hasn't seen a fresh post in ${daysSince} days. ` +
        `Cadence drives reach — even an Open-House teaser or "Just sold" beats silence.`,
      magnitude: daysSince / 7,
      platforms: [platform],
      generated_at,
    });
  }

  // -----------------------------------------------------------------
  // 4) Follower growth velocity per platform.
  // -----------------------------------------------------------------
  try {
    const compareCutoff = new Date(now - compareDays * 86400_000).toISOString();
    const { data: followerRaw } = await supabase
      .from("platform_followers")
      .select("platform, captured_date, follower_count")
      .gte("captured_date", compareCutoff)
      .order("captured_date", { ascending: false });
    const rows = (followerRaw ?? []) as DbFollowerRow[];
    const byPlatform = new Map<Platform, DbFollowerRow[]>();
    for (const r of rows) {
      const list = byPlatform.get(r.platform) ?? [];
      list.push(r);
      byPlatform.set(r.platform, list);
    }
    for (const [platform, list] of byPlatform.entries()) {
      if (list.length < 2) continue;
      const newest = list[0];
      const oldest = list[list.length - 1];
      const delta = newest.follower_count - oldest.follower_count;
      if (delta === 0) continue;
      if (Math.abs(delta) < 5) continue; // suppress noise
      const direction: TrendDirection = delta > 0 ? "up" : "down";
      const sign = delta > 0 ? "+" : "−";
      observations.push({
        id: tsId(["followers", platform]),
        direction,
        headline: `${platformLabel(platform)} audience ${direction === "up" ? "grew" : "shrank"} ${sign}${Math.abs(delta).toLocaleString()} followers`,
        detail:
          `Followers ${direction === "up" ? "added" : "lost"} ${Math.abs(delta).toLocaleString()} in the last ${compareDays} days on ${platformLabel(platform)}. ` +
          `${direction === "up" ? "What's working — find a way to keep it" : "Worth a content audit"}.`,
        magnitude: 1 + Math.abs(delta) / Math.max(1, oldest.follower_count),
        platforms: [platform],
        generated_at,
      });
    }
  } catch {
    // platform_followers may not have data yet — graceful skip
  }

  // Sort by magnitude DESC so the strongest signals appear first.
  return observations.sort(
    (a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0),
  );
}

function platformLabel(p: Platform): string {
  if (p === "facebook") return "Facebook";
  if (p === "instagram") return "Instagram";
  return "TikTok";
}

function capitalize(s: string): string {
  if (!s) return s;
  return s
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
