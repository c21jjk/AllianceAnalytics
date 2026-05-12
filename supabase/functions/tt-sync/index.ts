/**
 * TikTok ingestion Edge Function.
 *
 * Uses the TikTok Display API (v2) for the authenticated user's videos and
 * the Research API endpoint patterns where available. TikTok's API surface
 * for organic creator analytics is more limited than FB/IG — many "real"
 * analytics (audience age/gender, completion rate beyond aggregate) live
 * only inside the in-app TikTok Studio dashboard, NOT in the API.
 *
 * What we get reliably:
 *   - Video list (id, title/desc, create_time, cover_url, video_url, duration)
 *   - Per-video stats: view_count, like_count, comment_count, share_count
 *
 * What we cannot reliably get from organic API:
 *   - Reach (TikTok exposes "video views" only; closest proxy = views)
 *   - Audience demographics
 *   - Completion rate per-post
 *
 * If TikTok ever exposes these in a future API version, we extend
 * flattenStats() to populate them.
 *
 * Auth: OAuth user token. TikTok long-lived tokens expire (typically 1 yr).
 * If access_token is expired, this function attempts a refresh via the
 * TikTok refresh endpoint and writes the new token back to api_credentials.
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

const TT_API_BASE = "https://open.tiktokapis.com/v2";
const TT_REFRESH_URL = "https://open.tiktokapis.com/v2/oauth/token/";

const BACKFILL_DAYS = Number(Deno.env.get("TT_BACKFILL_DAYS") ?? "365");
const PAGE_SIZE = 20;

const VIDEO_FIELDS = [
  "id",
  "title",
  "video_description",
  "create_time",
  "cover_image_url",
  "share_url",
  "embed_link",
  "duration",
  "view_count",
  "like_count",
  "comment_count",
  "share_count",
].join(",");

interface TtTokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
}

interface TtVideoListResponse {
  data: { videos: TtVideo[]; cursor?: number; has_more?: boolean };
  error?: { code: string; message: string };
}

interface TtVideo {
  id: string;
  title?: string;
  video_description?: string;
  create_time: number; // unix seconds
  cover_image_url?: string;
  share_url?: string;
  embed_link?: string;
  duration?: number; // seconds
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

async function ttFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${TT_API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TT ${path} ${res.status}: ${body}`);
  }
  return await res.json() as T;
}

function isTokenExpired(creds: Record<string, unknown>): boolean {
  const obtained = creds.obtained_at;
  const expiresIn = creds.expires_in;
  if (typeof obtained !== "string" || typeof expiresIn !== "number") {
    return false; // Unknown — let the API call decide
  }
  const expiresAt = new Date(obtained).getTime() + expiresIn * 1000;
  // Refresh if within 24 hours of expiry
  return Date.now() > expiresAt - 24 * 3600 * 1000;
}

async function refreshToken(
  refreshToken: string,
  clientKey: string,
  clientSecret: string,
): Promise<TtTokenRefreshResponse> {
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(TT_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TT refresh failed ${res.status}: ${text}`);
  }
  return await res.json() as TtTokenRefreshResponse;
}

function flattenStats(v: TtVideo): NormalizedMetrics {
  const metrics: NormalizedMetrics = {
    plays: v.view_count,
    impressions: v.view_count, // Best proxy TT exposes
    reach: v.view_count,        // Same — TT doesn't differentiate
    likes: v.like_count,
    comments: v.comment_count,
    shares: v.share_count,
  };
  const er = computeEngagementRate(metrics);
  if (er !== undefined) metrics.engagement_rate = er;
  return metrics;
}

export async function syncTikTok(): Promise<SyncResult> {
  const start = Date.now();
  const client = createServiceClient();
  const result: SyncResult = {
    platform: "tiktok",
    ok: false,
    inserted: 0,
    updated: 0,
    metrics_rows_written: 0,
    errors: [],
    duration_ms: 0,
    backfilled: false,
  };

  try {
    const cred = await loadCredentials(client, "tiktok", [
      "access_token",
      "refresh_token",
      "client_key",
    ]);
    let accessToken = String(cred.credentials.access_token);

    // Refresh if expired or near-expiry. client_secret must be set in
    // env (TT_CLIENT_SECRET) — TikTok requires it for refresh and storing
    // it in the credentials jsonb is discouraged.
    if (isTokenExpired(cred.credentials)) {
      const clientSecret = Deno.env.get("TT_CLIENT_SECRET");
      if (!clientSecret) {
        throw new Error("TT token expired but TT_CLIENT_SECRET env var not set");
      }
      const refreshed = await refreshToken(
        String(cred.credentials.refresh_token),
        String(cred.credentials.client_key),
        clientSecret,
      );
      // Persist refreshed token
      const newCreds = {
        ...cred.credentials,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_in: refreshed.expires_in,
        refresh_expires_in: refreshed.refresh_expires_in,
        obtained_at: new Date().toISOString(),
      };
      await client
        .from("api_credentials")
        .update({ credentials: newCreds })
        .eq("platform", "tiktok");
      accessToken = refreshed.access_token;
    }

    // Capture the TT account's follower count once per sync run.
    // Best-effort — failure here doesn't block the video sync.
    try {
      const profileRes = await fetch(
        `${TT_API_BASE}/user/info/?fields=follower_count,following_count,likes_count,video_count,display_name`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (profileRes.ok) {
        const profileJson = await profileRes.json() as {
          data?: { user?: { follower_count?: number } };
        };
        const count = profileJson.data?.user?.follower_count ?? 0;
        await recordPlatformFollowers(client, "tiktok", count, profileJson);
      }
    } catch (e) {
      console.error("tt-sync: follower count fetch failed:", e);
    }

    const since = Math.floor(Date.now() / 1000) - BACKFILL_DAYS * 86400;

    // Walk paginated /video/list — POST with cursor body
    let cursor = 0;
    let hasMore = true;
    const videos: TtVideo[] = [];
    while (hasMore) {
      const data = await ttFetch<TtVideoListResponse>(
        `/video/list/?fields=${VIDEO_FIELDS}`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({ max_count: PAGE_SIZE, cursor }),
        },
      );
      if (data.error?.code && data.error.code !== "ok") {
        throw new Error(`TT list error: ${data.error.message}`);
      }
      videos.push(...(data.data?.videos ?? []));
      cursor = data.data?.cursor ?? cursor;
      hasMore = !!data.data?.has_more;
      if (videos.length > 5000) break;
      // Cutoff window: if oldest video on the page is older than `since`, stop
      if (videos.at(-1) && (videos.at(-1)!.create_time ?? 0) < since) break;
    }

    for (const v of videos) {
      try {
        if (v.create_time && v.create_time < since) continue;
        const metrics = flattenStats(v);
        const caption = v.video_description ?? v.title ?? null;

        // Cache the cover_image_url to Supabase Storage. TikTok cover URLs
        // are signed and expire — caching makes them persistent. media_url
        // here is the embed_link (HTML), not an image, so we never cache it.
        let cachedThumbUrl: string | null = null;
        let cachedAt: string | null = null;
        if (v.cover_image_url) {
          const cached = await cacheThumbnailToStorage({
            supabaseUrl: SUPABASE_URL,
            serviceRoleKey: SERVICE_ROLE_KEY,
            sourceUrl: v.cover_image_url,
            platform: "tiktok",
            postId: v.id,
          });
          cachedThumbUrl = cached.cachedUrl;
          cachedAt = cached.cachedAt;
        }

        const normalized: NormalizedPost = {
          platform: "tiktok",
          platform_post_id: v.id,
          caption,
          posted_at: new Date((v.create_time ?? 0) * 1000).toISOString(),
          permalink: v.share_url ?? null,
          media_url: v.embed_link ?? null,
          thumbnail_url: cachedThumbUrl ?? v.cover_image_url ?? null,
          thumbnail_cached_at: cachedAt,
          media_type: "video", // TikTok is video-only
          hashtags: extractHashtags(caption),
          metrics,
          audience: buildAudience({}), // Not exposed via API
          raw_payload: { v },
        };

        const { inserted, updated } = await upsertPost(client, normalized);
        if (inserted) result.inserted++;
        if (updated) result.updated++;
        result.metrics_rows_written++;
      } catch (e) {
        result.errors.push({
          post_id: v.id,
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
  await runPostGrouper(client, "tiktok");

  result.duration_ms = Date.now() - start;
  await recordSyncRun(client, "tiktok", result.ok, {
    inserted: result.inserted,
    updated: result.updated,
    errors: result.errors.slice(0, 5),
    duration_ms: result.duration_ms,
  });
  return result;
}

Deno.serve(async (_req: Request) => {
  const result = await syncTikTok();
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
