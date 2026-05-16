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
import { ReelRenderInputZ } from "../types.js";

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
