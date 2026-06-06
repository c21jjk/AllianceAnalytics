/**
 * Reel Template Library — shared factory utilities.
 * --------------------------------------------------------------------------
 *
 * Pure helpers every Reel template factory relies on:
 *
 *   • recomputeReelTimeline — walks a scene list and fills in startMs +
 *     totalDurationMs the same way `ReelStudioClient.recomputeTimeline`
 *     does. Single source of truth for the cumulative timing math.
 *
 *   • pickPhotoCycling — wrap-around photo picker so a listing with one
 *     photo can still seed a 4-photo composition without crashing.
 *
 *   • DEFAULT_TRANSITION_MS_BY_TYPE — same transition-duration table
 *     ReelStudioClient uses for the add-scene path. Re-exported here so
 *     factories can quote a real transition length without importing
 *     the client component.
 *
 * Why a separate module: factories run server-side (e.g. when seeding
 * a composition from a scheduled job) AND client-side (when the picker
 * fires `build()`). Anything they import has to be isomorphic — no
 * React, no DOM, no "use client".
 */

import type { Scene, TransitionType } from "@/lib/post-builder/types";

/**
 * Cumulative timing pass over a scene list. For each scene, computes
 * `startMs = prevStart + prevDuration - thisTransitionMs`, with the
 * first scene pinned to 0. Returns the rewritten scene array plus the
 * total composition duration in ms (sum of durations minus overlapping
 * transitions).
 *
 * Mirrors `ReelStudioClient.recomputeTimeline` exactly — if the math
 * in one diverges from the other, the Studio timeline strip will lie
 * about scene positions. Treat them as a matched pair.
 */
export function recomputeReelTimeline(
  scenes: readonly Scene[],
): { scenes: readonly Scene[]; totalDurationMs: number } {
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
 * Pick the Nth photo with wrap-around. Returns null only when the
 * photos array is empty — callers should fall back to the listing's
 * hero photo (and then to a design-only scene) in that case.
 */
export function pickPhotoCycling(
  photos: readonly string[],
  index: number,
): string | null {
  if (photos.length === 0) return null;
  return photos[index % photos.length] ?? null;
}

/**
 * Default transition durations per type. Mirrors
 * `DEFAULT_TRANSITION_MS_BY_TYPE` in ReelStudioClient so a template's
 * "fade" transition feels identical to a user-added "fade" transition.
 */
export const DEFAULT_TRANSITION_MS_BY_TYPE: Readonly<
  Record<TransitionType, number>
> = {
  cut: 0,
  fade: 400,
  dissolve: 300,
  fade_white: 300,
  slide_left: 350,
  slide_right: 350,
  slide_up: 350,
  slide_down: 350,
  wipe_left: 350,
  smooth_left: 400,
  smooth_right: 400,
  circle_open: 500,
  zoom_blur: 400,
};

/**
 * Helper: stable scene-id generator. Uses crypto.randomUUID when
 * available (both Node ≥ 19 and modern browsers), falls back to a
 * lightweight pseudo-random id for very old runtimes. Factories don't
 * need a cryptographically strong id — just unique within one
 * composition — so the fallback is acceptable.
 */
export function makeSceneId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `scene_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}
