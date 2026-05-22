import "server-only";

/**
 * Shared headless Chromium screenshot helper used by the template render
 * pipeline (render.ts) to convert template HTML into a PNG.
 *
 * Pulled out of render.ts so the @sparticuz/chromium-min Vercel quirks
 * (env-var detection, /tmp cache cleanup, Fluid Compute behavior) live in
 * ONE place. Bumping chromium versions or fixing cold-start issues happens
 * here, no copy-paste.
 *
 * Note: this whole module becomes deletable once we cut over to Polotno's
 * cloud render API in Phase 1 of the Polotno integration.
 */

// Hosted on Supabase Storage (same region as our Vercel functions) instead of
// GitHub releases — significantly faster cold starts than the GitHub releases
// CDN, and we control the lifecycle. Bucket `chromium-binaries` is public.
// IMPORTANT: filename is `chromium-v131.0.1-pack.tar` — NOT `.x64.tar`.
const CHROMIUM_PACK_URL =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/chromium-binaries/v131.0.1/chromium-v131.0.1-pack.tar";

/**
 * Screenshot HTML (or a fully-loaded URL) at exact dimensions using
 * headless Chromium.
 *
 * Two modes:
 *   • `html` — Caller passes a full HTML string; we `setContent` it.
 *     Used by the legacy primitive render path where the entire DOM is
 *     emitted server-side.
 *   • `url` — Caller passes a fully-qualified URL; we `page.goto` it,
 *     wait for the named `ready_attribute` to flip on the named selector,
 *     then screenshot. Used by the DB-template render path: a server-
 *     rendered Next.js route mounts a Fabric canvas client-side, then
 *     stamps the readiness attribute when drawing finishes.
 *
 * On Vercel the @sparticuz/chromium-min package is paired with a
 * publicly-hosted Chromium tarball — the binary downloads on cold start
 * and gets cached in /tmp.
 *
 * Locally we fall back to puppeteer-core's auto-detected system Chrome
 * via PUPPETEER_EXECUTABLE_PATH or the standard macOS path.
 */
export interface ScreenshotArgs {
  /** HTML mode — full HTML string for setContent. Mutually exclusive with `url`. */
  html?: string;
  /** URL mode — fully-qualified URL the headless browser navigates to.
   *  Page must signal readiness by setting `ready_attribute` to "ready" on
   *  a DOM element matching `ready_selector`. Mutually exclusive with `html`. */
  url?: string;
  /** Required when using `url` mode. Defaults to `canvas` if omitted. */
  ready_selector?: string;
  /** Required when using `url` mode. Defaults to `data-render-status` if omitted. */
  ready_attribute?: string;
  /** Required when using `url` mode. Defaults to 30_000ms. */
  ready_timeout_ms?: number;
  width: number;
  height: number;
  /** Optional tag prefixed onto log lines (defaults to "render"). */
  log_label?: string;
}

export async function screenshotHtml(args: ScreenshotArgs): Promise<Buffer> {
  const t0 = Date.now();
  const label = args.log_label ?? "render";
  const stage = (s: string) => console.log(`[${label}] ${s}: +${Date.now() - t0}ms`);

  const isVercel = !!process.env.VERCEL;

  // ──────────────────────────────────────────────────────────────────
  // VERCEL FLUID COMPUTE FIX (three-part — all critical):
  //
  // @sparticuz/chromium-min decides whether to extract the al2023.tar.br
  // library tarball (containing libnss3.so + other Chromium shared libs)
  // based on process.env.AWS_EXECUTION_ENV. Vercel Fluid Compute does
  // NOT set AWS_EXECUTION_ENV in the format the library expects. We set
  // it ourselves before the dynamic import, also force LD_LIBRARY_PATH,
  // and detect/clean corrupted warm-instance caches.
  // ──────────────────────────────────────────────────────────────────
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
      const hasBinary = fs.existsSync("/tmp/chromium");
      const hasLibs = fs.existsSync(`${libPath}/libnss3.so`);
      if (hasBinary && !hasLibs) {
        console.log(`[${label}] corrupted cache detected (binary but no libs); cleaning`);
        try { fs.unlinkSync("/tmp/chromium"); } catch {}
        try { fs.rmSync("/tmp/chromium-pack", { recursive: true, force: true }); } catch {}
        try { fs.rmSync("/tmp/al2023", { recursive: true, force: true }); } catch {}
      }
    } catch (e) {
      console.warn(`[${label}] cache check failed:`, (e as Error).message);
    }
  }
  stage("vercel env prepared");

  const puppeteer = (await import("puppeteer-core")).default;
  const chromium = (await import("@sparticuz/chromium-min")).default;
  stage("imports done");

  const executablePath = isVercel
    ? await chromium.executablePath(CHROMIUM_PACK_URL)
    : process.env.PUPPETEER_EXECUTABLE_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  stage("executablePath resolved (binary + libs downloaded if cold)");

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

    if (typeof args.html === "string") {
      // HTML mode — used by legacy primitive renders. We set the page
      // content directly; no network round-trip.
      await page.setContent(args.html, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      stage("setContent done");
      try {
        await Promise.race([
          page.evaluate(() => (document as Document).fonts.ready),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("font-timeout")), 5_000),
          ),
        ]);
        stage("fonts ready");
      } catch (e) {
        console.warn(`[${label}] font wait skipped: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    } else if (typeof args.url === "string") {
      // URL mode — used by DB-template renders. The Next.js route at
      // /render/template/<token> mounts a Fabric canvas client-side then
      // sets a DOM attribute when drawing finishes. We poll for that
      // attribute before snapping.
      const readySelector = args.ready_selector ?? "canvas";
      const readyAttribute = args.ready_attribute ?? "data-render-status";
      const readyTimeout = args.ready_timeout_ms ?? 30_000;

      await page.goto(args.url, {
        waitUntil: "networkidle2",
        timeout: 30_000,
      });
      stage("navigated");

      // Wait for the canvas to signal it's done rendering. waitForFunction
      // polls the page's JS context until the predicate returns true.
      await page.waitForFunction(
        (sel: string, attr: string) => {
          const el = document.querySelector(sel);
          return el?.getAttribute(attr) === "ready";
        },
        { timeout: readyTimeout, polling: 100 },
        readySelector,
        readyAttribute,
      );
      stage("client signaled ready");
      // Belt + suspenders: one more font tick before snapping. The client
      // already waited for fonts.ready before signaling, but a quick extra
      // tick covers any layout-after-paint edge cases.
      await new Promise((r) => setTimeout(r, 100));
    } else {
      throw new Error(
        "screenshotHtml requires either `html` or `url` (neither supplied)",
      );
    }

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
