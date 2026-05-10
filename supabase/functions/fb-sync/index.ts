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
} from "../_shared/db.ts";
import {
  buildAudience,
  computeEngagementRate,
  extractHashtags,
} from "../_shared/parse.ts";
import type {
  NormalizedMetrics,
  NormalizedPost,
  SyncResult,
} from "../_shared/types.ts";

const GRAPH_VERSION = "v21.0";
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

const INSIGHTS_METRICS = [
  "post_impressions",
  "post_impressions_unique", // Facebook's term for "reach"
  "post_reactions_by_type_total",
  "post_clicks",
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
  const reactionsByType = (map.get("post_reactions_by_type_total") ?? {}) as Record<string, number>;
  const totalReactions = Object.values(reactionsByType).reduce((s, n) => s + (Number(n) || 0), 0);

  const metrics: NormalizedMetrics = {
    impressions: Number(map.get("post_impressions") ?? 0) || undefined,
    reach: Number(map.get("post_impressions_unique") ?? 0) || undefined,
    likes: totalReactions || undefined,
    link_clicks: Number(map.get("post_clicks") ?? 0) || undefined,
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
          const insights = await fbFetch<FbInsightsResponse>(
            `/${fb.id}/insights?metric=${INSIGHTS_METRICS}`,
            token,
          );
          metrics = flattenInsights(insights);
        } catch (e) {
          result.errors.push({
            post_id: fb.id,
            message: `insights: ${(e as Error).message}`,
          });
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

        const normalized: NormalizedPost = {
          platform: "facebook",
          platform_post_id: fb.id,
          caption: fb.message ?? null,
          posted_at: fb.created_time,
          permalink: fb.permalink_url ?? null,
          media_url: mediaUrl,
          thumbnail_url: thumb,
          media_type: parseMediaType(fb),
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
