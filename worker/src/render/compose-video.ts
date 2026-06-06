/**
 * Compose an MP4 from per-scene PNG frame buffers + an optional audio track.
 *
 * This is the third stage of the Reel render pipeline:
 *   render-scene.ts   → produces PNG buffers per scene
 *   compose-video.ts  → THIS FILE — stitches frames + transitions + audio → MP4
 *   upload-video.ts   → uploads the MP4 to Supabase Storage
 *
 * The composer is intentionally stateless: it takes everything it needs as
 * arguments and produces a Buffer. All temp files are created under a
 * per-render tempdir and cleaned up in a finally block — even on success —
 * so we don't accumulate gigabytes of scratch on the worker between renders.
 *
 * Filter graph (conceptual):
 *
 *   [0:v] ─┐                                    (scene 0 frames)
 *   [1:v] ─┼─ xfade chain ──► [vout] ──► libx264 ──► out.mp4
 *   [2:v] ─┘                                    (scene N frames)
 *                                  ┌── [a_out]
 *   audio.mp3 ─► volume + afade ───┘
 *
 * "cut" transitions break the xfade chain and fall back to concat between
 * the two sub-segments. In practice MVP comps almost always use a single
 * transition style across all cuts, so the chain is usually homogeneous.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

import installer from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";

import type {
  AudioTrack,
  TransitionType,
  VideoComposition,
} from "../types.js";

// ---------------------------------------------------------------------------
// ffmpeg binary resolution
// ---------------------------------------------------------------------------

// why: in production we run on the Playwright base image which ships ffmpeg
// at /usr/bin/ffmpeg. Locally (Mac/linux dev boxes) the @ffmpeg-installer
// package bundles a binary for the host platform and exports its path. We
// always point fluent-ffmpeg at the installer path — if it doesn't exist on
// the platform (rare; the package supports darwin/linux/win on common
// arches), the worker process will fail loudly at startup which is better
// than silently picking up a system ffmpeg with unknown codec support.
ffmpeg.setFfmpegPath(installer.path);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ComposeVideoOptions {
  /** Output width — always 1080 for Reels. */
  width: number;
  /** Output height — always 1920. */
  height: number;
  /** Output frame rate — always 30. */
  fps: number;
}

export interface ComposeVideoInput {
  /**
   * Frames per scene, parallel array to composition.scenes. Each inner
   * array has Math.round(scene.durationMs / 1000 * fps) entries.
   */
  scenesFrames: readonly Buffer[][];
  /** The composition document — drives transition durations + audio config. */
  composition: VideoComposition;
}

// ---------------------------------------------------------------------------
// xfade transition mapping
// ---------------------------------------------------------------------------

/**
 * Map our domain TransitionType → ffmpeg xfade preset name.
 *
 * why:
 *   - "cut"        → no xfade at all; scenes are concatenated end-to-end.
 *     Returns null to signal "skip xfade for this seam".
 *   - "fade"       → "fade" (cross-dissolve between the two scenes).
 *   - "dissolve"   → "fadeblack" (dip-to-black between scenes — more
 *     dramatic than a cross-dissolve, matches what most editors call
 *     "dissolve" in real-estate edits).
 *   - "slide_left" → "slideleft" (incoming scene slides in from the right,
 *     pushing outgoing scene off the left).
 *   - "zoom_blur"  → "smoothleft". True zoom-blur isn't an xfade preset
 *     (would need a custom GL filter or per-frame blur+scale pipeline,
 *     way out of MVP scope). smoothleft is a soft-motion preset that
 *     reads as "energetic transition" without the cost.
 */
function xfadePresetFor(t: TransitionType): string | null {
  switch (t) {
    case "cut":
      return null;
    case "fade":
      return "fade";
    case "dissolve":
      return "fadeblack";
    case "fade_white":
      return "fadewhite";
    case "slide_left":
      return "slideleft";
    case "slide_right":
      return "slideright";
    case "slide_up":
      return "slideup";
    case "slide_down":
      return "slidedown";
    case "wipe_left":
      return "wipeleft";
    case "smooth_left":
      return "smoothleft";
    case "smooth_right":
      return "smoothright";
    case "circle_open":
      return "circleopen";
    case "zoom_blur":
      // why: closest analog available in xfade. Documented limitation.
      return "smoothleft";
    default: {
      // Exhaustiveness check — if a new TransitionType is added and we
      // forget to map it here, TS will fail to compile.
      const _exhaustive: never = t;
      throw new Error(`unhandled transition type: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a scene's PNG buffers to a per-scene subdirectory as zero-padded
 * sequential files (00001.png, 00002.png, ...). Returns the subdir path
 * so the caller can pass it to ffmpeg's image-sequence input.
 */
async function writeSceneFrames(
  sceneIndex: number,
  frames: readonly Buffer[],
  workDir: string,
): Promise<string> {
  const subdir = path.join(workDir, `scene${sceneIndex}`);
  await fs.mkdir(subdir, { recursive: true });
  // why: pad to 5 digits — max scene at 10s × 30fps = 300 frames, fits in
  // 5 digits with room. ffmpeg's %05d format string matches exactly.
  await Promise.all(
    frames.map((buf, i) => {
      const name = String(i + 1).padStart(5, "0") + ".png";
      return fs.writeFile(path.join(subdir, name), buf);
    }),
  );
  return subdir;
}

/**
 * Download the audio track to a temp file. Uses Node 22's global fetch.
 * Rejects with a descriptive error on non-200 responses or empty body.
 */
async function downloadAudio(
  audio: AudioTrack,
  destPath: string,
): Promise<void> {
  const res = await fetch(audio.url);
  if (!res.ok) {
    throw new Error(
      `audio download failed: ${res.status} ${res.statusText} for ${audio.url}`,
    );
  }
  if (!res.body) {
    throw new Error(`audio download returned empty body for ${audio.url}`);
  }
  // why: res.body is a Web ReadableStream; Readable.fromWeb adapts it to a
  // Node Readable so we can pipe straight to disk without buffering the
  // whole audio file in memory (most tracks are 1-3 MB, but the pattern
  // generalizes).
  const nodeStream = Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(destPath));
}

/**
 * Probe an ffmpeg arg list and run it via spawn. We use child_process.spawn
 * directly (rather than fluent-ffmpeg's run()) for the multi-input + complex
 * filter case because fluent-ffmpeg's input-options-per-input plumbing is
 * fiddly when each input needs DIFFERENT options (per-scene -framerate,
 * different from audio input options). Spawn gives us total control over
 * argv ordering, which is what ffmpeg actually cares about.
 */
function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(installer.path, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      // why: ffmpeg writes everything to stderr (progress + errors). We
      // only need the tail on failure; cap the buffer to avoid OOM on a
      // pathological run.
      stderr += chunk.toString("utf8");
      if (stderr.length > 64_000) {
        stderr = stderr.slice(-64_000);
      }
    });
    proc.on("error", (err) => {
      reject(new Error(`ffmpeg failed: ${err.message}`));
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `ffmpeg failed: exited with code ${String(code)}\n${stderr.slice(-2000)}`,
        ),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Filter graph builder
// ---------------------------------------------------------------------------

interface FilterGraphResult {
  /** The full -filter_complex argument string. */
  filterComplex: string;
  /** The final video-output label (e.g. "[vout]"). */
  videoOutLabel: string;
  /** The final audio-output label if audio is configured, else null. */
  audioOutLabel: string | null;
}

/**
 * Build the -filter_complex graph stitching all scene inputs together
 * with xfade transitions (or concat for "cut") and optionally applying
 * volume + afade to the audio input.
 *
 * Input indices into ffmpeg argv:
 *   - Scene N maps to ffmpeg input N (so [N:v] in the filter graph).
 *   - If audio is present it's the LAST input → index = scenes.length,
 *     accessed as [scenesLen:a].
 */
function buildFilterGraph(
  composition: VideoComposition,
  fps: number,
  hasAudio: boolean,
): FilterGraphResult {
  const scenes = composition.scenes;
  const sceneCount = scenes.length;
  const parts: string[] = [];

  // Pre-step: setpts each scene to PTS-STARTPTS so xfade's offset math is
  // relative to the start of each input rather than absolute wall-clock.
  // why: image-sequence inputs sometimes carry non-zero starting PTS from
  // ffmpeg's internal demux; xfade with absolute offsets gets confused.
  // Also force fps + format to a known shape so xfade's auto-negotiation
  // doesn't pick something weird at scene boundaries.
  for (let i = 0; i < sceneCount; i++) {
    parts.push(
      `[${i}:v]setpts=PTS-STARTPTS,fps=${fps},format=yuv420p[v${i}]`,
    );
  }

  // Build the chain. After processing scene K, we have a label "[chain${K}]"
  // representing scenes 0..K composited together with the appropriate
  // transitions on each seam.
  //
  // Two paths per seam:
  //   - "cut"   → concat filter (n=2:v=1:a=0) — produces a longer clip
  //               whose duration is the sum of the two inputs.
  //   - others  → xfade filter with transition=<preset>:duration=<s>:
  //               offset=<s>. offset is measured from start of the LEFT
  //               input; we want the transition to overlap with the end
  //               of the left input by transitionMs, so:
  //                 offset = (leftDurationSec) - (transitionMs / 1000)
  //               where leftDurationSec is the COMPOSITED duration of
  //               everything seen so far (because xfade itself shortens
  //               the output by `duration`).
  let currentLabel = `v0`;
  // Track the duration of the running composite, in seconds, so we can
  // compute xfade offsets without re-deriving from startMs (which doesn't
  // account for the duration-shrinking effect of prior xfades).
  let chainDurationSec = scenes[0]!.durationMs / 1000;

  for (let i = 1; i < sceneCount; i++) {
    const scene = scenes[i]!;
    const preset = xfadePresetFor(scene.transitionIn);
    const nextLabel = i === sceneCount - 1 ? `vout` : `chain${i}`;
    const sceneDurSec = scene.durationMs / 1000;

    if (preset === null) {
      // why: "cut" — no overlap. concat just glues the two segments.
      // After concat the composite duration grows by full scene length.
      parts.push(
        `[${currentLabel}][v${i}]concat=n=2:v=1:a=0[${nextLabel}]`,
      );
      chainDurationSec += sceneDurSec;
    } else {
      const transitionSec = scene.transitionMs / 1000;
      // xfade offset = where in the LEFT stream the transition starts.
      // We want it to start `transitionSec` before the left stream ends.
      const offsetSec = Math.max(0, chainDurationSec - transitionSec);
      parts.push(
        `[${currentLabel}][v${i}]xfade=transition=${preset}:duration=${transitionSec.toFixed(3)}:offset=${offsetSec.toFixed(3)}[${nextLabel}]`,
      );
      // After xfade, composite duration = left + right - transitionSec.
      chainDurationSec = chainDurationSec + sceneDurSec - transitionSec;
    }

    currentLabel = nextLabel;
  }

  // Single-scene edge case — there's no transition chain, so the final
  // label is still v0. Rename it to vout for downstream consistency.
  if (sceneCount === 1) {
    parts.push(`[v0]null[vout]`);
    currentLabel = "vout";
  }

  // Audio branch.
  let audioOutLabel: string | null = null;
  if (hasAudio && composition.audio) {
    const audio = composition.audio;
    const audioInputIndex = sceneCount;
    const totalSec = composition.totalDurationMs / 1000;
    const fadeInSec = Math.max(0, audio.fadeInMs / 1000);
    const fadeOutSec = Math.max(0, audio.fadeOutMs / 1000);
    const fadeOutStartSec = Math.max(0, totalSec - fadeOutSec);

    // why: chain volume → afade(in) → afade(out). atrim+asetpts ensures
    // the audio is exactly the composite video length, so -shortest has
    // a stable target even when the source track is much longer.
    const audioChain: string[] = [
      `volume=${audio.volume.toFixed(3)}`,
    ];
    if (fadeInSec > 0) {
      audioChain.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(3)}`);
    }
    if (fadeOutSec > 0) {
      audioChain.push(
        `afade=t=out:st=${fadeOutStartSec.toFixed(3)}:d=${fadeOutSec.toFixed(3)}`,
      );
    }
    audioChain.push(`atrim=0:${totalSec.toFixed(3)}`, `asetpts=PTS-STARTPTS`);

    parts.push(`[${audioInputIndex}:a]${audioChain.join(",")}[aout]`);
    audioOutLabel = "[aout]";
  }

  return {
    filterComplex: parts.join(";"),
    videoOutLabel: `[${currentLabel}]`,
    audioOutLabel,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateInput(input: ComposeVideoInput, opts: ComposeVideoOptions): void {
  const { scenesFrames, composition } = input;

  if (scenesFrames.length !== composition.scenes.length) {
    throw new Error(
      `scenesFrames length (${scenesFrames.length}) does not match ` +
        `composition.scenes length (${composition.scenes.length})`,
    );
  }

  for (let i = 0; i < scenesFrames.length; i++) {
    const frames = scenesFrames[i]!;
    if (frames.length === 0) {
      throw new Error(`scene ${i} has 0 frames`);
    }
  }

  // Sum scene durations, subtracting transition overlaps for non-cut seams
  // — this should equal composition.totalDurationMs within ±100ms.
  let computedMs = 0;
  for (let i = 0; i < composition.scenes.length; i++) {
    const scene = composition.scenes[i]!;
    computedMs += scene.durationMs;
    if (i > 0 && scene.transitionIn !== "cut") {
      computedMs -= scene.transitionMs;
    }
  }
  const drift = Math.abs(computedMs - composition.totalDurationMs);
  if (drift > 100) {
    throw new Error(
      `composition duration mismatch: scenes sum to ${computedMs}ms ` +
        `but totalDurationMs is ${composition.totalDurationMs}ms ` +
        `(drift ${drift}ms exceeds ±100ms tolerance)`,
    );
  }

  if (opts.fps <= 0) {
    throw new Error(`fps must be > 0, got ${opts.fps}`);
  }
  if (opts.width <= 0 || opts.height <= 0) {
    throw new Error(`width/height must be > 0, got ${opts.width}x${opts.height}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose an MP4 from per-scene PNG buffer arrays.
 *
 * See module-level JSDoc for the full pipeline + filter graph diagram.
 *
 * Returns the final MP4 as a Buffer. Throws on any ffmpeg/IO failure with
 * a descriptive message.
 */
export async function composeVideo(
  input: ComposeVideoInput,
  opts: ComposeVideoOptions,
): Promise<Buffer> {
  validateInput(input, opts);

  const { scenesFrames, composition } = input;
  const { fps, width, height } = opts;

  // why: mkdtemp generates a uniquely-suffixed directory so concurrent
  // renders on the same worker don't collide. The "reel-" prefix makes
  // it obvious in /tmp what these are during ops debugging.
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "reel-"));

  try {
    // 1. Write all frames to per-scene subdirs.
    const sceneDirs = await Promise.all(
      scenesFrames.map((frames, i) => writeSceneFrames(i, frames, workDir)),
    );

    // 2. Optionally download audio. A download failure (missing Storage
    //    object, 404, network) degrades to a SILENT render rather than
    //    failing the whole MP4 — the video is the critical artifact, and a
    //    missing track shouldn't sink the render. (Audio Library, 2026-06-06.)
    let audioPath: string | null = null;
    if (composition.audio) {
      const candidate = path.join(workDir, "audio.bin");
      try {
        await downloadAudio(composition.audio, candidate);
        audioPath = candidate;
      } catch (audioErr) {
        console.warn(
          `[compose-video] audio download failed, rendering silent: ${
            audioErr instanceof Error ? audioErr.message : String(audioErr)
          }`,
        );
        audioPath = null;
      }
    }

    // 3. Build the filter graph.
    const graph = buildFilterGraph(composition, fps, audioPath !== null);

    // 4. Assemble ffmpeg argv. Per-input options must come BEFORE the
    //    corresponding -i, so we build the input section scene-by-scene.
    const outputPath = path.join(workDir, "out.mp4");
    const args: string[] = ["-y"]; // -y: overwrite output without prompting

    for (const dir of sceneDirs) {
      args.push("-framerate", String(fps), "-i", path.join(dir, "%05d.png"));
    }
    if (audioPath) {
      // why -stream_loop -1: loop a short source track so it fills the full
      // reel duration. The filter graph's atrim=0:totalSec + the output's
      // -shortest flag bound the looped input to the video length, so a track
      // shorter OR longer than the reel both resolve to an exact-length bed
      // ("loop or trim to match the reel duration"). Must precede -i.
      args.push("-stream_loop", "-1", "-i", audioPath);
    }

    args.push(
      "-filter_complex",
      graph.filterComplex,
      "-map",
      graph.videoOutLabel,
    );

    if (graph.audioOutLabel) {
      args.push("-map", graph.audioOutLabel);
    } else {
      // why: explicit -an when there's no audio so ffmpeg doesn't try to
      // auto-pick a stream from one of the image inputs (they have none,
      // but being explicit avoids future surprises).
      args.push("-an");
    }

    // Video encode settings.
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast", // why: CRF stays consistent vs ultrafast; ~2x slower for ~30% smaller files
      "-crf",
      "23",
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p", // why: max compatibility — required by IG, FB, mobile players
      "-r",
      String(fps),
      "-s",
      `${width}x${height}`,
      "-movflags",
      "+faststart", // why: moves moov atom to front so players can begin playback before download completes
    );

    if (graph.audioOutLabel) {
      args.push(
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest", // why: trim to shortest stream (video) so trailing audio silence isn't muxed
      );
    }

    args.push(outputPath);

    // 5. Run ffmpeg.
    await runFfmpeg(args);

    // 6. Read the MP4 back as a Buffer for the caller (uploader will
    //    stream it to Supabase Storage).
    const mp4 = await fs.readFile(outputPath);
    return mp4;
  } finally {
    // why: clean up unconditionally. force:true ignores ENOENT if a step
    // failed before the dir was fully populated; recursive removes the
    // per-scene subdirs in one shot. We swallow any error here because
    // the primary outcome (render success or failure) is more important
    // to surface than a cleanup hiccup — but log it would be nice if a
    // future iteration wires logger in.
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
