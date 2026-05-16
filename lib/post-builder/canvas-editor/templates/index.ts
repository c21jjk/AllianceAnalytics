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
 * Current coverage (2026-05-15):
 *   5 post types × 3 variants × 3 formats = 45 templates, all generated
 *   programmatically by factories:
 *     • v1 Hero Editorial    — buildAllHeroEditorialTemplates  (15)
 *     • v2 Bold Stats        — buildAllBoldStatsTemplates      (15)
 *     • v3 Side-by-Side      — buildAllSideBySideTemplates     (15)
 *
 *   Each factory uses the same shape — POST_TYPE_CONFIGS table + per-format
 *   LAYOUTS table — so adding a new post type is one row in three files.
 *
 * Still to port from the V1 HTML primitives:
 *   • v6 Magazine Cover
 *   • v7 Polaroid
 *   • v8 Minimal Frame
 *
 *   (v4 Diptych + v5 Grid were retired on 2026-05-14 when the in-Studio
 *   Photos panel shipped — Larissa composes multi-photo posts by dragging
 *   additional photos onto the canvas instead of via dedicated variants.)
 */

import type {
  CanvasTemplateSchema,
  PostFormat,
  PostType,
  PostVariant,
} from "../types";
import { buildAllHeroEditorialTemplates } from "./hero-editorial-factory";
import { buildAllBoldStatsTemplates } from "./bold-stats-factory";
import { buildAllSideBySideTemplates } from "./side-by-side-factory";

/**
 * Source-of-truth array. Order doesn't matter for lookup, but the array
 * order DOES drive the default sort in the Templates panel (it groups by
 * category first, then by variant within category) — so we concatenate
 * by variant here so v1 cards come first, then v2, then v3.
 */
export const CANVAS_TEMPLATES: readonly CanvasTemplateSchema[] = [
  ...buildAllHeroEditorialTemplates(),
  ...buildAllBoldStatsTemplates(),
  ...buildAllSideBySideTemplates(),
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
