/**
 * Worker-side type definitions for the Reel render pipeline.
 *
 * why: these mirror a subset of types from
 *   /Users/johnkoch/Documents/GitHub/AllianceAnalytics/lib/post-builder/types.ts
 * (specifically: MotionRect, MotionPath, MOTION_PRESETS, SceneContent,
 * TransitionType, Scene, AudioTrack, VideoComposition, ReelRenderInput,
 * ReelRenderStatus, ReelRenderJob, REEL_CAPS).
 *
 * They are COPIED — NOT imported — from the main app. The worker is a
 * separate deployment unit (its own tsconfig, its own package.json, its
 * own container) and must not reach across the project boundary into
 * `lib/post-builder/`. Doing so would couple the worker's build to the
 * main app's module graph (next, react, supabase-js, fabric, etc.) and
 * make the container image enormous.
 *
 * Keeping them in sync: today this is manual — when the main app's types
 * change in a way that affects the render contract, mirror the change
 * here. Future automation could codegen both sides from a shared zod
 * schema (or json-schema), but the surface area is small enough that
 * manual sync is cheaper than the tooling cost right now.
 *
 * A drift check is included at the bottom of this file via the zod
 * schemas — if the main app sends a payload that doesn't match the
 * VideoCompositionZ shape, the /render route 400s with a clear error
 * pointing at exactly which field drifted.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Motion primitives
// ---------------------------------------------------------------------------

/**
 * A normalized rectangle into a source photo. All coordinates are
 * fractions of the source dimensions (0..1) so the same motion path
 * applies cleanly across photos of different resolutions.
 */
export interface MotionRect {
  /** Top-left x as fraction of source width [0..1]. */
  x: number;
  /** Top-left y as fraction of source height [0..1]. */
  y: number;
  /** Crop width as fraction of source width (0..1]. */
  w: number;
  /** Crop height as fraction of source height (0..1]. */
  h: number;
}

/**
 * Defines how a photo crops + animates over a scene's duration. The
 * renderer lerps from startRect → endRect, applying the easing curve to
 * the parametric t before projecting onto the source photo's pixel grid.
 */
export interface MotionPath {
  startRect: MotionRect;
  endRect: MotionRect;
  easing: "linear" | "ease_in" | "ease_out" | "ease_in_out";
}

/**
 * Canonical motion preset library. The editor surfaces these as named
 * buttons; the renderer resolves a preset NAME to a motion path the
 * same way. Single source of truth.
 *
 * why: duplicated verbatim from main app — both sides must agree on the
 * exact rect math or the preview won't match the rendered output.
 */
export const MOTION_PRESETS: Readonly<Record<string, MotionPath>> = {
  static: {
    startRect: { x: 0, y: 0, w: 1, h: 1 },
    endRect: { x: 0, y: 0, w: 1, h: 1 },
    easing: "linear",
  },
  zoom_in: {
    startRect: { x: 0, y: 0, w: 1, h: 1 },
    endRect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    easing: "ease_in_out",
  },
  zoom_out: {
    startRect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    endRect: { x: 0, y: 0, w: 1, h: 1 },
    easing: "ease_in_out",
  },
  pan_left: {
    startRect: { x: 0.1, y: 0, w: 0.9, h: 1 },
    endRect: { x: 0, y: 0, w: 0.9, h: 1 },
    easing: "ease_in_out",
  },
  pan_right: {
    startRect: { x: 0, y: 0, w: 0.9, h: 1 },
    endRect: { x: 0.1, y: 0, w: 0.9, h: 1 },
    easing: "ease_in_out",
  },
} as const;

// ---------------------------------------------------------------------------
// Scene content + transitions
// ---------------------------------------------------------------------------

/**
 * Discriminated union over scene content kinds:
 *   "design"     — a canvas-editor template rendered as a static frame.
 *   "photo"      — a single photo with a Ken-Burns-style motion path.
 *   "video_clip" — RESERVED for Phase 7. Worker rejects in MVP.
 */
export type SceneContent =
  | {
      kind: "design";
      /**
       * Inline canvas-editor template SCHEMA, embedded by VALUE. The
       * worker doesn't import the main app's CanvasTemplateSchema type
       * (cross-package boundary); it interprets this structurally —
       * width / height / layers[] / backgroundColor — at render time.
       * Stored as `unknown` so consumers cast at the boundary.
       *
       * Reproducibility property: the composition is self-contained. A
       * Reel saved today re-renders identically tomorrow even if the
       * canvas-editor template factory has been updated, because the
       * schema as it was at compose-time is preserved in the row.
       */
      template: unknown;
    }
  | {
      kind: "photo";
      /** Public URL of the source photo. */
      photoUrl: string;
      /** How the photo crops + animates over the scene duration. */
      motion: MotionPath;
    }
  | {
      kind: "video_clip";
      /** RESERVED — Phase 7. Worker rejects in MVP. */
      videoUrl: string;
      trimStartMs: number;
    };

/** Transitions between scenes. All have a configurable duration in ms.
 *  Mirror of the app TransitionType (lib/post-builder/types.ts). Expanded
 *  2026-06-05 — keep in lockstep with the app union + the xfade map. */
export type TransitionType =
  | "cut"
  | "fade"
  | "dissolve"
  | "fade_white"
  | "slide_left"
  | "slide_right"
  | "slide_up"
  | "slide_down"
  | "wipe_left"
  | "smooth_left"
  | "smooth_right"
  | "circle_open"
  | "zoom_blur";

export interface Scene {
  /** Stable id (UUID) used as React key + for re-ordering. */
  id: string;
  /** Start of the scene in the timeline, in ms. */
  startMs: number;
  /** Duration of the scene in ms. Cap: 10s. Min: 500ms. */
  durationMs: number;
  /** What this scene shows. */
  content: SceneContent;
  /** Transition into this scene (from the previous scene, or from
   *  black at the start). */
  transitionIn: TransitionType;
  /** Transition duration in ms. Overlaps with the end of the previous
   *  scene's content time. */
  transitionMs: number;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/** Optional background music track on the composition. */
export interface AudioTrack {
  /** Stable id of the track in the curated music library. */
  trackId: string;
  /** Public URL of the audio file (mp3 or aac). */
  url: string;
  /** Display name shown in the editor's music picker. */
  displayName: string;
  /** Volume 0..1. Default ~0.6 so music sits under future VO. */
  volume: number;
  /** Fade-in duration at the start, in ms. */
  fadeInMs: number;
  /** Fade-out duration at the end, in ms. */
  fadeOutMs: number;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * The full Reel composition document.
 *
 * Always 1080×1920 at 30fps for MVP — that's what IG/FB Reels surfaces
 * accept. Stored explicitly so the renderer never has to assume.
 */
export interface VideoComposition {
  schemaVersion: 1;
  width: 1080;
  height: 1920;
  frameRate: 30;
  /** Total duration in ms after accounting for overlapping transitions. */
  totalDurationMs: number;
  scenes: readonly Scene[];
  audio: AudioTrack | null;
  /** Optional: source listing MLS. Used to stamp a watermark/hashtag
   *  on the cover frame (Day 2+). */
  sourceListingMls?: string;
  /** ISO timestamp the composition was last edited. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Render job contract
// ---------------------------------------------------------------------------

/**
 * Input shape the main app sends to the worker.
 *
 * idempotency_key: client-generated UUID. The worker dedupes by this —
 * submitting the same key twice within 24h returns the original job's
 * status, not a fresh job. why: a flaky network retry shouldn't burn
 * a second render-pass-worth of CPU.
 */
export interface ReelRenderInput {
  composition: VideoComposition;
  idempotency_key: string;
}

/** Worker job lifecycle. */
export type ReelRenderStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

export interface ReelRenderJob {
  job_id: string;
  status: ReelRenderStatus;
  /** 0..100. Meaningful only while status === "processing". */
  progress_pct: number;
  /** Public Storage URL of the MP4. Set only on "succeeded". */
  video_url: string | null;
  /** Internal Storage path of the MP4. Set only on "succeeded". */
  video_path: string | null;
  /** MP4 duration in ms. Set only on "succeeded". */
  duration_ms: number | null;
  /**
   * Public Storage URL of the cover frame (first frame of the rendered
   * video). Set only on "succeeded" when the worker successfully extracted
   * and uploaded a cover PNG. Falls back to null when the per-scene frame
   * buffer was empty (defensive — REEL_CAPS.minScenes >= 2 prevents this
   * in practice) or the cover upload itself failed (logged, non-fatal —
   * we don't want a flaky cover upload to fail the whole render).
   *
   * why: the main app uses this as `generated_posts.image_url` so the IG
   * Reels grid cover matches the FIRST FRAME of the actual video instead
   * of the listing's hero photo. Older flows fall back to the listing
   * hero when this is null.
   */
  cover_url: string | null;
  /** Internal Storage path of the cover PNG for future cleanup. Mirrors
   *  video_path. Null whenever cover_url is null. */
  cover_path: string | null;
  /** Error message. Set only on "failed". */
  error: string | null;
  /** ISO timestamp at job submission. */
  created_at: string;
  /** ISO timestamp of last status update. */
  updated_at: string;
  /** Echo of the client-supplied idempotency key — the store keeps a
   *  secondary index on this for dedupe. Not on the main-app type
   *  because the client never reads this back; worker-only. */
  idempotency_key: string;
}

/**
 * Hard caps applied by both the editor (UI validation) and the renderer
 * (server-side rejection). Worker enforces these in the zod schema below
 * so a malformed composition gets a 400 instead of consuming render time.
 */
export const REEL_CAPS = {
  maxTotalDurationMs: 15_000,
  minTotalDurationMs: 3_000,
  maxScenes: 8,
  minScenes: 2,
  maxSceneDurationMs: 10_000,
  minSceneDurationMs: 500,
} as const;

// ---------------------------------------------------------------------------
// Zod schemas — runtime validation at the /render boundary
// ---------------------------------------------------------------------------
//
// why: TypeScript types vanish at runtime. The render endpoint is a
// public-ish HTTP surface (auth'd, but still external); we never trust
// the payload shape. Zod gives us "validate or reject" with structured
// error messages naming the bad field.

const MotionRectZ = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

const MotionPathZ = z.object({
  startRect: MotionRectZ,
  endRect: MotionRectZ,
  easing: z.enum(["linear", "ease_in", "ease_out", "ease_in_out"]),
});

const SceneContentZ = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("design"),
    // why: the embedded schema is structurally a CanvasTemplateSchema but
    // the worker doesn't depend on that type — pass it through as a
    // generic object and let render.js validate the shape at draw time.
    // z.record matches "any object" without requiring a closed shape.
    template: z.record(z.unknown()),
  }),
  z.object({
    kind: z.literal("photo"),
    photoUrl: z.string().url(),
    motion: MotionPathZ,
  }),
  z.object({
    kind: z.literal("video_clip"),
    videoUrl: z.string().url(),
    trimStartMs: z.number().int().min(0),
  }),
]);

const TransitionTypeZ = z.enum([
  "cut",
  "fade",
  "dissolve",
  "fade_white",
  "slide_left",
  "slide_right",
  "slide_up",
  "slide_down",
  "wipe_left",
  "smooth_left",
  "smooth_right",
  "circle_open",
  "zoom_blur",
]);

const SceneZ = z.object({
  id: z.string().min(1),
  startMs: z.number().int().min(0),
  durationMs: z
    .number()
    .int()
    .min(REEL_CAPS.minSceneDurationMs)
    .max(REEL_CAPS.maxSceneDurationMs),
  content: SceneContentZ,
  transitionIn: TransitionTypeZ,
  transitionMs: z.number().int().min(0).max(2000),
});

const AudioTrackZ = z.object({
  trackId: z.string().min(1),
  url: z.string().url(),
  displayName: z.string().min(1),
  volume: z.number().min(0).max(1),
  fadeInMs: z.number().int().min(0),
  fadeOutMs: z.number().int().min(0),
});

export const VideoCompositionZ = z.object({
  schemaVersion: z.literal(1),
  width: z.literal(1080),
  height: z.literal(1920),
  frameRate: z.literal(30),
  totalDurationMs: z
    .number()
    .int()
    .min(REEL_CAPS.minTotalDurationMs)
    .max(REEL_CAPS.maxTotalDurationMs),
  scenes: z
    .array(SceneZ)
    .min(REEL_CAPS.minScenes)
    .max(REEL_CAPS.maxScenes),
  audio: AudioTrackZ.nullable(),
  sourceListingMls: z.string().optional(),
  updatedAt: z.string().min(1),
});

export const ReelRenderInputZ = z.object({
  composition: VideoCompositionZ,
  idempotency_key: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// /render-image — synchronous single-template canvas render
// ---------------------------------------------------------------------------
//
// why a separate endpoint from /render:
//   /render is an async job-queue API for VIDEOS (multi-scene, audio mix,
//   ffmpeg compose, ~10-30s wall time). Polling is necessary because a
//   single HTTP connection can't survive the latency.
//
//   /render-image is the same Fabric-in-Chromium machinery applied to a
//   SINGLE canvas-editor template. It returns one PNG in ~2-3s — well
//   inside Vercel's main-app server-action 60s budget. No job tracking,
//   no polling, no idempotency dedupe (the caller can just retry on
//   network failure; the cost is one extra render).
//
//   Sharing the worker (instead of bringing Playwright into Vercel's
//   runtime) keeps Vercel's build small and lets us reuse the exact
//   same Fabric render path that drives video frames — which is the
//   point: this becomes the unified server-side canvas renderer for
//   future Phase-6+ consumers (multi-OH wizard, batch property exports,
//   etc.).

/**
 * Input shape for POST /render-image.
 *
 * `template` and `listing` are typed `unknown` because the worker doesn't
 * import the main app's CanvasTemplateSchema or MLSListingPayload types
 * (cross-package boundary, same as design-scene `template`). The browser-
 * side render.js hydrates bound fields structurally at draw time.
 *
 * `idempotency_key` is used as the storage filename so a flaky-network
 * retry of the same caller writes to the same path (idempotent overwrite
 * is fine — the rendered output is deterministic from the same inputs).
 */
export interface RenderImageInput {
  template: unknown;
  listing: unknown;
  idempotency_key: string;
}

export interface RenderImageOk {
  ok: true;
  /** Public Storage URL of the rendered PNG. */
  url: string;
  /** Internal Storage path of the PNG — used for future cleanup. */
  path: string;
}

export interface RenderImageErr {
  ok: false;
  error: string;
}

/** Validate the /render-image body. Mirrors ReelRenderInputZ's pattern:
 *  reject malformed payloads with a structured 400 instead of failing
 *  later inside the render path. */
export const RenderImageInputZ = z.object({
  // why z.record(z.unknown()): the template is structurally a
  // CanvasTemplateSchema but the worker doesn't depend on that type —
  // pass it through as a generic object and let the page-side render.js
  // validate the shape at draw time. Same trick as SceneContentZ design.
  template: z.record(z.unknown()),
  // why also z.record(z.unknown()): listing is structurally an
  // MLSListingPayload (used for bound-field hydration); the worker is
  // a structural consumer, not a typed one. The page-side bridge
  // hydrates `${address}`, `${list_price}`, etc. by key.
  listing: z.record(z.unknown()),
  idempotency_key: z.string().uuid(),
});
