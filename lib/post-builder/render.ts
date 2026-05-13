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
  hero_image_url: string;
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

  // Fetch the hero photo and inline it as a data URI.
  let heroImageDataUri: string;
  try {
    heroImageDataUri = await fetchAsDataUri(input.hero_image_url);
  } catch (e) {
    return {
      ok: false,
      error: `Failed to fetch hero image: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Render the template HTML.
  const html = tpl.render({ listing: input.listing, heroImageDataUri });

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
 * On Vercel the @sparticuz/chromium package provides a Lambda-friendly
 * Chromium binary. Locally we fall back to puppeteer-core's auto-detected
 * system Chrome path via PUPPETEER_EXECUTABLE_PATH env var.
 */
async function screenshotHtml(args: {
  html: string;
  width: number;
  height: number;
}): Promise<Buffer> {
  // Dynamic imports — these libs are heavy, only load when actually rendering.
  const puppeteer = (await import("puppeteer-core")).default;
  const chromium = (await import("@sparticuz/chromium")).default;

  const isVercel = !!process.env.VERCEL;
  const executablePath = isVercel
    ? await chromium.executablePath()
    : process.env.PUPPETEER_EXECUTABLE_PATH ||
      // Common local dev paths
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
    });
    await page.setContent(args.html, {
      waitUntil: "networkidle0",
      timeout: 20_000,
    });
    // Make sure web fonts have laid out before snapping.
    await page.evaluateHandle("document.fonts.ready");
    // Tiny extra beat for any layout settling.
    await new Promise((r) => setTimeout(r, 150));

    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: args.width, height: args.height },
      omitBackground: false,
    });
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}
