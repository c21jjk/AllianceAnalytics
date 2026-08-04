/**
 * lib/post-builder/rehost-images.ts (2026-08-03)
 * ---------------------------------------------------------------------------
 *
 * Mirror third-party listing photos into our own Supabase storage right
 * before publishing, and hand the platforms OUR public URLs instead of the
 * MLS CDN's.
 *
 * WHY: Instagram's Graph API ingests images by URL, fetched by Meta's
 * crawler. Paragon's CDN (zimg.paragon.ice.com, post-ICE migration) refuses
 * non-browser fetchers: HEAD requests 403 outright and blocked requests get
 * a text/html error page. Meta receives HTML where it expected an image and
 * the publish fails with "Only photo or video can be accepted as media
 * type" (seen live 2026-08-03 on gp c4d892f9, slides 2-4). Bright's
 * watermarked media CDN has the same risk profile. Facebook happened to
 * survive because its fetch path is more tolerant, but it is exposed to the
 * same failure class.
 *
 * Design:
 *   - Only non-Supabase URLs are mirrored; our own storage URLs pass
 *     through untouched (the designed hero render already lives there).
 *   - Content is verified (content-type image/*, size cap) before upload.
 *   - Path is deterministic per (post, source URL), so retries reuse the
 *     mirrored copy via a cheap existence probe instead of re-downloading.
 *   - FAIL-OPEN per URL: if the mirror attempt fails, the original URL is
 *     used so a mirroring hiccup can never break a publish that might have
 *     succeeded anyway.
 */
import "server-only";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** Bucket shared with the designed-post renders; mirrored slides live under
 *  the rehost/ prefix so lifecycle sweeps can treat them separately. */
const REHOST_BUCKET = "post-builder-renders";
const REHOST_PREFIX = "rehost";

/** IG's documented image ceiling is 8 MB. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Browser UA: the Paragon CDN serves images to browser GETs while
 *  rejecting bot UAs and HEAD requests. */
const FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface RehostResult {
  /** Same order as the input; each entry is either the original URL (already
   *  ours, or mirroring failed) or the mirrored Supabase public URL. */
  urls: string[];
  /** original URL -> mirrored URL, for callers that want to persist the
   *  rewrite back onto the row. Only contains successfully mirrored URLs. */
  replaced: Map<string, string>;
}

function isSupabaseStorageUrl(url: string): boolean {
  return url.includes(".supabase.co/storage/");
}

/**
 * Ensure every image URL is served from our Supabase storage. Non-Supabase
 * URLs are downloaded (browser UA), validated, uploaded to
 * post-builder-renders/rehost/<generatedPostId>/<hash>.<ext>, and replaced
 * with our public URL. Failures fall back to the original URL.
 */
export async function ensureSupabaseHostedImages(
  imageUrls: readonly string[],
  generatedPostId: string,
): Promise<RehostResult> {
  const replaced = new Map<string, string>();
  const out: string[] = [];

  let storage: ReturnType<typeof createAdminClient>["storage"] | null = null;
  try {
    storage = createAdminClient().storage;
  } catch (e) {
    // Missing env vars etc. — fail open for every URL.
    console.warn(
      "[rehost-images] admin client unavailable, publishing original URLs:",
      e instanceof Error ? e.message : e,
    );
    return { urls: [...imageUrls], replaced };
  }

  for (const url of imageUrls) {
    if (!url || isSupabaseStorageUrl(url)) {
      out.push(url);
      continue;
    }
    try {
      const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);

      // Existence probe first: deterministic path means a retry (Post Now
      // after partial failure, cron re-attempt) reuses the mirror without
      // re-downloading from the MLS CDN. Extension unknown until download,
      // so probe the common case (jpg) plus png.
      let mirroredUrl: string | null = null;
      for (const ext of ["jpg", "png", "webp"]) {
        const path = `${REHOST_PREFIX}/${generatedPostId}/${hash}.${ext}`;
        const { data: pub } = storage.from(REHOST_BUCKET).getPublicUrl(path);
        const probe = await fetch(pub.publicUrl, { method: "HEAD" });
        if (probe.ok) {
          mirroredUrl = pub.publicUrl;
          break;
        }
      }

      if (!mirroredUrl) {
        const res = await fetch(url, {
          headers: { "User-Agent": FETCH_UA, Accept: "image/*,*/*;q=0.8" },
          redirect: "follow",
        });
        if (!res.ok) {
          throw new Error(`source fetch ${res.status}`);
        }
        const contentType = (res.headers.get("content-type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const ext = EXT_BY_TYPE[contentType];
        if (!ext) {
          throw new Error(`unexpected content-type "${contentType}"`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
          throw new Error(`size ${buf.byteLength} outside 1..${MAX_IMAGE_BYTES}`);
        }
        const path = `${REHOST_PREFIX}/${generatedPostId}/${hash}.${ext}`;
        const { error: upErr } = await storage
          .from(REHOST_BUCKET)
          .upload(path, buf, { contentType, upsert: true });
        if (upErr) {
          throw new Error(`upload failed: ${upErr.message}`);
        }
        const { data: pub } = storage.from(REHOST_BUCKET).getPublicUrl(path);
        mirroredUrl = pub.publicUrl;
      }

      replaced.set(url, mirroredUrl);
      out.push(mirroredUrl);
    } catch (e) {
      console.warn(
        `[rehost-images] falling back to original URL for gp ${generatedPostId} (${url.slice(0, 80)}...):`,
        e instanceof Error ? e.message : e,
      );
      out.push(url);
    }
  }

  return { urls: out, replaced };
}

/**
 * Rewrite a generated_posts.additional_images jsonb array using the
 * replaced-URL map from ensureSupabaseHostedImages. Returns null when
 * nothing changed. Shape-preserving: only the url field of matching
 * entries is touched.
 */
export function rewriteAdditionalImages(
  rawAdditional: unknown,
  replaced: ReadonlyMap<string, string>,
): unknown[] | null {
  if (!Array.isArray(rawAdditional) || replaced.size === 0) return null;
  let changed = false;
  const next = rawAdditional.map((entry) => {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "url" in entry &&
      typeof (entry as { url: unknown }).url === "string"
    ) {
      const mirrored = replaced.get((entry as { url: string }).url);
      if (mirrored) {
        changed = true;
        return { ...(entry as Record<string, unknown>), url: mirrored };
      }
    }
    return entry;
  });
  return changed ? next : null;
}
