/**
 * Canvas template registry — finder + array exports.
 * ---------------------------------------------------
 *
 * Step 2 of Phase 1 ships 3 hand-authored templates (Just Listed Hero
 * Editorial across square / portrait / story). The registry exposes:
 *
 *   • CANVAS_TEMPLATES: readonly array of all known templates
 *   • findCanvasTemplate(postType, variant, format): the lookup the Post
 *     Builder uses to decide whether the "Edit in Studio" button is
 *     available for a given (category, variant, format) combination.
 *
 * Future phases will either:
 *   (a) Hand-author the remaining categories × variants × formats here.
 *   (b) Move templates to a Supabase `canvas_templates` table and load
 *       them server-side. The findCanvasTemplate function becomes async.
 * For now (a) keeps things fast — templates are just imports.
 */

import type {
  CanvasTemplateSchema,
  PostFormat,
  PostType,
  PostVariant,
} from "../types";
import { justListedHeroPortrait } from "./just-listed-hero-portrait";
import { justListedHeroSquare } from "./just-listed-hero-square";
import { justListedHeroStory } from "./just-listed-hero-story";

/**
 * Source-of-truth array. Order doesn't matter for lookup but reading order
 * tracks how we'd present them in a future Templates panel: by category, then
 * variant, then format (square → portrait → story).
 */
export const CANVAS_TEMPLATES: readonly CanvasTemplateSchema[] = [
  justListedHeroSquare,
  justListedHeroPortrait,
  justListedHeroStory,
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
 * use. Format: "Just Listed · Hero Editorial · Square".
 */
export function listAvailableTemplateNames(): string[] {
  return CANVAS_TEMPLATES.map((t) => t.name);
}
