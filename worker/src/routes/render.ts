/**
 * Render routes.
 *
 *   POST /render            — submit a composition, get back a job_id
 *   GET  /render/:job_id    — poll job status
 *
 * Both require the bearer token (mounted behind makeAuthMiddleware in
 * server.ts). Validation: POST body is parsed with ReelRenderInputZ;
 * any mismatch returns 400 with the field-level zod issues so the
 * main app's debugger can fix payload bugs quickly.
 *
 * why fire-and-forget: the renderer runs ~5s today and will run 10-30s
 * once Day 2 ships. We can't keep an HTTP connection open that long
 * across Vercel's edge runtime, Fly's proxy, and the user's browser
 * without something timing out. The poll pattern (return job_id
 * immediately, client polls /render/:id) is the standard fix.
 */

import { Router, type Request, type Response } from "express";

import { logger } from "../lib/logger.js";
import { runRenderJob } from "../jobs/render-job.js";
import type { JobStore } from "../jobs/store.js";
import {
  renderSingleTemplate,
  closeRenderBrowser,
} from "../render/render-scene.js";
import { uploadCanvasImageToStorage } from "../storage/upload-video.js";
import { ReelRenderInputZ, RenderImageInputZ } from "../types.js";

export function makeRenderRouter(store: JobStore): Router {
  const router = Router();

  // why path "/" not "/render": this router is mounted at "/render"
  // in server.ts. The internal paths are relative to that mount point.
  router.post("/", (req: Request, res: Response) => {
    const parsed = ReelRenderInputZ.safeParse(req.body);
    if (!parsed.success) {
      // Flatten zod issues into a single readable string so the main
      // app's network panel + our logs both stay grep-able.
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      res.status(400).json({
        ok: false,
        error: `Body validation failed: ${issues}`,
      });
      return;
    }
    const input = parsed.data;

    // Idempotency check — if we've seen this key in the last 24h,
    // return the existing job instead of starting a new one.
    // why: the main app retries on network blips; without dedupe a
    // single user click could spawn N parallel renders.
    const existing = store.findByIdempotencyKey(input.idempotency_key);
    if (existing !== undefined) {
      logger.info("render.dedupe_hit", {
        job_id: existing.job_id,
        idempotency_key: input.idempotency_key,
      });
      res.status(200).json({
        job_id: existing.job_id,
        status: existing.status,
        poll_url: `/render/${existing.job_id}`,
        deduped: true,
      });
      return;
    }

    const job = store.create({ idempotency_key: input.idempotency_key });
    logger.info("render.queued", {
      job_id: job.job_id,
      idempotency_key: input.idempotency_key,
    });

    // Fire-and-forget. We deliberately do not `await` — the response
    // returns now, the render proceeds asynchronously, the client
    // polls /render/:id. why void: making this explicit silences the
    // no-floating-promises eslint rule when it gets added.
    void runRenderJob(job.job_id, input, store);

    res.status(202).json({
      job_id: job.job_id,
      status: job.status,
      poll_url: `/render/${job.job_id}`,
    });
  });

  router.get("/:job_id", (req: Request, res: Response) => {
    const jobId = req.params.job_id;
    if (typeof jobId !== "string" || jobId.length === 0) {
      res.status(400).json({ ok: false, error: "missing job_id" });
      return;
    }
    const job = store.get(jobId);
    if (job === undefined) {
      res.status(404).json({ ok: false, error: "job not found" });
      return;
    }
    res.status(200).json(job);
  });

  return router;
}

// ---------------------------------------------------------------------------
// /render-image router — synchronous single-template canvas render
// ---------------------------------------------------------------------------
//
// why a separate router mounted at "/render-image" instead of folding into
// the /render router: Express's app.use("/render", ...) only matches paths
// where "/render" is a complete path segment. "/render-image" with a hyphen
// is NOT a sub-path of "/render" — it's a sibling. Mounting a second
// router (gated by the same auth middleware in server.ts) keeps the paths
// honest.
//
// why it doesn't take a JobStore: single-template renders are synchronous,
// so there's no job to track. The endpoint renders + uploads + returns the
// public URL inline.

/** Build the /render-image router. Mount in server.ts via
 *  app.use("/render-image", auth, makeRenderImageRouter()). */
export function makeRenderImageRouter(): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const parsed = RenderImageInputZ.safeParse(req.body);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      res.status(400).json({
        ok: false,
        error: `Body validation failed: ${issues}`,
      });
      return;
    }
    const input = parsed.data;
    const startedAt = Date.now();

    logger.info("render_image.start", {
      idempotency_key: input.idempotency_key,
    });

    try {
      // why 1080×1920 hardcoded: same canonical dimensions the Reels
      // pipeline uses. Future callers wanting different sizes (square IG,
      // story 9:16, etc.) will pass dimensions through the body and a
      // future version of renderSingleTemplate.
      const png = await renderSingleTemplate(
        input.template,
        input.listing,
        { width: 1080, height: 1920, fps: 30 },
      );

      const uploaded = await uploadCanvasImageToStorage(
        png,
        input.idempotency_key,
      );

      logger.info("render_image.succeeded", {
        idempotency_key: input.idempotency_key,
        url: uploaded.url,
        bytes: uploaded.size,
        duration_ms: Date.now() - startedAt,
      });

      res.status(200).json({
        ok: true,
        url: uploaded.url,
        path: uploaded.path,
      });
    } catch (err) {
      // why log + return 500 with the error message: this endpoint is
      // synchronous, so failure surfaces directly to the caller. The
      // structured error helps the main app distinguish "Chromium crashed"
      // from "bucket misconfig" without an extra round-trip.
      const message = err instanceof Error ? err.message : String(err);
      logger.error("render_image.failed", {
        idempotency_key: input.idempotency_key,
        error: message,
        duration_ms: Date.now() - startedAt,
      });
      res.status(500).json({ ok: false, error: message });
    } finally {
      // why: same browser-cleanup discipline as the video pipeline. Hold
      // the browser open across the render+upload window; release once
      // the response has been queued. If the worker handles a follow-up
      // /render or /render-image immediately, the next call pays a
      // ~500ms Chromium relaunch — acceptable in exchange for cleaner
      // memory between requests.
      try {
        await closeRenderBrowser();
      } catch (e) {
        logger.warn("render_image.cleanup.failed", {
          idempotency_key: input.idempotency_key,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });

  return router;
}
