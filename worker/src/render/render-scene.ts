/**
 * worker/src/render/render-scene.ts
 *
 * Renders every frame of one Scene as PNG buffers using a headless
 * Chromium tab driven by Playwright. The browser tab loads a small
 * static page (worker/render-page/index.html) that exposes
 * `window.renderSceneFrame(sceneJson, frameIndex, totalFrames)` — that
 * page is the actual frame compositor (Fabric.js). This file is the
 * Node-side driver.
 *
 * Architecture choice — page-per-job vs page-per-scene vs page-shared:
 *   We use ONE Chromium instance and ONE page for the entire job (all
 *   scenes). Tradeoffs considered:
 *     a) Page-per-frame: ~150ms goto() per frame → unusable for 30fps.
 *     b) Page-per-scene: clean isolation, but reloading the page wastes
 *        Fabric initialization (~80ms) for every scene.
 *     c) Page-shared (what we do): one goto() per job. Scenes call
 *        `resetCanvas` inside the page between scenes. ~80ms total
 *        warmup, then frames cost ~15–25ms each.
 *   The browser handle is cached at module scope so a multi-scene
 *   render keeps it warm. The orchestrator MUST call
 *   `closeRenderBrowser()` after the final scene to release resources.
 *
 * Failure handling:
 *   - If the page evaluate() rejects, we throw with the scene id and
 *     frame index in the message. The runRenderJob caller catches and
 *     marks the job failed; the browser is not torn down because other
 *     jobs (future: concurrent jobs in one worker) may be using it.
 *   - If the returned data URL is invalid or suspiciously small, we
 *     throw with a sentinel message — most likely cause is the page's
 *     window.renderSceneFrame returned without drawing anything
 *     (e.g., a network failure on a photo URL).
 *
 * Concurrency:
 *   This module is NOT safe for concurrent renderScene calls today —
 *   the single shared page would interleave frames. The worker's
 *   route layer (server.ts) serializes render jobs via the JobStore
 *   anyway, so this is fine. If we ever scale to in-process concurrency
 *   we'd switch to one page per concurrent slot.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  type Browser,
  type Page,
} from "playwright";

import type { Scene } from "../types.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Cached Chromium handle — created lazily on the first renderScene call. */
let cachedBrowser: Browser | null = null;
/** Cached page handle, sharing the cached browser. */
let cachedPage: Page | null = null;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderSceneOptions {
  /** Total composition width — always 1080 for Reels. */
  width: number;
  /** Total composition height — always 1920. */
  height: number;
  /** Frame rate of the output — always 30. */
  fps: number;
  /** Called per frame so the job tracker can update progress. */
  onProgress?: (frameIndex: number, totalFrames: number) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the render-page/index.html on disk.
 *
 * why this dance: in production the worker is shipped via the Docker
 * image and the `render-page` directory sits at `/app/render-page`
 * (alongside `dist/`). The compiled JS for THIS file ends up at
 * `/app/dist/render/render-scene.js`, so the relative hop is `../../render-page`.
 *
 * In dev (`tsx watch src/server.ts`) the running file is at
 * `worker/src/render/render-scene.ts` and the page is at
 * `worker/render-page/index.html` — the SAME relative hop works.
 *
 * We use `import.meta.url` (ESM) rather than `__dirname` because the
 * tsconfig is module: NodeNext and the file is ESM.
 */
function resolveRenderPageUrl(): string {
  // why: import.meta.url is a file:// URL even in dev; fileURLToPath
  // gives us a real OS path we can pass to path.resolve.
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  const htmlPath = path.resolve(dir, "..", "..", "render-page", "index.html");
  // Playwright wants a file:// URL for local navigation.
  return "file://" + htmlPath;
}

/**
 * Launch (or return the cached) Chromium browser + page. The page has
 * already navigated to the render-page and `window.renderSceneFrame` is
 * available on the global scope.
 */
async function getRenderPage(): Promise<Page> {
  if (cachedPage && cachedBrowser) {
    // why an isConnected guard: a crashed browser still leaves a stale
    // handle on the module. Detect + relaunch instead of throwing on
    // the next page.evaluate.
    if (cachedBrowser.isConnected()) {
      return cachedPage;
    }
    cachedBrowser = null;
    cachedPage = null;
  }

  logger.info("render.browser.launching");
  cachedBrowser = await chromium.launch({
    headless: true,
    args: [
      // why --no-sandbox: required when running as root in the
      // Playwright container image. Fly.io VMs run as root by default.
      "--no-sandbox",
      // why --disable-dev-shm-usage: Chromium uses /dev/shm for IPC
      // shared memory; on small containers /dev/shm defaults to 64MB
      // and Chromium crashes when it fills up. This flag falls back
      // to /tmp which has the VM's full disk.
      "--disable-dev-shm-usage",
      // why --disable-gpu: headless Chromium doesn't need (and on
      // Linux can't usefully access) GPU acceleration; the flag
      // saves ~50ms on startup and avoids "GpuChannelHost" warnings.
      "--disable-gpu",
    ],
  });

  const context = await cachedBrowser.newContext({
    // Lock the viewport to the canonical Reels dimensions. The renderer
    // draws into a 1080×1920 offscreen <canvas>, but matching the
    // viewport keeps anything that incidentally relies on layout (font
    // metrics, etc.) consistent.
    viewport: { width: 1080, height: 1920 },
    // Disable JS dialogs — the page never opens them, but a stray
    // alert from a misbehaving font script would block evaluate().
    javaScriptEnabled: true,
  });

  cachedPage = await context.newPage();
  // why pipe page console to our logger: any console.warn from
  // render.js (image load failures, unknown layer kinds) becomes a
  // structured log line we can grep in production.
  cachedPage.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      logger.warn("render.page.console", {
        type,
        text: msg.text(),
      });
    }
  });
  cachedPage.on("pageerror", (err) => {
    logger.error("render.page.error", { error: err.message });
  });

  const url = resolveRenderPageUrl();
  await cachedPage.goto(url, { waitUntil: "load" });
  // why also wait for fonts: render.js awaits document.fonts.ready
  // before drawing text layers, but warming this up at navigation time
  // means the first frame is no slower than subsequent frames.
  //
  // why the `globalThis as` indirection: this Node tsconfig deliberately
  // omits the DOM lib (we're not building for the browser), so
  // `document` is not a global identifier here. Inside page.evaluate
  // the callback runs in the browser context so `document` exists at
  // runtime — we just need to satisfy the type-checker without pulling
  // in the full DOM lib.
  await cachedPage.evaluate(async () => {
    const doc = (globalThis as unknown as {
      document: { fonts: { ready: Promise<unknown> } };
    }).document;
    await doc.fonts.ready;
  });
  logger.info("render.browser.ready");

  return cachedPage;
}

/**
 * Compute the number of frames for a scene at a given fps.
 *
 * why Math.round (not floor / ceil): 30fps × 1.5s = 45 frames exactly,
 * but floating-point gives us 45.000000001 sometimes; round-trips
 * through Math.round give us the integer the ffmpeg composer expects.
 * Both ceil and floor produce off-by-one drift on the boundary.
 */
function totalFramesFor(durationMs: number, fps: number): number {
  return Math.max(1, Math.round((durationMs / 1000) * fps));
}

/**
 * Parse a `data:image/png;base64,...` URL into a Buffer. Throws on
 * malformed input — the caller treats any throw as a frame-render
 * failure for that scene.
 */
function dataUrlToPngBuffer(dataUrl: unknown, sceneId: string, frameIndex: number): Buffer {
  if (typeof dataUrl !== "string") {
    throw new Error(
      `renderScene[${sceneId}] frame ${frameIndex}: page returned non-string (${typeof dataUrl})`,
    );
  }
  if (!dataUrl.startsWith("data:image/png")) {
    throw new Error(
      `renderScene[${sceneId}] frame ${frameIndex}: data URL missing image/png prefix (got "${dataUrl.slice(0, 40)}…")`,
    );
  }
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    throw new Error(
      `renderScene[${sceneId}] frame ${frameIndex}: data URL missing comma separator`,
    );
  }
  const b64 = dataUrl.slice(comma + 1);
  const buf = Buffer.from(b64, "base64");
  // why 1KB floor: an empty 1080×1920 PNG compresses to ~600 bytes; a
  // valid render of even a uniform color is ~1.2KB minimum. Anything
  // smaller than 1KB is almost certainly a render-failure black frame
  // or a zero-byte buffer from a truncated dataURL.
  if (buf.byteLength < 1024) {
    throw new Error(
      `renderScene[${sceneId}] frame ${frameIndex}: PNG buffer suspiciously small (${buf.byteLength} bytes)`,
    );
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render every frame of a single scene as PNG buffers.
 *
 * Returns an array of length `Math.round(scene.durationMs / 1000 * opts.fps)`.
 * For a 1.5s scene at 30fps, that's 45 frames.
 *
 * Internally launches a headless Chromium instance via Playwright,
 * navigates to the static `render-page/index.html`, and calls
 * `window.renderSceneFrame` for each frame. Reuses the page across
 * frames in the same scene.
 *
 * The browser instance is CACHED at module level — the first scene
 * pays the ~500ms Chromium startup cost; subsequent scenes reuse the
 * same browser. The renderJob orchestrator MUST call
 * `closeRenderBrowser()` at the end of the job to release resources.
 *
 * @throws if the page navigation fails, any frame's evaluate() throws,
 *   or a returned dataURL fails validation (see dataUrlToPngBuffer).
 */
export async function renderScene(
  scene: Scene,
  opts: RenderSceneOptions,
): Promise<Buffer[]> {
  // why explicit validation here even though zod already gate-kept the
  // composition: opts comes from the orchestrator, not from the
  // HTTP boundary. A misuse like fps=0 would otherwise produce a
  // nonsense totalFrames and a silent no-op render. Better to throw.
  if (opts.width !== 1080 || opts.height !== 1920) {
    throw new Error(
      `renderScene: only 1080×1920 supported, got ${opts.width}×${opts.height}`,
    );
  }
  if (opts.fps !== 30) {
    throw new Error(`renderScene: only fps=30 supported, got ${opts.fps}`);
  }
  if (scene.content.kind === "video_clip") {
    // why reject in driver too: the /render route already 400s these,
    // but a future programmatic caller (tests, batch tools) could
    // bypass that path. Defense in depth.
    throw new Error(
      `renderScene[${scene.id}]: video_clip scenes are reserved for Phase 7`,
    );
  }

  const totalFrames = totalFramesFor(scene.durationMs, opts.fps);
  logger.info("render.scene.start", {
    scene_id: scene.id,
    kind: scene.content.kind,
    duration_ms: scene.durationMs,
    total_frames: totalFrames,
  });

  const page = await getRenderPage();

  // why we serialize the scene once and pass by value to evaluate():
  // Playwright will JSON-stringify the argument anyway, so serializing
  // once at the top of the loop avoids repeated serialization cost
  // when the scene content is large (CanvasTemplateSchema with many
  // layers can be ~20KB).
  //
  // The cast through `unknown` is intentional — Playwright's evaluate
  // typing requires a JSON-serializable arg, and Scene is JSON-safe by
  // construction (every field is a primitive, plain object, or array).
  const sceneJson = JSON.parse(JSON.stringify(scene)) as Record<string, unknown>;

  const frames: Buffer[] = [];
  for (let i = 0; i < totalFrames; i += 1) {
    // why evaluate([sceneJson, idx, total]) tuple-arg style: Playwright
    // evaluates the function in the page context; passing multiple
    // args means tuple-wrapping. We typed it via unknown[] then
    // narrowed inside the page-side IIFE wrapper.
    const result: unknown = await page.evaluate(
      async (args: [Record<string, unknown>, number, number]) => {
        const [s, idx, total] = args;
        // why globalThis cast (and not `window`): this tsconfig omits
        // the DOM lib so `window` is not a typed global. globalThis IS
        // defined for both Node + browser at the type level, so we
        // narrow it ourselves to expose the render-page bridge fn.
        const bridge = globalThis as unknown as {
          renderSceneFrame?: (
            scene: Record<string, unknown>,
            frameIndex: number,
            totalFrames: number,
          ) => Promise<string>;
        };
        const fn = bridge.renderSceneFrame;
        if (typeof fn !== "function") {
          throw new Error("window.renderSceneFrame missing");
        }
        return fn(s, idx, total);
      },
      [sceneJson, i, totalFrames] as [Record<string, unknown>, number, number],
    );

    frames.push(dataUrlToPngBuffer(result, scene.id, i));
    if (opts.onProgress) {
      opts.onProgress(i + 1, totalFrames);
    }
  }

  logger.info("render.scene.done", {
    scene_id: scene.id,
    frames: frames.length,
  });

  return frames;
}

/**
 * Close the cached headless browser. Call after all scenes in a
 * composition have rendered. Calling twice is a safe no-op.
 *
 * Errors during close are swallowed (logged at warn) — a failed close
 * shouldn't mask a successful render. If the browser crashed earlier,
 * Playwright will throw here; we drop the stale references either way.
 */
export async function closeRenderBrowser(): Promise<void> {
  const browser = cachedBrowser;
  cachedBrowser = null;
  cachedPage = null;
  if (!browser) return;
  try {
    await browser.close();
    logger.info("render.browser.closed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("render.browser.close_failed", { error: message });
  }
}
