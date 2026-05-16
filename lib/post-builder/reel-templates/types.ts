/**
 * Reel Template Library — types.
 * --------------------------------------------------------------------------
 *
 * A `ReelTemplate` is a pre-composed `VideoComposition` blueprint that
 * takes a listing + its photo gallery and emits a worker-ready
 * `VideoComposition`. Templates encode the specific motion, durations,
 * and transition patterns that make a Reel feel like a "Cinematic Tour"
 * vs a "Quick Stats Reveal" — the user picks the vibe, the template
 * fills in the listing data.
 *
 * Mirrors the canvas-editor template pattern: a small declarative
 * record + a `build(listing, photos)` factory. The Reel Studio's
 * `ReelTemplatesPanel` reads the manifest to render the picker grid;
 * clicking a card invokes `template.build()` and the result replaces
 * the current composition.
 *
 * Per `feedback_reel_music_deprioritized.md`, every template defaults to
 * a silent Reel — IG/FB strip API-uploaded music on business accounts,
 * so attaching music here adds zero distribution value. `defaultsSilent`
 * is kept on the type so a future music-aware variant can opt in
 * without breaking the contract.
 */

import type {
  PostBuilderListing,
  PostType,
  VideoComposition,
} from "@/lib/post-builder/types";

/**
 * Output of a Reel template factory: the composition ready to be set as
 * the active `VideoComposition` in `ReelStudioClient`. Always lands at
 * the standard 1080×1920 / 30fps Reels frame — Studio doesn't render
 * any other Reel output today.
 */
export type ReelTemplateComposition = VideoComposition;

export interface ReelTemplate {
  /**
   * Stable id. Persisted on `generated_posts.template_id` so re-opens
   * can tell which template seeded the row even after the user has
   * mutated scenes inside Studio.
   *
   * Convention: `reel.<post_type>.<slug>`, e.g. `reel.just_listed.cinematic_tour`.
   */
  id: string;

  /** Card title — short, evocative, action-forward. */
  name: string;

  /**
   * One-sentence description shown under the card title in the picker.
   * Frames what makes this template different from its siblings.
   */
  description: string;

  /** Post type this template fits (same union the canvas templates use). */
  postType: PostType;

  /**
   * Approximate output duration in seconds, used purely for the card
   * label ("~7s"). The real total comes from the factory's recomputed
   * timeline, which honors transition overlaps.
   */
  durationSec: number;

  /**
   * Number of distinct photo-driven scenes. Used by the picker so it
   * can warn ("This listing has 2 photos but the template uses 4 — some
   * will repeat") and by the no-photo fallback path so design-only
   * compositions still render.
   */
  photoSceneCount: number;

  /**
   * True when the factory emits `audio: null`. Every template ships
   * silent today — see header comment. Kept on the type so a future
   * music-aware variant can opt in without breaking the contract.
   */
  defaultsSilent: boolean;

  /**
   * Factory: produces the full composition for the given listing +
   * photos. Implementations should:
   *
   *   1. Resolve a canvas template via `findCanvasTemplate` for the
   *      hero / outro design scenes.
   *   2. Cycle the photo array with wrap-around so a listing with
   *      fewer photos than scenes still produces a complete Reel.
   *   3. Run `recomputeReelTimeline` on the assembled scenes before
   *      returning, so `startMs` + `totalDurationMs` are accurate.
   *   4. Stamp `sourceListingMls = listing.mls_number` so the render
   *      worker can apply the canonical MLS hashtag to the cover.
   */
  build: (
    listing: PostBuilderListing,
    photos: readonly string[],
  ) => ReelTemplateComposition;
}

/**
 * Curated post-type display metadata for the picker. Kept here (not in
 * the panel) so analytics / external dashboards can read the same
 * labels without importing UI code.
 */
export interface ReelPostTypeMeta {
  label: string;
  /** Background tint for the picker's category header strip. */
  chipBg: string;
  /** Foreground for the category header strip. */
  chipFg: string;
  /** Eyebrow text mirroring the in-canvas status label. */
  eyebrow: string;
}

export const REEL_POST_TYPE_META: Record<PostType, ReelPostTypeMeta> = {
  just_listed: {
    label: "Just Listed",
    eyebrow: "JUST LISTED",
    chipBg: "#C9A961",
    chipFg: "#18181B",
  },
  just_sold: {
    label: "Just Sold",
    eyebrow: "JUST SOLD",
    chipBg: "#B91C1C",
    chipFg: "#FFFFFF",
  },
  under_contract: {
    label: "Under Contract",
    eyebrow: "UNDER CONTRACT",
    chipBg: "#B45309",
    chipFg: "#FFFFFF",
  },
  open_house: {
    label: "Open House",
    eyebrow: "OPEN HOUSE",
    chipBg: "#18181B",
    chipFg: "#C9A961",
  },
  price_reduction: {
    label: "Price Reduced",
    eyebrow: "PRICE REDUCED",
    chipBg: "#15803D",
    chipFg: "#FFFFFF",
  },
};
