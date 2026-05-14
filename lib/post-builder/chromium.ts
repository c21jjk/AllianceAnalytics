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
 * Screenshot HTML at exact dimensions using headless Chromium.
 *
 * On Vercel the @sparticuz/chromium-min package is paired with a
 * publicly-hosted Chromium tarball — the binary downloads on cold start
 * and gets cached in /tmp.
 *
 * Locally we fall back to puppeteer-core's auto-detected system Chrome
 * via PUPPETEER_EXECUTABLE_PATH or the standard macOS path.
 */
export async function screenshotHtml(args: {
  html: string;
  width: number;
  height: number;
  /** Optional tag prefixed onto log lines (defaults to "render"). */
  log_label?: string;
}): Promise<Buffer> {
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
    await page.setContent(args.html, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    stage("setContent done");
    try {
      await Promise.race([
        page.evaluate(() => (document as Document).fonts.ready),
        new Promise((_, rej) => setTimeout(() => rej(new Error("font-timeout")), 5_000)),
      ]);
      stage("fonts ready");
    } catch (e) {
      console.warn(`[${label}] font wait skipped: ${(e as Error).message}`);
    }
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
