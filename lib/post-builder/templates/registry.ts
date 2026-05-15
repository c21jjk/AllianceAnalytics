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
import { renderV1HeroEditorial } from "./primitives/v1-hero-editorial";
import { renderV1HeroEditorialPortrait } from "./primitives/v1-hero-editorial-portrait";
import { renderV1HeroEditorialStory } from "./primitives/v1-hero-editorial-story";
import { renderV2BoldStats } from "./primitives/v2-bold-stats";
import { renderV2BoldStatsPortrait } from "./primitives/v2-bold-stats-portrait";
import { renderV2BoldStatsStory } from "./primitives/v2-bold-stats-story";
import { renderV3SideBySide } from "./primitives/v3-side-by-side";
import { renderV3SideBySidePortrait } from "./primitives/v3-side-by-side-portrait";
import { renderV3SideBySideStory } from "./primitives/v3-side-by-side-story";
import { renderV6MagazineCover } from "./primitives/v6-magazine-cover";
import { renderV6MagazineCoverPortrait } from "./primitives/v6-magazine-cover-portrait";
import { renderV6MagazineCoverStory } from "./primitives/v6-magazine-cover-story";
import { renderV7Polaroid } from "./primitives/v7-polaroid";
import { renderV7PolaroidPortrait } from "./primitives/v7-polaroid-portrait";
import { renderV7PolaroidStory } from "./primitives/v7-polaroid-story";
import { renderV8MinimalFrame } from "./primitives/v8-minimal-frame";
import { renderV8MinimalFramePortrait } from "./primitives/v8-minimal-frame-portrait";
import { renderV8MinimalFrameStory } from "./primitives/v8-minimal-frame-story";
import { POST_TYPE_THEMES, getTheme } from "./themes";

// v4 (Two-Photo Diptych) and v5 (Three-Photo Grid) retired on 2026-05-14.
// The product direction shifted to single-photo posts only; users who want
// a multi-photo composite drag additional photos onto the canvas inside
// Studio (left-sidebar Photos panel). Old generated_posts rows with
// variant='v4'/'v5' still load via their saved image_url and layer_tree.

/**
 * Template registry.
 *
 * Current architecture: 5 post types × 3 variants × 3 formats = 45
 * composable templates. The (variant, format) primitives are 9 files;
 * post-type is applied via the theme. Template IDs follow
 * "{post_type}_{format_short}_{variant}".
 *
 *   - Adding a new variant: add a primitive file per format, register here.
 *   - Adding a new format: add 3 primitive files (one per variant), register.
 *   - Adding a new post type: one theme entry, all 9 (variant, format)
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

// Active single-photo variants. v4/v5 retired 2026-05-14.
// PostVariant still types as "v1" | "v2" | "v3" | "v4" | "v5" (legacy
// rows in the DB use v4/v5), but the runtime registry only registers
// the 3 active ones. listVariantsForPostType() / listTemplates() see
// only the active set, so the picker UI never shows v4/v5 cards.
const ACTIVE_VARIANTS = ["v1", "v2", "v3", "v6", "v7", "v8"] as const satisfies readonly PostVariant[];
type ActiveVariant = (typeof ACTIVE_VARIANTS)[number];

const PRIMITIVE_RENDERERS: Record<ActiveVariant, Record<PostFormat, PrimitiveRenderer>> = {
  v1: {
    square_1x1: renderV1HeroEditorial,
    portrait_4x5: renderV1HeroEditorialPortrait,
    story_9x16: renderV1HeroEditorialStory,
  },
  v2: {
    square_1x1: renderV2BoldStats,
    portrait_4x5: renderV2BoldStatsPortrait,
    story_9x16: renderV2BoldStatsStory,
  },
  v3: {
    square_1x1: renderV3SideBySide,
    portrait_4x5: renderV3SideBySidePortrait,
    story_9x16: renderV3SideBySideStory,
  },
  v6: {
    square_1x1: renderV6MagazineCover,
    portrait_4x5: renderV6MagazineCoverPortrait,
    story_9x16: renderV6MagazineCoverStory,
  },
  v7: {
    square_1x1: renderV7Polaroid,
    portrait_4x5: renderV7PolaroidPortrait,
    story_9x16: renderV7PolaroidStory,
  },
  v8: {
    square_1x1: renderV8MinimalFrame,
    portrait_4x5: renderV8MinimalFramePortrait,
    story_9x16: renderV8MinimalFrameStory,
  },
};

const VARIANT_META: Record<
  ActiveVariant,
  { display_name: string; description: string; photo_count: number }
> = {
  v1: {
    display_name: "Hero Editorial",
    description:
      "Hero photo fills the frame. Type stacked over a dark gradient. Best when the photo is the story.",
    photo_count: 1,
  },
  v2: {
    display_name: "Bold Stats",
    description:
      "Photo plus oversized price + stat row on a dark data surface. Magazine feel.",
    photo_count: 1,
  },
  v3: {
    display_name: "Side-by-Side",
    description:
      "Photo + data on a light surface with a gold accent rule between them. Listing-card composition.",
    photo_count: 1,
  },
  v6: {
    display_name: "Magazine Cover",
    description:
      "Editorial magazine-cover layout — hero photo above, large serif headline + price below on a cream surface.",
    photo_count: 1,
  },
  v7: {
    display_name: "Polaroid",
    description:
      "Polaroid-framed hero on a kraft-paper background with a slight tilt. Casual + warm, Pinterest-friendly.",
    photo_count: 1,
  },
  v8: {
    display_name: "Minimal Frame",
    description:
      "Gold-framed hero in maximum negative space. Gallery-poster minimalism for high-end listings.",
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

