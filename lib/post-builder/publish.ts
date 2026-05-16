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

export interface MetaCredentials {
  page_id: string;
  page_access_token: string;
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
  /** Refresh token + client_key kept on the row for refresh-on-401 fallback. */
  refresh_token: string | null;
  client_key: string | null;
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

  const igCreds = (ig?.credentials ?? {}) as { ig_business_account_id?: string };

  return {
    page_id: String(fbCreds.page_id),
    page_access_token: String(fbCreds.page_access_token),
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
  };
  if (!creds.access_token || !creds.open_id) return null;

  return {
    access_token: String(creds.access_token),
    open_id: String(creds.open_id),
    refresh_token: creds.refresh_token ? String(creds.refresh_token) : null,
    client_key: creds.client_key ? String(creds.client_key) : null,
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
}): Promise<PublishResult> {
  const { creds, image_urls, caption } = args;

  if (image_urls.length === 0) {
    return { ok: false, platform: "facebook", error: "no images provided" };
  }

  try {
    if (image_urls.length === 1) {
      // Single photo path.
      const url = `${GRAPH}/${creds.page_id}/photos`;
      const body = new URLSearchParams({
        url: image_urls[0],
        message: caption,
        access_token: creds.page_access_token,
      });
      const res = await fetch(url, { method: "POST", body });
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
        permalink: `https://www.facebook.com/${postId}`,
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
      const res = await fetch(uploadUrl, { method: "POST", body });
      const json = await res.json();
      if (!res.ok || !json.id) {
        return classifyFBError(json, "facebook");
      }
      mediaIds.push(String(json.id));
    }

    // Publish the gallery post via /feed with attached_media.
    const feedUrl = `${GRAPH}/${creds.page_id}/feed`;
    const attached = mediaIds.map((id) => ({ media_fbid: id }));
    const body = new URLSearchParams({
      message: caption,
      attached_media: JSON.stringify(attached),
      access_token: creds.page_access_token,
    });
    const res = await fetch(feedUrl, { method: "POST", body });
    const json = await res.json();
    if (!res.ok || !json.id) {
      return classifyFBError(json, "facebook");
    }
    return {
      ok: true,
      platform: "facebook",
      platform_post_id: String(json.id),
      permalink: `https://www.facebook.com/${json.id}`,
    };
  } catch (e) {
    return {
      ok: false,
      platform: "facebook",
      error: e instanceof Error ? e.message : String(e),
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
}): Promise<PublishResult> {
  const { creds, image_urls, caption } = args;

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
  try {
    let creationId: string;

    if (image_urls.length === 1) {
      const url = `${GRAPH}/${igId}/media`;
      const body = new URLSearchParams({
        image_url: image_urls[0],
        caption,
        access_token: creds.page_access_token,
      });
      const res = await fetch(url, { method: "POST", body });
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
          access_token: creds.page_access_token,
        });
        const res = await fetch(url, { method: "POST", body });
        const json = await res.json();
        if (!res.ok || !json.id) return classifyFBError(json, "instagram");
        childIds.push(String(json.id));
      }
      const parentUrl = `${GRAPH}/${igId}/media`;
      const body = new URLSearchParams({
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
        access_token: creds.page_access_token,
      });
      const res = await fetch(parentUrl, { method: "POST", body });
      const json = await res.json();
      if (!res.ok || !json.id) return classifyFBError(json, "instagram");
      creationId = String(json.id);
    }

    // Publish the container.
    const publishUrl = `${GRAPH}/${igId}/media_publish`;
    const body = new URLSearchParams({
      creation_id: creationId,
      access_token: creds.page_access_token,
    });
    const res = await fetch(publishUrl, { method: "POST", body });
    const json = await res.json();
    if (!res.ok || !json.id) return classifyFBError(json, "instagram");

    const mediaId = String(json.id);

    // Fetch the permalink (separate call, optional — failure not fatal).
    let permalink: string | null = null;
    try {
      const permRes = await fetch(
        `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(creds.page_access_token)}`,
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
      error: e instanceof Error ? e.message : String(e),
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

  // Common Graph error codes that mean "missing publishing scope":
  //   200 — Permission denied
  //   190 — Invalid OAuth token (often when scope wasn't granted)
  //   100 sub 33 — Param error from missing pages_manage_posts
  //   3 — Permission required (rare)
  const isScopeError =
    code === 200 ||
    code === 190 ||
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
}): Promise<PublishResult> {
  const { creds, video_url, cover_url, caption } = args;

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
      access_token: creds.page_access_token,
    });
    const containerRes = await fetch(containerUrl, {
      method: "POST",
      body: containerBody,
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
        `${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(creds.page_access_token)}`,
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

    // 3) Publish the container.
    const publishUrl = `${GRAPH}/${igId}/media_publish`;
    const publishBody = new URLSearchParams({
      creation_id: creationId,
      access_token: creds.page_access_token,
    });
    const publishRes = await fetch(publishUrl, {
      method: "POST",
      body: publishBody,
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
        `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(creds.page_access_token)}`,
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
      error: e instanceof Error ? e.message : String(e),
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
}): Promise<PublishResult> {
  const { creds, video_url, caption } = args;

  if (!video_url.startsWith("https://")) {
    return {
      ok: false,
      platform: "facebook",
      error: `FB video_url must be https:// (got ${video_url.slice(0, 32)}...). Meta rejects plain http URLs.`,
    };
  }

  try {
    const url = `${GRAPH}/${creds.page_id}/videos`;
    const body = new URLSearchParams({
      file_url: video_url,
      description: caption,
      access_token: creds.page_access_token,
    });
    const res = await fetch(url, { method: "POST", body });
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
      permalink: `https://www.facebook.com/${creds.page_id}/videos/${videoId}`,
    };
  } catch (e) {
    return {
      ok: false,
      platform: "facebook",
      error: e instanceof Error ? e.message : String(e),
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

export async function publishToTikTok(args: {
  creds: TikTokCredentials;
  image_urls: string[];
  caption: string;
}): Promise<PublishResult> {
  const { creds, image_urls, caption } = args;

  if (image_urls.length === 0) {
    return { ok: false, platform: "tiktok", error: "no images provided" };
  }
  // TikTok photo carousels cap at 35 images; we typically post 1.
  const photoImages = image_urls.slice(0, 35);

  const title = (caption ?? "").trim().slice(0, TT_CAPTION_MAX);

  // 1) Init the post. PHOTO mode with PULL_FROM_URL avoids the multi-step
  // UPLOAD/PUT flow and lets TikTok fetch the image directly.
  const initRes = await fetch(
    `${TT_API}/v2/post/publish/content/init/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
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
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      }),
    },
  );

  let initJson: TtPublishInitResponse;
  try {
    initJson = (await initRes.json()) as TtPublishInitResponse;
  } catch {
    return {
      ok: false,
      platform: "tiktok",
      error: `TikTok init returned non-JSON (status ${initRes.status})`,
    };
  }

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
    const statusRes = await fetch(
      `${TT_API}/v2/post/publish/status/fetch/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      },
    );
    let statusJson: TtPublishStatusResponse | null = null;
    try {
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
    if (lastStatus === "PUBLISH_COMPLETE") {
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
