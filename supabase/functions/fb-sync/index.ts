/**
 * Facebook Page ingestion Edge Function.
 *
 * Pulls posts + insights from a Facebook Page. Same Graph API base as IG;
 * different endpoints + insights metric names.
 *
 * Endpoints:
 *   GET /{page-id}/posts?fields=... — feed of page-authored posts
 *   GET /{post-id}/insights?metric=... — per-post insights
 *
 * Auth note: page_access_token must be a Page-scoped token (not a User
 * token). Insights require pages_read_engagement permission, which Alliance
 * already validated 2026-05-08.
 */
// @ts-expect-error - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  loadCredentials,
  upsertPost,
  recordSyncRun,
  recordPlatformFollowers,
  runPostGrouper,
} from "../_shared/db.ts";
import {
  buildAudience,
  computeEngagementRate,
  extractHashtags,
} from "../_shared/parse.ts";
import { cacheThumbnailToStorage } from "../_shared/thumbnail-cache.ts";
import type {
  NormalizedMetrics,
  NormalizedPost,
  SyncResult,
} from "../_shared/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// why: v25 returns fresher reach numbers than v21/v22 (~2% higher on a typical
// Reel because Meta backfills delayed impressions into the newer endpoint).
// Confirmed 2026-05-17 against the 110 W Garfield Reel: v22 returned 2,637;
// v25 returned 2,681. Same `post_impressions_unique` field, fresher data.
const GRAPH_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const BACKFILL_DAYS = Number(Deno.env.get("FB_BACKFILL_DAYS") ?? "365");
const PAGE_SIZE = 50;

const POST_FIELDS = [
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  "attachments{media_type,media,subattachments,target}",
  "is_published",
].join(",");

// Meta deprecated `post_impressions` and `post_clicks` (without _by_type) in
// Graph API v21 (Sep 2024). `post_impressions_unique` IS still supported and
// returns the SAME value as organic_unique + paid_unique when there's no paid
// promotion — which is always our case. Using the direct field saves one
// per-post Graph API call.
//
// Reach (max available from Graph API) = post_impressions_unique
// Clicks   = sum(values of post_clicks_by_type)
// Reactions stays on post_reactions_by_type_total.
//
// We kept paid_unique in the request for one reason: when Alliance starts
// running paid promotion someday, we want a non-zero value to surface in the
// raw_payload for audit/debugging without code change.
const INSIGHTS_METRICS_BASE = [
  "post_impressions_unique",
  "post_impressions_paid_unique",
  "post_reactions_by_type_total",
  "post_clicks_by_type",
].join(",");

// Video-only metrics. Calling these on a non-video post returns
// "metric does not apply", so we fetch them in a separate request that
// only fires when the post's media_type === "video".
const INSIGHTS_METRICS_VIDEO = [
  "post_video_views",
  "post_video_avg_time_watched",
  "post_video_complete_views_organic",
].join(",");

interface FbFeedResponse {
  data: FbPost[];
  paging?: { next?: string; cursors?: { after?: string } };
}

interface FbPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  is_published?: boolean;
  attachments?: {
    data: {
      media_type?: "photo" | "video" | "album" | "share";
      media?: { image?: { src?: string }; source?: string };
      /**
       * For video / Reel posts, `target.id` is the underlying video object id.
       * We use it to query the Reel-canonical `views` field via
       * /{video_id}?fields=views, which returns the same number Meta Business
       * Suite shows (initial plays + replays). Probed against the 110 W
       * Garfield Reel on 2026-05-17 — `views` = 4,447 vs Suite's 4,375 (~30
       * min freshness lag is the entire gap).
       */
      target?: { id?: string; url?: string };
    }[];
  };
}

interface FbInsightsResponse {
  data: { name: string; values: { value: number | Record<string, number> }[] }[];
}

async function fbFetch<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${GRAPH_BASE}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FB ${path} ${res.status}: ${body}`);
  }
  return await res.json() as T;
}

function parseMediaType(p: FbPost): NormalizedPost["media_type"] {
  const att = p.attachments?.data?.[0];
  if (!att?.media_type) return null;
  if (att.media_type === "video") return "video";
  if (att.media_type === "album") return "carousel";
  if (att.media_type === "photo") return "image";
  return null;
}

function flattenInsights(insights: FbInsightsResponse): NormalizedMetrics {
  const map = new Map<string, number | Record<string, number>>();
  for (const m of insights.data) {
    map.set(m.name, m.values?.[0]?.value ?? 0);
  }

  // Reactions: object keyed by reaction type → count. Sum to single likes-ish.
  const reactionsByType = (map.get("post_reactions_by_type_total") ?? {}) as Record<string, number>;
  const totalReactions = Object.values(reactionsByType).reduce((s, n) => s + (Number(n) || 0), 0);

  // Reach: use post_impressions_unique directly. v25 returns the highest
  // available value (organic + paid combined, deduped per user). When we
  // start running paid promotion this still captures the full reach in
  // one field — no client-side summing needed.
  const reach = Number(map.get("post_impressions_unique") ?? 0) || 0;

  // Clicks: object keyed by click type → count. Sum across types.
  const clicksByType = (map.get("post_clicks_by_type") ?? {}) as Record<string, number>;
  const totalClicks = Object.values(clicksByType).reduce((s, n) => s + (Number(n) || 0), 0);

  const metrics: NormalizedMetrics = {
    reach: reach || undefined,
    impressions: reach || undefined, // FB no longer exposes raw impressions; use reach as proxy
    likes: totalReactions || undefined,
    link_clicks: totalClicks || undefined,
    plays: Number(map.get("post_video_views") ?? 0) || undefined,
  };
  const completionViews = Number(map.get("post_video_complete_views_organic") ?? 0);
  if (metrics.plays && completionViews) {
    metrics.completion_rate = Math.round((completionViews / metrics.plays) * 10000) / 10000;
  }
  const avgWatch = Number(map.get("post_video_avg_time_watched") ?? 0);
  if (avgWatch) metrics.avg_watch_time_sec = avgWatch / 1000; // FB returns ms

  const er = computeEngagementRate(metrics);
  if (er !== undefined) metrics.engagement_rate = er;
  return metrics;
}

export async function syncFacebook(): Promise<SyncResult> {
  const start = Date.now();
  const client = createServiceClient();
  const result: SyncResult = {
    platform: "facebook",
    ok: false,
    inserted: 0,
    updated: 0,
    metrics_rows_written: 0,
    errors: [],
    duration_ms: 0,
    backfilled: false,
  };

  try {
    const cred = await loadCredentials(client, "facebook", [
      "page_id",
      "page_access_token",
    ]);
    const pageId = String(cred.credentials.page_id);
    const token = String(cred.credentials.page_access_token);

    // Capture the page's follower count (FB calls it fan_count) once per
    // sync run. Best-effort — failure here doesn't block the post sync.
    try {
      const profile = await fbFetch<{ fan_count?: number; followers_count?: number }>(
        `/${pageId}?fields=fan_count,followers_count`,
        token,
      );
      const count = profile.followers_count ?? profile.fan_count ?? 0;
      await recordPlatformFollowers(client, "facebook", count, profile);
    } catch (e) {
      console.error("fb-sync: follower count fetch failed:", e);
    }

    const since = Math.floor(Date.now() / 1000) - BACKFILL_DAYS * 86400;

    let after: string | undefined;
    const allPosts: FbPost[] = [];
    do {
      const path = `/${pageId}/posts?fields=${POST_FIELDS}&limit=${PAGE_SIZE}${
        after ? `&after=${encodeURIComponent(after)}` : ""
      }&since=${since}`;
      const page = await fbFetch<FbFeedResponse>(path, token);
      allPosts.push(...page.data);
      after = page.paging?.cursors?.after;
      if (!page.paging?.next) break;
      if (allPosts.length > 5000) break;
    } while (after);

    for (const fb of allPosts) {
      try {
        if (fb.is_published === false) continue;

        let metrics: NormalizedMetrics = {};
        try {
          // Always pull base metrics (impressions/clicks/reactions) — they're
          // valid for every post type. Video-only metrics get a second call
          // gated on media_type to avoid "metric does not apply" errors.
          const insights = await fbFetch<FbInsightsResponse>(
            `/${fb.id}/insights?metric=${INSIGHTS_METRICS_BASE}`,
            token,
          );
          metrics = flattenInsights(insights);
        } catch (e) {
          result.errors.push({
            post_id: fb.id,
            message: `insights: ${(e as Error).message}`,
          });
        }
        // Video-only second call. Failure here is non-fatal (some "video" posts
        // are actually shared video links without insights eligibility).
        if (parseMediaType(fb) === "video") {
          try {
            const videoInsights = await fbFetch<FbInsightsResponse>(
              `/${fb.id}/insights?metric=${INSIGHTS_METRICS_VIDEO}`,
              token,
            );
            const videoMetrics = flattenInsights(videoInsights);
            // Merge video-specific fields into the base metrics object.
            if (videoMetrics.plays !== undefined) metrics.plays = videoMetrics.plays;
            if (videoMetrics.completion_rate !== undefined) {
              metrics.completion_rate = videoMetrics.completion_rate;
            }
            if (videoMetrics.avg_watch_time_sec !== undefined) {
              metrics.avg_watch_time_sec = videoMetrics.avg_watch_time_sec;
            }
          } catch (_e) {
            // silent — video metrics are bonus; base metrics still present
          }

          // ── Reel-canonical play count ────────────────────────────────────
          // why: /post/insights?metric=post_video_views returns only 3-second
          // qualified views (= 2,024 for 110 W Garfield Reel). Meta Business
          // Suite shows the broader "all plays incl. replays" count = 4,375
          // — and the ONLY API surface that exposes that number is the video
          // object's `views` field. Probed exhaustively on 2026-05-17 across
          // every endpoint × candidate metric combination; `views` on the
          // video object was the unique match (returned 4,447, +1.6% vs Suite
          // due to API freshness lead).
          //
          // The video id lives in the post's first attachment's `target.id`.
          // If we can't resolve it (rare — would need a malformed attachment)
          // we leave metrics.plays at whatever the 3-sec count gave us.
          const videoId = fb.attachments?.data?.[0]?.target?.id;
          if (videoId) {
            try {
              const videoObj = await fbFetch<{ views?: number }>(
                `/${videoId}?fields=views`,
                token,
              );
              if (typeof videoObj.views === "number" && videoObj.views > 0) {
                metrics.plays = videoObj.views;
              }
            } catch (_e) {
              // silent — leave plays at the 3-sec fallback; this just means
              // the canonical play count wasn't fetchable for this post
              // (e.g., a shared external video without a video object on FB).
            }
          }
        }

        // Pull comments + shares from /{post-id}?fields=comments.summary(true),shares
        try {
          const counts = await fbFetch<{
            comments?: { summary?: { total_count?: number } };
            shares?: { count?: number };
          }>(
            `/${fb.id}?fields=comments.summary(true),shares`,
            token,
          );
          if (counts.comments?.summary?.total_count !== undefined) {
            metrics.comments = counts.comments.summary.total_count;
          }
          if (counts.shares?.count !== undefined) {
            metrics.shares = counts.shares.count;
          }
        } catch (e) {
          // Non-fatal — posts may have these disabled
        }

        const thumb = fb.attachments?.data?.[0]?.media?.image?.src ?? fb.full_picture ?? null;
        const mediaUrl = fb.attachments?.data?.[0]?.media?.source ?? null;
        const fbMediaType = parseMediaType(fb);

        // Cache the FB thumbnail to Storage if present. FB returns time-
        // limited fbcdn URLs that expire when Meta rotates them.
        let cachedThumbUrl: string | null = null;
        let cachedAt: string | null = null;
        if (thumb) {
          const cached = await cacheThumbnailToStorage({
            supabaseUrl: SUPABASE_URL,
            serviceRoleKey: SERVICE_ROLE_KEY,
            sourceUrl: thumb,
            platform: "facebook",
            postId: fb.id,
          });
          cachedThumbUrl = cached.cachedUrl;
          cachedAt = cached.cachedAt;
        }

        // media_url for photo posts is the full-res image. For video posts
        // it's a video URL (don't cache as image). Only cache when it's an
        // image AND distinct from the thumb we just cached.
        let cachedMediaUrl: string | null = null;
        if (
          mediaUrl &&
          fbMediaType === "image" &&
          mediaUrl !== thumb
        ) {
          const m = await cacheThumbnailToStorage({
            supabaseUrl: SUPABASE_URL,
            serviceRoleKey: SERVICE_ROLE_KEY,
            sourceUrl: mediaUrl,
            platform: "facebook",
            postId: fb.id,
            pathSuffix: "-media",
          });
          cachedMediaUrl = m.cachedUrl;
          if (m.cachedAt && !cachedAt) cachedAt = m.cachedAt;
        }

        const normalized: NormalizedPost = {
          platform: "facebook",
          platform_post_id: fb.id,
          caption: fb.message ?? null,
          posted_at: fb.created_time,
          permalink: fb.permalink_url ?? null,
          media_url: cachedMediaUrl ?? mediaUrl,
          thumbnail_url: cachedThumbUrl ?? thumb,
          thumbnail_cached_at: cachedAt,
          media_type: fbMediaType,
          hashtags: extractHashtags(fb.message),
          metrics,
          audience: buildAudience({}),
          raw_payload: { fb, metrics },
        };

        const { inserted, updated } = await upsertPost(client, normalized);
        if (inserted) result.inserted++;
        if (updated) result.updated++;
        result.metrics_rows_written++;
      } catch (e) {
        result.errors.push({
          post_id: fb.id,
          message: (e as Error).message,
        });
      }
    }

    result.ok = result.errors.length === 0 || result.inserted + result.updated > 0;
    result.backfilled = result.inserted > 5;
  } catch (e) {
    result.ok = false;
    result.errors.push({ message: (e as Error).message });
  }

  // Group new posts into cross-platform campaigns now (instead of waiting
  // for the standalone grouper cron). No-op if no ungrouped posts remain.
  await runPostGrouper(client, "facebook");

  result.duration_ms = Date.now() - start;
  await recordSyncRun(client, "facebook", result.ok, {
    inserted: result.inserted,
    updated: result.updated,
    errors: result.errors.slice(0, 5),
    duration_ms: result.duration_ms,
  });
  return result;
}

Deno.serve(async (_req: Request) => {
  const result = await syncFacebook();
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
