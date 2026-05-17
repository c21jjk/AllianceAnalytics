import type {
  PostBuilderListing,
  PostCustomizations,
  PostFormat,
  PostType,
  PostVariant,
  TemplateMeta,
} from "../types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "./primitives/_shared";
import {
  applyColorCustomizations,
  applyTextCustomizations,
  buildCustomizationCSS,
  injectCustomizationCSS,
} from "./primitives/_shared";
import { renderV2BoldStats } from "./primitives/v2-bold-stats";
import { renderV2BoldStatsPortrait } from "./primitives/v2-bold-stats-portrait";
import { renderV2BoldStatsStory } from "./primitives/v2-bold-stats-story";
import { renderV3ExcellenceCollection } from "./primitives/v3-excellence-collection";
import { renderV3ExcellenceCollectionPortrait } from "./primitives/v3-excellence-collection-portrait";
import { renderV3ExcellenceCollectionStory } from "./primitives/v3-excellence-collection-story";
import { renderV6MagazineCover } from "./primitives/v6-magazine-cover";
import { renderV6MagazineCoverPortrait } from "./primitives/v6-magazine-cover-portrait";
import { renderV6MagazineCoverStory } from "./primitives/v6-magazine-cover-story";
import { renderV8StandardListing } from "./primitives/v8-standard-listing";
import { renderV8StandardListingPortrait } from "./primitives/v8-standard-listing-portrait";
import { renderV8StandardListingStory } from "./primitives/v8-standard-listing-story";
import { renderV9JustSoldCelebration } from "./primitives/v9-just-sold-celebration";
import { renderV9JustSoldCelebrationPortrait } from "./primitives/v9-just-sold-celebration-portrait";
import { renderV9JustSoldCelebrationStory } from "./primitives/v9-just-sold-celebration-story";
import { renderV10ComingSoonTeaser } from "./primitives/v10-coming-soon-teaser";
import { renderV10ComingSoonTeaserPortrait } from "./primitives/v10-coming-soon-teaser-portrait";
import { renderV10ComingSoonTeaserStory } from "./primitives/v10-coming-soon-teaser-story";
import { POST_TYPE_THEMES, getTheme } from "./themes";

// v4 (Two-Photo Diptych) and v5 (Three-Photo Grid) retired on 2026-05-14.
// The product direction shifted to single-photo posts only; users who want
// a multi-photo composite drag additional photos onto the canvas inside
// Studio (left-sidebar Photos panel). Old generated_posts rows with
// variant='v4'/'v5' still load via their saved image_url and layer_tree.

/**
 * Template registry.
 *
 * Current architecture (2026-05-17): 5 post types × 6 variants × 3 formats =
 * 90 composable templates. The (variant, format) primitives are 18 files;
 * post-type is applied via the theme. Template IDs follow
 * "{post_type}_{format_short}_{variant}".
 *
 * Active variants:
 *   • v2 Bold Stats           — photo + oversized stats on a dark surface
 *   • v3 Excellence Collection — premium tier (replaces v3 Side-by-Side)
 *   • v6 Magazine Cover       — editorial cover-style layout
 *   • v8 Standard NEW LISTING — everyday tier (replaces v8 Minimal Frame)
 *   • v9 Just Sold Celebration — closed-deal energy with angled SOLD sash
 *   • v10 Coming Soon Teaser   — pre-listing tease with withheld address
 *
 * Retired (kept on disk for git history but not imported): v1 Hero
 * Editorial and v7 Polaroid (2026-05-17); v4 Diptych and v5 Grid
 * (2026-05-14); v3 Side-by-Side and v8 Minimal Frame (2026-05-17 — variant
 * slots reassigned to Excellence Collection and Standard NEW LISTING).
 *
 *   - Adding a new variant: add 3 primitive files (one per format), register here.
 *   - Adding a new format: add 6 primitive files (one per variant), register.
 *   - Adding a new post type: one theme entry, all 18 (variant, format)
 *     combinations light up automatically.
 *
 * All variants are single-photo as of 2026-05-14 (v4/v5 multi-photo
 * retired in favor of a single-photo-first UX; users compose multi-photo
 * layouts inside Studio when they want them).
 */

export type TemplateRenderer = (args: {
  listing: PostBuilderListing;
  /** First photo. Single-photo variants render this; v4/v5 are retired. */
  heroImageDataUri: string;
  /**
   * Forward-compat slot. v1-v3 ignore this. Retained on the signature so
   * future multi-photo template primitives (e.g. an editorial diptych
   * authored under Studio's free-form canvas later) can opt in without
   * a contract change.
   */
  heroImageDataUris?: string[];
  /**
   * Path A — user customizations. When provided, the registry wrapper
   * applies text/color overrides to the theme before calling the
   * primitive, and injects a CSS override layer at the end of the rendered
   * HTML so the visual rules win the cascade.
   */
  customizations?: PostCustomizations | null;
}) => string;

interface TemplateEntry {
  meta: TemplateMeta;
  render: TemplateRenderer;
}

type PrimitiveRenderer = (args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
  heroImageDataUris?: string[];
}) => string;

// Active single-photo variants (2026-05-17): v2, v3, v6, v8, v9, v10.
// v1 Hero Editorial and v7 Polaroid retired same day; v4/v5 retired 2026-05-14.
// PostVariant still types as a wider union including legacy values so old
// generated_posts rows continue to deserialize, but the runtime registry
// only registers the active set. listVariantsForPostType() / listTemplates()
// see only the active set, so the picker UI never shows retired cards.
const ACTIVE_VARIANTS = ["v2", "v3", "v6", "v8", "v9", "v10"] as const satisfies readonly PostVariant[];
type ActiveVariant = (typeof ACTIVE_VARIANTS)[number];

const PRIMITIVE_RENDERERS: Record<ActiveVariant, Record<PostFormat, PrimitiveRenderer>> = {
  v2: {
    square_1x1: renderV2BoldStats,
    portrait_4x5: renderV2BoldStatsPortrait,
    story_9x16: renderV2BoldStatsStory,
  },
  v3: {
    square_1x1: renderV3ExcellenceCollection,
    portrait_4x5: renderV3ExcellenceCollectionPortrait,
    story_9x16: renderV3ExcellenceCollectionStory,
  },
  v6: {
    square_1x1: renderV6MagazineCover,
    portrait_4x5: renderV6MagazineCoverPortrait,
    story_9x16: renderV6MagazineCoverStory,
  },
  v8: {
    square_1x1: renderV8StandardListing,
    portrait_4x5: renderV8StandardListingPortrait,
    story_9x16: renderV8StandardListingStory,
  },
  v9: {
    square_1x1: renderV9JustSoldCelebration,
    portrait_4x5: renderV9JustSoldCelebrationPortrait,
    story_9x16: renderV9JustSoldCelebrationStory,
  },
  v10: {
    square_1x1: renderV10ComingSoonTeaser,
    portrait_4x5: renderV10ComingSoonTeaserPortrait,
    story_9x16: renderV10ComingSoonTeaserStory,
  },
};

const VARIANT_META: Record<
  ActiveVariant,
  { display_name: string; description: string; photo_count: number }
> = {
  v2: {
    display_name: "Bold Stats",
    description:
      "Photo plus oversized price + stat row on a dark data surface. Magazine feel.",
    photo_count: 1,
  },
  v3: {
    display_name: "Excellence Collection",
    description:
      "Premium tier — gold-trimmed editorial for properties $949k and up. Excellence Collection branding with dominant photo + Playfair price.",
    photo_count: 1,
  },
  v6: {
    display_name: "Magazine Cover",
    description:
      "Editorial magazine-cover layout — hero photo above, large serif headline + price below on a cream surface.",
    photo_count: 1,
  },
  v8: {
    display_name: "Standard NEW LISTING",
    description:
      "Everyday tier — cream surface with dark bottom band carrying address, city, and bed/bath/feature row. C21 Alliance badge top-right.",
    photo_count: 1,
  },
  v9: {
    display_name: "Just Sold Celebration",
    description:
      "Closed-deal energy — angled gold SOLD sash, photo with scrim, and bright address typography. For just_sold post types.",
    photo_count: 1,
  },
  v10: {
    display_name: "Coming Soon Teaser",
    description:
      "Pre-listing tease — heavy bottom veil, mixed-weight COMING/SOON in Playfair, withheld address (street + city only). Builds anticipation before list.",
    photo_count: 1,
  },
};

const POST_TYPE_META: Record<PostType, { display_name: string }> = {
  just_listed: { display_name: "Just Listed" },
  just_sold: { display_name: "Just Sold" },
  under_contract: { display_name: "Under Contract" },
  open_house: { display_name: "Open House" },
  price_reduction: { display_name: "Price Reduced" },
};

const FORMAT_META: Record<
  PostFormat,
  { display_name: string; description: string; aspect: string }
> = {
  square_1x1: {
    display_name: "Square",
    description: "Instagram feed + Facebook feed",
    aspect: "1:1",
  },
  portrait_4x5: {
    display_name: "Portrait",
    description: "Instagram feed preferred",
    aspect: "4:5",
  },
  story_9x16: {
    display_name: "Story",
    description: "IG / FB Story and Reels cover",
    aspect: "9:16",
  },
};

const SUPPORTED_FORMATS: PostFormat[] = ["square_1x1", "portrait_4x5", "story_9x16"];

const FORMAT_DIMENSIONS: Record<PostFormat, { width: number; height: number }> = {
  square_1x1: { width: 1080, height: 1080 },
  portrait_4x5: { width: 1080, height: 1350 },
  story_9x16: { width: 1080, height: 1920 },
};

function buildTemplateMap(): Record<string, TemplateEntry> {
  const out: Record<string, TemplateEntry> = {};
  for (const post_type of Object.keys(POST_TYPE_THEMES) as PostType[]) {
    for (const format of SUPPORTED_FORMATS) {
      for (const variant of ACTIVE_VARIANTS) {
        const id = `${post_type}_${formatShortName(format)}_${variant}`;
        const variantMeta = VARIANT_META[variant];
        const variantRenderer = PRIMITIVE_RENDERERS[variant][format];
        const meta: TemplateMeta = {
          id,
          post_type,
          variant,
          format,
          display_name: `${POST_TYPE_META[post_type].display_name} · ${variantMeta.display_name}`,
          description: variantMeta.description,
          dimensions: FORMAT_DIMENSIONS[format],
          photo_count: variantMeta.photo_count,
        };
        out[id] = {
          meta,
          render: ({ listing, heroImageDataUri, heroImageDataUris, customizations }) => {
            // Apply text + color overrides to the theme before primitive render.
            // (Text and brand colors are baked into the HTML at render time.)
            let theme = getTheme(post_type);
            theme = applyColorCustomizations(theme, customizations);
            theme = applyTextCustomizations(theme, customizations);
            const baseHtml = variantRenderer({
              listing: listing as PostBuilderListingWithOH,
              theme,
              heroImageDataUri,
              heroImageDataUris,
            });
            // Inject visual customizations (visibility, badge sizing, badge
            // position) as a CSS layer after the template's <style> block so
            // its rules win the cascade.
            const overrideCss = buildCustomizationCSS(customizations);
            return injectCustomizationCSS(baseHtml, overrideCss);
          },
        };
      }
    }
  }
  return out;
}

export function formatShortName(format: PostFormat): string {
  switch (format) {
    case "square_1x1":
      return "square";
    case "portrait_4x5":
      return "portrait";
    case "story_9x16":
      return "story";
  }
}

export function formatDisplayMeta(format: PostFormat) {
  return FORMAT_META[format];
}

export function listSupportedFormats(): PostFormat[] {
  return [...SUPPORTED_FORMATS];
}

const TEMPLATES = buildTemplateMap();

export function getTemplate(template_id: string): TemplateEntry | null {
  return TEMPLATES[template_id] ?? null;
}

export function listTemplates(): TemplateMeta[] {
  return Object.values(TEMPLATES).map((t) => t.meta);
}

export function listTemplatesForPostType(post_type: PostType): TemplateMeta[] {
  return listTemplates().filter((t) => t.post_type === post_type);
}

export function listVariantsForPostType(post_type: PostType, format: PostFormat) {
  return listTemplates()
    .filter((t) => t.post_type === post_type && t.format === format)
    .map((t) => {
      // why: the wider PostVariant union still includes v4/v5 for legacy
      // generated_posts rows. The runtime registry only emits active
      // variants, so this narrow lookup is always safe — the assertion
      // just bridges the static type system to that runtime guarantee.
      const v = t.variant as ActiveVariant;
      return {
        template_id: t.id,
        variant: t.variant,
        display_name: VARIANT_META[v].display_name,
        description: VARIANT_META[v].description,
        photo_count: VARIANT_META[v].photo_count,
      };
    });
}

