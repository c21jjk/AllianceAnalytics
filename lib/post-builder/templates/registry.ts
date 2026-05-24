/**
 * Legacy V1 template registry — STUB as of 2026-05-24.
 *
 * The V1 HTML primitive system (which generated 90 HTML templates rendered
 * via headless Chromium) was deleted on 2026-05-24 alongside the factory
 * canvas templates. All renders now go through the canvas-editor schema
 * pipeline (see `lib/post-builder/canvas-editor/templates/`).
 *
 * This file is preserved as a SHIM only — every export that downstream
 * code still imports keeps its signature but returns an empty result.
 * Once every call site is migrated to either the canvas-editor lookup
 * (`findCanvasTemplate`) or removed entirely, this file can be deleted.
 *
 * Surviving call sites (2026-05-24 audit):
 *   • `app/(app)/post-builder/page.tsx` — formatDisplayMeta,
 *     listSupportedFormats, listVariantsForPostType
 *   • `app/api/post-builder/multi-oh-generate/route.ts` — formatShortName
 *   • `app/api/post-builder/preview-html/route.ts` — getTemplate
 *   • `app/api/post-builder/render/route.ts` — getTemplate
 *
 * All consumers must tolerate getTemplate() and listVariantsForPostType()
 * returning empty/null. The Generate button's render path is being
 * migrated to the canvas-template route in a follow-up.
 */
import type {
  PostBuilderListing,
  PostCustomizations,
  PostFormat,
  PostType,
  PostVariant,
  TemplateMeta,
} from "../types";

// Keep the renderer type exported so any future caller can satisfy the
// signature, even though no real renderer exists today.
export type TemplateRenderer = (args: {
  listing: PostBuilderListing;
  heroImageDataUri: string;
  heroImageDataUris?: string[];
  customizations?: PostCustomizations;
}) => string;

export interface TemplateEntry {
  meta: TemplateMeta;
  render: TemplateRenderer;
}

const FORMAT_META: Record<
  PostFormat,
  { display_name: string; description: string; aspect: string }
> = {
  square_1x1: {
    display_name: "Square",
    description: "Instagram feed default — equal width and height",
    aspect: "1:1",
  },
  // Retained for legacy `generated_posts.format = 'portrait_4x5'` rows
  // that pre-date the 2026-05-24 pivot to square as the default. New
  // posts always use square_1x1 or story_9x16.
  story_9x16: {
    display_name: "Story",
    description: "IG / FB Story and Reels cover",
    aspect: "9:16",
  },
};

const SUPPORTED_FORMATS: PostFormat[] = ["square_1x1", "story_9x16"];

/** Short slug used in template-id construction. Kept for back-compat. */
export function formatShortName(format: PostFormat): string {
  switch (format) {
    case "square_1x1":
      return "square";
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

/**
 * Legacy V1 template lookup. Always returns null after the 2026-05-24
 * deletion of the HTML primitive renderers. Callers that need a template
 * must use `findCanvasTemplate` from
 * `lib/post-builder/canvas-editor/templates` instead.
 *
 * Param `template_id` kept for back-compat with call sites that pass it.
 */
export function getTemplate(template_id: string): TemplateEntry | null {
  void template_id;
  return null;
}

export function listTemplates(): TemplateMeta[] {
  return [];
}

export function listTemplatesForPostType(post_type: PostType): TemplateMeta[] {
  void post_type;
  return [];
}

export function listVariantsForPostType(
  post_type: PostType,
  format: PostFormat,
): TemplateMeta[] {
  void post_type;
  void format;
  // 2026-05-24 — variant axis soft-deprecated. Returning [] hides the
  // variant grid in PostBuilderClient (the picker only renders cards
  // when this returns a non-empty array).
  return [];
}

// Retained re-exports so consumers that did `import { PostVariant } from
// "...registry"` still typecheck. PostVariant lives in ../types.
export type { PostVariant };
