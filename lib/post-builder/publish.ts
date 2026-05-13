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

export interface PublishOk {
  ok: true;
  platform: "facebook" | "instagram";
  platform_post_id: string;
  permalink: string | null;
}

export interface PublishErr {
  ok: false;
  platform: "facebook" | "instagram";
  error: string;
  /** True when the error signals a missing publishing scope (re-auth needed). */
  scope_error?: boolean;
}

export type PublishResult = PublishOk | PublishErr;

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
