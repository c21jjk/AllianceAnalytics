import "server-only";
/**
 * Node/Next.js mirror of the Edge Function thumbnail caching helper.
 *
 * Two runtimes (Deno edge + Node server actions) can't share a TypeScript
 * file directly because the Deno version imports from a URL — so we keep
 * the implementations in lockstep instead. Edge version lives at:
 *
 *   supabase/functions/_shared/thumbnail-cache.ts
 *
 * Behavior is identical: download with a 10s timeout, upload to the
 * `post-thumbnails` Supabase Storage bucket, return the durable public URL
 * (or null on any failure so callers can fall back to the source URL).
 */
import { createClient } from "@supabase/supabase-js";

export type CachePlatform = "facebook" | "instagram" | "tiktok";

export interface CacheThumbnailArgs {
  supabaseUrl: string;
  serviceRoleKey: string;
  sourceUrl: string;
  platform: CachePlatform;
  /** platform_post_id from the post (used in the object path) */
  postId: string;
  /**
   * Optional suffix appended to the object path before the extension.
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

  const ext = extensionForContentType(contentType);
  const mime = normalizedContentType(contentType);
  const suffix = pathSuffix ?? "";
  const path = `${platform}/${postId}${suffix}.${ext}`;

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: mime,
        upsert: true,
        cacheControl: "31536000",
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
