/**
 * Build a Reel `VideoComposition` from a finished carousel post.
 * --------------------------------------------------------------------------
 *
 * The "Make it a Reel" flow takes a post the user already assembled in the
 * Post Builder — a branded hero card plus the carousel photos they curated —
 * and turns it into a cinematic slideshow Reel:
 *
 *   scene 0   : 9:16 branded hero card (design scene, same pattern as the
 *               Reel Studio's buildDefaultComposition — a proper vertical
 *               opener, NOT the square feed card cropped into 9:16)
 *   scene 1..N: one photo scene per carousel slide, in the user's order,
 *               with Ken Burns motion cycled for visual rhythm
 *
 * This is intentionally a generalization of ReelStudioClient's
 * `buildDefaultComposition`: that one seeds a fixed 3 gallery photos; this
 * one uses the exact set + order the user already chose in the carousel.
 * The output is a normal VideoComposition, so it flows straight into the
 * existing Reel Studio editor + render worker + publish path — no new
 * rendering or publishing machinery.
 *
 * Music is intentionally omitted (audio: null) — that's its own parked plan
 * (see the reel-music memory); silent is the correct default today.
 */

import {
  MOTION_PRESETS,
  type PostType,
  type PostVariant,
  type Scene,
  type TransitionType,
  type VideoComposition,
} from "@/lib/post-builder/types";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";

/**
 * Pacing presets. The user picked "cinematic" as the default feel; the
 * others back a one-tap global speed control in the editor. Each value is
 * the per-photo-scene duration in ms.
 */
export type ReelPace = "cinematic" | "standard" | "punchy";

const PACE_PHOTO_SCENE_MS: Readonly<Record<ReelPace, number>> = {
  cinematic: 3_500,
  standard: 2_500,
  punchy: 1_600,
};

/** Hero opener is held a beat shorter than a cinematic body scene. */
const HERO_SCENE_MS = 2_500;

/** Crossfade overlap between scenes (ms). Dissolve reads as "premium". */
const BODY_TRANSITION_MS = 500;

/**
 * Motion cycle for the body photos. Every slide PANS (alternating
 * direction) so a landscape photo sweeps across its full width for a
 * dramatic, cinematic feel. The renderer adds a gentle zoom on top of the
 * pan for depth (see the cover+pan-across model in ReelPreview /
 * worker render.js), so the preset here only needs to encode pan
 * direction — the sign of the x delta is what the renderer reads.
 */
const MOTION_CYCLE = ["pan_right", "pan_left"] as const;

/**
 * Recompute each scene's `startMs` and the composition's total duration,
 * accounting for transition overlap (a transition overlaps the END of the
 * previous scene by `transitionMs`). Mirrors ReelStudioClient's
 * recomputeStartTimes so timeline math stays identical across both entry
 * points.
 */
function recompute(scenes: Scene[]): {
  scenes: Scene[];
  totalDurationMs: number;
} {
  if (scenes.length === 0) return { scenes: [], totalDurationMs: 0 };
  const out: Scene[] = [];
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!;
    const overlap =
      i === 0 ? 0 : Math.min(s.transitionMs, scenes[i - 1]!.durationMs);
    const startMs = i === 0 ? 0 : cursor - overlap;
    out.push({ ...s, startMs });
    cursor = startMs + s.durationMs;
  }
  return { scenes: out, totalDurationMs: cursor };
}

export interface BuildReelFromCarouselParams {
  /** Post type of the source post (drives the 9:16 hero template lookup). */
  postType: PostType;
  /** Variant of the source post. Ignored by the lookup today but passed for forward-compat. */
  variant: PostVariant;
  /**
   * The carousel photos to play after the hero, in the order the user
   * arranged them. These are the `additional_images` URLs from the post —
   * NOT including the hero render (the hero is rebuilt as a 9:16 design
   * scene so it reads correctly in a vertical frame).
   */
  photoUrls: readonly string[];
  /** MLS number of the source listing, stamped on the composition for attribution. */
  sourceListingMls?: string;
  /** Pacing feel. Defaults to cinematic per the agreed design. */
  pace?: ReelPace;
}

/**
 * Build the composition. Returns null only when there are no photos to
 * sequence — the caller should gate the "Make it a Reel" prompt on the post
 * actually having carousel slides, so this is a defensive guard.
 */
export function buildReelFromCarousel(
  params: BuildReelFromCarouselParams,
): VideoComposition | null {
  const { postType, variant, photoUrls, sourceListingMls } = params;
  const pace: ReelPace = params.pace ?? "cinematic";
  if (photoUrls.length === 0) return null;

  const photoSceneMs = PACE_PHOTO_SCENE_MS[pace];
  const heroTemplate = findCanvasTemplate(postType, variant, "story_9x16");

  const heroScene: Scene = {
    id: crypto.randomUUID(),
    startMs: 0,
    durationMs: HERO_SCENE_MS,
    content: { kind: "design", template: heroTemplate },
    // First scene transitions in from black — a cut keeps the opener crisp.
    transitionIn: "cut" as TransitionType,
    transitionMs: 0,
  };

  const photoScenes: Scene[] = photoUrls.map((url, i) => {
    const motionKey = MOTION_CYCLE[i % MOTION_CYCLE.length]!;
    return {
      id: crypto.randomUUID(),
      startMs: 0, // recomputed below
      durationMs: photoSceneMs,
      content: {
        kind: "photo",
        photoUrl: url,
        motion: MOTION_PRESETS[motionKey] ?? MOTION_PRESETS.static!,
      },
      transitionIn: "dissolve" as TransitionType,
      transitionMs: BODY_TRANSITION_MS,
    };
  });

  const { scenes, totalDurationMs } = recompute([heroScene, ...photoScenes]);

  return {
    schemaVersion: 1,
    width: 1080,
    height: 1920,
    frameRate: 30,
    totalDurationMs,
    scenes,
    audio: null,
    sourceListingMls,
    updatedAt: new Date().toISOString(),
  };
}
