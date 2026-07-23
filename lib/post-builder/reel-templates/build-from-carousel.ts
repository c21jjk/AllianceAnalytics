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
  REEL_CAPS,
  type PostType,
  type PostVariant,
  type Scene,
  type TextOverlay,
  type TransitionType,
  type VideoComposition,
} from "@/lib/post-builder/types";
import type { CanvasTemplateSchema } from "@/lib/post-builder/canvas-editor/types";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import { createTextOverlay } from "./text-overlay";

/**
 * Pacing presets. The user picked "cinematic" as the default feel; the
 * others back a one-tap global speed control in the editor. Each value is
 * the per-photo-scene duration in ms.
 */
export type ReelPace = "cinematic" | "standard" | "punchy";

const PACE_PHOTO_SCENE_MS: Readonly<Record<ReelPace, number>> = {
  // 2026-06-05 — slowed to match the editor's new "Standard" pace (4.5s);
  // a freshly seeded Reel opens calm rather than fast.
  cinematic: 4_500,
  standard: 3_000,
  punchy: 2_000,
};

/** Hero opener is held a beat shorter than a cinematic body scene. */
const HERO_SCENE_MS = 2_500;

/**
 * Crossfade overlap between scenes (ms). 2026-06-06 — set to 300 (the editor's
 * "Standard" speed) so a seeded Reel's transitions match the global transition
 * control's dropdown exactly on load. The user can bump it to Slow/Dramatic.
 */
const BODY_TRANSITION_MS = 300;

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

/**
 * Build a closing END-CARD / CTA scene: a dark Obsessed-Grey card with a CTA
 * headline + the C21 Alliance wordmark, both as animated text overlays. A
 * design scene with an empty dark schema (the overlays carry the content), so
 * it renders identically in the preview and the worker. Appended to a Reel via
 * the editor's "Add end-card" action.
 */
/**
 * Beat-sync wiring (2026-06-05). Snap each scene's duration to the nearest
 * whole number of beats for a given BPM, so cuts land on the beat. Preserves
 * relative pacing (a long scene stays longer) while aligning every cut to the
 * grid. Clamped to the scene-duration caps. Once the music library lands with
 * per-track BPM, the editor passes that BPM here; until then the user can set
 * it manually. Returns adjusted scenes; the caller re-times the timeline.
 */
export function snapScenesToBeat(
  scenes: readonly Scene[],
  bpm: number,
): Scene[] {
  if (!Number.isFinite(bpm) || bpm <= 0) return scenes.slice();
  const beatMs = 60_000 / bpm;
  return scenes.map((s) => {
    const beats = Math.max(1, Math.round(s.durationMs / beatMs));
    const snapped = Math.min(10_000, Math.max(500, Math.round(beats * beatMs)));
    return { ...s, durationMs: snapped };
  });
}

export function buildEndCardScene(): Scene {
  const schema: CanvasTemplateSchema = {
    id: "reel_end_card",
    name: "Reel End Card",
    description: "Dark CTA end card for Reels.",
    category: "just_listed",
    variant: "v1" as PostVariant,
    format: "story_9x16",
    width: 1080,
    height: 1920,
    backgroundColor: "#252526",
    backgroundImage: null,
    layers: [],
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
  const cta: TextOverlay = {
    ...createTextOverlay("headline"),
    text: "Schedule a private tour",
    y: 0.42,
    fontSize: 104,
  };
  const brand: TextOverlay = {
    ...createTextOverlay("gold_bar"),
    text: "C21 ALLIANCE",
    y: 0.6,
  };
  return {
    id: crypto.randomUUID(),
    startMs: 0,
    durationMs: 2_500,
    content: { kind: "design", template: schema },
    // 2026-06-06 — uniform with body scenes; the editor also re-tunes this to
    // the Reel's current global transition when the card is appended.
    transitionIn: "dissolve",
    transitionMs: BODY_TRANSITION_MS,
    textOverlays: [cta, brand],
  };
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
  /**
   * 2026-07-23 — Auto-Reel pipeline. When set, scene 0 is a PHOTO scene
   * playing this pre-rendered 9:16 hero PNG (slow zoom) instead of a
   * design scene. why: the render worker expects design scenes to ship
   * PRE-HYDRATED (bound fields already resolved into concrete text), which
   * the interactive Reel editor does but a headless server flow cannot do
   * cheaply. The auto-reel pipeline instead renders the 9:16 hero template
   * to a PNG server-side (renderCanvasSchema hydrates bound fields via the
   * Chromium render page) and plays that PNG as the opener. Manual "Make it
   * a Reel" flows omit this and keep the editable design hero.
   */
  heroImageUrl?: string | null;
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

  const heroScene: Scene = params.heroImageUrl
    ? {
        // Photo-hero path (auto-reel): the pre-rendered 9:16 hero PNG plays
        // as a photo scene with a gentle zoom. No hydration needed — the
        // PNG already carries the resolved address/price/branding.
        id: crypto.randomUUID(),
        startMs: 0,
        durationMs: HERO_SCENE_MS,
        content: {
          kind: "photo",
          photoUrl: params.heroImageUrl,
          motion: MOTION_PRESETS.zoom_in ?? MOTION_PRESETS.static!,
        },
        transitionIn: "cut" as TransitionType,
        transitionMs: 0,
      }
    : {
        id: crypto.randomUUID(),
        startMs: 0,
        durationMs: HERO_SCENE_MS,
        content: {
          kind: "design",
          template: findCanvasTemplate(postType, variant, "story_9x16"),
        },
        // First scene transitions in from black — a cut keeps the opener crisp.
        transitionIn: "cut" as TransitionType,
        transitionMs: 0,
      };

  // why slice at maxScenes - 1: the hero occupies scene 0 and the worker's
  // zod schema hard-rejects compositions above REEL_CAPS.maxScenes scenes.
  // Dropping the extra carousel slides here beats a 400 at render time.
  const cappedPhotoUrls = photoUrls.slice(0, REEL_CAPS.maxScenes - 1);

  const photoScenes: Scene[] = cappedPhotoUrls.map((url, i) => {
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

  let { scenes, totalDurationMs } = recompute([heroScene, ...photoScenes]);

  // why a total-duration clamp: the worker's zod schema also caps
  // totalDurationMs at REEL_CAPS.maxTotalDurationMs (15s). A cinematic
  // pace (4.5s/slide) with 7 slides would otherwise overshoot and 400.
  // Shorten the photo scenes proportionally (hero keeps its timing) and
  // re-time. With the 8-scene cap above, one pass always lands under the
  // limit: the worst case after clamping to the per-scene minimum is
  // hero 2.5s + 7 x 0.5s minus transition overlaps, well below 15s.
  if (totalDurationMs > REEL_CAPS.maxTotalDurationMs) {
    const overshoot = totalDurationMs - REEL_CAPS.maxTotalDurationMs;
    const photoTotal = scenes.reduce(
      (sum, s) => (s.content.kind === "photo" ? sum + s.durationMs : sum),
      0,
    );
    if (photoTotal > 0) {
      const factor = Math.max(0, (photoTotal - overshoot) / photoTotal);
      const shortened = scenes.map((s) =>
        s.content.kind === "photo"
          ? {
              ...s,
              durationMs: Math.max(
                REEL_CAPS.minSceneDurationMs,
                Math.round(s.durationMs * factor),
              ),
            }
          : s,
      );
      ({ scenes, totalDurationMs } = recompute(shortened));
    }
  }

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
