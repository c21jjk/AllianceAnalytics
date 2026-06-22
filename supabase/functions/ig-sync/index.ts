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

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const BACKFILL_DAYS = Number(Deno.env.get("IG_BACKFILL_DAYS") ?? "365");
const PAGE_SIZE = 50;

// ── Time budgeting (2026-06-11) ─────────────────────────────────────────────
// why: each media id costs 1 detail call + 1-3 insight calls + thumbnail
// caching, all sequential. The catalog grew until every run blew past the
// edge gateway's ~150s ceiling: 504 on every tick, zero rows written, IG
// metrics frozen. The run now stops STARTING new media at this budget and
// returns 200 with a partial summary; stalest-first ordering guarantees the
// next 4h tick continues where this one stopped.
const TIME_BUDGET_MS = Number(Deno.env.get("SYNC_TIME_BUDGET_MS") ?? "110000");
// Age tier: media older than STALE_AGE_DAYS whose metrics were refreshed in
// the last FRESH_WINDOW_DAYS get skipped before the detail call even fires.
const STALE_AGE_DAYS = 90;
const FRESH_WINDOW_DAYS = 7;
// why: one hung Meta call previously ate the whole run with no bound.
const FETCH_TIMEOUT_MS = 15_000;

// Meta deprecated `impressions` for IG media in v22 (still works in v21 but
// will break shortly). The new replacement is `views` which works on every
// media type. We keep the rest of the universal metrics in the BASE set;
// video-only metrics go in their own request gated on media_type.
const INSIGHTS_METRICS_BASE = [
  "reach",
  "likes",
  "comments",
  "shares",
  "saved",
  "profile_visits",
  "follows",
  "total_interactions",
  "views",
].join(",");

// Video / Reel-only metrics. Calling these on a static image returns a
// "metric does not support this media product type" error, so we gate on
// media_type before requesting.
const INSIGHTS_METRICS_VIDEO = ["plays"].join(",");

// Minimal fallback set when the base call fails for any reason — these
// have been verified working in v21+ for every media type.
const INSIGHTS_METRICS_MINIMAL = ["reach", "likes", "comments", "shares", "saved"].join(",");

interface IgMediaListResponse {
  data: { id: string; timestamp?: string }[];
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
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
  // `views` replaced `impressions` in v22; either may be present on a
  // post-by-post basis depending on when the metric was queried. Use either,
  // preferring the new name.
  const impressions = map.views ?? map.impressions ?? 0;
  const metrics: NormalizedMetrics = {
    impressions: impressions || undefined,
    reach: map.reach || undefined,
    likes: map.likes,
    comments: map.comments,
    shares: map.shares,
    saves: map.saved,
    plays: map.plays || undefined,
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

    // Capture the IG Business account's follower count once per sync run.
    // Best-effort — failure here doesn't block the media sync.
    try {
      const profile = await igFetch<{
        followers_count?: number;
        media_count?: number;
        username?: string;
      }>(
        `/${igId}?fields=followers_count,media_count,username`,
        token,
      );
      const count = profile.followers_count ?? 0;
      await recordPlatformFollowers(client, "instagram", count, profile);
    } catch (e) {
      console.error("ig-sync: follower count fetch failed:", e);
    }

    // Cutoff for backfill window
    const since = Math.floor(Date.now() / 1000) - BACKFILL_DAYS * 86400;

    // Walk paginated /media.
    //
    // why (2026-06-22): IG's /media edge has NO server-side `since` filter, so
    // it returns the account's ENTIRE lifetime catalog (~1,200 media). The old
    // code fetched only `id`, queued every id, and only discarded out-of-window
    // media AFTER a per-media detail call. With ~780 media not yet in the DB —
    // most of them years old — every run burned its full time budget
    // detail-fetching-then-skipping ancient media and NEVER reached the
    // existing posts that needed a metrics refresh (they sit in `knownIds`,
    // after `newIds`). Result: frozen posts never updated; row count crept up.
    //
    // Fix: fetch `timestamp` alongside `id` and drop out-of-window media HERE,
    // before queueing. The feed is reverse-chronological, so the first media
    // older than `since` means every later page is older too — stop paginating.
    // This mirrors fb-sync, whose /posts call passes `&since=` server-side.
    let after: string | undefined;
    const walked: { id: string; ts: number }[] = [];
    let reachedWindowEdge = false;
    do {
      const path = `/${igId}/media?fields=id,timestamp&limit=${PAGE_SIZE}${
        after ? `&after=${encodeURIComponent(after)}` : ""
      }`;
      const page = await igFetch<IgMediaListResponse>(path, token);
      for (const d of page.data) {
        const ts = d.timestamp
          ? Math.floor(new Date(d.timestamp).getTime() / 1000)
          : 0;
        if (ts && ts < since) {
          reachedWindowEdge = true;
          break;
        }
        walked.push({ id: d.id, ts });
      }
      if (reachedWindowEdge) break;
      after = page.paging?.cursors?.after;
      if (!page.paging?.next) break;
      // Safety cap — avoid runaway pagination
      if (walked.length > 5000) break;
    } while (after);

    // ── Recency-first queue (2026-06-22) ──────────────────────────────────
    // why this replaced the old new-first / known-stalest-first split: that
    // ordering processed EVERY media not yet in the DB before ANY existing
    // stale post. During catch-up that meant a backlog of older un-ingested
    // media sat in front of recently-frozen posts (e.g. this month's reels),
    // starving them indefinitely. Ordering the whole queue by post recency
    // guarantees the posts that matter most for reports — the most recent —
    // are always refreshed first, whether they're brand new or stale. The
    // age tier still drops old posts whose metrics were refreshed in the last
    // FRESH_WINDOW_DAYS so steady-state runs don't re-do unchanging old media.
    const { data: knownRows } = await client
      .from("posts")
      .select("platform_post_id, last_synced_at, posted_at")
      .eq("platform", "instagram");
    const knownByPostId = new Map<string, { last_synced_at: string | null; posted_at: string | null }>(
      (knownRows ?? []).map((r) => [
        String(r.platform_post_id),
        { last_synced_at: r.last_synced_at, posted_at: r.posted_at },
      ]),
    );
    const staleAgeCutoff = Date.now() - STALE_AGE_DAYS * 86400_000;
    const freshCutoff = Date.now() - FRESH_WINDOW_DAYS * 86400_000;

    let skippedFresh = 0;
    const queue = walked
      .filter(({ id, ts }) => {
        const known = knownByPostId.get(id);
        if (!known) return true; // never ingested — must pull it
        const postedMs = ts ? ts * 1000 : Date.now();
        const syncedMs = known.last_synced_at
          ? new Date(known.last_synced_at).getTime()
          : 0;
        if (postedMs < staleAgeCutoff && syncedMs > freshCutoff) {
          skippedFresh++;
          return false;
        }
        return true;
      })
      .sort((a, b) => b.ts - a.ts) // most recent post first
      .map((m) => m.id);
    result.skipped_fresh = skippedFresh;

    // Hydrate each media id with details + insights
    let processed = 0;
    for (const mediaId of queue) {
      // why: never START a media id we might not finish; the remainder is
      // intact and stalest-first puts it at the front of the next run.
      if (Date.now() - start > TIME_BUDGET_MS) {
        result.deferred = queue.length - processed;
        console.warn(
          `ig-sync: time budget reached after ${processed} media; deferring ${result.deferred} to next run`,
        );
        break;
      }
      processed++;
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
            `/${mediaId}/insights?metric=${INSIGHTS_METRICS_BASE}`,
            token,
          );
          metrics = flattenInsights(insights);
        } catch (_e) {
          // Insights API rejects the whole batch when any one metric isn't
          // valid for the media type. Fall back to the minimal set, which
          // works for every post type in v21+.
          try {
            const insights2 = await igFetch<IgInsightsResponse>(
              `/${mediaId}/insights?metric=${INSIGHTS_METRICS_MINIMAL}`,
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
        // Video-only second call. Failure non-fatal.
        const mediaTypeNorm = parseMediaType(detail.media_type, detail.media_product_type);
        if (mediaTypeNorm === "video" || mediaTypeNorm === "reel") {
          try {
            const videoInsights = await igFetch<IgInsightsResponse>(
              `/${mediaId}/insights?metric=${INSIGHTS_METRICS_VIDEO}`,
              token,
            );
            const videoMetrics = flattenInsights(videoInsights);
            if (videoMetrics.plays !== undefined) metrics.plays = videoMetrics.plays;
          } catch (_e) {
            // silent — plays is bonus; base metrics still present
          }
        }

        // Cache the chosen thumbnail (and media_url for photo posts where it
        // doubles as the displayed image) to Supabase Storage so the URL
        // survives Meta's CDN rotation.
        const rawThumb = detail.thumbnail_url ?? detail.media_url ?? null;
        let cachedThumbUrl: string | null = null;
        let cachedAt: string | null = null;
        if (rawThumb) {
          const cached = await cacheThumbnailToStorage({
            supabaseUrl: SUPABASE_URL,
            serviceRoleKey: SERVICE_ROLE_KEY,
            sourceUrl: rawThumb,
            platform: "instagram",
            postId: detail.id,
          });
          cachedThumbUrl = cached.cachedUrl;
          cachedAt = cached.cachedAt;
        }

        // For IMAGE posts, media_url IS the image and is the most likely to
        // be referenced as a fallback elsewhere. Cache it under a -media
        // suffix so we don't collide with the thumbnail entry. Skip when the
        // media_url is a video URL (CAROUSEL/VIDEO posts).
        let cachedMediaUrl: string | null = null;
        if (
          detail.media_url &&
          detail.media_type === "IMAGE" &&
          detail.media_url !== rawThumb
        ) {
          const m = await cacheThumbnailToStorage({
            supabaseUrl: SUPABASE_URL,
            serviceRoleKey: SERVICE_ROLE_KEY,
            sourceUrl: detail.media_url,
            platform: "instagram",
            postId: detail.id,
            pathSuffix: "-media",
          });
          cachedMediaUrl = m.cachedUrl;
          if (m.cachedAt && !cachedAt) cachedAt = m.cachedAt;
        }

        const normalized: NormalizedPost = {
          platform: "instagram",
          platform_post_id: detail.id,
          caption: detail.caption ?? null,
          posted_at: detail.timestamp,
          permalink: detail.permalink ?? null,
          media_url: cachedMediaUrl ?? detail.media_url ?? null,
          thumbnail_url: cachedThumbUrl ?? rawThumb,
          thumbnail_cached_at: cachedAt,
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

  // Group new posts into cross-platform campaigns immediately so the
  // dashboard reflects the merge before the next 4h grouper cron.
  await runPostGrouper(client, "instagram");

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
