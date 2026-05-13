/**
 * Layer-builders dispatch.
 *
 * Single entry point that turns a (template_id, listing, photos) tuple into
 * a complete LayerTree. Template IDs follow:
 *
 *   IG single-photo / multi-photo:
 *     `${post_type}_${format_short}_${variant}`
 *   e.g. `just_listed_square_v1`, `open_house_story_v3`, `just_sold_portrait_v4`
 *
 *   FB primitives:
 *     `fb_new_listing_v1`, `fb_open_house_v1`
 *
 * The 5 IG variants × 3 formats × N post types all dispatch to one of 15
 * layer-builders — the post type comes via the resolved theme.
 */

import type { LayerTree } from "../../layers/types";
import type {
  PostBuilderListingWithOH,
  PostTypeTheme,
} from "../primitives/_shared";
import type { PostFormat, PostType, PostVariant } from "../../types";
import { getTheme } from "../themes";

import { buildV1HeroEditorialSquare } from "./v1-hero-editorial";
import { buildV1HeroEditorialPortrait } from "./v1-hero-editorial-portrait";
import { buildV1HeroEditorialStory } from "./v1-hero-editorial-story";
import { buildV2BoldStatsSquare } from "./v2-bold-stats";
import { buildV2BoldStatsPortrait } from "./v2-bold-stats-portrait";
import { buildV2BoldStatsStory } from "./v2-bold-stats-story";
import { buildV3SideBySideSquare } from "./v3-side-by-side";
import { buildV3SideBySidePortrait } from "./v3-side-by-side-portrait";
import { buildV3SideBySideStory } from "./v3-side-by-side-story";
import { buildV4TwoPhotoDiptychSquare } from "./v4-two-photo-diptych";
import { buildV4TwoPhotoDiptychPortrait } from "./v4-two-photo-diptych-portrait";
import { buildV4TwoPhotoDiptychStory } from "./v4-two-photo-diptych-story";
import { buildV5ThreePhotoGridSquare } from "./v5-three-photo-grid";
import { buildV5ThreePhotoGridPortrait } from "./v5-three-photo-grid-portrait";
import { buildV5ThreePhotoGridStory } from "./v5-three-photo-grid-story";
import { buildFBNewListingV1 } from "./fb-new-listing-v1";
import { buildFBOpenHouseV1 } from "./fb-open-house-v1";

type IGBuilder = (args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}) => LayerTree;

const IG_BUILDERS: Record<PostVariant, Record<PostFormat, IGBuilder>> = {
  v1: {
    square_1x1: buildV1HeroEditorialSquare,
    portrait_4x5: buildV1HeroEditorialPortrait,
    story_9x16: buildV1HeroEditorialStory,
  },
  v2: {
    square_1x1: buildV2BoldStatsSquare,
    portrait_4x5: buildV2BoldStatsPortrait,
    story_9x16: buildV2BoldStatsStory,
  },
  v3: {
    square_1x1: buildV3SideBySideSquare,
    portrait_4x5: buildV3SideBySidePortrait,
    story_9x16: buildV3SideBySideStory,
  },
  v4: {
    square_1x1: buildV4TwoPhotoDiptychSquare,
    portrait_4x5: buildV4TwoPhotoDiptychPortrait,
    story_9x16: buildV4TwoPhotoDiptychStory,
  },
  v5: {
    square_1x1: buildV5ThreePhotoGridSquare,
    portrait_4x5: buildV5ThreePhotoGridPortrait,
    story_9x16: buildV5ThreePhotoGridStory,
  },
};

const FORMAT_BY_SHORT: Record<string, PostFormat> = {
  square: "square_1x1",
  portrait: "portrait_4x5",
  story: "story_9x16",
};

const KNOWN_POST_TYPES: PostType[] = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
];

const KNOWN_VARIANTS: PostVariant[] = ["v1", "v2", "v3", "v4", "v5"];

/**
 * Public dispatch. Given a template_id (e.g. `just_listed_square_v1` or
 * `fb_new_listing_v1`), build the corresponding LayerTree.
 *
 * Returns null if the template_id doesn't parse to a known builder.
 */
export function buildLayerTreeForTemplate(args: {
  template_id: string;
  listing: PostBuilderListingWithOH;
  heroImageUrls: string[];
  /** Optional theme override — if absent we look it up from the post_type prefix. */
  theme?: PostTypeTheme;
  /** FB New Listing only. */
  customFeature?: string | null;
}): LayerTree | null {
  const id = args.template_id;

  // FB primitives — fixed ids.
  if (id === "fb_new_listing_v1") {
    return buildFBNewListingV1({
      listing: args.listing,
      heroImageUrls: args.heroImageUrls,
      customFeature: args.customFeature,
    });
  }
  if (id === "fb_open_house_v1") {
    return buildFBOpenHouseV1({
      listing: args.listing,
      heroImageUrls: args.heroImageUrls,
    });
  }

  // IG single/multi: parse `${post_type}_${format_short}_${variant}`.
  // Post types may include underscores (e.g. just_listed) so we walk from
  // the right: variant = last token, format = second-to-last, post_type = rest.
  const parts = id.split("_");
  if (parts.length < 3) return null;
  const variant = parts[parts.length - 1] as PostVariant;
  const formatShort = parts[parts.length - 2];
  const postType = parts.slice(0, parts.length - 2).join("_") as PostType;

  if (!KNOWN_VARIANTS.includes(variant)) return null;
  const format = FORMAT_BY_SHORT[formatShort];
  if (!format) return null;
  if (!KNOWN_POST_TYPES.includes(postType)) return null;

  const builder = IG_BUILDERS[variant][format];
  if (!builder) return null;

  const theme = args.theme ?? getTheme(postType);

  return builder({
    listing: args.listing,
    theme,
    heroImageUrls: args.heroImageUrls,
  });
}

export {
  buildV1HeroEditorialSquare,
  buildV1HeroEditorialPortrait,
  buildV1HeroEditorialStory,
  buildV2BoldStatsSquare,
  buildV2BoldStatsPortrait,
  buildV2BoldStatsStory,
  buildV3SideBySideSquare,
  buildV3SideBySidePortrait,
  buildV3SideBySideStory,
  buildV4TwoPhotoDiptychSquare,
  buildV4TwoPhotoDiptychPortrait,
  buildV4TwoPhotoDiptychStory,
  buildV5ThreePhotoGridSquare,
  buildV5ThreePhotoGridPortrait,
  buildV5ThreePhotoGridStory,
  buildFBNewListingV1,
  buildFBOpenHouseV1,
};
