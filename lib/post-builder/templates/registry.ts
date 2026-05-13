import type {
  PostBuilderListing,
  PostFormat,
  PostType,
  PostVariant,
  TemplateMeta,
} from "../types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "./primitives/_shared";
import { renderV1HeroEditorial } from "./primitives/v1-hero-editorial";
import { renderV2BoldStats } from "./primitives/v2-bold-stats";
import { renderV3SideBySide } from "./primitives/v3-side-by-side";
import { POST_TYPE_THEMES, getTheme } from "./themes";

/**
 * Template registry. The composite template_id ('just_listed_square_v1')
 * persists on generated_posts so we always know exactly what produced an
 * image.
 *
 * Phase 2 architecture: the registry composes three variant primitives
 * (v1 / v2 / v3) with four post-type themes. That gives 12 templates with
 * three actual layout files instead of twelve. Each combination is fully
 * brand-styled because the primitive consumes the theme.
 *
 * Adding a variant = one new primitive file + register here.
 * Adding a post type = one new theme entry in themes.ts.
 */

export type TemplateRenderer = (args: {
  listing: PostBuilderListing;
  heroImageDataUri: string;
}) => string;

interface TemplateEntry {
  meta: TemplateMeta;
  render: TemplateRenderer;
}

// Variant primitive registry.
const VARIANT_RENDERERS: Record<
  PostVariant,
  (args: {
    listing: PostBuilderListingWithOH;
    theme: PostTypeTheme;
    heroImageDataUri: string;
  }) => string
> = {
  v1: renderV1HeroEditorial,
  v2: renderV2BoldStats,
  v3: renderV3SideBySide,
};

const VARIANT_META: Record<
  PostVariant,
  { display_name: string; description: string }
> = {
  v1: {
    display_name: "Hero Editorial",
    description:
      "Hero photo fills the frame. Type stacked over a dark gradient at the bottom. Best when the photo is the story.",
  },
  v2: {
    display_name: "Bold Stats",
    description:
      "Photo top 60%, oversized price + stat row on a dark surface below. Magazine feel.",
  },
  v3: {
    display_name: "Side-by-Side",
    description:
      "55/45 split — photo left, data column right on a light surface with a gold accent rule. Listing-card composition.",
  },
};

const POST_TYPE_META: Record<PostType, { display_name: string }> = {
  just_listed: { display_name: "Just Listed" },
  just_sold: { display_name: "Just Sold" },
  under_contract: { display_name: "Under Contract" },
  open_house: { display_name: "Open House" },
};

// Phase 2 only ships Square 1:1. Adding portrait/story = add to this list.
const SUPPORTED_FORMATS: PostFormat[] = ["square_1x1"];

const FORMAT_DIMENSIONS: Record<PostFormat, { width: number; height: number }> = {
  square_1x1: { width: 1080, height: 1080 },
  portrait_4x5: { width: 1080, height: 1350 },
  story_9x16: { width: 1080, height: 1920 },
};

/**
 * Build the full set of valid template IDs eagerly so listTemplates() is
 * cheap and consistent. Format: "{post_type}_{format_short}_{variant}"
 * e.g. "just_sold_square_v2".
 */
function buildTemplateMap(): Record<string, TemplateEntry> {
  const out: Record<string, TemplateEntry> = {};
  for (const post_type of Object.keys(POST_TYPE_THEMES) as PostType[]) {
    for (const format of SUPPORTED_FORMATS) {
      for (const variant of Object.keys(VARIANT_RENDERERS) as PostVariant[]) {
        const formatShort = formatShortName(format);
        const id = `${post_type}_${formatShort}_${variant}`;
        const variantMeta = VARIANT_META[variant];
        const variantRenderer = VARIANT_RENDERERS[variant];
        const meta: TemplateMeta = {
          id,
          post_type,
          variant,
          format,
          display_name: `${POST_TYPE_META[post_type].display_name} · ${variantMeta.display_name}`,
          description: variantMeta.description,
          dimensions: FORMAT_DIMENSIONS[format],
        };
        out[id] = {
          meta,
          render: ({ listing, heroImageDataUri }) =>
            variantRenderer({
              listing: listing as PostBuilderListingWithOH,
              theme: getTheme(post_type),
              heroImageDataUri,
            }),
        };
      }
    }
  }
  return out;
}

function formatShortName(format: PostFormat): string {
  switch (format) {
    case "square_1x1":
      return "square";
    case "portrait_4x5":
      return "portrait";
    case "story_9x16":
      return "story";
  }
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
    }));
}
