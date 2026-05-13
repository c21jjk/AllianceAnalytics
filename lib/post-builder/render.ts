import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTemplate } from "./templates/registry";
import type { PostBuilderListing } from "./types";

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
  // primitives read from heroImageDataUris.
  const html = tpl.render({
    listing: input.listing,
    heroImageDataUri: heroImageDataUris[0],
    heroImageDataUris,
  });

  // Launch headless Chromium and screenshot.
  let pngBytes: Buffer;
  try {
    pngBytes = await screenshotHtml({
      html,
      width: tpl.meta.dimensions.width,
      height: tpl.meta.dimensions.height,
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

/**
 * Screenshot HTML at exact dimensions using headless Chromium.
 *
 * On Vercel the @sparticuz/chromium-min package is paired with a
 * publicly-hosted Chromium tarball — the binary downloads on cold start
 * and gets cached in /tmp. This sidesteps Vercel's 50 MB compressed
 * function size limit (the full @sparticuz/chromium package was ~50 MB
 * on its own and tipped us over).
 *
 * The CHROMIUM_PACK_URL must match the chromium-min package version. Bump
 * both together when upgrading. Sparticuz publishes the tarball as a
 * GitHub release for every chromium version.
 *
 * Locally we fall back to puppeteer-core's auto-detected system Chrome
 * via PUPPETEER_EXECUTABLE_PATH or the standard macOS path.
 */
// IMPORTANT: filename is `chromium-v131.0.1-pack.tar` — NOT `.x64.tar`.
// The `.x64` suffix returns 404, and chromium-min retries silently for the
// entire function timeout. Verified asset name via the GitHub releases API.
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

async function screenshotHtml(args: {
  html: string;
  width: number;
  height: number;
}): Promise<Buffer> {
  const t0 = Date.now();
  const stage = (label: string) =>
    console.log(`[render] ${label}: +${Date.now() - t0}ms`);

  // Dynamic imports — these libs are heavy, only load when actually rendering.
  const puppeteer = (await import("puppeteer-core")).default;
  const chromium = (await import("@sparticuz/chromium-min")).default;
  stage("imports done");

  const isVercel = !!process.env.VERCEL;
  const executablePath = isVercel
    ? await chromium.executablePath(CHROMIUM_PACK_URL)
    : process.env.PUPPETEER_EXECUTABLE_PATH ||
      // Common local dev paths
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  stage("executablePath resolved (binary downloaded if cold)");

  const browser = await puppeteer.launch({
    args: isVercel ? chromium.args : ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: {
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
    },
    executablePath,
    headless: true,
  });
  stage("browser launched");

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
    });
    stage("page + viewport ready");
    // Use domcontentloaded instead of networkidle0 — the hero image is already
    // a data URI so no network needed for it. Google Fonts may still load
    // slowly from the function region; we wait explicitly for fonts below
    // with a hard cap to avoid hanging the whole render.
    await page.setContent(args.html, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    stage("setContent done");
    // Wait for fonts with an explicit timeout — Google Fonts CDN occasionally
    // stalls from us-east lambdas. After 5s give up and render with system
    // font fallback (still readable, just slightly off-brand).
    try {
      await Promise.race([
        page.evaluate(() => (document as Document).fonts.ready),
        new Promise((_, rej) => setTimeout(() => rej(new Error("font-timeout")), 5_000)),
      ]);
      stage("fonts ready");
    } catch (e) {
      console.warn(`[render] font wait skipped: ${(e as Error).message}`);
    }
    // Tiny extra beat for any layout settling.
    await new Promise((r) => setTimeout(r, 150));

    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: args.width, height: args.height },
      omitBackground: false,
    });
    stage("screenshot captured");
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
    stage("browser closed");
  }
}
