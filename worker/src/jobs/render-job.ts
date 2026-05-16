/**
 * Stub render function — Day 1 placeholder.
 *
 * why a stub: today's deliverable is the SCAFFOLD, not the renderer.
 * Day 2 we replace the body of `runRenderJob` with real work
 * (Fabric server-side composition → ffmpeg encode → Supabase Storage
 * upload). The function SIGNATURE + the state-machine progression
 * stays the same so:
 *   - The /render route, the job store, and the main app's poll loop
 *     can be wired end-to-end TODAY against the stub.
 *   - Day 2 is a single-file change with no surface churn.
 *
 * State machine the real renderer will follow:
 *   queued → processing (0%)   — composing first frame
 *   processing (20%)           — Fabric scene 1 rendered
 *   processing (50%)           — all scenes composited
 *   processing (80%)           — ffmpeg encoded, awaiting upload
 *   succeeded                  — Storage URL written, duration_ms set
 *
 * On throw → status=failed with error message. Never crashes the
 * worker — every failure is captured into the job record.
 */

import { logger } from "../lib/logger.js";
import type { JobStore } from "./store.js";
import type { ReelRenderInput } from "../types.js";

/** Sleep helper. Promise wrapper over setTimeout so async/await flows
 *  read cleanly. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a render job. Returns when the job has reached a terminal state
 * (succeeded or failed). The caller does NOT await this — /render
 * fires it and returns the queued job to the client immediately, so
 * the poll loop drives the UI.
 *
 * @param jobId — id of the job to drive. The store row must already
 *   exist in status "queued" (created by the /render route).
 * @param input — the validated ReelRenderInput. Day 2 the stub starts
 *   reading composition.scenes etc. — for now the body is parameter-
 *   free; we accept the arg so the signature is Day-2-ready.
 * @param store — the JobStore the route also uses. Decoupled so this
 *   function is testable with a fake.
 */
export async function runRenderJob(
  jobId: string,
  input: ReelRenderInput,
  store: JobStore,
): Promise<void> {
  try {
    logger.info("render.start", {
      job_id: jobId,
      scenes: input.composition.scenes.length,
      total_duration_ms: input.composition.totalDurationMs,
    });

    // why: explicit transition out of "queued" so /render/:id callers
    // see the work has been picked up even before the first sleep.
    store.update(jobId, { status: "processing", progress_pct: 0 });

    await sleep(1000);
    store.update(jobId, { status: "processing", progress_pct: 20 });

    await sleep(1000);
    store.update(jobId, { status: "processing", progress_pct: 50 });

    await sleep(1000);
    store.update(jobId, { status: "processing", progress_pct: 80 });

    await sleep(2000);

    // Day 2 replaces these constants with the real upload result.
    const fakeVideoUrl = "https://example.com/fake-reel.mp4";
    const fakeDurationMs = 7000;

    store.update(jobId, {
      status: "succeeded",
      progress_pct: 100,
      video_url: fakeVideoUrl,
      video_path: "stub/fake-reel.mp4",
      duration_ms: fakeDurationMs,
    });

    logger.info("render.succeeded", {
      job_id: jobId,
      duration_ms: fakeDurationMs,
    });
  } catch (err) {
    // why: any throw INSIDE the render pipeline must be captured here.
    // If it propagates out, Node will treat it as an unhandled rejection
    // and (in modern Node) terminate the process — taking every other
    // in-flight job down with it.
    const message = err instanceof Error ? err.message : String(err);
    logger.error("render.failed", { job_id: jobId, error: message });
    store.update(jobId, {
      status: "failed",
      error: message,
    });
  }
}
