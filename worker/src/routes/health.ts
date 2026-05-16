/**
 * GET /health — unauthenticated liveness/readiness probe.
 *
 * Consumed by:
 *   - Docker HEALTHCHECK (every 30s — if non-200, the container is
 *     marked unhealthy and Fly restarts it).
 *   - Fly's load balancer auto-stop/start logic (a healthy /health
 *     keeps the machine running; idleness triggers stop).
 *   - Humans curling the public URL post-deploy.
 *
 * why no auth here: a healthcheck endpoint that requires the bearer
 * token would mean the Docker HEALTHCHECK instruction needs the
 * token baked into the image OR fetched via env at runtime — both
 * couple ops surface to a secret. Public /health is the industry
 * default; we expose ONLY non-sensitive aggregate counts.
 */

import { Router, type Request, type Response } from "express";

import type { JobStore } from "../jobs/store.js";

/** Stable version string. Bumped manually when we ship a meaningful
 *  worker change; used to verify a deploy actually rolled out. */
const WORKER_VERSION = "0.1.0";

export function makeHealthRouter(store: JobStore): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    const counts = store.diagnostics();
    res.status(200).json({
      ok: true,
      version: WORKER_VERSION,
      jobs: counts,
    });
  });

  return router;
}
