import "server-only";

/**
 * Shared per-post metric formulas — single source of truth for "reach" and
 * "engagements" across the dashboard, the Owner Story, and the weekly social
 * media email.
 *
 * History: we drifted twice in a row (weekly email on 2026-05-19, Owner
 * Story on 2026-05-20) because each surface re-implemented these calculations
 * inline. This file exists so future surfaces can `import { reachOf,
 * engagementsOf }` instead of copying the formula.
 *
 * If you change anything here, every report that displays per-post or
 * aggregate-post numbers will update at the same time. Don't fork.
 */

export type MetricsBag = Record<string, unknown> | null | undefined;

export interface PostMetricsRow {
  metrics: MetricsBag;
  media_type: string | null;
  platform: string;
}

export function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Per-post reach using the video-aware formula the dashboard's post detail
 * established and the rest of the analytics surfaces mirror.
 *
 * For TikTok or any video / reel post: prefer `plays` (always >= reach since
 * replays push it higher), then fall back to `reach`, then `impressions`.
 * For static / photo / carousel posts: prefer `reach`, then `impressions`,
 * then `plays`.
 *
 * Why "plays" for video: for FB Reels the `plays` field from fb-sync stores
 * the Reel-canonical play count (initial plays + replays) from
 * /{video_id}?fields=views — that's the headline number Meta Business Suite
 * displays, and the dashboard exposes the same so sellers and managers see
 * the same number we see.
 */
export function reachOf(row: PostMetricsRow): number {
  const m = row.metrics ?? {};
  const isVideo = row.media_type === "video" || row.media_type === "reel";
  if (row.platform === "tiktok" || isVideo) {
    return readNum(m.plays) || readNum(m.reach) || readNum(m.impressions);
  }
  return readNum(m.reach) || readNum(m.impressions) || readNum(m.plays);
}

/**
 * Per-post engagements mirroring Meta Business Suite's "Engagement" tally:
 * reactions + comments + shares + saves + link clicks.
 *
 * The link_clicks field is the bulk of FB Reel engagement (verified against
 * the 110 W Garfield Reel 2026-05-17 — Meta UI showed 267 engagement
 * (28 + 3 + 17 + 219); our pre-fix tally was 48 because we weren't summing
 * link_clicks). On IG / TT this field is typically 0 or undefined so it has
 * no effect.
 */
export function engagementsOf(row: { metrics: MetricsBag }): number {
  const m = row.metrics ?? {};
  return (
    readNum(m.likes) +
    readNum(m.comments) +
    readNum(m.shares) +
    readNum(m.saves) +
    readNum(m.link_clicks)
  );
}
