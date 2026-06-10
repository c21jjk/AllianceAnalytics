import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Phase 5A — Meta Graph API publishing client for the Post Builder.
 *
 * Handles two surface platforms (FB Page + Instagram Business), four shapes:
 *
 *   IG single image  → POST /{ig-id}/media → /media_publish
 *   IG carousel      → POST /{ig-id}/media × N (is_carousel_item=true)
 *                    → POST /{ig-id}/media (CAROUSEL, children=[ids])
 *                    → /media_publish
 *   FB single photo  → POST /{page-id}/photos
 *   FB multi-photo   → POST /{page-id}/photos × N (published=false)
 *                    → POST /{page-id}/feed with attached_media=[{media_fbid}, ...]
 *
 * Hard guards (per project memory: NO Groups, NO personal profiles, NO auto-spend):
 *   - Only publishes to the page_id / ig_business_account_id from api_credentials.
 *     The caller cannot inject a different ID.
 *   - Never calls /boost or any paid endpoint.
 *   - Never touches Groups/profiles APIs (Page tokens can't anyway).
 *
 * Token rotation: detects "missing scope" Graph errors and surfaces them
 * with a clear message so the user knows to re-authorize.
 */

const GRAPH_VERSION = "v22.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// why: external platform calls can otherwise hang the route indefinitely.
// 30s covers normal Graph/TikTok latency; poll-loop requests get a tighter
// 15s because the loops already bound the total wait themselves.
const FETCH_TIMEOUT_MS = 30_000;
const POLL_FETCH_TIMEOUT_MS = 15_000;

/**
 * why: AbortSignal.timeout rejects with a DOMException named TimeoutError
 * (older runtimes: AbortError). Surface a clear transient message instead
 * of the raw abort text so the UI tells the user to simply retry.
 */
function fetchErrorMessage(e: unknown): string {
  if (
    e instanceof Error &&
    (e.name === "TimeoutError" || e.name === "AbortError")
  ) {
    return "Platform API request timed out. This is usually transient. Try again.";
  }
  return e instanceof Error ? e.message : String(e);
}

export interface MetaCredentials {
  page_id: string;
  /**
   * FB Page Access Token — used for `/page/photos`, `/page/feed`, `/page/videos`.
   * Must carry the `pages_manage_posts` permission (which requires the owning
   * Meta app to have the "Manage everything on your Page" use case configured).
   */
  page_access_token: string;
  /**
   * IG-capable Page Access Token — used for the `/ig-id/media`,
   * `/ig-id/media_publish` IG publishing endpoints. MUST carry
   * `instagram_basic` + `instagram_content_publish` scopes.
   *
   * why: a single Meta app may not yet have BOTH Page-publish scopes
   * (`pages_manage_posts`) AND IG-publish scopes if the IG use case
   * hasn't been fully customized. We persist them independently in the
   * `facebook` vs `instagram` rows of `api_credentials` so each can come
   * from a different app's token if needed. Falls back to
   * `page_access_token` when the IG row doesn't carry its own token.
   */
  ig_page_access_token: string;
  ig_business_account_id: string | null;
}

export type PublishPlatform = "facebook" | "instagram" | "tiktok";

export interface PublishOk {
  ok: true;
  platform: PublishPlatform;
  platform_post_id: string;
  permalink: string | null;
}

export interface PublishErr {
  ok: false;
  platform: PublishPlatform;
  error: string;
  /** True when the error signals a missing publishing scope (re-auth needed). */
  scope_error?: boolean;
}

export type PublishResult = PublishOk | PublishErr;

export interface TikTokCredentials {
  access_token: string;
  open_id: string;
  /** Refresh token + client_key + client_secret kept on the row for refresh-on-401 fallback. */
  refresh_token: string | null;
  client_key: string | null;
  client_secret: string | null;
}

/**
 * Load FB + IG credentials from api_credentials. Returns null when either
 * record is missing or marked inactive (caller surfaces a clear error).
 */
export async function loadMetaCredentials(): Promise<MetaCredentials | null> {
  const supabase = createAdminClient();

  const { data: fb } = await supabase
    .from("api_credentials")
    .select("credentials, is_active")
    .eq("platform", "facebook")
    .eq("is_active", true)
    .maybeSingle();
  if (!fb) return null;

  // IG credential is optional — caller may only want FB.
  const { data: ig } = await supabase
    .from("api_credentials")
    .select("credentials, is_active")
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle();

  const fbCreds = fb.credentials as { page_id?: string; page_access_token?: string };
  if (!fbCreds.page_id || !fbCreds.page_access_token) return null;

  const igCreds = (ig?.credentials ?? {}) as {
    ig_business_account_id?: string;
    page_access_token?: string;
  };

  // why: when the IG row carries its own page_access_token, use it for IG
  // publishes (it'll have instagram_* scopes). Otherwise fall back to the FB
  // row's token — the same single-token behavior we had before the split.
  const igToken = igCreds.page_access_token
    ? String(igCreds.page_access_token)
    : String(fbCreds.page_access_token);

  return {
    page_id: String(fbCreds.page_id),
    page_access_token: String(fbCreds.page_access_token),
    ig_page_access_token: igToken,
    ig_business_account_id: igCreds.ig_business_account_id
      ? String(igCreds.ig_business_account_id)
      : null,
  };
}

/**
 * Load TikTok publishing credentials from api_credentials. Same row the
 * tt-sync edge function uses; we just need access_token + open_id at
 * publish time. Returns null when no active TikTok row exists.
 */
export async function loadTikTokCredentials(): Promise<TikTokCredentials | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("api_credentials")
    .select("credentials, is_active")
    .eq("platform", "tiktok")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;

  const creds = data.credentials as {
    access_token?: string;
    open_id?: string;
    refresh_token?: string;
    client_key?: string;
    client_secret?: string;
  };
  if (!creds.access_token || !creds.open_id) return null;

  // why: tt-sync edge function reads TT_CLIENT_SECRET from env (see
  // credentialSchemas.ts), so the secret may not be persisted in the
  // api_credentials JSONB row. Fall back to env so refresh-on-401 works
  // without requiring a credentials backfill. The JSONB value wins when
  // present so a per-environment override is still possible.
  const envClientSecret = process.env.TT_CLIENT_SECRET ?? null;

  return {
    access_token: String(creds.access_token),
    open_id: String(creds.open_id),
    refresh_token: creds.refresh_token ? String(creds.refresh_token) : null,
    client_key: creds.client_key ? String(creds.client_key) : null,
    client_secret: creds.client_secret
      ? String(creds.client_secret)
      : envClientSecret,
  };
}

/**
 * Publish to FB Page. Handles both single and multi-photo posts.
 *
 * Single (1 image_url): direct POST to /{page-id}/photos with the caption
 * as `message` — creates a photo post with the message attached.
 *
 * Multi (2+ image_urls): upload each photo with `published=false` to get
 * a media_fbid for each, then POST to /{page-id}/feed with
 * `attached_media=[{media_fbid: x}, ...]` and the message. Facebook lays
 * them out in a gallery grid automatically.
 */
export async function publishToFBPage(args: {
  creds: MetaCredentials;
  image_urls: string[];
  caption: string;
  /**
   * When true, append `published=false` so the post lands in the Page's
   * Drafts (Page Manager → Drafts). Invisible to followers; admins only.
   * For multi-photo: every child upload is already published=false, AND
   * the final /feed call also gets published=false so the bundled post
   * stays in Drafts instead of going live.
   */
  test_mode?: boolean;
}): Promise<PublishResult> {
  const { creds, image_urls, caption, test_mode } = args;

  if (image_urls.length === 0) {
    return { ok: false, platform: "facebook", error: "no images provided" };
  }

  try {
    if (image_urls.length === 1) {
      // Single photo path.
      const url = `${GRAPH}/${creds.page_id}/photos`;
      const params: Record<string, string> = {
        url: image_urls[0],
        message: caption,
        access_token: creds.page_access_token,
      };
      if (test_mode) params.published = "false";
      const body = new URLSearchParams(params);
      const res = await fetch(url, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const json = await res.json();
      if (!res.ok || !json.id) {
        return classifyFBError(json, "facebook");
      }
      // The response has `id` (photo id) and `post_id` (page post id).
      const postId: string = json.post_id ?? json.id;
      return {
        ok: true,
        platform: "facebook",
        platform_post_id: postId,
        // why: in test mode the post is a Page Draft — not publicly
        // addressable. Send the user to Meta Business Suite's content
        // view (filtered to the right Page) so they can find their
        // drafts queue and review/publish from there. The post id is in
        // platform_post_id above for downstream traceability.
        permalink: test_mode
          ? `https://business.facebook.com/latest/content?asset_id=${creds.page_id}`
          : `https://www.facebook.com/${postId}`,
      };
    }

    // Multi-photo path: upload each photo unpublished, then bundle into a feed post.
    const mediaIds: string[] = [];
    for (const imgUrl of image_urls) {
      const uploadUrl = `${GRAPH}/${creds.page_id}/photos`;
      const body = new URLSearchParams({
        url: imgUrl,
        published: "false",
        access_token: creds.page_access_token,
      });
      const res = await fetch(uploadUrl, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const json = await res.json();
      if (!res.ok || !json.id) {
        return classifyFBError(json, "facebook");
      }
      mediaIds.push(String(json.id));
    }

    // Publish the gallery post via /feed with attached_media.
    const feedUrl = `${GRAPH}/${creds.page_id}/feed`;
    const attached = mediaIds.map((id) => ({ media_fbid: id }));
    const feedParams: Record<string, string> = {
      message: caption,
      attached_media: JSON.stringify(attached),
      access_token: creds.page_access_token,
    };
    if (test_mode) feedParams.published = "false";
    const body = new URLSearchParams(feedParams);
    const res = await fetch(feedUrl, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const json = await res.json();
    if (!res.ok || !json.id) {
      return classifyFBError(json, "facebook");
    }
    return {
      ok: true,
      platform: "facebook",
      platform_post_id: String(json.id),
      permalink: test_mode
        ? `https://business.facebook.com/latest/content?asset_id=${creds.page_id}`
        : `https://www.facebook.com/${json.id}`,
    };
  } catch (e) {
    return {
      ok: false,
      platform: "facebook",
      error: fetchErrorMessage(e),
    };
  }
}

/**
 * Publish to Instagram (Business account linked to the FB Page).
 *
 * Single image: 2-step container + publish.
 * Carousel (2-10 images): create N child containers + 1 parent CAROUSEL
 * container + publish.
 *
 * IG carousel hard cap is 10. Caller (Post Builder UI) should disable IG
 * for OH multi-property posts with > 10 listings.
 */
export async function publishToIG(args: {
  creds: MetaCredentials;
  image_urls: string[];
  caption: string;
  /**
   * When true, build the container(s) but DON'T call /media_publish. The
   * container is created on IG's side (proving auth + payload + image
   * fetch all worked) but never becomes visible. Containers expire in 24h
   * if not published. Permalink is null in test mode.
   */
  test_mode?: boolean;
}): Promise<PublishResult> {
  const { creds, image_urls, caption, test_mode } = args;

  if (!creds.ig_business_account_id) {
    return {
      ok: false,
      platform: "instagram",
      error: "Instagram Business account not configured in api_credentials",
    };
  }
  if (image_urls.length === 0) {
    return { ok: false, platform: "instagram", error: "no images provided" };
  }
  if (image_urls.length > 10) {
    return {
      ok: false,
      platform: "instagram",
      error: `Instagram carousel max is 10 images (received ${image_urls.length})`,
    };
  }

  const igId = creds.ig_business_account_id;
  // why: IG publishing uses the IG-specific page token (carries
  // instagram_basic + instagram_content_publish). Falls back to the FB
  // page token when no separate IG token is configured.
  const igAccessToken = creds.ig_page_access_token;

  try {
    let creationId: string;

    if (image_urls.length === 1) {
      const url = `${GRAPH}/${igId}/media`;
      const body = new URLSearchParams({
        image_url: image_urls[0],
        caption,
        access_token: igAccessToken,
      });
      const res = await fetch(url, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const json = await res.json();
      if (!res.ok || !json.id) return classifyFBError(json, "instagram");
      creationId = String(json.id);
    } else {
      // Carousel: create each child, then parent container.
      const childIds: string[] = [];
      for (const imgUrl of image_urls) {
        const url = `${GRAPH}/${igId}/media`;
        const body = new URLSearchParams({
          image_url: imgUrl,
          is_carousel_item: "true",
          access_token: igAccessToken,
        });
        const res = await fetch(url, {
          method: "POST",
          body,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        const json = await res.json();
        if (!res.ok || !json.id) return classifyFBError(json, "instagram");
        childIds.push(String(json.id));
      }
      const parentUrl = `${GRAPH}/${igId}/media`;
      const body = new URLSearchParams({
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
        access_token: igAccessToken,
      });
      const res = await fetch(parentUrl, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const json = await res.json();
      if (!res.ok || !json.id) return classifyFBError(json, "instagram");
      creationId = String(json.id);
    }

    // why: in test mode, stop here. The container exists on IG's side
    // (proves auth + image fetch + caption all worked end-to-end) but
    // is never made visible. Containers expire in 24h. Surface the
    // creation_id as platform_post_id so the row still has a paper trail.
    if (test_mode) {
      return {
        ok: true,
        platform: "instagram",
        platform_post_id: creationId,
        permalink: null,
      };
    }

    // Publish the container.
    const publishUrl = `${GRAPH}/${igId}/media_publish`;
    const body = new URLSearchParams({
      creation_id: creationId,
      access_token: igAccessToken,
    });
    const res = await fetch(publishUrl, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const json = await res.json();
    if (!res.ok || !json.id) return classifyFBError(json, "instagram");

    const mediaId = String(json.id);

    // Fetch the permalink (separate call, optional — failure not fatal).
    let permalink: string | null = null;
    try {
      const permRes = await fetch(
        `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(igAccessToken)}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      const permJson = await permRes.json();
      if (permRes.ok && typeof permJson.permalink === "string") {
        permalink = permJson.permalink;
      }
    } catch {
      // ignore
    }

    return {
      ok: true,
      platform: "instagram",
      platform_post_id: mediaId,
      permalink,
    };
  } catch (e) {
    return {
      ok: false,
      platform: "instagram",
      error: fetchErrorMessage(e),
    };
  }
}

/**
 * Inspect a Meta Graph error response and turn it into a clean PublishErr,
 * tagging scope-related failures so the UI can prompt re-auth.
 */
function classifyFBError(
  json: { error?: { message?: string; code?: number; error_subcode?: number; type?: string } },
  platform: "facebook" | "instagram",
): PublishErr {
  const msg = json?.error?.message ?? "Unknown Graph API error";
  const code = json?.error?.code;
  const sub = json?.error?.error_subcode;

  // why: Graph code 190 means the OAuth token itself is invalid or expired,
  // NOT a missing scope. Re-connecting is the fix, not re-scoping, so it
  // gets its own message. scope_error stays true so the UI still prompts
  // the user toward credentials.
  if (code === 190) {
    return {
      ok: false,
      platform,
      error: `Facebook token invalid or expired. Re-connect Facebook in Settings > Credentials. Graph said: ${msg}`,
      scope_error: true,
    };
  }

  // Common Graph error codes that mean "missing publishing scope":
  //   200 — Permission denied
  //   100 sub 33 — Param error from missing pages_manage_posts
  //   3 — Permission required (rare)
  const isScopeError =
    code === 200 ||
    (code === 100 && sub === 33) ||
    /permission|scope|not authorized|denied/i.test(msg);

  if (isScopeError) {
    return {
      ok: false,
      platform,
      error: `Missing publishing permission. Re-authorize the Meta app with ${
        platform === "facebook"
          ? "pages_manage_posts"
          : "instagram_content_publish"
      } scope. Graph said: ${msg}`,
      scope_error: true,
    };
  }
  return { ok: false, platform, error: msg };
}

/* ----------------------------------------------------------------------- *
 *  Meta token health — debug_token surface
 *
 *  Surfaces the real expires_at of the saved FB Page Access Token so the
 *  UI can warn before the token dies and so `schedulePostAction` can
 *  reject scheduled posts that would land past the expiry.
 *
 *  why: long-lived Page tokens inherit the underlying User token's expiry
 *  (60d for User long-lived, longer for system users). The hard-coded
 *  2026-08-08 deadline in memory is a starting point — debug_token tells
 *  us the actual expiry, which may be sooner if the underlying User
 *  token was rotated.
 *
 *  The endpoint is `/debug_token?input_token=<t>&access_token=<app|user|page>`.
 *  We pass the page token as BOTH input and access — Meta returns the
 *  expires_at field for this self-referential call (scopes may be
 *  truncated without an app token, but expires_at is what matters here).
 * ----------------------------------------------------------------------- */

export interface FBTokenStatus {
  /** True when debug_token returned valid data. */
  ok: boolean;
  /** Unix seconds. null when the token never expires (rare, system users). */
  expires_at_unix: number | null;
  /** ISO 8601 string. null when never expires. */
  expires_at_iso: string | null;
  /** Whole days until expiry. null when never expires; negative when expired. */
  days_until_expiry: number | null;
  /** True when Meta says the token is currently valid. */
  is_valid: boolean;
  /** Best-available app id (from debug_token data.app_id). */
  app_id: string | null;
  /** Error from debug_token or a transport-level failure. */
  error: string | null;
}

/**
 * Hit /debug_token with the saved Page Access Token. Returns FBTokenStatus
 * with the real expires_at and a derived days_until_expiry.
 *
 * Caller is expected to handle ok:false gracefully (e.g. fall back to the
 * known rotation deadline in memory) rather than blocking.
 */
export async function getFBTokenStatus(
  creds: MetaCredentials,
): Promise<FBTokenStatus> {
  const url =
    `${GRAPH}/debug_token` +
    `?input_token=${encodeURIComponent(creds.page_access_token)}` +
    `&access_token=${encodeURIComponent(creds.page_access_token)}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const json = (await res.json()) as {
      data?: {
        is_valid?: boolean;
        expires_at?: number;
        data_access_expires_at?: number;
        app_id?: string;
        scopes?: string[];
      };
      error?: { message?: string; code?: number };
    };

    if (!res.ok || json.error || !json.data) {
      return {
        ok: false,
        expires_at_unix: null,
        expires_at_iso: null,
        days_until_expiry: null,
        is_valid: false,
        app_id: null,
        error: json.error?.message ?? `HTTP ${res.status}`,
      };
    }

    const data = json.data;
    // why: expires_at 0 or missing means "never expires" for some long-lived
    // page / system-user tokens. Normalize to null so callers treat both
    // shapes identically.
    const expiresAtRaw =
      typeof data.expires_at === "number" && data.expires_at > 0
        ? data.expires_at
        : null;
    const nowSec = Math.floor(Date.now() / 1000);
    const days =
      expiresAtRaw != null ? Math.floor((expiresAtRaw - nowSec) / 86400) : null;

    return {
      ok: true,
      expires_at_unix: expiresAtRaw,
      expires_at_iso: expiresAtRaw
        ? new Date(expiresAtRaw * 1000).toISOString()
        : null,
      days_until_expiry: days,
      is_valid: data.is_valid === true,
      app_id: data.app_id ?? null,
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      expires_at_unix: null,
      expires_at_iso: null,
      days_until_expiry: null,
      is_valid: false,
      app_id: null,
      error: fetchErrorMessage(e),
    };
  }
}

/* ----------------------------------------------------------------------- *
 *  Reels / Video — Day 6 native video build
 *
 *  Two new publish surfaces:
 *
 *    publishReelToIG   — IG Reels (3-step: container → poll status → publish)
 *    publishVideoToFB  — FB Page video (single POST; publishes immediately)
 *
 *  Both pull from public HTTPS URLs (Supabase Storage in practice).
 *  Meta rejects http:// outright, so we validate up front.
 *
 *  TikTok video posting lives elsewhere (Day 7+) — publishToTikTok above
 *  is PHOTO-mode only. The orchestrator surfaces a clear "coming soon"
 *  for tiktok on Reel rows for now.
 * ----------------------------------------------------------------------- */

/** Shape of an IG container status response. */
interface IGContainerStatus {
  status_code?: string;
  error?: { message?: string; code?: number; error_subcode?: number };
}

/**
 * Publish an Instagram Reel via the Meta Graph API.
 *
 * Reels are a 3-step flow:
 *   1) POST /{ig-id}/media with media_type=REELS, video_url, cover_url,
 *      caption, share_to_feed=true  →  returns creation_id (the container)
 *   2) Poll GET /{creation_id}?fields=status_code every 2s until FINISHED
 *      (or ERROR / EXPIRED). Max ~120s — video transcode can be slow.
 *   3) POST /{ig-id}/media_publish with creation_id  →  returns media_id
 *
 * After publish, fetch the permalink (best-effort, never fatal).
 *
 * `share_to_feed=true`: per project memory, max distribution is the goal —
 * post to both the Reels tab AND the main feed grid. This is the default
 * users expect anyway; the only reason to skip the feed is if you want a
 * "vertical-only" account aesthetic, which doesn't apply here.
 *
 * why: video_url must be HTTPS — Meta returns a 400 for http:// URLs and
 * we'd rather catch it client-side with a clean error than wait for the
 * Graph round-trip.
 */
export async function publishReelToIG(args: {
  creds: MetaCredentials;
  video_url: string;
  cover_url: string;
  caption: string;
  /**
   * When true, build the Reels container and poll status to confirm the
   * transcode succeeded, but DON'T call /media_publish. Container exists
   * on Meta's side but never appears in the feed or Reels tab.
   */
  test_mode?: boolean;
}): Promise<PublishResult> {
  const { creds, video_url, cover_url, caption, test_mode } = args;

  if (!creds.ig_business_account_id) {
    return {
      ok: false,
      platform: "instagram",
      error: "Instagram Business account not configured in api_credentials",
    };
  }
  // why: Meta strictly requires https for media URLs — fail fast with a
  // clear message instead of waiting for the Graph error.
  if (!video_url.startsWith("https://")) {
    return {
      ok: false,
      platform: "instagram",
      error: `Reel video_url must be https:// (got ${video_url.slice(0, 32)}...). Meta rejects plain http URLs.`,
    };
  }
  if (cover_url && !cover_url.startsWith("https://")) {
    return {
      ok: false,
      platform: "instagram",
      error: `Reel cover_url must be https:// (got ${cover_url.slice(0, 32)}...). Meta rejects plain http URLs.`,
    };
  }

  const igId = creds.ig_business_account_id;
  // why: IG Reel publishing uses the IG-capable token (instagram_basic +
  // instagram_content_publish), same pattern as publishToIG.
  const igAccessToken = creds.ig_page_access_token;

  try {
    // 1) Create the Reels container.
    const containerUrl = `${GRAPH}/${igId}/media`;
    const containerBody = new URLSearchParams({
      media_type: "REELS",
      video_url,
      cover_url,
      caption,
      // why: share_to_feed=true posts to both Reels tab AND main feed for
      // max reach — aligns with project priority on views/exposure.
      share_to_feed: "true",
      access_token: igAccessToken,
    });
    const containerRes = await fetch(containerUrl, {
      method: "POST",
      body: containerBody,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const containerJson = (await containerRes.json()) as {
      id?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (!containerRes.ok || !containerJson.id) {
      return classifyFBError(containerJson, "instagram");
    }
    const creationId = String(containerJson.id);

    // 2) Poll status until FINISHED (or ERROR/EXPIRED).
    // why: 2s interval × 60 iterations = 120s max. Reel transcode for
    // a 9:16 30s clip typically lands in 10–30s; we want headroom for
    // longer clips without holding the route forever (route maxDuration
    // is 60s — caller should treat a 60s+ wait as a timeout).
    const POLL_INTERVAL_MS = 2_000;
    const MAX_POLLS = 60;
    let status = "IN_PROGRESS";
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const statusRes = await fetch(
        `${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(igAccessToken)}`,
        { signal: AbortSignal.timeout(POLL_FETCH_TIMEOUT_MS) },
      );
      const statusJson = (await statusRes.json()) as IGContainerStatus;
      if (!statusRes.ok && statusJson.error) {
        return classifyFBError(statusJson, "instagram");
      }
      status = statusJson.status_code ?? "IN_PROGRESS";
      if (status === "FINISHED" || status === "PUBLISHED") break;
      if (status === "ERROR" || status === "EXPIRED") {
        return {
          ok: false,
          platform: "instagram",
          error: `IG Reels container ${status} during processing. The video may be too long, wrong codec, or the URL became unreachable.`,
        };
      }
    }
    if (status !== "FINISHED" && status !== "PUBLISHED") {
      return {
        ok: false,
        platform: "instagram",
        error: `IG Reels container did not finish in ${(POLL_INTERVAL_MS * MAX_POLLS) / 1000}s (last status: ${status}). Try again — Meta may still be transcoding.`,
      };
    }

    // why: in test mode, the container is built + transcoded but never
    // published. Surface the creation_id as platform_post_id; container
    // expires in 24h if not published.
    if (test_mode) {
      return {
        ok: true,
        platform: "instagram",
        platform_post_id: creationId,
        permalink: null,
      };
    }

    // 3) Publish the container.
    const publishUrl = `${GRAPH}/${igId}/media_publish`;
    const publishBody = new URLSearchParams({
      creation_id: creationId,
      access_token: igAccessToken,
    });
    const publishRes = await fetch(publishUrl, {
      method: "POST",
      body: publishBody,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const publishJson = (await publishRes.json()) as {
      id?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (!publishRes.ok || !publishJson.id) {
      return classifyFBError(publishJson, "instagram");
    }
    const mediaId = String(publishJson.id);

    // Fetch the permalink (best-effort, failure is not fatal).
    let permalink: string | null = null;
    try {
      const permRes = await fetch(
        `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(igAccessToken)}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      const permJson = (await permRes.json()) as { permalink?: string };
      if (permRes.ok && typeof permJson.permalink === "string") {
        permalink = permJson.permalink;
      }
    } catch {
      // ignore — permalink is a nice-to-have
    }

    return {
      ok: true,
      platform: "instagram",
      platform_post_id: mediaId,
      permalink,
    };
  } catch (e) {
    return {
      ok: false,
      platform: "instagram",
      error: fetchErrorMessage(e),
    };
  }
}

/**
 * Publish a video to a Facebook Page.
 *
 * Unlike IG Reels, FB Page videos publish immediately on a single POST —
 * no container/poll/publish handshake. The endpoint accepts `file_url`
 * for the source MP4 and `description` for the caption text.
 *
 * Permalink format is well-known and constructable from page_id + video_id,
 * so we don't need a follow-up Graph call to fetch it.
 *
 * why: video_url must be HTTPS (same Meta restriction as Reels).
 */
export async function publishVideoToFB(args: {
  creds: MetaCredentials;
  video_url: string;
  caption: string;
  /**
   * When true, attach `unpublished_content_type=DRAFT` so the video lands
   * in the Page's Video Library as a draft instead of publishing live.
   * Admins can review in Page Manager → Content → Videos → Drafts.
   */
  test_mode?: boolean;
}): Promise<PublishResult> {
  const { creds, video_url, caption, test_mode } = args;

  if (!video_url.startsWith("https://")) {
    return {
      ok: false,
      platform: "facebook",
      error: `FB video_url must be https:// (got ${video_url.slice(0, 32)}...). Meta rejects plain http URLs.`,
    };
  }

  try {
    const url = `${GRAPH}/${creds.page_id}/videos`;
    const params: Record<string, string> = {
      file_url: video_url,
      description: caption,
      access_token: creds.page_access_token,
    };
    if (test_mode) params.unpublished_content_type = "DRAFT";
    const body = new URLSearchParams(params);
    const res = await fetch(url, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const json = (await res.json()) as {
      id?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (!res.ok || !json.id) {
      return classifyFBError(json, "facebook");
    }
    const videoId = String(json.id);
    // why: FB doesn't surface a /post_id for video uploads the same way it
    // does for /photos. The canonical public URL is /{page_id}/videos/{id}
    // and is what shows in the Page's video tab — that's the right link
    // for the user to share / verify the post.
    return {
      ok: true,
      platform: "facebook",
      platform_post_id: videoId,
      // why: drafts aren't publicly addressable; surface Page Manager
      // instead so the user can find the video in the Drafts list.
      permalink: test_mode
        ? `https://www.facebook.com/business/help/page-manager`
        : `https://www.facebook.com/${creds.page_id}/videos/${videoId}`,
    };
  } catch (e) {
    return {
      ok: false,
      platform: "facebook",
      error: fetchErrorMessage(e),
    };
  }
}

/* ----------------------------------------------------------------------- *
 *  TikTok — Phase 6 publish parity
 *
 *  Uses Content Posting API → Direct Post (PHOTO mode, PULL_FROM_URL).
 *  Photo posts publish immediately to the user's feed; nothing manual.
 *
 *  Requirements:
 *    - api_credentials.tiktok.access_token must carry the `video.publish`
 *      (or photo.publish equivalent) scope. The tt-sync scope alone is NOT
 *      enough — re-auth may be required if the saved row predates Phase 6.
 *    - The image URL host must be on TikTok's "verified domains" list in
 *      the developer console for PULL_FROM_URL to succeed.
 *
 *  Failure modes surface with `scope_error: true` when the access token is
 *  obviously missing the publishing scope, so the UI can prompt re-auth
 *  without dumping a wall of TikTok JSON.
 * ----------------------------------------------------------------------- */

const TT_API = "https://open.tiktokapis.com";

// TikTok captions cap at 2,200 chars. We trim defensively to leave some
// room for hashtags / inline @mentions that Studio may have appended.
const TT_CAPTION_MAX = 2000;

interface TtPublishInitResponse {
  data?: { publish_id?: string };
  error?: { code?: string; message?: string };
}

interface TtPublishStatusResponse {
  data?: {
    status?: string;
    publicaly_available_post_id?: string[];
    fail_reason?: string;
  };
  error?: { code?: string; message?: string };
}

/**
 * Detect TikTok auth/expired-token failures. The Content Posting API can
 * surface them either as HTTP 401 or as a structured error code in the
 * JSON body — cover both shapes so we don't miss a stale-token retry
 * opportunity. Scope failures route to `classifyTikTokError` instead so
 * the user sees a clean "re-authorize" message.
 *
 * why: TikTok's access tokens expire every 24h. The tt-sync edge function
 * refreshes daily, but a publish that fires within the refresh window will
 * occasionally see a freshly-stale token. This guard lets us retry once
 * with a refreshed token before bubbling the failure up to Larissa.
 */
function isTikTokAuthError(
  status: number,
  code: string | undefined,
  message: string,
): boolean {
  if (status === 401) return true;
  const c = (code ?? "").toLowerCase();
  if (c === "access_token_invalid" || c === "unauthorized") return true;
  if (c === "invalid_request" && /token/i.test(message)) return true;
  return /access[\s_]?token/i.test(message) && /expired|invalid/i.test(message);
}

/**
 * Refresh the TikTok access_token using the stored refresh_token.
 *
 * Persists the new access_token + rotated refresh_token to api_credentials
 * (TikTok rotates the refresh_token on every refresh and bumps it back to
 * 365d). Returns the new access_token on success or null on failure — the
 * caller surfaces the original error message when refresh fails.
 *
 * why: the in-place mutation of `creds.access_token` lets the caller's
 * poll loop reuse the refreshed token without re-loading from Supabase.
 * The DB write is best-effort: if it fails, the in-memory creds are still
 * usable for this request but the next request will get the old token —
 * tt-sync will eventually re-refresh and self-heal.
 */
async function refreshTikTokToken(
  creds: TikTokCredentials,
): Promise<string | null> {
  if (!creds.refresh_token || !creds.client_key || !creds.client_secret) {
    console.warn(
      "[publishTikTok] refresh-on-401 skipped: missing refresh_token / client_key / client_secret on credential row",
    );
    return null;
  }
  // why: optimistic-lock anchor. We only persist our rotation if the stored
  // access token still equals this value (see the .eq guard below).
  const refreshedFromToken = creds.access_token;
  try {
    const res = await fetch(`${TT_API}/v2/oauth/token/`, {
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: creds.client_key,
        client_secret: creds.client_secret,
        grant_type: "refresh_token",
        refresh_token: creds.refresh_token,
      }),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      console.error(
        "[publishTikTok] token refresh failed:",
        json.error ?? `HTTP ${res.status}`,
        json.error_description ?? "",
      );
      return null;
    }

    // Persist rotated tokens. We preserve the rest of the credentials
    // JSONB shape (open_id, client_key, client_secret) and only swap the
    // token fields + expiry bookkeeping.
    const supabase = createAdminClient();
    const nextCreds = {
      access_token: json.access_token,
      open_id: creds.open_id,
      refresh_token: json.refresh_token ?? creds.refresh_token,
      client_key: creds.client_key,
      client_secret: creds.client_secret,
      expires_at: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : null,
      // why: tt-sync's proactive expiry check reads obtained_at + expires_in
      // (not expires_at). Write BOTH shapes so either refresher's bookkeeping
      // stays correct no matter which one rotated last.
      obtained_at: new Date().toISOString(),
      expires_in: json.expires_in ?? null,
      refresh_expires_in: json.refresh_expires_in ?? null,
    };
    // why: optimistic guard against the tt-sync refresher racing us. TikTok
    // invalidates the OLD refresh token on rotation, so blindly overwriting
    // a newer rotation would persist a dead refresh token. Only update the
    // row if the stored access token is still the one we refreshed FROM.
    const { data: updatedRows, error: upErr } = await supabase
      .from("api_credentials")
      .update({
        credentials: nextCreds,
        updated_at: new Date().toISOString(),
      })
      .eq("platform", "tiktok")
      .eq("is_active", true)
      .eq("credentials->>access_token", refreshedFromToken)
      .select("id");
    if (upErr) {
      console.error(
        "[publishTikTok] credential update failed (in-memory token still usable):",
        upErr.message,
      );
    } else if (!updatedRows || updatedRows.length === 0) {
      // why: zero rows matched means another refresher already rotated the
      // row. Their tokens are the live chain; use those instead of ours.
      console.warn(
        "[publishTikTok] token row rotated concurrently; re-reading credentials",
      );
      const { data: fresh } = await supabase
        .from("api_credentials")
        .select("credentials")
        .eq("platform", "tiktok")
        .eq("is_active", true)
        .maybeSingle();
      const freshCreds = (fresh?.credentials ?? {}) as {
        access_token?: string;
        refresh_token?: string;
      };
      if (freshCreds.access_token) {
        creds.access_token = String(freshCreds.access_token);
        if (freshCreds.refresh_token) {
          creds.refresh_token = String(freshCreds.refresh_token);
        }
        return creds.access_token;
      }
    }

    // Mutate in place so the caller's poll loop sees the new token.
    creds.access_token = json.access_token;
    if (json.refresh_token) creds.refresh_token = json.refresh_token;
    return json.access_token;
  } catch (e) {
    console.error("[publishTikTok] token refresh threw:", e);
    return null;
  }
}

/**
 * Wrap a TikTok publish-init POST with one refresh-on-401 retry.
 *
 * Used by both `publishToTikTok` (photo) and `publishVideoToTikTok` (video)
 * — the only thing that differs between them is the endpoint and the body
 * shape, so we keep this generic.
 *
 * Returns the final {res, json} pair. On auth failure WITH no successful
 * refresh, the returned json carries the original error so the caller's
 * `classifyTikTokError` path surfaces the right message to the UI.
 */
async function tryTikTokInitWithRefresh(
  initUrl: string,
  initBody: unknown,
  creds: TikTokCredentials,
): Promise<{ res: Response; json: TtPublishInitResponse }> {
  let lastRes: Response | undefined;
  let lastJson: TtPublishInitResponse = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(initUrl, {
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(initBody),
    });
    let json: TtPublishInitResponse;
    try {
      json = (await res.json()) as TtPublishInitResponse;
    } catch {
      // Non-JSON response — surface synthetically so the caller's normal
      // error path handles it without a try/catch ladder.
      json = {
        error: { code: "non_json", message: `TikTok returned non-JSON (HTTP ${res.status})` },
      };
    }
    lastRes = res;
    lastJson = json;

    const errCode = json.error?.code;
    const failed = !res.ok || (errCode != null && errCode !== "ok");
    if (!failed) return { res, json };

    // Only retry on the first attempt, and only for auth-shaped errors.
    if (
      attempt === 0 &&
      isTikTokAuthError(res.status, errCode, json.error?.message ?? "")
    ) {
      const refreshed = await refreshTikTokToken(creds);
      if (refreshed) continue;
    }
    return { res, json };
  }
  // Unreachable — the loop returns or continues. Belt-and-suspenders for TS.
  return { res: lastRes as Response, json: lastJson };
}

export async function publishToTikTok(args: {
  creds: TikTokCredentials;
  image_urls: string[];
  caption: string;
  /**
   * When true, swap `post_mode: DIRECT_POST` → `post_mode: MEDIA_UPLOAD`.
   * The content uploads to the account's TikTok app drafts inbox (visible
   * via the "+" tab in the mobile app) instead of going live. User must
   * manually publish from the app to make it public.
   */
  test_mode?: boolean;
}): Promise<PublishResult> {
  const { creds, image_urls, caption, test_mode } = args;

  if (image_urls.length === 0) {
    return { ok: false, platform: "tiktok", error: "no images provided" };
  }
  // TikTok photo carousels cap at 35 images; we typically post 1.
  const photoImages = image_urls.slice(0, 35);

  const title = (caption ?? "").trim().slice(0, TT_CAPTION_MAX);

  // 1) Init the post. PHOTO mode with PULL_FROM_URL avoids the multi-step
  // UPLOAD/PUT flow and lets TikTok fetch the image directly.
  // why: tryTikTokInitWithRefresh wraps the init POST with a single
  // refresh-on-401 retry. If the saved access_token is stale (24h expiry
  // + a publish that lands mid-refresh window), we silently swap in a new
  // token using the stored refresh_token before bubbling the failure up.
  const { res: initRes, json: initJson } = await tryTikTokInitWithRefresh(
    `${TT_API}/v2/post/publish/content/init/`,
    {
      post_info: {
        title,
        // PUBLIC_TO_EVERYONE requires the creator's privacy settings to
        // allow it. If the creator's account is private the API will
        // reject with a clear error — caller can surface to user.
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_comment: false,
        // Photo-mode-only flags (TikTok ignores duet/stitch for photos
        // but accepts them in the body).
        auto_add_music: true,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: photoImages,
      },
      // why: test_mode → MEDIA_UPLOAD lands the content in the app drafts
      // inbox. The creator must manually publish from the TikTok app to
      // make it public. DIRECT_POST is the live path.
      post_mode: test_mode ? "MEDIA_UPLOAD" : "DIRECT_POST",
      media_type: "PHOTO",
    },
    creds,
  );

  const initErrCode = initJson.error?.code;
  if (!initRes.ok || (initErrCode && initErrCode !== "ok")) {
    return classifyTikTokError(
      initJson.error?.message ?? `HTTP ${initRes.status}`,
      initErrCode,
    );
  }

  const publishId = initJson.data?.publish_id;
  if (!publishId) {
    return {
      ok: false,
      platform: "tiktok",
      error: "TikTok init succeeded but returned no publish_id.",
    };
  }

  // 2) Poll status. PHOTO PULL_FROM_URL is usually fast (under 10s) but
  // we give it up to ~25s before reporting back. The publish row already
  // exists by then; the post arrives shortly after even if we time out.
  const deadline = Date.now() + 25_000;
  let lastStatus: string | undefined;
  let publicPostId: string | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    let statusJson: TtPublishStatusResponse | null = null;
    try {
      // why: 15s timeout per poll request; the loop deadline bounds the
      // total wait. A timed-out or non-JSON poll is transient, so retry on
      // the next iteration instead of failing the publish.
      const statusRes = await fetch(
        `${TT_API}/v2/post/publish/status/fetch/`,
        {
          method: "POST",
          signal: AbortSignal.timeout(POLL_FETCH_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${creds.access_token}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({ publish_id: publishId }),
        },
      );
      statusJson = (await statusRes.json()) as TtPublishStatusResponse;
    } catch {
      // Transient — retry on the next loop iteration.
      continue;
    }
    if (
      statusJson?.error?.code &&
      statusJson.error.code !== "ok"
    ) {
      return classifyTikTokError(
        statusJson.error.message ?? "TikTok status error",
        statusJson.error.code,
      );
    }
    lastStatus = statusJson?.data?.status;
    // why: DIRECT_POST finishes at PUBLISH_COMPLETE; MEDIA_UPLOAD finishes
    // at SEND_TO_USER_INBOX (the content is in the user's app drafts).
    // Both are success terminal states.
    if (
      lastStatus === "PUBLISH_COMPLETE" ||
      lastStatus === "SEND_TO_USER_INBOX"
    ) {
      publicPostId =
        statusJson?.data?.publicaly_available_post_id?.[0];
      break;
    }
    if (lastStatus === "FAILED") {
      return {
        ok: false,
        platform: "tiktok",
        error:
          statusJson?.data?.fail_reason ?? "TikTok reported publish failure",
      };
    }
  }

  // Even if we time out polling, TikTok has accepted the publish — surface
  // the publish_id so we have a paper trail. The post lands shortly after.
  return {
    ok: true,
    platform: "tiktok",
    platform_post_id: publicPostId ?? publishId,
    // why: in MEDIA_UPLOAD mode no public URL exists yet (creator must
    // publish from the TikTok app). publicPostId is also absent. Null
    // permalink signals "look in TikTok app drafts" — the UI handles it.
    permalink: publicPostId
      ? `https://www.tiktok.com/@/photo/${publicPostId}`
      : null,
  };
}

function classifyTikTokError(
  message: string,
  code: string | undefined,
): PublishErr {
  const lc = `${code ?? ""} ${message}`.toLowerCase();
  // Scope errors — Larissa needs to re-auth with publishing scope. The
  // exact code TikTok returns varies; cover the common shapes.
  if (
    lc.includes("scope") ||
    lc.includes("permission") ||
    lc.includes("unauthorized")
  ) {
    return {
      ok: false,
      platform: "tiktok",
      error: `Missing publishing permission on the TikTok app. Re-authorize with the video.publish scope. TikTok said: ${message}`,
      scope_error: true,
    };
  }
  // Domain-verification errors are common when the image URL host isn't on
  // the developer console's allowlist. Surface a friendlier message.
  if (lc.includes("url_ownership") || lc.includes("verified_domain")) {
    return {
      ok: false,
      platform: "tiktok",
      error: `TikTok requires the image host to be a verified domain on your TikTok developer app. Add the Supabase Storage host to the verified domains list, then retry. TikTok said: ${message}`,
    };
  }
  return {
    ok: false,
    platform: "tiktok",
    error: `TikTok publish failed: ${message}`,
  };
}

/* ----------------------------------------------------------------------- *
 *  TikTok — VIDEO publishing (Reel parity)
 *
 *  Mirrors publishToTikTok's flow but targets the video init endpoint:
 *
 *    POST /v2/post/publish/video/init/
 *      media_type: "VIDEO"  (implicit on this endpoint, but explicit here)
 *      post_mode:  "DIRECT_POST"
 *      source_info.source: "PULL_FROM_URL"
 *      source_info.video_url: <https-only mp4 URL>
 *
 *  Same poll endpoint, longer deadline (TikTok transcodes vertical video
 *  for the For You feed before "PUBLISH_COMPLETE" lands — typically 20-45s
 *  but we give it ~60s before reporting back).
 *
 *  Same gotchas as the photo path:
 *    - PULL_FROM_URL requires the video host to be on the verified-domains
 *      list in the TikTok developer console (see classifyTikTokError for
 *      the user-friendly message).
 *    - The access_token must carry `video.publish`. Re-auth flow if missing.
 *
 *  Refresh-on-401: tryTikTokInitWithRefresh handles the init retry. If a
 *  long video transcode times out the polling phase, the publish_id is
 *  returned so callers have a paper trail (the post lands shortly after).
 * ----------------------------------------------------------------------- */

export async function publishVideoToTikTok(args: {
  creds: TikTokCredentials;
  video_url: string;
  caption: string;
  /**
   * When true, swap `post_mode: DIRECT_POST` → `post_mode: MEDIA_UPLOAD`.
   * Video lands in the account's TikTok app drafts inbox. Status reaches
   * SEND_TO_USER_INBOX instead of PUBLISH_COMPLETE.
   */
  test_mode?: boolean;
}): Promise<PublishResult> {
  const { creds, video_url, caption, test_mode } = args;

  // why: same HTTPS guard as Meta video — TikTok rejects plain http URLs
  // for PULL_FROM_URL and we'd rather fail fast with a clear message than
  // wait for the API round-trip.
  if (!video_url.startsWith("https://")) {
    return {
      ok: false,
      platform: "tiktok",
      error: `TikTok video_url must be https:// (got ${video_url.slice(0, 32)}...). TikTok rejects plain http URLs.`,
    };
  }

  const title = (caption ?? "").trim().slice(0, TT_CAPTION_MAX);

  // 1) Init the video post.
  //
  // why: test mode uses a different endpoint AND a different body shape.
  // The direct-post endpoint accepts post_info (privacy, interaction
  // flags, cover timestamp); the inbox endpoint is source_info only,
  // because the creator sets all of that themselves in the TikTok app
  // before publishing the draft.
  //
  //   Live: POST /v2/post/publish/video/init/   (direct, publishes immediately)
  //   Test: POST /v2/post/publish/inbox/video/init/ (lands in app inbox)
  const initEndpoint = test_mode
    ? `${TT_API}/v2/post/publish/inbox/video/init/`
    : `${TT_API}/v2/post/publish/video/init/`;
  const initBody = test_mode
    ? {
        source_info: {
          source: "PULL_FROM_URL",
          video_url,
        },
      }
    : {
        post_info: {
          title,
          // Same privacy + interaction defaults as the photo path. The
          // duet/stitch flags actually matter for video (unlike photo
          // where TikTok ignores them).
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          // why: 1s offset gives TikTok a usable poster frame even on
          // videos that open on a black/intro frame. 1000ms is within
          // every Reel template we ship (all > 5s).
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url,
        },
      };
  const { res: initRes, json: initJson } = await tryTikTokInitWithRefresh(
    initEndpoint,
    initBody,
    creds,
  );

  const initErrCode = initJson.error?.code;
  if (!initRes.ok || (initErrCode && initErrCode !== "ok")) {
    return classifyTikTokError(
      initJson.error?.message ?? `HTTP ${initRes.status}`,
      initErrCode,
    );
  }

  const publishId = initJson.data?.publish_id;
  if (!publishId) {
    return {
      ok: false,
      platform: "tiktok",
      error: "TikTok video init succeeded but returned no publish_id.",
    };
  }

  // 2) Poll status. Video transcodes are slower than photos — give it ~60s
  // before reporting back. The publish row already exists by then; even on
  // timeout the post usually lands shortly after.
  const deadline = Date.now() + 60_000;
  let lastStatus: string | undefined;
  let publicPostId: string | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    let statusJson: TtPublishStatusResponse | null = null;
    try {
      // why: 15s timeout per poll request; the loop deadline bounds the
      // total wait. A timed-out or non-JSON poll is transient, so retry on
      // the next iteration instead of failing the publish.
      const statusRes = await fetch(`${TT_API}/v2/post/publish/status/fetch/`, {
        method: "POST",
        signal: AbortSignal.timeout(POLL_FETCH_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
      statusJson = (await statusRes.json()) as TtPublishStatusResponse;
    } catch {
      // Transient — retry on the next loop iteration.
      continue;
    }
    if (statusJson?.error?.code && statusJson.error.code !== "ok") {
      return classifyTikTokError(
        statusJson.error.message ?? "TikTok status error",
        statusJson.error.code,
      );
    }
    lastStatus = statusJson?.data?.status;
    // why: DIRECT_POST finishes at PUBLISH_COMPLETE; inbox upload finishes
    // at SEND_TO_USER_INBOX (the video is in the user's app drafts).
    // Both are success terminal states.
    if (
      lastStatus === "PUBLISH_COMPLETE" ||
      lastStatus === "SEND_TO_USER_INBOX"
    ) {
      publicPostId = statusJson?.data?.publicaly_available_post_id?.[0];
      break;
    }
    if (lastStatus === "FAILED") {
      return {
        ok: false,
        platform: "tiktok",
        error:
          statusJson?.data?.fail_reason ??
          "TikTok reported video publish failure",
      };
    }
  }

  // Even if we time out polling, TikTok has accepted the publish — surface
  // the publish_id as a paper trail. The post lands shortly after.
  return {
    ok: true,
    platform: "tiktok",
    platform_post_id: publicPostId ?? publishId,
    permalink: publicPostId
      ? `https://www.tiktok.com/@/video/${publicPostId}`
      : null,
  };
}
