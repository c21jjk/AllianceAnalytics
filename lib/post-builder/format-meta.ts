/**
 * Post format metadata + slug helpers.
 *
 * Relocated 2026-05-30 out of the deleted legacy V1 `templates/registry.ts`
 * stub. These are generic format helpers (display names, aspect labels, and
 * the short slug used in template-id / filename construction) with no tie to
 * the retired V1 template system. The current canvas-schema pipeline and the
 * Post Builder UI both consume them.
 */
import type { PostFormat } from "./types";

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

/** Short slug used in template-id / filename construction. */
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
