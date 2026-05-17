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
 * Current coverage (2026-05-17):
 *   5 post types × 6 variants × 3 formats = 90 templates, all generated
 *   programmatically by factories:
 *     • v2 Bold Stats             — buildAllBoldStatsTemplates             (15)
 *     • v3 Excellence Collection  — buildAllExcellenceCollectionTemplates  (15)
 *     • v6 Magazine Cover         — buildAllMagazineCoverTemplates         (15)
 *     • v8 Standard NEW LISTING   — buildAllStandardListingTemplates       (15)
 *     • v9 Just Sold Celebration  — buildAllJustSoldCelebrationTemplates   (15)
 *     • v10 Coming Soon Teaser    — buildAllComingSoonTeaserTemplates      (15)
 *
 *   Each factory uses the same shape — POST_TYPE_CONFIGS table + per-format
 *   LAYOUTS table — so adding a new post type is one row in six files.
 *
 *   (Retired: v1 Hero Editorial + v7 Polaroid retired 2026-05-17 alongside
 *   the editorial refresh that shipped v9 + v10. v4 Diptych + v5 Grid were
 *   retired on 2026-05-14 when the in-Studio Photos panel shipped — Larissa
 *   composes multi-photo posts by dragging additional photos onto the canvas
 *   instead of via dedicated variants.)
 *
 * "Edit in Studio" coverage: every variant card in Post Builder now resolves
 * to a canvas template, so the button appears across the entire variant grid.
 */

import type {
  CanvasTemplateSchema,
  PostFormat,
  PostType,
  PostVariant,
} from "../types";
import { isGradientFill, PLATFORM_DIMENSIONS } from "../types";
import { buildAllBoldStatsTemplates } from "./bold-stats-factory";
// why: 2026-05-17 — v1 Hero Editorial + v7 Polaroid retired alongside the
// editorial refresh that introduced v9 Just Sold Celebration + v10 Coming
// Soon Teaser. v3 Side-by-Side was already retired in favor of Excellence
// Collection (premium tier, auto-selected at price >= $949k); v8 Minimal
// Frame retired in favor of Standard NEW LISTING (everyday tier). Old
// factories kept on disk for git history; not imported anymore.
import { buildAllExcellenceCollectionTemplates } from "./excellence-collection-factory";
import { buildAllMagazineCoverTemplates } from "./magazine-cover-factory";
import { buildAllStandardListingTemplates } from "./standard-listing-factory";
import { buildAllJustSoldCelebrationTemplates } from "./just-sold-celebration-factory";
import { buildAllComingSoonTeaserTemplates } from "./coming-soon-teaser-factory";

/**
 * Source-of-truth array. Order doesn't matter for lookup, but the array
 * order DOES drive the default sort in the Templates panel (it groups by
 * category first, then by variant within category) — so we concatenate
 * by variant here in numeric order: v2 → v3 → v6 → v8 → v9 → v10.
 */
export const CANVAS_TEMPLATES: readonly CanvasTemplateSchema[] = [
  ...buildAllBoldStatsTemplates(),
  ...buildAllExcellenceCollectionTemplates(),
  ...buildAllMagazineCoverTemplates(),
  ...buildAllStandardListingTemplates(),
  ...buildAllJustSoldCelebrationTemplates(),
  ...buildAllComingSoonTeaserTemplates(),
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

// ===========================================================================
// validateCanvasTemplates — defensive runtime check on the registry
// ===========================================================================
//
// Why a runtime validator on a fully-typed schema:
//   TypeScript catches the vast majority of authoring mistakes (wrong bound
//   field name, missing layer kind, etc.) at compile time. But two classes
//   of bug slip past the compiler:
//
//     1. **Pixel-precision invariants.** The schema's `width` and `height`
//        fields are `number`, so `width: 1081` compiles cleanly even though
//        it breaks the editor's "must match PLATFORM_DIMENSIONS[format]"
//        invariant. The editor enforces this at canvas-open time, so a
//        broken template only surfaces when someone clicks Edit in Studio —
//        not at build time.
//     2. **Layer-id duplication.** Factories generate layer ids like
//        `layer_badge_text`. A copy-paste typo could produce two layers
//        with the same id inside one template, which Fabric tolerates but
//        the editor's layer panel + selection events get confused by.
//
//   The validator runs at module-load time (dev/build only — see the
//   bottom-of-file guard). If any template is malformed, the dev server
//   fails fast with an actionable error message rather than rendering a
//   broken canvas an hour later when someone happens to pick that template.
//
// What this is NOT:
//   This isn't a substitute for a real test runner (Vitest is queued as a
//   follow-up). It's the smallest viable safety net — same shape Canva uses
//   internally for asset-pipeline gates: cheap, runs every load, fails loud.
//
// To add a new invariant: extend `validateCanvasTemplates` below. If the
// invariant is expensive (>1ms across the registry), move it behind a
// `process.env.VALIDATE_CANVAS_TEMPLATES === "1"` flag so prod builds skip it.

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
 * invariant violation. Callers can wrap in a try/catch to collect issues
 * across the whole registry — but in practice, the first failure points
 * at the bug clearly enough that fixing it iteratively (re-run, fix next)
 * is faster than collecting them all.
 */
export function validateCanvasTemplates(
  templates: readonly CanvasTemplateSchema[],
): void {
  // ---- Invariant 1: no duplicate template ids across the registry ----
  const seenTemplateIds = new Set<string>();
  for (const t of templates) {
    if (seenTemplateIds.has(t.id)) {
      throw new CanvasTemplateValidationError(
        t.id,
        "unique_template_id",
        `Duplicate template id appears more than once in CANVAS_TEMPLATES — this would make findCanvasTemplate non-deterministic.`,
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
        `Got ${t.width}×${t.height}, expected ${expected.width}×${expected.height} for format "${t.format}". The editor refuses to open mismatched templates.`,
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
          `Layer id "${l.id}" appears more than once. Fabric tolerates this but the editor's layer panel + selection events get confused.`,
        );
      }
      seenLayerIds.add(l.id);
    }

    // ---- Invariant 5: hero photo is present ----
    // why: every template designed to date binds the listing's primary
    // photo to a hero_photo image layer. Templates without one are valid
    // schema-wise but produce a "where's the listing?" experience. If a
    // future template intentionally omits the hero (e.g., a text-only
    // testimonial card), revisit this invariant — it's the place we'd
    // relax it with a per-template opt-out flag.
    const hasHero = t.layers.some(
      (l) => l.kind === "image" && l.boundField === "hero_photo",
    );
    if (!hasHero) {
      throw new CanvasTemplateValidationError(
        t.id,
        "has_hero_photo_layer",
        `No image layer bound to hero_photo. Every shipped template needs one — the listing's primary photo is the visual anchor.`,
      );
    }

    // ---- Invariant 6: price slot present unless category is under_contract ----
    // why: under_contract templates use a "Under Contract" literal label
    // in the price slot (no price binding). Every other category MUST bind
    // to either `price` (active/open_house/price_reduction/just_listed) or
    // `close_price` (just_sold). Missing this is the #1 way a refactor
    // accidentally produces a "price-less" Just Listed template.
    if (t.category !== "under_contract") {
      const hasPrice = t.layers.some(
        (l) =>
          l.kind === "text" &&
          (l.boundField === "price" || l.boundField === "close_price"),
      );
      if (!hasPrice) {
        throw new CanvasTemplateValidationError(
          t.id,
          "has_price_layer",
          `Category "${t.category}" requires a text layer bound to "price" or "close_price". Found none.`,
        );
      }
    }

    // ---- Invariant 7: schemaVersion is the current version ----
    // why: the schemaVersion field exists specifically so we can introduce
    // breaking changes someday and migrate old templates on load. Right now
    // it must be 1 — anything else is a stale template that the editor
    // would try to hydrate against a future schema shape and fail oddly.
    if (t.schemaVersion !== 1) {
      throw new CanvasTemplateValidationError(
        t.id,
        "schema_version_current",
        `Got schemaVersion ${t.schemaVersion}, expected 1.`,
      );
    }

    // ---- Invariant 8: gradient ShapeLayer fills are well-formed ----
    // why: TS narrows `ShapeLayer.fill` to `string | GradientFill` but the
    // stop-array invariants (>=2 stops, ascending offsets in [0, 1], every
    // stop has a non-empty color) cannot be expressed at the type level.
    // Fabric tolerates a malformed gradient by rendering nothing — a silent
    // visual failure. Reject loudly here so a template author sees the
    // mistake at build time instead of opening Studio to a blank rect.
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
            `Shape layer "${layer.id}" gradient stops are not in ascending offset order (stop ${i} offset ${s.offset} < previous ${lastOffset}).`,
          );
        }
        lastOffset = s.offset;
        if (typeof s.color !== "string" || s.color.length === 0) {
          throw new CanvasTemplateValidationError(
            t.id,
            "gradient_fill_valid",
            `Shape layer "${layer.id}" gradient stop ${i} has empty/non-string color.`,
          );
        }
      }
      // why: spread is OPTIONAL on radial gradients (defaults to 1). When
      // explicitly set, it must be > 0 — a zero or negative spread paints
      // nothing at all. Linear has no spread field; this branch only fires
      // for radial.
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

// why: run the validator at module-load time in dev + build, but skip it in
// production runtime so we don't pay the validation cost on every cold start.
// The validator is fast (~1ms across 45 templates today) but as the registry
// grows + invariants accrete, we don't want this to creep into TTFB.
//
// `NODE_ENV` is set by Next.js to "production" in `next build` and the
// resulting prod server; "development" in `next dev`. Both run this module
// at startup, so the build-time check is enough to keep prod safe — any
// template change that survives the build also survived the validator.
if (process.env.NODE_ENV !== "production") {
  validateCanvasTemplates(CANVAS_TEMPLATES);
}
