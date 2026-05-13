import type { PostBuilderListing, TemplateMeta } from "../types";
import { renderJustListedSquareV1 } from "./just-listed-square-v1";

/**
 * Template registry. The composite template_id ('just_listed_square_v1')
 * persists on generated_posts so we always know exactly what produced an
 * image. Adding a template = drop in a new file + add an entry below; no
 * DB migration needed.
 *
 * Each template renderer returns a complete HTML document (head + body
 * with all CSS inlined). Puppeteer screenshots the body at the template's
 * declared dimensions.
 */
export type TemplateRenderer = (args: {
  listing: PostBuilderListing;
  heroImageDataUri: string;
}) => string;

interface TemplateEntry {
  meta: TemplateMeta;
  render: TemplateRenderer;
}

const TEMPLATES: Record<string, TemplateEntry> = {
  just_listed_square_v1: {
    meta: {
      id: "just_listed_square_v1",
      post_type: "just_listed",
      variant: "v1",
      format: "square_1x1",
      display_name: "Hero Photo · Editorial",
      description:
        "Single hero photo with gradient bottom band. Address, price, and beds/baths chips. Editorial-feel typography, gold accent rule.",
      dimensions: { width: 1080, height: 1080 },
    },
    render: renderJustListedSquareV1,
  },
};

export function getTemplate(template_id: string): TemplateEntry | null {
  return TEMPLATES[template_id] ?? null;
}

export function listTemplates(): TemplateMeta[] {
  return Object.values(TEMPLATES).map((t) => t.meta);
}

export function listTemplatesForPostType(post_type: string): TemplateMeta[] {
  return listTemplates().filter((t) => t.post_type === post_type);
}
