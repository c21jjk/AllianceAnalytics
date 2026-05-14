import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { screenshotHtml } from "./chromium";
import { getTemplate } from "./templates/registry";
import type { PostBuilderListing, PostCustomizations } from "./types";

/**
 * Server-side rendering pipeline for Post Builder templates.
 *
 * Flow:
 *   1. Fetch the hero image bytes; convert to a data: URI so the headless
 *      browser doesn't have to make a network call (fast + immune to CDN
 *      hiccups + works in restricted serverless environments).
 *   2. Render the template's HTML with the data URI baked in.
 *   3. Launch headless Chromium (Vercel: @sparticuz/chromium; local dev:
 *      falls back to system Chrome via puppeteer-core).
 *   4. setContent() the HTML at the template's exact dimensions.
 *   5. Wait for fonts to settle, screenshot as PNG.
 *   6. Upload to Supabase Storage; return the public URL.
 *
 * Returns { ok: true, image_url, image_path } on success,
 * { ok: false, error } on failure.
 */

const STORAGE_BUCKET = "post-builder-renders";

export interface RenderTemplateInput {
  template_id: string;
  listing: PostBuilderListing;
  /**
   * Single-photo variants (v1/v2/v3) take just hero_image_url. Multi-photo
   * variants (v4/v5) take hero_image_urls. Callers should send the right
   * shape for the variant they're rendering; if both are present,
   * hero_image_urls takes precedence.
   */
  hero_image_url?: string;
  hero_image_urls?: string[];
  /** Path A — user customizations baked into this render. */
  customizations?: PostCustomizations | null;
}

export interface RenderTemplateOk {
  ok: true;
  image_url: string;
  image_path: string;
  template_id: string;
  width: number;
  height: number;
  rendered_at: string;
}

export interface RenderTemplateErr {
  ok: false;
  error: string;
}

export type RenderTemplateResult = RenderTemplateOk | RenderTemplateErr;

export async function renderTemplate(
  input: RenderTemplateInput,
): Promise<RenderTemplateResult> {
  const tpl = getTemplate(input.template_id);
  if (!tpl) return { ok: false, error: `Unknown template: ${input.template_id}` };

  // Resolve the source URL list. hero_image_urls takes precedence; if the
  // caller only sent hero_image_url, wrap it. Trim to the template's
  // photo_count so we don't fetch unused photos. If the caller sent fewer
  // photos than the template wants, the last URL is repeated to fill the
  // slots — beats failing the render outright.
  const requestedUrls: string[] = (input.hero_image_urls?.length
    ? input.hero_image_urls
    : input.hero_image_url
      ? [input.hero_image_url]
      : []
  ).filter((u) => typeof u === "string" && u.length > 0);

  if (requestedUrls.length === 0) {
    return { ok: false, error: "no hero_image_url(s) provided" };
  }

  const wanted = tpl.meta.photo_count;
  const sourceUrls: string[] = [];
  for (let i = 0; i < wanted; i++) {
    sourceUrls.push(requestedUrls[Math.min(i, requestedUrls.length - 1)]);
  }

  // Fetch all photos in parallel, inline as data URIs.
  let heroImageDataUris: string[];
  try {
    heroImageDataUris = await Promise.all(sourceUrls.map((u) => fetchAsDataUri(u)));
  } catch (e) {
    return {
      ok: false,
      error: `Failed to fetch hero image(s): ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Render the template HTML. Backward-compat: primitives that expect a
  // single heroImageDataUri keep getting the first one; multi-photo
  // primitives read from heroImageDataUris. Path A customizations flow
  // through to the registry wrapper which applies them.
  const html = tpl.render({
    listing: input.listing,
    heroImageDataUri: heroImageDataUris[0],
    heroImageDataUris,
    customizations: input.customizations,
  });

  // Launch headless Chromium and screenshot.
  let pngBytes: Buffer;
  try {
    pngBytes = await screenshotHtml({
      html,
      width: tpl.meta.dimensions.width,
      height: tpl.meta.dimensions.height,
      log_label: "render",
    });
  } catch (e) {
    return {
      ok: false,
      error: `Render failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Upload to Storage.
  const supabase = createAdminClient();
  const renderedAt = new Date().toISOString();
  const path = `${input.template_id}/${input.listing.mls_number}/${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, pngBytes, {
      contentType: "image/png",
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path);

  return {
    ok: true,
    image_url: pub.publicUrl,
    image_path: path,
    template_id: input.template_id,
    width: tpl.meta.dimensions.width,
    height: tpl.meta.dimensions.height,
    rendered_at: renderedAt,
  };
}

/**
 * Download a public image URL and return it as a data: URI string.
 * Times out at 15s — RETS image CDNs are usually fast but we don't want
 * a hung fetch to take down the entire function.
 */
async function fetchAsDataUri(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Some MLS image hosts gate by referer/UA — use a permissive UA.
      headers: { "user-agent": "Mozilla/5.0 (compatible; AllianceAnalytics/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from image host`);
    }
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } finally {
    clearTimeout(timeout);
  }
}

// screenshotHtml lives in ./chromium for the Vercel/cold-start setup. See
// chromium.ts for the gory details. Whole module retires once Polotno cloud
// render replaces it in Phase 1.
