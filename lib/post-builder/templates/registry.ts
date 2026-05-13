import type {
  PostBuilderListing,
  PostFormat,
  PostType,
  PostVariant,
  TemplateMeta,
} from "../types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "./primitives/_shared";
import { renderV1HeroEditorial } from "./primitives/v1-hero-editorial";
import { renderV1HeroEditorialPortrait } from "./primitives/v1-hero-editorial-portrait";
import { renderV1HeroEditorialStory } from "./primitives/v1-hero-editorial-story";
import { renderV2BoldStats } from "./primitives/v2-bold-stats";
import { renderV2BoldStatsPortrait } from "./primitives/v2-bold-stats-portrait";
import { renderV2BoldStatsStory } from "./primitives/v2-bold-stats-story";
import { renderV3SideBySide } from "./primitives/v3-side-by-side";
import { renderV3SideBySidePortrait } from "./primitives/v3-side-by-side-portrait";
import { renderV3SideBySideStory } from "./primitives/v3-side-by-side-story";
import { renderV4TwoPhotoDiptych } from "./primitives/v4-two-photo-diptych";
import { renderV4TwoPhotoDiptychPortrait } from "./primitives/v4-two-photo-diptych-portrait";
import { renderV4TwoPhotoDiptychStory } from "./primitives/v4-two-photo-diptych-story";
import { renderV5ThreePhotoGrid } from "./primitives/v5-three-photo-grid";
import { renderV5ThreePhotoGridPortrait } from "./primitives/v5-three-photo-grid-portrait";
import { renderV5ThreePhotoGridStory } from "./primitives/v5-three-photo-grid-story";
import { POST_TYPE_THEMES, getTheme } from "./themes";

/**
 * Template registry.
 *
 * Phase 3 architecture: 4 post types × 3 variants × 3 formats = 36
 * composable templates. The (variant, format) primitives are 9 files;
 * post-type is applied via the theme. Template IDs follow
 * "{post_type}_{format_short}_{variant}".
 *
 *   - Adding a new variant: add a primitive file per format, register here.
 *   - Adding a new format: add 3 primitive files (one per variant), register.
 *   - Adding a new post type: one theme entry, all 9 (variant, format)
 *     combinations light up automatically.
 */

export type TemplateRenderer = (args: {
  listing: PostBuilderListing;
  /** First photo (always present). Used by single-photo variants v1-v3. */
  heroImageDataUri: string;
  /**
   * Full ordered array of photos passed by the render pipeline. Length
   * equals the template's photo_count. Multi-photo variants (v4/v5) read
   * from this; single-photo variants ignore it.
   */
  heroImageDataUris?: string[];
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

// (variant, format) → primitive renderer.
const PRIMITIVE_RENDERERS: Record<PostVariant, Record<PostFormat, PrimitiveRenderer>> = {
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
  v4: {
    square_1x1: renderV4TwoPhotoDiptych,
    portrait_4x5: renderV4TwoPhotoDiptychPortrait,
    story_9x16: renderV4TwoPhotoDiptychStory,
  },
  v5: {
    square_1x1: renderV5ThreePhotoGrid,
    portrait_4x5: renderV5ThreePhotoGridPortrait,
    story_9x16: renderV5ThreePhotoGridStory,
  },
};

const VARIANT_META: Record<
  PostVariant,
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
  v4: {
    display_name: "Two-Photo Diptych",
    description:
      "Side-by-side photos on a light surface with a gold seam. Lookbook feel — pair an exterior with an interior.",
    photo_count: 2,
  },
  v5: {
    display_name: "Three-Photo Grid",
    description:
      "Hero photo plus two stacked thumbnails. Magazine listing-spread composition for showcasing range.",
    photo_count: 3,
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
      for (const variant of Object.keys(PRIMITIVE_RENDERERS) as PostVariant[]) {
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
          render: ({ listing, heroImageDataUri, heroImageDataUris }) =>
            variantRenderer({
              listing: listing as PostBuilderListingWithOH,
              theme: getTheme(post_type),
              heroImageDataUri,
              heroImageDataUris,
            }),
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
    .map((t) => ({
      template_id: t.id,
      variant: t.variant,
      display_name: VARIANT_META[t.variant].display_name,
      description: VARIANT_META[t.variant].description,
      photo_count: VARIANT_META[t.variant].photo_count,
    }));
}
