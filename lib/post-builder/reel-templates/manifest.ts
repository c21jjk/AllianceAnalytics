/**
 * Reel Template Library — manifest.
 * --------------------------------------------------------------------------
 *
 * 15 pre-composed Reel templates (3 per post type) that Larissa can pick
 * from inside the Reel Studio. Each template encodes a specific motion +
 * transition + duration pattern — picking one fills the workspace with a
 * complete, edit-ready composition for the active listing.
 *
 * Layout convention:
 *
 *   • Scene 0      — design hero card (canvas template, no motion)
 *   • Scenes 1..N  — photo scenes with motion presets
 *   • Final scene  — design outro (often the same hero template, fades out)
 *
 * Duration policy:
 *   Templates aim for 5-9s total. IG's Reels-tier distribution boost is
 *   strongest for completed views; anything under 5s reads as a stutter
 *   and anything over 10s loses viewers before they finish. The 15s
 *   `REEL_CAPS.maxTotalDurationMs` is a hard ceiling, not a target.
 *
 * Music policy:
 *   All templates default to `audio: null`. IG/FB strip API-uploaded
 *   music on business accounts, so attaching music adds zero
 *   distribution value (see `feedback_reel_music_deprioritized.md`).
 *   Larissa can add a track via MusicPicker after picking the template.
 */

import {
  MOTION_PRESETS,
  type AudioTrack,
  type PostBuilderListing,
  type PostType,
  type Scene,
  type VideoComposition,
} from "@/lib/post-builder/types";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import type { ReelTemplate } from "./types";
import {
  DEFAULT_TRANSITION_MS_BY_TYPE,
  makeSceneId,
  pickPhotoCycling,
  recomputeReelTimeline,
} from "./utils";

// ---------------------------------------------------------------------------
// Shared composition skeleton — wraps the scene array in a complete
// VideoComposition with the right Reels frame + frame-rate + source-listing
// stamp. Pulled out so every factory is two lines: assemble scenes, wrap.
// ---------------------------------------------------------------------------

function composeReel(
  listing: PostBuilderListing,
  scenes: Scene[],
): VideoComposition {
  const timed = recomputeReelTimeline(scenes);
  return {
    schemaVersion: 1,
    width: 1080,
    height: 1920,
    frameRate: 30,
    totalDurationMs: timed.totalDurationMs,
    scenes: timed.scenes,
    audio: null satisfies AudioTrack | null,
    sourceListingMls: listing.mls_number,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Resolve a design template for a given post type + variant at the Reels
 * 9:16 frame. Returns `unknown` because the canvas-editor schema is opaque
 * at the worker boundary — see `SceneContent.design.template` for the
 * boundary contract.
 */
function designTemplate(
  postType: PostType,
  variant: "v1" | "v2" | "v6",
): unknown {
  // why: keep the search narrow to the 3 variants we use in Reels —
  // v1 (photo-forward hero), v2 (bold stats), v6 (magazine cover). The
  // other variants are designed for static formats where the eyebrow +
  // chrome have more breathing room; they read cramped at 9:16 once
  // motion is added on top.
  return findCanvasTemplate(postType, variant, "story_9x16");
}

/** Convenience for building a photo scene. */
function photoScene(args: {
  photoUrl: string;
  motionPreset: keyof typeof MOTION_PRESETS;
  durationMs: number;
  transition: keyof typeof DEFAULT_TRANSITION_MS_BY_TYPE;
}): Scene {
  const preset = MOTION_PRESETS[args.motionPreset];
  if (!preset) {
    // why: every key in MOTION_PRESETS resolves at module load, but TS
    // can't narrow Record<string,_> access — this guard is defensive
    // against a future motion-preset rename.
    throw new Error(`Unknown motion preset: ${args.motionPreset}`);
  }
  return {
    id: makeSceneId(),
    startMs: 0,
    durationMs: args.durationMs,
    content: { kind: "photo", photoUrl: args.photoUrl, motion: preset },
    transitionIn: args.transition,
    transitionMs: DEFAULT_TRANSITION_MS_BY_TYPE[args.transition],
  };
}

/** Convenience for building a design (hero/outro) scene. */
function designScene(args: {
  template: unknown;
  durationMs: number;
  transition: keyof typeof DEFAULT_TRANSITION_MS_BY_TYPE;
}): Scene {
  return {
    id: makeSceneId(),
    startMs: 0,
    durationMs: args.durationMs,
    content: { kind: "design", template: args.template },
    transitionIn: args.transition,
    transitionMs: DEFAULT_TRANSITION_MS_BY_TYPE[args.transition],
  };
}

/**
 * Resolve N photo URLs by cycling the supplied photos array and falling
 * back to the listing's hero photo when the gallery is empty. Returns
 * null entries only when both the gallery and the hero are missing —
 * factories degrade those slots to a design scene to keep the Reel
 * complete.
 */
function resolvePhotos(
  listing: PostBuilderListing,
  photos: readonly string[],
  count: number,
): readonly (string | null)[] {
  const out: (string | null)[] = [];
  const heroFallback = listing.hero_image_url ?? null;
  for (let i = 0; i < count; i++) {
    out.push(pickPhotoCycling(photos, i) ?? heroFallback);
  }
  return out;
}

// ===========================================================================
// JUST LISTED — 3 templates
// ===========================================================================

const JUST_LISTED_TEMPLATES: ReelTemplate[] = [
  {
    id: "reel.just_listed.cinematic_tour",
    name: "Cinematic Listing Tour",
    description:
      "Slow zoom-outs and dissolves — the prestige listing treatment. 4 photos, ~9s.",
    postType: "just_listed",
    durationSec: 9,
    photoSceneCount: 4,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("just_listed", "v1");
      const [p0, p1, p2, p3] = resolvePhotos(listing, photos, 4);
      const scenes: Scene[] = [
        designScene({ template: hero, durationMs: 1800, transition: "cut" }),
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_out",
              durationMs: 1700,
              transition: "dissolve",
            })
          : designScene({ template: hero, durationMs: 1700, transition: "dissolve" }),
        p1
          ? photoScene({
              photoUrl: p1,
              motionPreset: "pan_right",
              durationMs: 1700,
              transition: "dissolve",
            })
          : designScene({ template: hero, durationMs: 1700, transition: "dissolve" }),
        p2
          ? photoScene({
              photoUrl: p2,
              motionPreset: "zoom_in",
              durationMs: 1700,
              transition: "dissolve",
            })
          : designScene({ template: hero, durationMs: 1700, transition: "dissolve" }),
        p3
          ? photoScene({
              photoUrl: p3,
              motionPreset: "pan_left",
              durationMs: 1500,
              transition: "dissolve",
            })
          : designScene({ template: hero, durationMs: 1500, transition: "dissolve" }),
        designScene({ template: hero, durationMs: 1200, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.just_listed.hero_to_stats",
    name: "Hero-to-Stats Reveal",
    description:
      "Hero card, one wide photo, then the Bold Stats variant punches in. 1 photo, ~6s.",
    postType: "just_listed",
    durationSec: 6,
    photoSceneCount: 1,
    defaultsSilent: true,
    build: (listing, photos) => {
      const heroV1 = designTemplate("just_listed", "v1");
      const heroV2 = designTemplate("just_listed", "v2");
      const [p0] = resolvePhotos(listing, photos, 1);
      const scenes: Scene[] = [
        designScene({ template: heroV1, durationMs: 1500, transition: "cut" }),
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_in",
              durationMs: 2200,
              transition: "fade",
            })
          : designScene({ template: heroV1, durationMs: 2200, transition: "fade" }),
        designScene({ template: heroV2, durationMs: 2300, transition: "zoom_blur" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.just_listed.quick_walkthrough",
    name: "Quick Walkthrough",
    description:
      "Five photos in rapid succession with alternating pans — kinetic, scroll-stopping. ~7s.",
    postType: "just_listed",
    durationSec: 7,
    photoSceneCount: 5,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("just_listed", "v1");
      const [p0, p1, p2, p3, p4] = resolvePhotos(listing, photos, 5);
      const motions: Array<keyof typeof MOTION_PRESETS> = [
        "pan_right",
        "pan_left",
        "zoom_in",
        "pan_right",
        "zoom_out",
      ];
      const photoSlots = [p0, p1, p2, p3, p4];
      const photoScenes: Scene[] = photoSlots.map((url, i) =>
        url
          ? photoScene({
              photoUrl: url,
              motionPreset: motions[i]!,
              durationMs: 1000,
              transition: i === 0 ? "cut" : "dissolve",
            })
          : designScene({
              template: hero,
              durationMs: 1000,
              transition: i === 0 ? "cut" : "dissolve",
            }),
      );
      const scenes: Scene[] = [
        designScene({ template: hero, durationMs: 1200, transition: "cut" }),
        ...photoScenes,
        designScene({ template: hero, durationMs: 1100, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
];

// ===========================================================================
// OPEN HOUSE — 3 templates
// ===========================================================================

const OPEN_HOUSE_TEMPLATES: ReelTemplate[] = [
  {
    id: "reel.open_house.weekend_promo",
    name: "Open House Promo",
    description:
      "Magazine-cover hero, 3 interior photos with slow zooms, design outro. ~8s.",
    postType: "open_house",
    durationSec: 8,
    photoSceneCount: 3,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("open_house", "v6");
      const [p0, p1, p2] = resolvePhotos(listing, photos, 3);
      const scenes: Scene[] = [
        designScene({ template: hero, durationMs: 2000, transition: "cut" }),
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_in",
              durationMs: 1600,
              transition: "fade",
            })
          : designScene({ template: hero, durationMs: 1600, transition: "fade" }),
        p1
          ? photoScene({
              photoUrl: p1,
              motionPreset: "pan_right",
              durationMs: 1600,
              transition: "dissolve",
            })
          : designScene({ template: hero, durationMs: 1600, transition: "dissolve" }),
        p2
          ? photoScene({
              photoUrl: p2,
              motionPreset: "zoom_out",
              durationMs: 1600,
              transition: "dissolve",
            })
          : designScene({ template: hero, durationMs: 1600, transition: "dissolve" }),
        designScene({ template: hero, durationMs: 1300, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.open_house.this_saturday_bombshell",
    name: "This Saturday Bombshell",
    description:
      "Bold Stats hero, hard cut into one big photo, zoom-blur back to stats. ~6s.",
    postType: "open_house",
    durationSec: 6,
    photoSceneCount: 1,
    defaultsSilent: true,
    build: (listing, photos) => {
      const heroV2 = designTemplate("open_house", "v2");
      const heroV6 = designTemplate("open_house", "v6");
      const [p0] = resolvePhotos(listing, photos, 1);
      const scenes: Scene[] = [
        designScene({ template: heroV2, durationMs: 1700, transition: "cut" }),
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_in",
              durationMs: 2400,
              transition: "zoom_blur",
            })
          : designScene({ template: heroV6, durationMs: 2400, transition: "zoom_blur" }),
        designScene({ template: heroV6, durationMs: 2000, transition: "zoom_blur" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.open_house.doors_open_teaser",
    name: "Doors-Open Teaser",
    description:
      "Pan-left chain across 4 photos with soft dissolves — feels like walking through the house. ~7s.",
    postType: "open_house",
    durationSec: 7,
    photoSceneCount: 4,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("open_house", "v1");
      const [p0, p1, p2, p3] = resolvePhotos(listing, photos, 4);
      const photoSlots = [p0, p1, p2, p3];
      const photoScenes: Scene[] = photoSlots.map((url, i) =>
        url
          ? photoScene({
              photoUrl: url,
              motionPreset: "pan_left",
              durationMs: 1300,
              transition: "dissolve",
            })
          : designScene({
              template: hero,
              durationMs: 1300,
              transition: "dissolve",
            }),
      );
      const scenes: Scene[] = [
        designScene({ template: hero, durationMs: 1300, transition: "cut" }),
        ...photoScenes,
        designScene({ template: hero, durationMs: 1100, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
];

// ===========================================================================
// JUST SOLD — 3 templates
// ===========================================================================

const JUST_SOLD_TEMPLATES: ReelTemplate[] = [
  {
    id: "reel.just_sold.bombshell",
    name: "Just Sold Bombshell",
    description:
      "Dramatic zoom-in on the hero photo, smash into the magazine-cover SOLD stamp. ~7s.",
    postType: "just_sold",
    durationSec: 7,
    photoSceneCount: 2,
    defaultsSilent: true,
    build: (listing, photos) => {
      const heroV6 = designTemplate("just_sold", "v6");
      const heroV1 = designTemplate("just_sold", "v1");
      const [p0, p1] = resolvePhotos(listing, photos, 2);
      const scenes: Scene[] = [
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_in",
              durationMs: 2200,
              transition: "cut",
            })
          : designScene({ template: heroV1, durationMs: 2200, transition: "cut" }),
        designScene({ template: heroV6, durationMs: 2000, transition: "zoom_blur" }),
        p1
          ? photoScene({
              photoUrl: p1,
              motionPreset: "pan_right",
              durationMs: 1500,
              transition: "fade",
            })
          : designScene({ template: heroV1, durationMs: 1500, transition: "fade" }),
        designScene({ template: heroV6, durationMs: 1400, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.just_sold.stats_proof",
    name: "Sold — Stats That Prove It",
    description:
      "Hero photo, then the Bold Stats card lingers so the price + days-on-market read clearly. ~8s.",
    postType: "just_sold",
    durationSec: 8,
    photoSceneCount: 2,
    defaultsSilent: true,
    build: (listing, photos) => {
      const heroV1 = designTemplate("just_sold", "v1");
      const heroV2 = designTemplate("just_sold", "v2");
      const [p0, p1] = resolvePhotos(listing, photos, 2);
      const scenes: Scene[] = [
        designScene({ template: heroV1, durationMs: 1600, transition: "cut" }),
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_out",
              durationMs: 1800,
              transition: "dissolve",
            })
          : designScene({ template: heroV1, durationMs: 1800, transition: "dissolve" }),
        designScene({ template: heroV2, durationMs: 2600, transition: "fade" }),
        p1
          ? photoScene({
              photoUrl: p1,
              motionPreset: "pan_left",
              durationMs: 1500,
              transition: "fade",
            })
          : designScene({ template: heroV1, durationMs: 1500, transition: "fade" }),
        designScene({ template: heroV2, durationMs: 1200, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.just_sold.before_after",
    name: "Before & After Sold",
    description:
      "Alternating photo + SOLD-stamp scenes — celebrates the close. 3 photos, ~8s.",
    postType: "just_sold",
    durationSec: 8,
    photoSceneCount: 3,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("just_sold", "v6");
      const [p0, p1, p2] = resolvePhotos(listing, photos, 3);
      const scenes: Scene[] = [
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_in",
              durationMs: 1400,
              transition: "cut",
            })
          : designScene({ template: hero, durationMs: 1400, transition: "cut" }),
        designScene({ template: hero, durationMs: 1200, transition: "fade" }),
        p1
          ? photoScene({
              photoUrl: p1,
              motionPreset: "pan_right",
              durationMs: 1400,
              transition: "fade",
            })
          : designScene({ template: hero, durationMs: 1400, transition: "fade" }),
        designScene({ template: hero, durationMs: 1200, transition: "fade" }),
        p2
          ? photoScene({
              photoUrl: p2,
              motionPreset: "zoom_out",
              durationMs: 1400,
              transition: "fade",
            })
          : designScene({ template: hero, durationMs: 1400, transition: "fade" }),
        designScene({ template: hero, durationMs: 1400, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
];

// ===========================================================================
// PRICE REDUCTION — 3 templates
// ===========================================================================

const PRICE_REDUCTION_TEMPLATES: ReelTemplate[] = [
  {
    id: "reel.price_reduction.price_drop_punch",
    name: "Price Drop Punch",
    description:
      "Magazine-cover ↓ NEW PRICE hero, slide-left chain across 3 photos, punchy and short. ~6s.",
    postType: "price_reduction",
    durationSec: 6,
    photoSceneCount: 3,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("price_reduction", "v6");
      const [p0, p1, p2] = resolvePhotos(listing, photos, 3);
      const photoSlots = [p0, p1, p2];
      const motions: Array<keyof typeof MOTION_PRESETS> = [
        "zoom_in",
        "pan_left",
        "zoom_out",
      ];
      const photoScenes: Scene[] = photoSlots.map((url, i) =>
        url
          ? photoScene({
              photoUrl: url,
              motionPreset: motions[i]!,
              durationMs: 1100,
              transition: "slide_left",
            })
          : designScene({
              template: hero,
              durationMs: 1100,
              transition: "slide_left",
            }),
      );
      const scenes: Scene[] = [
        designScene({ template: hero, durationMs: 1500, transition: "cut" }),
        ...photoScenes,
        designScene({ template: hero, durationMs: 1100, transition: "slide_left" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.price_reduction.new_price_reveal",
    name: "New Price Reveal",
    description:
      "Photo first, then the Bold Stats card lingers so the new number reads. ~7s.",
    postType: "price_reduction",
    durationSec: 7,
    photoSceneCount: 2,
    defaultsSilent: true,
    build: (listing, photos) => {
      const heroV1 = designTemplate("price_reduction", "v1");
      const heroV2 = designTemplate("price_reduction", "v2");
      const [p0, p1] = resolvePhotos(listing, photos, 2);
      const scenes: Scene[] = [
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_in",
              durationMs: 1700,
              transition: "cut",
            })
          : designScene({ template: heroV1, durationMs: 1700, transition: "cut" }),
        designScene({ template: heroV2, durationMs: 2600, transition: "zoom_blur" }),
        p1
          ? photoScene({
              photoUrl: p1,
              motionPreset: "pan_right",
              durationMs: 1500,
              transition: "fade",
            })
          : designScene({ template: heroV1, durationMs: 1500, transition: "fade" }),
        designScene({ template: heroV2, durationMs: 1200, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.price_reduction.dont_miss_markdown",
    name: "Don't-Miss Markdown",
    description:
      "Pan-right chain with a zoom-blur finish — energetic urgency. 4 photos, ~7s.",
    postType: "price_reduction",
    durationSec: 7,
    photoSceneCount: 4,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("price_reduction", "v6");
      const [p0, p1, p2, p3] = resolvePhotos(listing, photos, 4);
      const photoSlots = [p0, p1, p2, p3];
      const photoScenes: Scene[] = photoSlots.map((url, i) =>
        url
          ? photoScene({
              photoUrl: url,
              motionPreset: "pan_right",
              durationMs: 1100,
              transition: i === 0 ? "cut" : "dissolve",
            })
          : designScene({
              template: hero,
              durationMs: 1100,
              transition: i === 0 ? "cut" : "dissolve",
            }),
      );
      const scenes: Scene[] = [
        designScene({ template: hero, durationMs: 1300, transition: "cut" }),
        ...photoScenes,
        designScene({ template: hero, durationMs: 1300, transition: "zoom_blur" }),
      ];
      return composeReel(listing, scenes);
    },
  },
];

// ===========================================================================
// UNDER CONTRACT — 3 templates
// ===========================================================================

const UNDER_CONTRACT_TEMPLATES: ReelTemplate[] = [
  {
    id: "reel.under_contract.announcement",
    name: "Under Contract Announcement",
    description:
      "Slow pan across 3 photos, ends on the UNDER CONTRACT hero. ~7s.",
    postType: "under_contract",
    durationSec: 7,
    photoSceneCount: 3,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("under_contract", "v1");
      const [p0, p1, p2] = resolvePhotos(listing, photos, 3);
      const photoSlots = [p0, p1, p2];
      const motions: Array<keyof typeof MOTION_PRESETS> = [
        "pan_left",
        "pan_right",
        "zoom_out",
      ];
      const photoScenes: Scene[] = photoSlots.map((url, i) =>
        url
          ? photoScene({
              photoUrl: url,
              motionPreset: motions[i]!,
              durationMs: 1500,
              transition: i === 0 ? "cut" : "dissolve",
            })
          : designScene({
              template: hero,
              durationMs: 1500,
              transition: i === 0 ? "cut" : "dissolve",
            }),
      );
      const scenes: Scene[] = [
        ...photoScenes,
        designScene({ template: hero, durationMs: 2300, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.under_contract.pending_stats",
    name: "Pending — The Stats",
    description:
      "Bold Stats hero holds long so price + property details read; bookended by hero photo. ~8s.",
    postType: "under_contract",
    durationSec: 8,
    photoSceneCount: 1,
    defaultsSilent: true,
    build: (listing, photos) => {
      const heroV1 = designTemplate("under_contract", "v1");
      const heroV2 = designTemplate("under_contract", "v2");
      const [p0] = resolvePhotos(listing, photos, 1);
      const scenes: Scene[] = [
        designScene({ template: heroV1, durationMs: 1600, transition: "cut" }),
        p0
          ? photoScene({
              photoUrl: p0,
              motionPreset: "zoom_out",
              durationMs: 2200,
              transition: "dissolve",
            })
          : designScene({ template: heroV1, durationMs: 2200, transition: "dissolve" }),
        designScene({ template: heroV2, durationMs: 2800, transition: "fade" }),
        designScene({ template: heroV1, durationMs: 1300, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
  {
    id: "reel.under_contract.heading_to_closing",
    name: "Heading to Closing",
    description:
      "Quick photo sequence — celebrates the milestone without overstaying. 4 photos, ~6s.",
    postType: "under_contract",
    durationSec: 6,
    photoSceneCount: 4,
    defaultsSilent: true,
    build: (listing, photos) => {
      const hero = designTemplate("under_contract", "v1");
      const [p0, p1, p2, p3] = resolvePhotos(listing, photos, 4);
      const photoSlots = [p0, p1, p2, p3];
      const motions: Array<keyof typeof MOTION_PRESETS> = [
        "zoom_in",
        "pan_right",
        "pan_left",
        "zoom_out",
      ];
      const photoScenes: Scene[] = photoSlots.map((url, i) =>
        url
          ? photoScene({
              photoUrl: url,
              motionPreset: motions[i]!,
              durationMs: 1000,
              transition: i === 0 ? "cut" : "dissolve",
            })
          : designScene({
              template: hero,
              durationMs: 1000,
              transition: i === 0 ? "cut" : "dissolve",
            }),
      );
      const scenes: Scene[] = [
        designScene({ template: hero, durationMs: 1200, transition: "cut" }),
        ...photoScenes,
        designScene({ template: hero, durationMs: 1100, transition: "fade" }),
      ];
      return composeReel(listing, scenes);
    },
  },
];

// ===========================================================================
// Manifest export
// ===========================================================================

/**
 * The full Reel Template Library. Order here is the default sort order in
 * the picker (matches `REEL_POST_TYPE_META` group order: Just Listed first,
 * then Just Sold, Under Contract, Open House, Price Reduced).
 */
export const REEL_TEMPLATES: readonly ReelTemplate[] = [
  ...JUST_LISTED_TEMPLATES,
  ...JUST_SOLD_TEMPLATES,
  ...UNDER_CONTRACT_TEMPLATES,
  ...OPEN_HOUSE_TEMPLATES,
  ...PRICE_REDUCTION_TEMPLATES,
];

/**
 * Lookup by id. Used when the picker fires `onTemplateApply` and we need
 * to resolve back to the factory.
 */
export function findReelTemplate(id: string): ReelTemplate | null {
  return REEL_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Group the manifest by post type for the picker's category sections.
 * Returns a stable shape — entries appear in `REEL_POST_TYPE_META` order
 * regardless of how the underlying arrays are concatenated above.
 */
export function getReelTemplatesByPostType(): ReadonlyArray<{
  postType: PostType;
  templates: readonly ReelTemplate[];
}> {
  const order: readonly PostType[] = [
    "just_listed",
    "just_sold",
    "under_contract",
    "open_house",
    "price_reduction",
  ];
  return order.map((postType) => ({
    postType,
    templates: REEL_TEMPLATES.filter((t) => t.postType === postType),
  }));
}
