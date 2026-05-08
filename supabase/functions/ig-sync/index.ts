/**
 * Instagram ingestion Edge Function.
 *
 * Pulls media + insights for the connected IG Business account from the
 * Facebook Graph API, normalizes them into the posts + post_metrics_daily
 * schema, and upserts.
 *
 * Endpoints used:
 *   GET /{ig-business-id}/media — list of recent media IDs (paginated)
 *   GET /{media-id}?fields=...  — caption, media_type, media_url, thumbnail_url, permalink, timestamp
 *   GET /{media-id}/insights?metric=... — impressions, reach, likes, comments, shares, saves, plays, profile_visits, follows
 *
 * Insights-eligible accounts: IG Business linked to a FB Page. (Confirmed
 * present per api_credentials inspection 2026-05-08.)
 *
 * Backfill window: env var IG_BACKFILL_DAYS, default 365.
 *
 * Auth: this function should be invoked with verify_jwt=true. The Next.js
 * server action passes the user's session; cron invocations include the
 * service-role key as Authorization.
 */
// @ts-expect-error - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  loadCredentials,
  upsertPost,
  recordSyncRun,
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

const BACKFILL_DAYS = Number(Deno.env.get("IG_BACKFILL_DAYS") ?? "365");
const PAGE_SIZE = 50;

/** Media-level insights metrics we request from /insights */
const INSIGHTS_METRICS = [
  "impressions",
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "plays",
  "profile_visits",
  "follows",
  "video_view_total_time",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
].join(",");

interface IgMediaListResponse {
  data: { id: string }[];
  paging?: { next?: string; cursors?: { after?: string } };
}

interface IgMediaDetail {
  id: string;
  caption?: string;
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD";
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
}

interface IgInsightsResponse {
  data: { name: string; values: { value: number }[] }[];
}

async function igFetch<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${GRAPH_BASE}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`IG ${path} ${res.status}: ${body}`);
  }
  return await res.json() as T;
}

function parseMediaType(
  m: IgMediaDetail["media_type"],
  p: IgMediaDetail["media_product_type"],
): NormalizedPost["media_type"] {
  if (p === "REELS") return "reel";
  if (m === "CAROUSEL_ALBUM") return "carousel";
  if (m === "VIDEO") return "video";
  if (m === "IMAGE") return "image";
  return null;
}

function flattenInsights(
  insights: IgInsightsResponse,
): NormalizedMetrics {
  const map: Record<string, number> = {};
  for (const m of insights.data) {
    map[m.name] = m.values?.[0]?.value ?? 0;
  }
  const metrics: NormalizedMetrics = {
    impressions: map.impressions,
    reach: map.reach,
    likes: map.likes,
    comments: map.comments,
    shares: map.shares,
    saves: map.saved,
    plays: map.plays,
    profile_visits: map.profile_visits,
    follows: map.follows,
  };
  const er = computeEngagementRate(metrics);
  if (er !== undefined) metrics.engagement_rate = er;
  return metrics;
}

export async function syncInstagram(): Promise<SyncResult> {
  const start = Date.now();
  const client = createServiceClient();

  const result: SyncResult = {
    platform: "instagram",
    ok: false,
    inserted: 0,
    updated: 0,
    metrics_rows_written: 0,
    errors: [],
    duration_ms: 0,
    backfilled: false,
  };

  try {
    const cred = await loadCredentials(client, "instagram", [
      "ig_business_account_id",
      "page_access_token",
    ]);
    const igId = String(cred.credentials.ig_business_account_id);
    const token = String(cred.credentials.page_access_token);

    // Cutoff for backfill window
    const since = Math.floor(Date.now() / 1000) - BACKFILL_DAYS * 86400;

    // Walk paginated /media
    let after: string | undefined;
    const mediaIds: string[] = [];
    do {
      const path = `/${igId}/media?fields=id&limit=${PAGE_SIZE}${
        after ? `&after=${encodeURIComponent(after)}` : ""
      }`;
      const page = await igFetch<IgMediaListResponse>(path, token);
      mediaIds.push(...page.data.map((d) => d.id));
      after = page.paging?.cursors?.after;
      if (!page.paging?.next) break;
      // Safety cap — avoid runaway pagination
      if (mediaIds.length > 5000) break;
    } while (after);

    // Hydrate each media id with details + insights
    for (const mediaId of mediaIds) {
      try {
        const detail = await igFetch<IgMediaDetail>(
          `/${mediaId}?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp`,
          token,
        );

        // Skip if outside backfill window
        const postedTs = Math.floor(new Date(detail.timestamp).getTime() / 1000);
        if (postedTs < since) continue;

        let metrics: NormalizedMetrics = {};
        try {
          const insights = await igFetch<IgInsightsResponse>(
            `/${mediaId}/insights?metric=${INSIGHTS_METRICS}`,
            token,
          );
          metrics = flattenInsights(insights);
        } catch (e) {
          // Insights API rejects metrics that don't apply to the media type
          // (e.g. video_view_total_time on an image). We retry with a
          // minimum metrics set when this happens.
          const minimal = ["impressions", "reach", "likes", "comments", "shares", "saved"].join(",");
          try {
            const insights2 = await igFetch<IgInsightsResponse>(
              `/${mediaId}/insights?metric=${minimal}`,
              token,
            );
            metrics = flattenInsights(insights2);
          } catch (e2) {
            result.errors.push({
              post_id: mediaId,
              message: `insights: ${(e2 as Error).message}`,
            });
            // Continue; metrics will be empty for this post
          }
        }

        const normalized: NormalizedPost = {
          platform: "instagram",
          platform_post_id: detail.id,
          caption: detail.caption ?? null,
          posted_at: detail.timestamp,
          permalink: detail.permalink ?? null,
          media_url: detail.media_url ?? null,
          thumbnail_url: detail.thumbnail_url ?? detail.media_url ?? null,
          media_type: parseMediaType(detail.media_type, detail.media_product_type),
          hashtags: extractHashtags(detail.caption),
          metrics,
          // IG audience demographics live on the /insights endpoint of the
          // BUSINESS account, not per-media. Per-post audience is left empty
          // here; a separate aggregator will fold the page-level audience into
          // each report at generation time.
          audience: buildAudience({}),
          raw_payload: { detail, insights: metrics },
        };

        const { inserted, updated } = await upsertPost(client, normalized);
        if (inserted) result.inserted++;
        if (updated) result.updated++;
        result.metrics_rows_written++;
      } catch (e) {
        result.errors.push({
          post_id: mediaId,
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
  await recordSyncRun(client, "instagram", result.ok, {
    inserted: result.inserted,
    updated: result.updated,
    errors: result.errors.slice(0, 5),
    duration_ms: result.duration_ms,
  });
  return result;
}

Deno.serve(async (_req: Request) => {
  const result = await syncInstagram();
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
