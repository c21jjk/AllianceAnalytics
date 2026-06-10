/**
 * Real render job (Day 2 — 2026-05-16).
 *
 * The stub from Day 1 is gone. This function now drives the actual
 * Playwright-based frame renderer, ffmpeg composer, and Supabase Storage
 * uploader in sequence:
 *
 *   queued → processing
 *   ├─  5%  preparing browser
 *   ├─ 5-55% rendering frames per scene (incremental)
 *   ├─ 60%  composing video with ffmpeg
 *   ├─ 80%  ffmpeg done, uploading to Storage
 *   ├─ 95%  upload done
 *   └─ 100% succeeded — Storage URL written
 *
 * Failures at any stage land in `status: "failed"` with a descriptive
 * message. The Playwright browser is always closed in `finally` so a
 * failed render doesn't leak a Chromium process across jobs.
 *
 * Why the orchestration lives here and not in the route handler:
 *   The route returns the queued job to the client immediately so the
 *   client's poll loop can drive the UI. The actual work is fire-and-
 *   forget from the route's perspective — render-job.ts is what runs
 *   in the background, single-file isolated.
 */

import { logger } from "../lib/logger.js";
import { renderScene, closeRenderBrowser } from "../render/render-scene.js";
import { composeVideo } from "../render/compose-video.js";
import {
  uploadVideoToStorage,
  uploadReelCoverToStorage,
} from "../storage/upload-video.js";
import type { JobStore } from "./store.js";
import type { ReelRenderInput } from "../types.js";

/**
 * Hard wall-clock budget for one render job. why 5 minutes: a healthy
 * 15s Reel renders in well under a minute; anything past 5 minutes
 * means a hung Chromium evaluate, a stalled photo fetch, or a wedged
 * upload. The watchdog marks the job failed and tears the browser down
 * so the worker can take the next job instead of pinning "processing"
 * forever.
 */
const JOB_DEADLINE_MS = 5 * 60_000;

/**
 * Run a render job. Returns when the job has reached a terminal state
 * (succeeded or failed). The caller does NOT await this — /render
 * fires it and returns the queued job to the client immediately, so
 * the poll loop drives the UI.
 *
 * @param jobId — id of the job to drive. The store row must already
 *   exist in status "queued" (created by the /render route).
 * @param input — the validated ReelRenderInput. Drives every scene
 *   render + the ffmpeg composition + the upload path.
 * @param store — the JobStore the route also uses. Decoupled so this
 *   function is testable with a fake.
 */
export async function runRenderJob(
  jobId: string,
  input: ReelRenderInput,
  store: JobStore,
): Promise<void> {
  const composition = input.composition;
  const startedAt = Date.now();
  // why: cache the dimensions + fps locally so each module call gets the
  // same options object reference shape. The composition's schemaVersion
  // pins these to (1080, 1920, 30) at the type level, so we don't need to
  // re-validate them here.
  const renderOpts = {
    width: composition.width,
    height: composition.height,
    fps: composition.frameRate,
  } as const;

  // why: set when the watchdog fires so the zombie pipeline (which keeps
  // running until the browser close kills it) can't flip the job's
  // terminal "failed" status back to "succeeded" after the fact.
  let deadlineFired = false;

  // why an inner closure instead of inlining in the try: the outer
  // function Promise.races the whole pipeline against a hard deadline.
  const runPipeline = async (): Promise<void> => {
    logger.info("render.start", {
      job_id: jobId,
      scenes: composition.scenes.length,
      total_duration_ms: composition.totalDurationMs,
      has_audio: composition.audio !== null,
    });

    // ---- 0..5% — preparing ----
    // why: the explicit "processing 0" transition lets /render/:id callers
    // see the work has been picked up before the first scene renders. Some
    // scenes (especially design-kind with many image layers) can take 1-2s
    // for the first frame because Chromium has to fetch + decode the
    // listing photo; the early progress update prevents the UI from
    // looking frozen during that window.
    store.update(jobId, { status: "processing", progress_pct: 5 });

    // ---- 5..55% — per-scene frame rendering ----
    // why: render scenes sequentially even though they could conceptually
    // be parallelized. The cached Playwright browser/page is single-
    // threaded inside the worker — running two scenes in parallel would
    // require two browser instances, doubling memory + slowing each by
    // the GIL-ish single-CPU shared between them. Sequential is faster
    // overall on the shared-cpu-2x VM size we picked.
    const sceneBuffers: Buffer[][] = [];
    const sceneCount = composition.scenes.length;
    for (let i = 0; i < sceneCount; i++) {
      const scene = composition.scenes[i];
      // why: explicit guard for noUncheckedIndexedAccess. The loop bound is
      // sceneCount === composition.scenes.length so this is impossible in
      // practice — the guard satisfies the type system and surfaces a
      // clear runtime error if some future refactor breaks the invariant.
      if (!scene) {
        throw new Error(
          `Internal: scene at index ${i} is undefined despite being within sceneCount ${sceneCount}.`,
        );
      }
      logger.info("render.scene.start", {
        job_id: jobId,
        scene_index: i,
        scene_kind: scene.content.kind,
        scene_duration_ms: scene.durationMs,
      });
      const frames = await renderScene(scene, {
        ...renderOpts,
        // why: per-frame progress callback wires into the JOB progress
        // counter, NOT the SCENE counter. The math maps each scene's
        // frame stream onto a slice of the 5..55% range.
        onProgress: (frameIdx, totalFrames) => {
          // Progress contribution: 50% total split across scenes.
          const sceneSliceStart = 5 + (i / sceneCount) * 50;
          const sceneSliceEnd = 5 + ((i + 1) / sceneCount) * 50;
          const intraScenePct =
            totalFrames > 0 ? frameIdx / totalFrames : 0;
          const pct = Math.round(
            sceneSliceStart +
              (sceneSliceEnd - sceneSliceStart) * intraScenePct,
          );
          store.update(jobId, { progress_pct: pct });
        },
      });
      sceneBuffers.push(frames);
      logger.info("render.scene.done", {
        job_id: jobId,
        scene_index: i,
        frames_rendered: frames.length,
      });
    }
    store.update(jobId, { progress_pct: 55 });

    // ---- 55..58% — extract + upload the cover PNG (first frame) ----
    // why: the IG Reels grid cover must match the first second of the
    // rendered video (which is the designed hero card), NOT the listing's
    // raw hero photo. We grab sceneBuffers[0][0] (the literal first frame
    // of the first scene) and upload it as a separate PNG in the same
    // bucket under a `covers/` prefix.
    //
    // Failure handling: a missing/empty first-frame buffer (shouldn't
    // happen — REEL_CAPS.minScenes ≥ 2 — but guard defensively) skips the
    // cover upload entirely. The main app's persist path treats a null
    // cover_url as "fall back to listing hero photo", so a skipped cover
    // degrades gracefully. A FAILED upload (network, bucket misconfig,
    // size cap exceeded) is logged at warn and also produces a null
    // cover — we explicitly do NOT fail the whole render for a cover
    // upload glitch because the MP4 is the critical artifact.
    let coverUrl: string | null = null;
    let coverPath: string | null = null;
    const firstFrame = sceneBuffers[0]?.[0];
    if (firstFrame === undefined) {
      // why warn-not-throw: the video render succeeded; missing the cover
      // is a degraded path, not a failure. Surface in logs so we notice.
      logger.warn("render.cover.skipped_missing_first_frame", {
        job_id: jobId,
        scene_buffers_len: sceneBuffers.length,
        first_scene_frames: sceneBuffers[0]?.length ?? 0,
      });
    } else {
      try {
        const coverUpload = await uploadReelCoverToStorage(firstFrame, jobId);
        coverUrl = coverUpload.url;
        coverPath = coverUpload.path;
        logger.info("render.cover.uploaded", {
          job_id: jobId,
          cover_url: coverUrl,
          bytes: coverUpload.size,
        });
      } catch (coverErr) {
        // why: same degraded-path rationale as the missing-frame branch.
        // Don't bubble — the MP4 path is the user-visible value.
        logger.warn("render.cover.upload_failed", {
          job_id: jobId,
          error:
            coverErr instanceof Error ? coverErr.message : String(coverErr),
        });
      }
    }
    store.update(jobId, { progress_pct: 58 });

    // ---- 55..80% — ffmpeg composition ----
    // why: ffmpeg's progress events are not currently wired (would need a
    // separate parser of stderr or fluent-ffmpeg's `.on("progress")`). For
    // MVP we just bump to 60 at start, 80 at end. Encoding a 7-second
    // 1080×1920 H.264 with our preset takes ~3-8s on the worker's
    // shared-cpu-2x VM, so the "60→80" jump is visually fine even without
    // intermediate progress.
    store.update(jobId, { progress_pct: 60 });
    logger.info("render.compose.start", {
      job_id: jobId,
      scene_frame_counts: sceneBuffers.map((f) => f.length),
    });
    const mp4 = await composeVideo(
      { scenesFrames: sceneBuffers, composition },
      renderOpts,
    );
    store.update(jobId, { progress_pct: 80 });
    logger.info("render.compose.done", {
      job_id: jobId,
      mp4_bytes: mp4.length,
    });

    // ---- 80..95% — Supabase Storage upload ----
    store.update(jobId, { progress_pct: 85 });
    const uploaded = await uploadVideoToStorage(mp4, jobId);
    store.update(jobId, { progress_pct: 95 });
    logger.info("render.upload.done", {
      job_id: jobId,
      video_url: uploaded.url,
      bytes: uploaded.size,
    });

    // ---- 100% — succeeded ----
    // why the deadlineFired guard: if the watchdog already marked this
    // job failed, the zombie pipeline must not overwrite that terminal
    // state with a late success.
    if (deadlineFired) return;
    store.update(jobId, {
      status: "succeeded",
      progress_pct: 100,
      video_url: uploaded.url,
      video_path: uploaded.path,
      duration_ms: composition.totalDurationMs,
      // why: cover_url/cover_path may be null (degraded path — see the
      // cover upload block above). The main app's persist action falls
      // back to the listing's hero photo when null.
      cover_url: coverUrl,
      cover_path: coverPath,
    });
    logger.info("render.succeeded", {
      job_id: jobId,
      duration_ms: composition.totalDurationMs,
      total_elapsed_ms: Date.now() - startedAt,
      bytes: uploaded.size,
    });
  };

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pipeline = runPipeline();
    // why swallow the zombie's rejection: when the deadline wins the
    // race, the pipeline keeps running until the browser close in the
    // finally block kills it. Its eventual rejection must not become an
    // unhandled rejection that terminates the process.
    void pipeline.catch(() => undefined);
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        deadlineFired = true;
        reject(
          new Error(
            `Render job exceeded the ${Math.round(JOB_DEADLINE_MS / 1000)}s watchdog deadline`,
          ),
        );
      }, JOB_DEADLINE_MS);
    });
    await Promise.race([pipeline, deadline]);
  } catch (err) {
    // why: any throw INSIDE the render pipeline must be captured here.
    // If it propagates out, Node will treat it as an unhandled rejection
    // and (in modern Node) terminate the process — taking every other
    // in-flight job down with it.
    const message = err instanceof Error ? err.message : String(err);
    logger.error("render.failed", {
      job_id: jobId,
      error: message,
      elapsed_ms: Date.now() - startedAt,
    });
    store.update(jobId, {
      status: "failed",
      error: message,
    });
  } finally {
    // why clear the timer: a finished pipeline must not leave a live
    // 5-minute timeout keeping the event loop busy (and firing
    // deadlineFired on a job that already completed).
    if (deadlineTimer !== undefined) {
      clearTimeout(deadlineTimer);
    }
    // why: release Playwright resources between jobs. The cached browser
    // instance is at module scope inside render-scene.ts so we explicitly
    // close it here rather than letting it linger across job boundaries.
    // Re-opening on the next job pays a ~500ms Chromium-startup cost; in
    // exchange we get clean memory + no stale-page-state bugs that
    // accumulate over a long-running worker.
    try {
      await closeRenderBrowser();
    } catch (e) {
      // Best-effort cleanup. Logging only — a failed close is not a job
      // failure (the job's status is already terminal at this point).
      logger.warn("render.cleanup.failed", {
        job_id: jobId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
