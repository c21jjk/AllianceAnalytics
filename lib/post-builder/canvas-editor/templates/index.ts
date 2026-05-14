/**
 * Canvas template registry — finder + array exports.
 * ---------------------------------------------------
 *
 * The registry exposes:
 *
 *   • CANVAS_TEMPLATES: readonly array of all known templates
 *   • findCanvasTemplate(postType, variant, format): the lookup the Post
 *     Builder uses to decide whether the "Edit in Studio" button is
 *     available for a given (category, variant, format) combination.
 *
 * Current coverage (2026-05-14):
 *   5 post types × v1 (Hero Editorial) × 3 formats = 15 templates, all
 *   generated programmatically by `createHeroEditorialTemplate`. The factory
 *   bakes in post-type-specific theming (eyebrow text, price mode, optional
 *   badge stamp, optional open-house date/time line) so adding a 6th post
 *   type is a config edit in `hero-editorial-factory.ts` — no new files.
 *
 * Future variants (v2 Bold Stats, v3 Side-by-Side, v4 Diptych, v5 Grid)
 * will get their own factory files following the same pattern, then this
 * registry will concatenate the per-variant arrays.
 */

import type {
  CanvasTemplateSchema,
  PostFormat,
  PostType,
  PostVariant,
} from "../types";
import { buildAllHeroEditorialTemplates } from "./hero-editorial-factory";

/**
 * Source-of-truth array. Order doesn't matter for lookup but reading order
 * tracks how we'd present them in a future Templates panel: by category, then
 * variant, then format (square → portrait → story).
 */
export const CANVAS_TEMPLATES: readonly CanvasTemplateSchema[] = [
  ...buildAllHeroEditorialTemplates(),
] as const;

/**
 * Find the template that matches a (category, variant, format) tuple.
 * Returns null if no template exists yet for that combination — caller is
 * responsible for hiding the "Edit in Studio" affordance when null.
 */
export function findCanvasTemplate(
  category: PostType,
  variant: PostVariant,
  format: PostFormat,
): CanvasTemplateSchema | null {
  return (
    CANVAS_TEMPLATES.find(
      (t) =>
        t.category === category &&
        t.variant === variant &&
        t.format === format,
    ) ?? null
  );
}

/**
 * Slim listing of available templates for diagnostic / future templates-panel
 * use. Format: "Just Listed · Hero Editorial · Square 1:1".
 */
export function listAvailableTemplateNames(): string[] {
  return CANVAS_TEMPLATES.map((t) => t.name);
}
