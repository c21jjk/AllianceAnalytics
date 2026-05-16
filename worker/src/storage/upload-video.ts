/**
 * Supabase Storage uploader for rendered Reel MP4s.
 *
 * why a dedicated module: the render worker has exactly one "external
 * write" — the MP4 → Storage upload. Isolating it here keeps the
 * orchestrator (`jobs/render-job.ts`) easy to read and means anyone
 * debugging an upload failure has one obvious file to open.
 *
 * Failure handling: every error path throws a typed Error with a
 * human-readable message. The orchestrator catches it and writes the
 * message to the job row's `error` column. Special-cased: a missing
 * bucket produces a custom message because that's a one-time
 * provisioning mistake that would otherwise look like a generic
 * "upload failed" and burn an hour of debugging.
 */

import { logger } from "../lib/logger.js";
import { getSupabaseAdmin } from "./supabase-client.js";

/** Bucket where Reel MP4s live. Must exist + be PUBLIC. */
// why: hardcoded constant rather than env var. The bucket name is part
// of the data model (paths stored in DB rows reference this bucket),
// not configuration — env-driving it would let staging/prod drift and
// produce dangling references. Match the canvas-save pattern from
// `app/api/post-builder/canvas-save/route.ts`.
const STORAGE_BUCKET = "post-builder-reels";

/** Max acceptable MP4 size before we treat it as a broken render. */
// why: 50 MB. Realistic Reels MP4s (9–60s at 1080×1920, h264 high) come
// in well under 20 MB. IG Graph's hard ceiling is ~100 MB. Anything over
// 50 MB almost certainly means the encoder ran without compression
// (raw frames, wrong codec, etc.) — fail fast rather than burn upload
// bandwidth and end up with a video Meta will reject anyway.
const MAX_MP4_BYTES = 50 * 1024 * 1024;

/** 1-year browser cache. Paths are unique per render so it's safe. */
const CACHE_CONTROL_SECONDS = "31536000";

/** Substrings in Supabase error messages that mean "bucket does not
 *  exist". The SDK doesn't expose a typed error code for this, so we
 *  pattern-match. Cheap and stable — the strings are stable across
 *  storage-js versions. */
const BUCKET_NOT_FOUND_SUBSTRINGS = ["bucket not found", "not_found"];

export interface UploadVideoResult {
  /** Public URL of the uploaded MP4. */
  url: string;
  /** Internal Storage path — used for cleanup on row delete/replace. */
  path: string;
  /** Final byte size of the uploaded file. */
  size: number;
}

/**
 * Upload a rendered Reel MP4 to Supabase Storage.
 *
 * Bucket: `post-builder-reels` (must exist — create via Supabase dashboard
 * or `mcp__supabase__apply_migration` with `INSERT INTO storage.buckets ...`).
 * Path:   `reels/{job_id}.mp4`
 *
 * The bucket must be PUBLIC so social-platform Graph APIs (IG Reels +
 * FB videos) can fetch the file via `video_url` for ingestion. Public
 * Supabase Storage URLs are fine — they're long random IDs that aren't
 * enumerable, and the audience-facing media will live on Meta/TikTok
 * after publish anyway.
 *
 * Returns the public URL + internal path + byte size. Throws with a clear
 * error message on any failure (bucket missing, auth bad, network error,
 * size cap exceeded).
 *
 * Caller is responsible for cleaning up the old MP4 at the prior path if
 * this upload replaces an earlier render (e.g., the user re-edits a Reel).
 * That cleanup happens at the row-update server action level, NOT here.
 *
 * @param mp4   — encoded MP4 bytes from the ffmpeg composer step.
 * @param jobId — uuid identifying the render job. Becomes the filename.
 */
export async function uploadVideoToStorage(
  mp4: Buffer,
  jobId: string,
): Promise<UploadVideoResult> {
  const size = mp4.length;

  // why: size cap check first — cheap, deterministic, no network call.
  // If the buffer is garbage-large, fail before we waste bandwidth.
  if (size > MAX_MP4_BYTES) {
    throw new Error(
      `Rendered MP4 is ${size} bytes (cap: ${MAX_MP4_BYTES}). ` +
        `This usually means the encoder ran without compression. ` +
        `Check the ffmpeg composer step before re-uploading.`,
    );
  }

  // why: also guard against empty buffer. A 0-byte upload "succeeds"
  // in Storage but produces an unplayable file — much better to fail
  // here with a clear message than ship a broken URL downstream.
  if (size === 0) {
    throw new Error(
      "Rendered MP4 buffer is empty (0 bytes). The render pipeline " +
        "produced no output — check the ffmpeg composer step.",
    );
  }

  const path = `reels/${jobId}.mp4`;
  const startedAt = Date.now();

  logger.info("storage.upload.start", {
    job_id: jobId,
    bucket: STORAGE_BUCKET,
    path,
    size_bytes: size,
  });

  const supabase = getSupabaseAdmin();

  // why: upsert: false — job IDs are UUIDs so collisions are
  // mathematically impossible, but if one ever shows up it means
  // something is REALLY wrong (re-running a completed job?), and we
  // want a loud failure, not a silent overwrite.
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, mp4, {
      contentType: "video/mp4",
      upsert: false,
      cacheControl: CACHE_CONTROL_SECONDS,
    });

  if (uploadError) {
    const message = uploadError.message ?? String(uploadError);
    const lowered = message.toLowerCase();

    // why: special-case bucket-missing because it's a provisioning
    // problem with a one-line fix (create the bucket), not an
    // operational failure. The friendly message saves an hour of
    // "why is upload_failed showing up only on this env" debugging.
    if (BUCKET_NOT_FOUND_SUBSTRINGS.some((s) => lowered.includes(s))) {
      throw new Error(
        `Storage bucket '${STORAGE_BUCKET}' does not exist. ` +
          `Create it in the Supabase dashboard or apply a migration ` +
          `that inserts into storage.buckets.`,
      );
    }

    throw new Error(
      `Supabase Storage upload failed: ${message}. ` +
        `Path: ${path}. Bucket: ${STORAGE_BUCKET}.`,
    );
  }

  // why: getPublicUrl is synchronous and never throws — it just
  // constructs the URL by string concatenation. Safe to call here
  // because the upload above succeeded; if the bucket weren't public
  // the URL would still be returned but would 401 when fetched. That's
  // an operator misconfiguration (bucket created as private), not a
  // bug we can defend against from here without an extra round-trip.
  const { data: pub } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path);

  const url = pub.publicUrl;
  const durationMs = Date.now() - startedAt;

  logger.info("storage.upload.succeeded", {
    job_id: jobId,
    bucket: STORAGE_BUCKET,
    path,
    size_bytes: size,
    duration_ms: durationMs,
  });

  return { url, path, size };
}
