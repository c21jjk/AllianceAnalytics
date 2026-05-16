/**
 * In-memory job store for ReelRenderJob records.
 *
 * why in-memory and not Redis: Day 1 the worker runs as a single Fly
 * machine. There's exactly one process and one address-space, so a
 * `Map` is perfectly safe and zero-ops. When we scale to N workers
 * (Day 5+) we'll need shared storage — Upstash Redis or Fly's
 * regional KV — and the swap is a one-file change because every
 * consumer of this module talks through the JobStore interface
 * below. Don't optimize ahead of the constraint.
 *
 * TTL: jobs auto-evict 24h after created_at. A sweep runs every 5
 * minutes. why 24h: the main app's idempotency window is 24h, so
 * a job needs to be retrievable for at least that long after submit.
 * The sweep itself is cheap (one scan over a Map) and bounded by
 * however many jobs we've run in 24h — at MVP traffic, < 100.
 *
 * Secondary index on idempotency_key: makes the /render dedupe path
 * O(1) instead of O(n) over all live jobs. The render route checks
 * this before creating a new job.
 */

import { randomUUID } from "node:crypto";

import { logger } from "../lib/logger.js";
import type { ReelRenderJob, ReelRenderStatus } from "../types.js";

/** Public job-store interface — see in-file `why` for the rationale.
 *  Future Redis implementation will satisfy this exact shape. */
export interface JobStore {
  /** Create a new job with status="queued", echoing the idempotency
   *  key. Returns the freshly-minted job. */
  create(input: { idempotency_key: string }): ReelRenderJob;
  /** Get a job by id, or undefined if not found / evicted. */
  get(id: string): ReelRenderJob | undefined;
  /** Find an EXISTING job by idempotency_key within the last 24h.
   *  Returns undefined if none. why 24h: matches the main app's
   *  idempotency window. */
  findByIdempotencyKey(key: string): ReelRenderJob | undefined;
  /** Partial update. Returns the updated job, or undefined if not
   *  found. Always bumps updated_at to now. */
  update(id: string, patch: Partial<ReelRenderJob>): ReelRenderJob | undefined;
  /** Lightweight snapshot for /health diagnostics. Returns counts by
   *  status, not the full job rows (don't want /health to balloon
   *  memory under load). */
  diagnostics(): { queued: number; processing: number; succeeded: number; failed: number };
  /** Stop the periodic TTL sweep. Used during graceful shutdown so
   *  the Node event loop can exit. */
  stop(): void;
}

/** TTL window — jobs older than this are evicted on the next sweep. */
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
/** Sweep cadence. 5 min keeps eviction work bounded without burning CPU. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Concrete in-memory implementation. */
class InMemoryJobStore implements JobStore {
  private readonly byId = new Map<string, ReelRenderJob>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor() {
    // unref() lets the Node process exit even if the timer is pending —
    // important so SIGTERM doesn't have to wait up to 5 min for the
    // next tick.
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  create(input: { idempotency_key: string }): ReelRenderJob {
    const now = new Date().toISOString();
    const job: ReelRenderJob = {
      job_id: randomUUID(),
      status: "queued",
      progress_pct: 0,
      video_url: null,
      video_path: null,
      duration_ms: null,
      error: null,
      created_at: now,
      updated_at: now,
      idempotency_key: input.idempotency_key,
    };
    this.byId.set(job.job_id, job);
    this.byIdempotencyKey.set(input.idempotency_key, job.job_id);
    return job;
  }

  get(id: string): ReelRenderJob | undefined {
    return this.byId.get(id);
  }

  findByIdempotencyKey(key: string): ReelRenderJob | undefined {
    const id = this.byIdempotencyKey.get(key);
    if (id === undefined) return undefined;
    const job = this.byId.get(id);
    if (job === undefined) {
      // The job was evicted but the secondary-index entry lingered —
      // clean it up opportunistically.
      this.byIdempotencyKey.delete(key);
      return undefined;
    }
    return job;
  }

  update(id: string, patch: Partial<ReelRenderJob>): ReelRenderJob | undefined {
    const existing = this.byId.get(id);
    if (existing === undefined) return undefined;
    // Spread `patch` AFTER `existing` so the patch wins, but force
    // updated_at to always be `now` regardless of caller — the caller
    // shouldn't have to remember to set it.
    const next: ReelRenderJob = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.byId.set(id, next);
    return next;
  }

  diagnostics(): {
    queued: number;
    processing: number;
    succeeded: number;
    failed: number;
  } {
    const counts = { queued: 0, processing: 0, succeeded: 0, failed: 0 };
    for (const job of this.byId.values()) {
      counts[job.status satisfies ReelRenderStatus] += 1;
    }
    return counts;
  }

  stop(): void {
    clearInterval(this.sweepTimer);
  }

  /** Walk every job and drop the ones past TTL. Logs the count when
   *  non-zero so we can confirm sweeps are doing useful work. */
  private sweep(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    let evicted = 0;
    for (const [id, job] of this.byId.entries()) {
      if (Date.parse(job.created_at) < cutoff) {
        this.byId.delete(id);
        this.byIdempotencyKey.delete(job.idempotency_key);
        evicted += 1;
      }
    }
    if (evicted > 0) {
      logger.info("job_store.sweep_evicted", { evicted });
    }
  }
}

/** Factory. Hides the concrete impl — only `JobStore` should leak out. */
export function createJobStore(): JobStore {
  return new InMemoryJobStore();
}
