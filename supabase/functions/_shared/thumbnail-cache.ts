/**
 * Thumbnail caching helper for Edge Function sync runs.
 *
 * Problem: IG/TT/FB return thumbnail URLs as time-limited signed CDN links.
 * They rotate every few hours/days, breaking previously-stored URLs in our
 * posts.thumbnail_url column.
 *
 * Fix: download the image once at sync time, upload it to the public
 * `post-thumbnails` Supabase Storage bucket, and store the durable Storage
 * public URL instead. Callers fall back to the original source URL when
 * caching fails — never block a sync on a storage hiccup.
 *
 * Runtime: Deno (Supabase Edge Function).
 * Mirror module for Node/Next.js server actions lives at
 * `lib/storage/thumbnail-cache.ts`.
 */
// @ts-expect-error - Deno-resolved import; runs in the Edge Function runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type CachePlatform = "facebook" | "instagram" | "tiktok";

export interface CacheThumbnailArgs {
  supabaseUrl: string;
  serviceRoleKey: string;
  sourceUrl: string;
  platform: CachePlatform;
  /** platform_post_id from the post (used in the object path) */
  postId: string;
  /**
   * Optional suffix appended to the object path before the extension. Used
   * to cache `media_url` alongside `thumbnail_url` without colliding.
   * Example: pathSuffix = "-media" → `{platform}/{postId}-media.jpg`.
   */
  pathSuffix?: string;
}

export interface CacheThumbnailResult {
  /** Durable Supabase Storage public URL on success; null on any failure. */
  cachedUrl: string | null;
  /** ISO timestamp of upload completion; null on failure. */
  cachedAt: string | null;
}

const BUCKET = "post-thumbnails";
const FETCH_TIMEOUT_MS = 10_000;

function extensionForContentType(ct: string | null | undefined): string {
  if (!ct) return "jpg";
  const lower = ct.toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("gif")) return "gif";
  // jpg/jpeg, or anything else weird — default to .jpg (Supabase bucket
  // mime-list still permits the actual content-type on upload).
  return "jpg";
}

function normalizedContentType(ct: string | null | undefined): string {
  if (!ct) return "image/jpeg";
  const lower = ct.toLowerCase().split(";")[0].trim();
  if (
    lower === "image/jpeg" ||
    lower === "image/png" ||
    lower === "image/webp" ||
    lower === "image/gif"
  ) {
    return lower;
  }
  // Reject anything that isn't an obvious image content-type by mapping
  // to jpeg so the bucket's allowed-mime list still accepts the upload.
  return "image/jpeg";
}

export async function cacheThumbnailToStorage(
  args: CacheThumbnailArgs,
): Promise<CacheThumbnailResult> {
  const { supabaseUrl, serviceRoleKey, sourceUrl, platform, postId, pathSuffix } =
    args;

  if (!sourceUrl) {
    return { cachedUrl: null, cachedAt: null };
  }

  // 1) Download with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let bytes: ArrayBuffer;
  let contentType: string | null;
  try {
    const res = await fetch(sourceUrl, { signal: controller.signal });
    if (!res.ok) {
      console.warn(
        `thumbnail-cache: fetch ${res.status} for ${platform}/${postId}`,
      );
      return { cachedUrl: null, cachedAt: null };
    }
    contentType = res.headers.get("content-type");
    bytes = await res.arrayBuffer();
  } catch (e) {
    console.warn(
      `thumbnail-cache: fetch failed for ${platform}/${postId}: ${
        (e as Error).message
      }`,
    );
    return { cachedUrl: null, cachedAt: null };
  } finally {
    clearTimeout(timer);
  }

  // 2) Build object path
  const ext = extensionForContentType(contentType);
  const mime = normalizedContentType(contentType);
  const suffix = pathSuffix ?? "";
  const path = `${platform}/${postId}${suffix}.${ext}`;

  // 3) Upload (upsert so re-syncs overwrite cleanly)
  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: mime,
        upsert: true,
        cacheControl: "31536000", // 1 year — Storage URL is stable + immutable per path
      });
    if (error) {
      console.warn(
        `thumbnail-cache: upload failed for ${platform}/${postId}: ${error.message}`,
      );
      return { cachedUrl: null, cachedAt: null };
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) {
      console.warn(
        `thumbnail-cache: no publicUrl returned for ${platform}/${postId}`,
      );
      return { cachedUrl: null, cachedAt: null };
    }
    return { cachedUrl: data.publicUrl, cachedAt: new Date().toISOString() };
  } catch (e) {
    console.warn(
      `thumbnail-cache: unexpected error for ${platform}/${postId}: ${
        (e as Error).message
      }`,
    );
    return { cachedUrl: null, cachedAt: null };
  }
}
