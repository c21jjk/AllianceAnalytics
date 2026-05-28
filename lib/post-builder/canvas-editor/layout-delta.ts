/**
 * layout-delta — extract / apply LAYOUT-ONLY edits across a multi-OH carousel.
 * ---------------------------------------------------------------------------
 *
 * Why this file exists
 *   The user edits slide 1 in Studio (moves the logo, resizes the date font),
 *   then wants those LAYOUT changes pushed to slides 2..N without re-doing
 *   them manually. The per-slide DATA — listing photo URL, address text,
 *   hosting agent name + phone + photo — must STAY distinct.
 *
 *   This module is the data-shape contract for that propagation:
 *
 *     • `LayoutDelta` — the closed set of properties that propagate. Anything
 *       outside this list (text content, src URLs, boundField metadata,
 *       hideIfEmpty) is per-slide and stays per-slide.
 *
 *     • `extractLayoutDelta(layer)` — read the current values for those
 *       properties off a CanvasLayer.
 *
 *     • `applyLayoutDelta(layer, delta)` — return a NEW layer with the
 *       delta's fields overlaid; everything else is preserved verbatim.
 *
 *     • `applyOverridesToSchema(schema, overrides)` — walk a template schema
 *       and apply per-layer deltas keyed by id. Used at slide-load time so
 *       sibling slides re-derive their canvas with the propagated layout.
 *
 * Why the schema is the propagation target (not Fabric JSON)
 *   The multi-OH slide loader in PostBuilderClient.tsx ALWAYS re-derives
 *   each slide's canvas from the canonical template + that slide's listing
 *   data (see the 2026-05-28 priority-order comment in `handleSlideEditClick`).
 *   Saved Fabric snapshots are intentionally NOT consulted for slide reopen.
 *   So the right propagation channel is a layout overrides bag that gets
 *   merged ONTO the canonical schema BEFORE bound-field hydration runs.
 *
 * Idempotence
 *   Extracting + re-applying a delta should produce the same layer. We
 *   only spread defined keys (`delta[k] !== undefined`) so applying an
 *   empty delta is a no-op.
 */

import type {
  CanvasLayer,
  CanvasTemplateSchema,
  GradientFill,
  ImageLayer,
  ShapeLayer,
  TextLayer,
} from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The closed set of layer properties we consider "layout" for cross-slide
 * propagation. Deliberately excludes anything that would corrupt per-slide
 * data on apply:
 *   • `text` (string content of a TextLayer) — slide-specific (each slide's
 *     address differs).
 *   • `src` (URL on an ImageLayer) — slide-specific (each slide's hero photo).
 *   • `boundField` (TextLayer + ImageLayer) — controls re-hydration, stays
 *     authoritative per-slide.
 *   • `hideIfEmpty` (ImageLayer) — driven by per-slide data availability.
 *   • `text` content for SOLD overlays, etc.
 *
 * Fields below cover position, dimensions, rotation, opacity, typography,
 * fill, stroke, corner radius, etc. — every property a user is likely to
 * tweak in Studio when adjusting brand/layout.
 *
 * Note on `fill`: `ShapeLayer.fill` can be either a hex string OR a
 * `GradientFill` object. We accept both so a propagation of a recolored
 * shape (e.g. a brand-gold gradient) carries through.
 */
export type LayoutDelta = Partial<{
  // CanvasLayerBase positioning + transform
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  // CanvasLayerBase scale (not actually on the schema today — preserved here
  // for forward-compat if we ever expose Fabric scaleX/scaleY directly).
  scaleX: number;
  scaleY: number;

  // TextLayer typography + appearance
  fontFamily: string;
  fontSize: number;
  fontWeight: number | string;
  fontStyle: string;
  fill: string | GradientFill;
  textAlign: string;
  lineHeight: number;
  charSpacing: number;
  underline: boolean;
  linethrough: boolean;

  // ImageLayer appearance
  cornerRadius: number;
  borderColor: string;
  borderWidth: number;
  objectFit: string;

  // ShapeLayer appearance (`fill` already declared above — shared with text)
  stroke: string;
  strokeWidth: number;
  shapeType: string;
  strokeDashArray: number[];
}>;

/** Bag of layer-id → LayoutDelta. Persisted to `generated_posts.carousel_layout_overrides`. */
export type CarouselLayoutOverrides = Record<string, LayoutDelta>;

// ---------------------------------------------------------------------------
// extractLayoutDelta — read layout-only fields off a layer
// ---------------------------------------------------------------------------

/**
 * Extract a layout-only delta from a CanvasLayer for propagation.
 * Excludes text/src CONTENT and bound-field metadata — those stay per-slide.
 *
 * The output is always a NEW object (no aliasing) so callers can safely
 * persist or mutate it independently of the source layer.
 */
export function extractLayoutDelta(layer: CanvasLayer): LayoutDelta {
  // Base fields — present on every layer kind.
  const base: LayoutDelta = {
    left: layer.left,
    top: layer.top,
    width: layer.width,
    height: layer.height,
    angle: layer.angle,
    opacity: layer.opacity,
  };

  switch (layer.kind) {
    case "text": {
      const t = layer;
      return {
        ...base,
        fontFamily: t.fontFamily,
        fontSize: t.fontSize,
        fontWeight: t.fontWeight,
        fontStyle: t.fontStyle,
        fill: t.fill,
        textAlign: t.textAlign,
        lineHeight: t.lineHeight,
        charSpacing: t.charSpacing,
        underline: t.underline,
        linethrough: t.linethrough,
      };
    }
    case "image": {
      const i = layer;
      return {
        ...base,
        cornerRadius: i.cornerRadius,
        borderColor: i.borderColor,
        borderWidth: i.borderWidth,
        objectFit: i.objectFit,
      };
    }
    case "shape": {
      const s = layer;
      return {
        ...base,
        fill: s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        cornerRadius: s.cornerRadius,
        shapeType: s.shapeType,
        // why: clone the array so persisting / diffing a delta can't mutate
        // the source layer's schema-side array.
        strokeDashArray: s.strokeDashArray.slice(),
      };
    }
    case "group":
      // why: groups don't carry leaf-level layout properties; their children
      // do. We propagate position/size for the group container itself, which
      // is what's already in `base`.
      return base;
    default: {
      const _exhaustive: never = layer;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// applyLayoutDelta — overlay a delta onto a layer
// ---------------------------------------------------------------------------

/**
 * Apply a layout delta to a CanvasLayer, returning a new layer object.
 * Existing text/src/boundField/hideIfEmpty are preserved untouched.
 *
 * Only fields PRESENT on the delta (`!== undefined`) are written — that
 * keeps the merge associative and avoids overwriting a layer's
 * (non-overridden) defaults with `undefined`s.
 *
 * Kind-aware: a text-only field on a delta (e.g. `fontSize`) is silently
 * dropped when applied to an image layer. This is defensive — in practice
 * the delta only carries fields the source layer had — but it keeps the
 * function safe to call with any (delta, layer) pair.
 */
export function applyLayoutDelta(
  layer: CanvasLayer,
  delta: LayoutDelta,
): CanvasLayer {
  // Pull out the base-class fields first — present on every kind.
  // why: typed as a plain Record (not Partial<CanvasLayer>) so the spread
  // below into kind-specific layer types doesn't widen the discriminated
  // `kind` field. Every key here matches the CanvasLayerBase contract.
  const basePatch: Record<string, number> = {};
  if (delta.left !== undefined) basePatch.left = delta.left;
  if (delta.top !== undefined) basePatch.top = delta.top;
  if (delta.width !== undefined) basePatch.width = delta.width;
  if (delta.height !== undefined) basePatch.height = delta.height;
  if (delta.angle !== undefined) basePatch.angle = delta.angle;
  if (delta.opacity !== undefined) basePatch.opacity = delta.opacity;

  // why: the switch below merges into each discriminated kind individually.
  // TypeScript's spread over a discriminated union widens the result type
  // unless we narrow the source inside each branch — so we re-declare
  // `layer` typed to the active branch via the case discriminator.
  switch (layer.kind) {
    case "text": {
      const textLayer: TextLayer = layer;
      const patch: Partial<TextLayer> = {};
      if (delta.fontFamily !== undefined) patch.fontFamily = delta.fontFamily;
      if (delta.fontSize !== undefined) patch.fontSize = delta.fontSize;
      if (delta.fontWeight !== undefined) {
        // why: the schema narrows fontWeight to 100..900 multiples of 100,
        // but the LayoutDelta accepts `number | string` for forward-compat
        // with Fabric's full enum. Narrow by casting — in practice the
        // extractor always reads from a schema-typed source so the cast is
        // safe.
        patch.fontWeight = delta.fontWeight as TextLayer["fontWeight"];
      }
      if (delta.fontStyle !== undefined) {
        patch.fontStyle = delta.fontStyle as TextLayer["fontStyle"];
      }
      if (delta.fill !== undefined && typeof delta.fill === "string") {
        patch.fill = delta.fill;
      }
      if (delta.textAlign !== undefined) {
        patch.textAlign = delta.textAlign as TextLayer["textAlign"];
      }
      if (delta.lineHeight !== undefined) patch.lineHeight = delta.lineHeight;
      if (delta.charSpacing !== undefined) patch.charSpacing = delta.charSpacing;
      if (delta.underline !== undefined) patch.underline = delta.underline;
      if (delta.linethrough !== undefined) patch.linethrough = delta.linethrough;
      const next: TextLayer = { ...textLayer, ...basePatch, ...patch };
      return next;
    }
    case "image": {
      const imageLayer: ImageLayer = layer;
      const patch: Partial<ImageLayer> = {};
      if (delta.cornerRadius !== undefined) patch.cornerRadius = delta.cornerRadius;
      if (delta.borderColor !== undefined) patch.borderColor = delta.borderColor;
      if (delta.borderWidth !== undefined) patch.borderWidth = delta.borderWidth;
      if (delta.objectFit !== undefined) {
        patch.objectFit = delta.objectFit as ImageLayer["objectFit"];
      }
      const next: ImageLayer = { ...imageLayer, ...basePatch, ...patch };
      return next;
    }
    case "shape": {
      const shapeLayer: ShapeLayer = layer;
      const patch: Partial<ShapeLayer> = {};
      if (delta.fill !== undefined) patch.fill = delta.fill;
      if (delta.stroke !== undefined) patch.stroke = delta.stroke;
      if (delta.strokeWidth !== undefined) patch.strokeWidth = delta.strokeWidth;
      if (delta.cornerRadius !== undefined) patch.cornerRadius = delta.cornerRadius;
      if (delta.shapeType !== undefined) {
        patch.shapeType = delta.shapeType as ShapeLayer["shapeType"];
      }
      if (delta.strokeDashArray !== undefined) {
        patch.strokeDashArray = delta.strokeDashArray.slice();
      }
      const next: ShapeLayer = { ...shapeLayer, ...basePatch, ...patch };
      return next;
    }
    case "group": {
      // Groups only get the base-class fields. Children are walked by
      // applyOverridesToSchema separately (they have their own ids).
      return { ...layer, ...basePatch };
    }
    default: {
      const _exhaustive: never = layer;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// applyOverridesToSchema — walk a schema and apply per-layer deltas
// ---------------------------------------------------------------------------

/**
 * Walk a CanvasTemplateSchema's layer tree and apply per-layer deltas keyed
 * by layer id. Layers without a matching id are passed through unchanged.
 *
 * Recurses into GroupLayer children — a delta keyed on a child id will
 * still apply.
 *
 * Returns a NEW schema with a NEW layers array (shallow copies for
 * untouched layers, fresh objects for patched ones). The input is not
 * mutated.
 *
 * Empty `overrides` is a no-op (returns the input schema reference
 * unchanged via a structural pass-through, but the array is still copied
 * to keep the caller's downstream code from sharing a reference).
 */
export function applyOverridesToSchema(
  schema: CanvasTemplateSchema,
  overrides: CarouselLayoutOverrides,
): CanvasTemplateSchema {
  if (Object.keys(overrides).length === 0) {
    return schema;
  }
  return {
    ...schema,
    layers: schema.layers.map((layer) => walkLayer(layer, overrides)),
  };
}

function walkLayer(
  layer: CanvasLayer,
  overrides: CarouselLayoutOverrides,
): CanvasLayer {
  const delta = overrides[layer.id];
  let next = layer;
  if (delta) {
    next = applyLayoutDelta(layer, delta);
  }
  if (next.kind === "group") {
    return {
      ...next,
      children: next.children.map((child) => walkLayer(child, overrides)),
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Persistence helpers — round-trip the overrides JSON safely.
// ---------------------------------------------------------------------------

/**
 * Coerce an unknown value (e.g. `generated_posts.carousel_layout_overrides`
 * read from the DB) into a CarouselLayoutOverrides. Returns `{}` for any
 * shape that isn't a plain object of object values, so consumers always
 * have a safe map to iterate.
 *
 * Why not just `as CarouselLayoutOverrides`: the DB column is typed `Json`
 * at the supabase layer, and a corrupted / hand-edited row should fail
 * soft (no overrides) rather than crash slide hydration.
 */
export function parseCarouselLayoutOverrides(
  raw: unknown,
): CarouselLayoutOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CarouselLayoutOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = value as LayoutDelta;
    }
  }
  return out;
}
