/**
 * Canvas template registry — finder + array exports.
 * ---------------------------------------------------
 *
 * Current coverage (2026-05-24):
 *   5 post types × 1 variant ("v1") × 2 formats (square_1x1, story_9x16) =
 *   10 placeholder templates total.
 *
 * Per the 2026-05-24 template purge:
 *   • The previous 90-template catalog (v2 Bold Stats, v3 Excellence
 *     Collection, v6 Magazine Cover, v8 Standard, v9 Just Sold,
 *     v10 Coming Soon) was deleted entirely. The old factory files are
 *     still on disk as orphans for git history; not imported anywhere.
 *   • Variant axis is soft-deprecated to a single "v1" value. The Post
 *     Builder variant grid is gone — one card per (post_type × format)
 *     tuple.
 *   • Real per-recipe templates are authored ONE AT A TIME as Larissa
 *     ships Canva references. The Phase 2 AI Design pipeline encodes
 *     the recipes in `lib/post-builder/canvas-editor/ai/brand-prompt.ts`
 *     so the AI can produce on-brand output even before the file-based
 *     templates exist.
 *
 * "Edit in Studio" coverage: every (post_type × format) combo resolves
 * to a placeholder template that the user can edit. AI Design returns
 * a Claude-redesigned schema that replaces the placeholder.
 */

import type { CanvasTemplateSchema, PostType, PostVariant } from "../types";
import { PLATFORM_DIMENSIONS } from "../types";
import { isGradientFill } from "../types";
import { buildAllPlaceholderTemplates } from "./placeholder-factory";
import { buildJustListedSquareTemplate } from "./just-listed-square";
import { buildJustSoldSquareTemplate } from "./just-sold-square";
import { buildOpenHouseSquareTemplate } from "./open-house-square";

/**
 * Source-of-truth array.
 *
 * 2026-05-24 Phase C composition:
 *   • 3 REAL Larissa-spec templates for the post types we have
 *     references for (Just Listed × square, Just Sold × square,
 *     Open House × square).
 *   • 7 placeholder templates filling the remaining (post_type ×
 *     format) slots — the placeholder factory's SKIP_TUPLES list
 *     excludes the 3 above.
 *
 * Total: 10 templates, same count as the all-placeholder Phase B
 * state. As Larissa ships story-format references or new post-type
 * designs, replace the corresponding placeholder slot with a real
 * factory (mirror the pattern in just-listed-square.ts etc.).
 */
export const CANVAS_TEMPLATES: readonly CanvasTemplateSchema[] = [
  buildJustListedSquareTemplate(),
  buildJustSoldSquareTemplate(),
  buildOpenHouseSquareTemplate(),
  ...buildAllPlaceholderTemplates(),
];

/**
 * Find the template that matches a (category, variant, format) tuple.
 *
 * 2026-05-24 — variant axis soft-deprecated: every placeholder is "v1".
 * Callers pass any variant value; the lookup ignores it and returns the
 * single template for the (category, format) pair. Kept the param in the
 * signature for back-compat with existing callers across the codebase;
 * remove the param entirely once all callers stop passing it.
 */
export function findCanvasTemplate(
  category: PostType,
  variant: PostVariant,
  format: CanvasTemplateSchema["format"],
): CanvasTemplateSchema | null {
  // why: variant ignored on lookup. See deprecation note above.
  void variant;
  return (
    CANVAS_TEMPLATES.find(
      (t) => t.category === category && t.format === format,
    ) ?? null
  );
}

/**
 * Slim listing of available templates for diagnostic / Templates Panel use.
 * Format: "Just Listed · v1 · Square 1:1".
 */
export function listAvailableTemplateNames(): string[] {
  return CANVAS_TEMPLATES.map((t) => t.name);
}

// ===========================================================================
// validateCanvasTemplates — runtime invariant check
// ===========================================================================

export class CanvasTemplateValidationError extends Error {
  constructor(
    public readonly templateId: string,
    public readonly invariant: string,
    detail: string,
  ) {
    super(
      `Canvas template "${templateId}" failed invariant "${invariant}": ${detail}`,
    );
    this.name = "CanvasTemplateValidationError";
  }
}

/**
 * Pure function that walks the template list and throws on the first
 * invariant violation. Runs at module-load in dev/build only.
 */
export function validateCanvasTemplates(
  templates: readonly CanvasTemplateSchema[],
): void {
  // ---- Invariant 1: no duplicate template ids ----
  const seenTemplateIds = new Set<string>();
  for (const t of templates) {
    if (seenTemplateIds.has(t.id)) {
      throw new CanvasTemplateValidationError(
        t.id,
        "unique_template_id",
        `Duplicate template id appears more than once in CANVAS_TEMPLATES.`,
      );
    }
    seenTemplateIds.add(t.id);
  }

  for (const t of templates) {
    // ---- Invariant 2: dimensions match PLATFORM_DIMENSIONS[format] ----
    const expected = PLATFORM_DIMENSIONS[t.format];
    if (t.width !== expected.width || t.height !== expected.height) {
      throw new CanvasTemplateValidationError(
        t.id,
        "dimensions_match_format",
        `Got ${t.width}×${t.height}, expected ${expected.width}×${expected.height} for format "${t.format}".`,
      );
    }

    // ---- Invariant 3: layers array is non-empty ----
    if (!Array.isArray(t.layers) || t.layers.length === 0) {
      throw new CanvasTemplateValidationError(
        t.id,
        "layers_non_empty",
        `Template has no layers — the canvas would render as a blank colored rectangle.`,
      );
    }

    // ---- Invariant 4: no duplicate layer ids within a template ----
    const seenLayerIds = new Set<string>();
    for (const l of t.layers) {
      if (seenLayerIds.has(l.id)) {
        throw new CanvasTemplateValidationError(
          t.id,
          "unique_layer_id",
          `Layer id "${l.id}" appears more than once.`,
        );
      }
      seenLayerIds.add(l.id);
    }

    // ---- Invariant 5: hero photo is present ----
    const hasHero = t.layers.some(
      (l) => l.kind === "image" && l.boundField === "hero_photo",
    );
    if (!hasHero) {
      throw new CanvasTemplateValidationError(
        t.id,
        "has_hero_photo_layer",
        `No image layer bound to hero_photo.`,
      );
    }

    // ---- Invariant 6: schemaVersion is the current version ----
    if (t.schemaVersion !== 1) {
      throw new CanvasTemplateValidationError(
        t.id,
        "schema_version_current",
        `Got schemaVersion ${t.schemaVersion}, expected 1.`,
      );
    }

    // ---- Invariant 7: gradient ShapeLayer fills are well-formed ----
    for (const layer of t.layers) {
      if (layer.kind !== "shape") continue;
      if (!isGradientFill(layer.fill)) continue;
      const stops = layer.fill.stops;
      if (stops.length < 2) {
        throw new CanvasTemplateValidationError(
          t.id,
          "gradient_fill_valid",
          `Shape layer "${layer.id}" gradient has ${stops.length} stop(s); minimum is 2.`,
        );
      }
      let lastOffset = -Infinity;
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        if (
          typeof s.offset !== "number" ||
          Number.isNaN(s.offset) ||
          s.offset < 0 ||
          s.offset > 1
        ) {
          throw new CanvasTemplateValidationError(
            t.id,
            "gradient_fill_valid",
            `Shape layer "${layer.id}" gradient stop ${i} offset ${String(s.offset)} is out of [0, 1].`,
          );
        }
        if (s.offset < lastOffset) {
          throw new CanvasTemplateValidationError(
            t.id,
            "gradient_fill_valid",
            `Shape layer "${layer.id}" gradient stops not in ascending order.`,
          );
        }
        lastOffset = s.offset;
        if (typeof s.color !== "string" || s.color.length === 0) {
          throw new CanvasTemplateValidationError(
            t.id,
            "gradient_fill_valid",
            `Shape layer "${layer.id}" gradient stop ${i} has empty color.`,
          );
        }
      }
      if (layer.fill.kind === "radial" && layer.fill.spread !== undefined) {
        if (
          typeof layer.fill.spread !== "number" ||
          !(layer.fill.spread > 0)
        ) {
          throw new CanvasTemplateValidationError(
            t.id,
            "gradient_fill_valid",
            `Shape layer "${layer.id}" radial gradient spread ${String(layer.fill.spread)} must be > 0.`,
          );
        }
      }
    }
  }
}

if (process.env.NODE_ENV !== "production") {
  validateCanvasTemplates(CANVAS_TEMPLATES);
}
