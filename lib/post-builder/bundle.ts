import "server-only";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderFBNewListingV1 } from "./templates/primitives/fb-new-listing-v1";
import { renderFBOpenHouseV1 } from "./templates/primitives/fb-open-house-v1";
import type {
  FBBundleListingInput,
  FBBundleRequest,
  PostBuilderListing,
} from "./types";
import { generateFBCaption, type FBCaptionResult } from "./captions-fb";

/**
 * Phase 7+: server-side bundle generator for Facebook Native multi-photo posts.
 *
 * Pipeline:
 *   1. For each input listing, fetch the hero photo and inline as data URI.
 *   2. Render the FB Hero Card HTML for each listing.
 *   3. Launch headless Chromium ONCE, screenshot each hero card to PNG.
 *   4. Fetch each "real photo" URL (Paragon CDN) as bytes.
 *   5. Generate the multi-block caption via the captions-fb module.
 *   6. Stream-zip everything: hero PNGs + real photos + caption.txt + README.
 *   7. Upload the ZIP to Storage; return public URL.
 *
 * Array-aware from day one — Phase 7 sends 1 listing, Phase 8 (Open House
 * multi-property) will send up to ~15. Same code path.
 */

const STORAGE_BUCKET = "post-builder-renders";
const CHROMIUM_PACK_URL =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/chromium-binaries/v131.0.1/chromium-v131.0.1-pack.tar";

export interface BundleResultOk {
  ok: true;
  bundle_url: string;
  bundle_path: string;
  asset_count: number;
  caption: string;
  hashtags: string[];
  mls_hashtag: string;
  rendered_at: string;
  /**
   * Public URLs of each gallery asset, in order. Used by the publish API
   * to feed Meta's Graph endpoints (which require image_url to be public).
   * For new_listing_single: [hero_card_url, real_photo_url, real_photo_url, ...]
   * For open_house_multi:   [hero_card_url, hero_card_url, ...]  (one per listing)
   */
  asset_urls: string[];
}

export interface BundleResultErr {
  ok: false;
  error: string;
}

export type BundleResult = BundleResultOk | BundleResultErr;

export async function generateFBBundle(req: FBBundleRequest): Promise<BundleResult> {
  if (!req.listings || req.listings.length === 0) {
    return { ok: false, error: "at least one listing required" };
  }

  // --- 1. Caption first (cheap, fails fast if Claude is down) ----------
  const caption = await generateFBCaption({
    shape: req.caption_shape,
    listings: req.listings.map((l) => l.listing),
  });
  if (!caption) {
    return { ok: false, error: "caption generation failed" };
  }

  // --- 2. For each listing, generate its hero card PNG -----------------
  let heroPngs: { listing: PostBuilderListing; bytes: Buffer; filenameStem: string }[];
  try {
    heroPngs = await renderAllHeroCards(req);
  } catch (e) {
    return {
      ok: false,
      error: `Hero card render failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // --- 3. Fetch each real photo and collect into a manifest -----------
  //
  // Two patterns based on caption shape:
  //   new_listing_single → 1 hero card + N real photos in gallery
  //   open_house_multi   → N hero cards only (every gallery slot is designed)
  //
  // For OH multi we skip the real-photo fetch entirely.
  let realPhotos: { filename: string; bytes: Buffer; contentType: string }[] = [];
  if (req.caption_shape !== "open_house_multi") {
    try {
      realPhotos = await fetchAllRealPhotos(req.listings);
    } catch (e) {
      return {
        ok: false,
        error: `Photo fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // --- 4. Pack into ZIP ------------------------------------------------
  let zipBytes: Buffer;
  try {
    zipBytes = await packBundle({ heroPngs, realPhotos, caption, shape: req.caption_shape });
  } catch (e) {
    return {
      ok: false,
      error: `Bundle pack failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // --- 5. Upload to Storage -------------------------------------------
  const supabase = createAdminClient();
  const renderedAt = new Date().toISOString();
  const firstMls = req.listings[0].listing.mls_number;
  const stamp = Date.now();

  // 5a. Upload the ZIP for download convenience.
  const zipPath = `bundles/${req.hero_template_id}/${firstMls}/${stamp}.zip`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(zipPath, zipBytes, {
      contentType: "application/zip",
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    return { ok: false, error: `ZIP upload failed: ${uploadError.message}` };
  }
  const { data: zipPub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(zipPath);

  // 5b. Upload each hero card PNG individually — these need public URLs
  // for the Phase 5A publish API (Meta Graph wants image_url params).
  const assetUrls: string[] = [];
  for (const hero of heroPngs) {
    const heroPath = `bundle-assets/${req.hero_template_id}/${firstMls}/${stamp}/${hero.filenameStem}.png`;
    const { error: heroErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(heroPath, hero.bytes, {
        contentType: "image/png",
        upsert: false,
        cacheControl: "31536000",
      });
    if (heroErr) {
      console.warn(`[bundle] hero asset upload failed ${heroPath}:`, heroErr.message);
      continue;
    }
    const { data: heroPub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(heroPath);
    if (heroPub?.publicUrl) assetUrls.push(heroPub.publicUrl);
  }

  // 5c. Real photos already have public Paragon URLs — include directly.
  // For new_listing_single, skip photo #1 (it was the hero card source)
  // to match the ZIP filename numbering (01-hero, 02-photo, 03-photo, ...).
  if (req.caption_shape === "new_listing_single" && req.listings[0]) {
    const realUrls = req.listings[0].real_photo_urls.slice(1);
    for (const u of realUrls) assetUrls.push(u);
  }

  return {
    ok: true,
    bundle_url: zipPub.publicUrl,
    bundle_path: zipPath,
    asset_count: heroPngs.length + realPhotos.length,
    asset_urls: assetUrls,
    caption: caption.caption,
    hashtags: caption.hashtags,
    mls_hashtag: caption.mls_hashtag,
    rendered_at: renderedAt,
  };
}

// ---------------------------------------------------------------------
// Hero card rendering
// ---------------------------------------------------------------------

async function renderAllHeroCards(
  req: FBBundleRequest,
): Promise<{ listing: PostBuilderListing; bytes: Buffer; filenameStem: string }[]> {
  // Same chromium-min setup as render.ts — see that file's comments for
  // why we set AWS_EXECUTION_ENV + LD_LIBRARY_PATH manually and clean
  // /tmp/chromium if libs are missing.
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    if (!process.env.AWS_EXECUTION_ENV) {
      process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs20.x";
    }
    const libPath = "/tmp/al2023/lib";
    if (!process.env.LD_LIBRARY_PATH?.includes(libPath)) {
      process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
        ? `${libPath}:${process.env.LD_LIBRARY_PATH}`
        : libPath;
    }
    process.env.FONTCONFIG_PATH ??= "/tmp/fonts";
    try {
      const fs = await import("node:fs");
      if (
        fs.existsSync("/tmp/chromium") &&
        !fs.existsSync(`${libPath}/libnss3.so`)
      ) {
        try { fs.unlinkSync("/tmp/chromium"); } catch {}
        try { fs.rmSync("/tmp/chromium-pack", { recursive: true, force: true }); } catch {}
        try { fs.rmSync("/tmp/al2023", { recursive: true, force: true }); } catch {}
      }
    } catch {}
  }

  const puppeteer = (await import("puppeteer-core")).default;
  const chromium = (await import("@sparticuz/chromium-min")).default;

  const executablePath = isVercel
    ? await chromium.executablePath(CHROMIUM_PACK_URL)
    : process.env.PUPPETEER_EXECUTABLE_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  const browser = await puppeteer.launch({
    args: isVercel ? chromium.args : ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1080, height: 1080, deviceScaleFactor: 1 },
    executablePath,
    headless: true,
  });

  const heroPngs: { listing: PostBuilderListing; bytes: Buffer; filenameStem: string }[] = [];
  try {
    for (let i = 0; i < req.listings.length; i++) {
      const input = req.listings[i];
      const heroUrl = input.real_photo_urls[0] ?? input.listing.hero_image_url;
      if (!heroUrl) {
        throw new Error(
          `Listing ${input.listing.mls_number} has no hero photo URL`,
        );
      }
      const heroDataUri = await fetchAsDataUri(heroUrl);

      // Hero template selection
      let html: string;
      if (req.hero_template_id === "fb_new_listing_v1") {
        html = renderFBNewListingV1({
          listing: input.listing,
          heroImageDataUri: heroDataUri,
          customFeature: input.custom_feature ?? null,
        });
      } else if (req.hero_template_id === "fb_open_house_v1") {
        html = renderFBOpenHouseV1({
          listing: input.listing,
          heroImageDataUri: heroDataUri,
        });
      } else {
        throw new Error(`Unsupported hero_template_id: ${req.hero_template_id}`);
      }

      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15_000 });
      // Best-effort font wait with 5s cap (matches render.ts).
      try {
        await Promise.race([
          page.evaluate(() => (document as Document).fonts.ready),
          new Promise((_, rej) => setTimeout(() => rej(new Error("font-timeout")), 5_000)),
        ]);
      } catch {
        // System font fallback — Playfair degrades to Times, Inter to system sans
      }
      await new Promise((r) => setTimeout(r, 100));
      const png = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: 1080, height: 1080 },
      });
      await page.close();

      // Filename stem like "01-hero-261231" — sortable for the gallery order.
      const seq = String(i + 1).padStart(2, "0");
      heroPngs.push({
        listing: input.listing,
        bytes: Buffer.from(png),
        filenameStem: `${seq}-hero-${input.listing.mls_number}`,
      });
    }
  } finally {
    await browser.close();
  }

  return heroPngs;
}

// ---------------------------------------------------------------------
// Real photo fetching
// ---------------------------------------------------------------------

/**
 * Fetch real (supporting) listing photos for new_listing_single mode.
 * The caller has already filtered out OH multi-property shape, so this
 * only handles the single-listing case: skip photo #1 (already used as
 * the hero card source) and include the rest in the gallery.
 */
async function fetchAllRealPhotos(
  inputs: FBBundleListingInput[],
): Promise<{ filename: string; bytes: Buffer; contentType: string }[]> {
  const out: { filename: string; bytes: Buffer; contentType: string }[] = [];
  // Currently only single-listing for the new_listing_single shape.
  // If a future shape ships multi-listing-with-real-photos we'll branch here.
  const input = inputs[0];
  if (!input) return out;
  const mls = input.listing.mls_number;
  const photoUrlsToFetch = input.real_photo_urls.slice(1); // skip hero source

  for (let j = 0; j < photoUrlsToFetch.length; j++) {
    const url = photoUrlsToFetch[j];
    try {
      const r = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; AllianceAnalytics/1.0)" },
      });
      if (!r.ok) {
        console.warn(`[bundle] skipping photo ${url}: HTTP ${r.status}`);
        continue;
      }
      const ct = r.headers.get("content-type") ?? "image/jpeg";
      const bytes = Buffer.from(await r.arrayBuffer());
      const ext = ct.toLowerCase().includes("png") ? "png" : "jpg";
      // Numbering continues after the hero card (which is "01-…")
      const filename = `${String(j + 2).padStart(2, "0")}-${mls}.${ext}`;
      out.push({ filename, bytes, contentType: ct });
    } catch (e) {
      console.warn(`[bundle] photo fetch error ${url}:`, e);
    }
  }
  return out;
}

async function fetchAsDataUri(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; AllianceAnalytics/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------
// ZIP packaging
// ---------------------------------------------------------------------

async function packBundle(args: {
  heroPngs: { bytes: Buffer; filenameStem: string }[];
  realPhotos: { filename: string; bytes: Buffer; contentType: string }[];
  caption: FBCaptionResult;
  shape?: "new_listing_single" | "open_house_multi";
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const pass = new PassThrough();
    pass.on("data", (c) => chunks.push(c as Buffer));
    pass.on("end", () => resolve(Buffer.concat(chunks)));
    pass.on("error", reject);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", reject);
    archive.pipe(pass);

    // Hero card PNGs (one per listing for Phase 7, will be N for Phase 8).
    for (const h of args.heroPngs) {
      archive.append(h.bytes, { name: `${h.filenameStem}.png` });
    }

    // Real listing photos (skipping photo #1 which is the hero source).
    for (const p of args.realPhotos) {
      archive.append(p.bytes, { name: p.filename });
    }

    // Caption + hashtags as plain text.
    const captionTxt = args.caption.caption;
    archive.append(captionTxt, { name: "caption.txt" });

    // README walking Larissa through the workflow.
    const isOH = args.shape === "open_house_multi";
    const readme = isOH
      ? `Century 21 Alliance — Open House Weekend Bundle

WORKFLOW:
  1. Copy the contents of caption.txt and paste into the Facebook post body.
     The caption includes day-grouped addresses + times for every property.
  2. Upload all the hero card PNGs to the FB gallery — Facebook will lay them
     out in a grid. Order doesn't matter much for OH posts since each card
     is self-labeled with its address + time.
  3. Each card is a designed asset; no real photos to drop in.
  4. The first listing's MLS hashtag (${args.caption.mls_hashtag}) is in the caption
     for auto-attribution. Add more hashtags by hand if you want per-property
     attribution for every listing in the post.
`
      : `Century 21 Alliance — Facebook Post Bundle

WORKFLOW:
  1. Copy the contents of caption.txt and paste into the Facebook post body.
  2. Upload the photos in numerical order (01, 02, 03, …) — Facebook will
     lay them out in a gallery grid. Photo 01 is the designed hero card.
  3. The MLS hashtag (${args.caption.mls_hashtag}) is baked into the caption so
     once published, the Alliance Analytics auto-linker ties the post back
     to this listing automatically.

If any photo doesn't fit your post, just don't upload it — order is the
only thing Facebook cares about.
`;
    archive.append(readme, { name: "README.txt" });

    archive.finalize().catch(reject);
  });
}
