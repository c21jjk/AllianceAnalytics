/**
 * Facebook Page ingestion Edge Function.
 *
 * Pulls posts + insights from a Facebook Page. Same Graph API base as IG;
 * different endpoints + insights metric names.
 *
 * ── 2026-06-22 metric-source rewrite ────────────────────────────────────────
 * Meta deprecated ALL reach/impressions metrics on the AGGREGATED POST node
 * effective 2026-06-15 (`post_impressions_unique` & friends now return
 * `(#100) must be a valid insights metric`). Because the old code requested
 * those fields BUNDLED with reactions in one call, the whole call 400'd and FB
 * posts started syncing with null reach AND null likes.
 *
 * The fix: those metrics are STILL ALIVE on the underlying VIDEO/REEL node's
 * `video_insights` edge. For video posts we resolve the reel id from
 * permalink_url (`/reel/{id}/`) and read:
 *   fb_reels_total_plays   → plays   (== FB Content Library "Views")
 *   post_impressions_unique→ reach   (== FB Content Library "Viewers")
 *   post_video_avg_time_watched → avg watch (ms)
 * Verified 2026-06-22 against the Sunshine Shore reel (974700268690768):
 * API 49,016 plays / 35,865 reach vs FB native 49,014 Views / 36,805 Viewers.
 *
 * Engagement counts (reactions/comments/shares) come from the post node's
 * summary edges, which match the FB native UI exactly (160 / 283 / 22).
 *
 * Photo/text posts have no video node, so reach is unavailable from the API
 * post-deprecation — they keep accurate engagement and leave reach undefined
 * (NOT a silent zero) until Meta ships the new Page Viewer metric.
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

// why: v25 returns fresher reach numbers than v21/v22 and is the first version
// where the reel-node `video_insights` edge carries fb_reels_total_plays.
const GRAPH_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const BACKFILL_DAYS = Number(Deno.env.get("FB_BACKFILL_DAYS") ?? "365");
const PAGE_SIZE = 50;

// ── Time budgeting (2026-06-11) ─────────────────────────────────────────────
const TIME_BUDGET_MS = Number(Deno.env.get("SYNC_TIME_BUDGET_MS") ?? "110000");
const STALE_AGE_DAYS = 90;
const FRESH_WINDOW_DAYS = 7;
const BACKFILL_CAP_PER_RUN = 25;
const FETCH_TIMEOUT_MS = 15_000;

const POST_FIELDS = [
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  "attachments{media_type,media,subattachments,target}",
  "is_published",
].join(",");

// Post-node insights that SURVIVED the 2026-06-15 deprecation. Reactions +
// clicks are still valid here for every post type. Reach/impressions are NOT
// (they moved to the video node) — do NOT add them back or the whole call 400s.
// Kept as a single-metric request so one bad metric can't nuke the others.
const INSIGHTS_METRICS_CLICKS = "post_clicks_by_type";

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
      /** For video/Reel posts, target.id is the underlying video object id. */
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
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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

/**
 * Resolve the underlying video/reel object id for a FB post. The permalink is
 * the reliable source (`/reel/{id}/`, `/videos/{id}/`, `/watch/?v={id}`); the
 * attachment target.id is a fallback. Returns undefined for non-video posts.
 */
function resolveVideoId(p: {
  permalink_url?: string;
  attachments?: FbPost["attachments"];
}): string | undefined {
  const m = p.permalink_url?.match(/\/(?:reel|videos?|watch)\/(?:\?v=)?(\d+)/);
  if (m) return m[1];
  return p.attachments?.data?.[0]?.target?.id;
}

/**
 * Read reach + total plays from the VIDEO node's `video_insights` edge. These
 * metrics are deprecated on the aggregated post node but remain live here.
 * Called WITHOUT a metric param so Meta returns whatever applies to the video
 * type (reel vs upload) instead of 400'ing on a type-specific metric name.
 */
async function fetchVideoInsights(
  videoId: string,
  token: string,
): Promise<{ plays?: number; reach?: number; avgWatchSec?: number }> {
  // The video node's `views` field is the UNIVERSAL play count — it matches
  // Meta Business Suite's "Views" for both reels (== fb_reels_total_plays) and
  // older non-reel uploads (which don't expose fb_reels_total_plays in the
  // insights edge). Fetch it first so every video type gets a plays number.
  let plays: number | undefined;
  try {
    const node = await fbFetch<{ views?: number }>(`/${videoId}?fields=views`, token);
    if (typeof node.views === "number" && node.views > 0) plays = node.views;
  } catch (_e) {
    // fall through — the insights edge below provides a reel-only backup
  }

  const r = await fbFetch<FbInsightsResponse>(`/${videoId}/video_insights`, token);
  const map = new Map<string, number | Record<string, number>>();
  for (const m of r.data) map.set(m.name, m.values?.[0]?.value ?? 0);
  const num = (k: string): number | undefined => {
    const v = Number(map.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  // Backup plays source if the node field was unavailable.
  if (plays === undefined) plays = num("fb_reels_total_plays") ?? num("total_video_views");
  const reach = num("post_impressions_unique");
  const avgMs = num("post_video_avg_time_watched");
  return { plays, reach, avgWatchSec: avgMs ? avgMs / 1000 : undefined };
}

/** Sum a Graph "by_type" object (e.g. post_clicks_by_type) to a single total. */
function sumByType(v: unknown): number {
  if (!v || typeof v !== "object") return 0;
  return Object.values(v as Record<string, number>).reduce(
    (s, n) => s + (Number(n) || 0),
    0,
  );
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

    // Page follower count (fan_count). Best-effort.
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

    // ── Priority backfill: video posts missing reach OR plays ──────────────
    // why: aged-out posts fall out of the time-budgeted feed walk and froze at
    // their day-one numbers (or null reach after the deprecation). This pass
    // patches reach + plays straight from the video node for the stalest
    // offenders first. Bounded per run; the rest catch up on later ticks.
    try {
      // Pull stalest video posts first, then filter in JS for a missing reach
      // OR plays field (avoids brittle PostgREST json-arrow .or() filters).
      const { data: videoRows } = await client
        .from("posts")
        .select("id, platform_post_id, permalink, metrics, last_synced_at")
        .eq("platform", "facebook")
        .in("media_type", ["video", "reel"])
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(200);

      const candidates = (videoRows ?? [])
        .filter((r) => {
          const m = (r.metrics as Record<string, number>) ?? {};
          return m.reach == null || m.plays == null;
        })
        .slice(0, BACKFILL_CAP_PER_RUN);
      let patched = 0;
      for (const row of candidates) {
        if (Date.now() - start > TIME_BUDGET_MS / 4) break;
        try {
          const videoId = resolveVideoId({
            permalink_url: (row.permalink as string) ?? undefined,
          });
          if (!videoId) continue;
          const vi = await fetchVideoInsights(videoId, token);
          if (vi.plays === undefined && vi.reach === undefined) continue;

          const existing = (row.metrics as Record<string, number>) ?? {};
          const merged: Record<string, number> = { ...existing };
          if (vi.plays !== undefined) {
            merged.plays = vi.plays;
            merged.impressions = vi.plays;
          }
          if (vi.reach !== undefined) merged.reach = vi.reach;
          if (vi.avgWatchSec !== undefined) merged.avg_watch_time_sec = vi.avgWatchSec;
          const er = computeEngagementRate(merged as NormalizedMetrics);
          if (er !== undefined) merged.engagement_rate = er;

          await client
            .from("posts")
            .update({ metrics: merged, last_synced_at: new Date().toISOString() })
            .eq("id", row.id);
          patched++;
        } catch (e) {
          console.warn(
            `fb-sync: backfill failed for post ${row.platform_post_id}:`,
            (e as Error).message,
          );
        }
      }
      if (patched > 0) {
        console.log(`fb-sync: priority backfill patched ${patched} video posts`);
      }
    } catch (e) {
      console.error("fb-sync: priority backfill query failed:", e);
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

    // ── Stalest-first queue (2026-06-11) ──────────────────────────────────
    const { data: knownRows } = await client
      .from("posts")
      .select("platform_post_id, last_synced_at, posted_at")
      .eq("platform", "facebook");
    const knownByPostId = new Map<string, { last_synced_at: string | null; posted_at: string | null }>(
      (knownRows ?? []).map((r) => [
        String(r.platform_post_id),
        { last_synced_at: r.last_synced_at, posted_at: r.posted_at },
      ]),
    );
    const staleAgeCutoff = Date.now() - STALE_AGE_DAYS * 86400_000;
    const freshCutoff = Date.now() - FRESH_WINDOW_DAYS * 86400_000;

    const newPosts: FbPost[] = [];
    const knownPosts: FbPost[] = [];
    let skippedFresh = 0;
    for (const fb of allPosts) {
      const known = knownByPostId.get(fb.id);
      if (!known) {
        newPosts.push(fb);
        continue;
      }
      const postedMs = known.posted_at ? new Date(known.posted_at).getTime() : Date.now();
      const syncedMs = known.last_synced_at ? new Date(known.last_synced_at).getTime() : 0;
      if (postedMs < staleAgeCutoff && syncedMs > freshCutoff) {
        skippedFresh++;
        continue;
      }
      knownPosts.push(fb);
    }
    knownPosts.sort((a, b) => {
      const sa = knownByPostId.get(a.id)?.last_synced_at ?? "";
      const sb = knownByPostId.get(b.id)?.last_synced_at ?? "";
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    const queue = [...newPosts, ...knownPosts];
    result.skipped_fresh = skippedFresh;

    let processed = 0;
    for (const fb of queue) {
      if (Date.now() - start > TIME_BUDGET_MS) {
        result.deferred = queue.length - processed;
        console.warn(
          `fb-sync: time budget reached after ${processed} posts; deferring ${result.deferred} to next run`,
        );
        break;
      }
      processed++;
      try {
        if (fb.is_published === false) continue;

        const metrics: NormalizedMetrics = {};

        // ── Engagement counts (all post types) ───────────────────────────
        // Summary edges match the FB native UI exactly. reactions→likes,
        // plus comments + shares in the same call.
        try {
          const counts = await fbFetch<{
            reactions?: { summary?: { total_count?: number } };
            comments?: { summary?: { total_count?: number } };
            shares?: { count?: number };
          }>(
            `/${fb.id}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares`,
            token,
          );
          const reactions = counts.reactions?.summary?.total_count;
          if (reactions !== undefined) metrics.likes = reactions;
          const comments = counts.comments?.summary?.total_count;
          if (comments !== undefined) metrics.comments = comments;
          if (counts.shares?.count !== undefined) metrics.shares = counts.shares.count;
        } catch (e) {
          result.errors.push({
            post_id: fb.id,
            message: `counts: ${(e as Error).message}`,
          });
        }

        // ── Link clicks (still valid on the post node) ───────────────────
        try {
          const clicks = await fbFetch<FbInsightsResponse>(
            `/${fb.id}/insights?metric=${INSIGHTS_METRICS_CLICKS}`,
            token,
          );
          const total = clicks.data.reduce(
            (s, m) => s + sumByType(m.values?.[0]?.value),
            0,
          );
          if (total > 0) metrics.link_clicks = total;
        } catch (_e) {
          // non-fatal — some post types have no clicks insight
        }

        // ── Reach + plays from the VIDEO node (deprecation-proof) ─────────
        if (parseMediaType(fb) === "video") {
          const videoId = resolveVideoId(fb);
          if (videoId) {
            try {
              const vi = await fetchVideoInsights(videoId, token);
              if (vi.plays !== undefined) {
                metrics.plays = vi.plays;
                metrics.impressions = vi.plays; // total plays ≈ impressions
              }
              if (vi.reach !== undefined) metrics.reach = vi.reach;
              if (vi.avgWatchSec !== undefined) metrics.avg_watch_time_sec = vi.avgWatchSec;
            } catch (e) {
              // non-fatal — a shared external video may have no insights
              console.warn(
                `fb-sync: video_insights failed for ${fb.id}:`,
                (e as Error).message,
              );
            }
          }
        }

        const er = computeEngagementRate(metrics);
        if (er !== undefined) metrics.engagement_rate = er;

        const thumb = fb.attachments?.data?.[0]?.media?.image?.src ?? fb.full_picture ?? null;
        const mediaUrl = fb.attachments?.data?.[0]?.media?.source ?? null;
        const fbMediaType = parseMediaType(fb);

        // Cache the FB thumbnail to Storage (fbcdn URLs expire on rotation).
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

        let cachedMediaUrl: string | null = null;
        if (mediaUrl && fbMediaType === "image" && mediaUrl !== thumb) {
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
