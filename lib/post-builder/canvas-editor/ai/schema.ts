/**
 * Strict validators that narrow raw Claude output into typed pipeline
 * results. Manual validation (not Zod) to stay consistent with the rest
 * of this codebase — see lib/post-builder/magic-design.ts validateRecommendation
 * and lib/post-builder/captions.ts validateCaptions for the same pattern.
 *
 * Every validator follows the same contract:
 *   • Accept `unknown` (raw parsed JSON)
 *   • Return the typed shape on success, or `null` on any malformed field
 *   • Never throw — invalid input becomes `null` so the pipeline can
 *     surface a clean error message rather than a 500
 *
 * Why so many small validators (vs. one big one): each pass's output has
 * a different shape, and per-pass validation lets the pipeline report
 * exactly which pass failed instead of a generic "validation error".
 */
import type {
  CompositionBrief,
  CritiqueResult,
  DesignMood,
  ImageLayerMutationPatch,
  LayerMutation,
  LayoutPlan,
  ShapeLayerMutationPatch,
  StrategyBrief,
  TextLayerMutationPatch,
} from "./types";
import type {
  CanvasTemplateSchema,
  ImageLayer,
  ShapeLayer,
  TextLayer,
} from "../types";

// ===========================================================================
// Tiny shape predicates
// ===========================================================================

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isHex(v: unknown): v is string {
  return (
    typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)
  );
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

// ===========================================================================
// JSON extraction helper — shared across pipeline passes
// ===========================================================================

/**
 * Pull JSON out of Claude's output even when it's wrapped in ```json fences
 * or has a leading sentence. Mirrors lib/post-builder/magic-design.ts so
 * pipeline behavior matches the rest of the AI features in the codebase.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ===========================================================================
// CompositionBrief (Pass 1)
// ===========================================================================

const SUBJECT_POSITIONS = ["left", "center", "right", "balanced"] as const;
const LIGHTING_OPTIONS = [
  "bright_daylight",
  "overcast",
  "golden_hour",
  "blue_hour",
  "twilight",
  "interior_lit",
  "mixed",
] as const;
const TEXT_COLOR_OPTIONS = ["light", "dark"] as const;

export function validateCompositionBrief(raw: unknown): CompositionBrief | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  if (
    !isString(obj.subject_position) ||
    !(SUBJECT_POSITIONS as readonly string[]).includes(obj.subject_position)
  ) {
    return null;
  }
  if (
    !isString(obj.lighting) ||
    !(LIGHTING_OPTIONS as readonly string[]).includes(obj.lighting)
  ) {
    return null;
  }
  if (!isNonEmptyString(obj.architectural_style)) return null;

  // Palette — at least one valid hex, accept 1-8 entries.
  const paletteRaw = asArray(obj.dominant_palette);
  if (!paletteRaw) return null;
  const palette = paletteRaw.filter((c): c is string => isHex(c));
  if (palette.length === 0) return null;

  // Safe zones — each entry validated independently. Empty is allowed
  // (some photos have no clean zone for text); the layout pass will fall
  // back to the strategy's photo_treatment choice.
  const zonesRaw = asArray(obj.safe_text_zones) ?? [];
  const zones: CompositionBrief["safe_text_zones"] = zonesRaw
    .map((z): CompositionBrief["safe_text_zones"][number] | null => {
      const zr = asRecord(z);
      if (!zr) return null;
      if (!isNonEmptyString(zr.label)) return null;
      if (!isFiniteNum(zr.x) || zr.x < 0 || zr.x > 1) return null;
      if (!isFiniteNum(zr.y) || zr.y < 0 || zr.y > 1) return null;
      if (!isFiniteNum(zr.width) || zr.width <= 0 || zr.width > 1) return null;
      if (!isFiniteNum(zr.height) || zr.height <= 0 || zr.height > 1) {
        return null;
      }
      if (
        !isString(zr.recommended_text_color) ||
        !(TEXT_COLOR_OPTIONS as readonly string[]).includes(
          zr.recommended_text_color,
        )
      ) {
        return null;
      }
      return {
        label: zr.label,
        x: zr.x,
        y: zr.y,
        width: zr.width,
        height: zr.height,
        recommended_text_color: zr.recommended_text_color as "light" | "dark",
      };
    })
    .filter((z): z is CompositionBrief["safe_text_zones"][number] => z !== null);

  const notes = isString(obj.notes) ? obj.notes.slice(0, 600) : "";

  return {
    subject_position: obj.subject_position as CompositionBrief["subject_position"],
    lighting: obj.lighting as CompositionBrief["lighting"],
    architectural_style: obj.architectural_style.trim(),
    dominant_palette: palette,
    safe_text_zones: zones,
    notes,
  };
}

// ===========================================================================
// StrategyBrief (Pass 2)
// ===========================================================================

const DESIGN_MOODS = [
  "luxury_editorial",
  "punchy_modern",
  "warm_local",
  "minimal_classic",
  "magazine_cover",
  "bold_celebration",
] as const;

const HIERARCHY_ELEMENTS = [
  "hero_photo",
  "price",
  "address",
  "eyebrow",
  "stats",
  "brand_mark",
] as const;

const COLOR_KEYS = [
  "gold500",
  "gold600",
  "gold100",
  "ink900",
  "ink800",
  "ink700",
  "white",
  "whiteWarm",
] as const;

const PHOTO_TREATMENTS = [
  "full_bleed",
  "scrim_overlay_bottom",
  "scrim_overlay_top",
  "framed_with_margin",
  "polaroid_offset",
  "duotone_gold_ink",
] as const;

export function validateStrategyBrief(raw: unknown): StrategyBrief | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  if (
    !isString(obj.mood) ||
    !(DESIGN_MOODS as readonly string[]).includes(obj.mood)
  ) {
    return null;
  }
  if (!isNonEmptyString(obj.rationale)) return null;
  if (!isNonEmptyString(obj.type_treatment)) return null;
  if (
    !isString(obj.photo_treatment) ||
    !(PHOTO_TREATMENTS as readonly string[]).includes(obj.photo_treatment)
  ) {
    return null;
  }

  const hierarchyRaw = asArray(obj.hierarchy);
  if (!hierarchyRaw || hierarchyRaw.length === 0) return null;
  const hierarchy = hierarchyRaw.filter(
    (h): h is StrategyBrief["hierarchy"][number] =>
      isString(h) && (HIERARCHY_ELEMENTS as readonly string[]).includes(h),
  );
  if (hierarchy.length === 0) return null;

  const colorsRaw = asArray(obj.color_emphasis);
  if (!colorsRaw) return null;
  const colors = colorsRaw.filter(
    (c): c is StrategyBrief["color_emphasis"][number] =>
      isString(c) && (COLOR_KEYS as readonly string[]).includes(c),
  );
  if (colors.length === 0) return null;

  return {
    mood: obj.mood as DesignMood,
    rationale: obj.rationale.trim(),
    hierarchy,
    color_emphasis: colors,
    type_treatment: obj.type_treatment.trim(),
    photo_treatment: obj.photo_treatment as StrategyBrief["photo_treatment"],
  };
}

// ===========================================================================
// LayoutPlan (Pass 3)
// ===========================================================================

/**
 * Tight allowed-fields validator for a text mutation patch. Rejects any
 * field NOT in TextLayerMutationPatch — Claude sometimes invents fields
 * (e.g. "color" instead of "fill"), and silently dropping them is worse
 * than refusing the patch so we can iterate on the prompt.
 */
const TEXT_PATCH_KEYS = new Set<keyof TextLayerMutationPatch>([
  "text",
  "left",
  "top",
  "width",
  "height",
  "angle",
  "opacity",
  "visible",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fill",
  "textAlign",
  "lineHeight",
  "charSpacing",
  "underline",
  "linethrough",
  "maxWidth",
]);

const IMAGE_PATCH_KEYS = new Set<keyof ImageLayerMutationPatch>([
  "left",
  "top",
  "width",
  "height",
  "angle",
  "opacity",
  "visible",
  "objectFit",
  "cornerRadius",
  "borderColor",
  "borderWidth",
]);

const SHAPE_PATCH_KEYS = new Set<keyof ShapeLayerMutationPatch>([
  "left",
  "top",
  "width",
  "height",
  "angle",
  "opacity",
  "visible",
  "fill",
  "stroke",
  "strokeWidth",
  "cornerRadius",
  "strokeDashArray",
]);

function validateTextPatch(raw: unknown): TextLayerMutationPatch | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const patch: TextLayerMutationPatch = {};

  for (const key of Object.keys(obj)) {
    if (!TEXT_PATCH_KEYS.has(key as keyof TextLayerMutationPatch)) {
      // Unknown field — reject so we can fix the prompt.
      return null;
    }
  }

  if (obj.text !== undefined) {
    if (!isString(obj.text)) return null;
    patch.text = obj.text;
  }
  if (obj.left !== undefined) {
    if (!isFiniteNum(obj.left)) return null;
    patch.left = obj.left;
  }
  if (obj.top !== undefined) {
    if (!isFiniteNum(obj.top)) return null;
    patch.top = obj.top;
  }
  if (obj.width !== undefined) {
    if (!isFiniteNum(obj.width) || obj.width <= 0) return null;
    patch.width = obj.width;
  }
  if (obj.height !== undefined) {
    if (!isFiniteNum(obj.height) || obj.height <= 0) return null;
    patch.height = obj.height;
  }
  if (obj.angle !== undefined) {
    if (!isFiniteNum(obj.angle)) return null;
    patch.angle = obj.angle;
  }
  if (obj.opacity !== undefined) {
    if (!isFiniteNum(obj.opacity) || obj.opacity < 0 || obj.opacity > 1) {
      return null;
    }
    patch.opacity = obj.opacity;
  }
  if (obj.visible !== undefined) {
    if (typeof obj.visible !== "boolean") return null;
    patch.visible = obj.visible;
  }
  if (obj.fontFamily !== undefined) {
    if (!isNonEmptyString(obj.fontFamily)) return null;
    patch.fontFamily = obj.fontFamily;
  }
  if (obj.fontSize !== undefined) {
    if (!isFiniteNum(obj.fontSize) || obj.fontSize < 4 || obj.fontSize > 400) {
      return null;
    }
    patch.fontSize = obj.fontSize;
  }
  if (obj.fontWeight !== undefined) {
    if (
      !isFiniteNum(obj.fontWeight) ||
      obj.fontWeight < 100 ||
      obj.fontWeight > 900
    ) {
      return null;
    }
    patch.fontWeight = obj.fontWeight;
  }
  if (obj.fontStyle !== undefined) {
    if (obj.fontStyle !== "normal" && obj.fontStyle !== "italic") return null;
    patch.fontStyle = obj.fontStyle;
  }
  if (obj.fill !== undefined) {
    if (!isHex(obj.fill)) return null;
    patch.fill = obj.fill;
  }
  if (obj.textAlign !== undefined) {
    if (
      obj.textAlign !== "left" &&
      obj.textAlign !== "center" &&
      obj.textAlign !== "right" &&
      obj.textAlign !== "justify"
    ) {
      return null;
    }
    patch.textAlign = obj.textAlign;
  }
  if (obj.lineHeight !== undefined) {
    if (!isFiniteNum(obj.lineHeight) || obj.lineHeight < 0.5 || obj.lineHeight > 3) {
      return null;
    }
    patch.lineHeight = obj.lineHeight;
  }
  if (obj.charSpacing !== undefined) {
    if (
      !isFiniteNum(obj.charSpacing) ||
      obj.charSpacing < -200 ||
      obj.charSpacing > 1000
    ) {
      return null;
    }
    patch.charSpacing = obj.charSpacing;
  }
  if (obj.underline !== undefined) {
    if (typeof obj.underline !== "boolean") return null;
    patch.underline = obj.underline;
  }
  if (obj.linethrough !== undefined) {
    if (typeof obj.linethrough !== "boolean") return null;
    patch.linethrough = obj.linethrough;
  }
  if (obj.maxWidth !== undefined) {
    if (obj.maxWidth !== null && !isFiniteNum(obj.maxWidth)) return null;
    patch.maxWidth = obj.maxWidth as number | null;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function validateImagePatch(raw: unknown): ImageLayerMutationPatch | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const patch: ImageLayerMutationPatch = {};

  for (const key of Object.keys(obj)) {
    if (!IMAGE_PATCH_KEYS.has(key as keyof ImageLayerMutationPatch)) {
      return null;
    }
  }

  if (obj.left !== undefined && !isFiniteNum(obj.left)) return null;
  if (obj.left !== undefined) patch.left = obj.left;
  if (obj.top !== undefined && !isFiniteNum(obj.top)) return null;
  if (obj.top !== undefined) patch.top = obj.top;
  if (obj.width !== undefined && (!isFiniteNum(obj.width) || obj.width <= 0)) {
    return null;
  }
  if (obj.width !== undefined) patch.width = obj.width;
  if (obj.height !== undefined && (!isFiniteNum(obj.height) || obj.height <= 0)) {
    return null;
  }
  if (obj.height !== undefined) patch.height = obj.height;
  if (obj.angle !== undefined && !isFiniteNum(obj.angle)) return null;
  if (obj.angle !== undefined) patch.angle = obj.angle;
  if (
    obj.opacity !== undefined &&
    (!isFiniteNum(obj.opacity) || obj.opacity < 0 || obj.opacity > 1)
  ) {
    return null;
  }
  if (obj.opacity !== undefined) patch.opacity = obj.opacity;
  if (obj.visible !== undefined && typeof obj.visible !== "boolean") return null;
  if (obj.visible !== undefined) patch.visible = obj.visible;
  if (obj.objectFit !== undefined) {
    if (
      obj.objectFit !== "cover" &&
      obj.objectFit !== "contain" &&
      obj.objectFit !== "stretch"
    ) {
      return null;
    }
    patch.objectFit = obj.objectFit;
  }
  if (
    obj.cornerRadius !== undefined &&
    (!isFiniteNum(obj.cornerRadius) || obj.cornerRadius < 0)
  ) {
    return null;
  }
  if (obj.cornerRadius !== undefined) patch.cornerRadius = obj.cornerRadius;
  if (obj.borderColor !== undefined && !isHex(obj.borderColor)) return null;
  if (obj.borderColor !== undefined) patch.borderColor = obj.borderColor;
  if (
    obj.borderWidth !== undefined &&
    (!isFiniteNum(obj.borderWidth) || obj.borderWidth < 0)
  ) {
    return null;
  }
  if (obj.borderWidth !== undefined) patch.borderWidth = obj.borderWidth;

  return Object.keys(patch).length > 0 ? patch : null;
}

function validateShapePatch(raw: unknown): ShapeLayerMutationPatch | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const patch: ShapeLayerMutationPatch = {};

  for (const key of Object.keys(obj)) {
    if (!SHAPE_PATCH_KEYS.has(key as keyof ShapeLayerMutationPatch)) {
      return null;
    }
  }

  if (obj.left !== undefined && !isFiniteNum(obj.left)) return null;
  if (obj.left !== undefined) patch.left = obj.left;
  if (obj.top !== undefined && !isFiniteNum(obj.top)) return null;
  if (obj.top !== undefined) patch.top = obj.top;
  if (obj.width !== undefined && (!isFiniteNum(obj.width) || obj.width <= 0)) {
    return null;
  }
  if (obj.width !== undefined) patch.width = obj.width;
  if (obj.height !== undefined && (!isFiniteNum(obj.height) || obj.height <= 0)) {
    return null;
  }
  if (obj.height !== undefined) patch.height = obj.height;
  if (obj.angle !== undefined && !isFiniteNum(obj.angle)) return null;
  if (obj.angle !== undefined) patch.angle = obj.angle;
  if (
    obj.opacity !== undefined &&
    (!isFiniteNum(obj.opacity) || obj.opacity < 0 || obj.opacity > 1)
  ) {
    return null;
  }
  if (obj.opacity !== undefined) patch.opacity = obj.opacity;
  if (obj.visible !== undefined && typeof obj.visible !== "boolean") return null;
  if (obj.visible !== undefined) patch.visible = obj.visible;
  // Fill accepts hex OR "transparent" (empty fill) — Claude may use either.
  if (obj.fill !== undefined) {
    if (!isString(obj.fill) || (obj.fill !== "" && obj.fill !== "transparent" && !isHex(obj.fill))) {
      return null;
    }
    patch.fill = obj.fill;
  }
  if (obj.stroke !== undefined) {
    if (
      !isString(obj.stroke) ||
      (obj.stroke !== "" && obj.stroke !== "transparent" && !isHex(obj.stroke))
    ) {
      return null;
    }
    patch.stroke = obj.stroke;
  }
  if (
    obj.strokeWidth !== undefined &&
    (!isFiniteNum(obj.strokeWidth) || obj.strokeWidth < 0)
  ) {
    return null;
  }
  if (obj.strokeWidth !== undefined) patch.strokeWidth = obj.strokeWidth;
  if (
    obj.cornerRadius !== undefined &&
    (!isFiniteNum(obj.cornerRadius) || obj.cornerRadius < 0)
  ) {
    return null;
  }
  if (obj.cornerRadius !== undefined) patch.cornerRadius = obj.cornerRadius;
  if (obj.strokeDashArray !== undefined) {
    const arr = asArray(obj.strokeDashArray);
    if (!arr || !arr.every((n): n is number => isFiniteNum(n) && n >= 0)) {
      return null;
    }
    patch.strokeDashArray = arr as number[];
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function validateMutation(raw: unknown): LayerMutation | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  if (!isNonEmptyString(obj.layerId)) return null;

  if (obj.kind === "text") {
    const patch = validateTextPatch(obj.patch);
    if (!patch) return null;
    return { kind: "text", layerId: obj.layerId, patch };
  }
  if (obj.kind === "image") {
    const patch = validateImagePatch(obj.patch);
    if (!patch) return null;
    return { kind: "image", layerId: obj.layerId, patch };
  }
  if (obj.kind === "shape") {
    const patch = validateShapePatch(obj.patch);
    if (!patch) return null;
    return { kind: "shape", layerId: obj.layerId, patch };
  }
  return null;
}

/**
 * Layout-pass validator. Accepts either kind of LayoutPlan.
 *
 * For `full_replacement`, we do a LIGHT validation of the schema — we
 * trust Claude's structured output here because re-validating a 50+ layer
 * tree against the full CanvasTemplateSchema validator (which lives in
 * a separate file we'd have to import) is a lot of code for marginal
 * safety. The applier (Phase 1 file 5) does its own per-layer validation
 * when actually applying mutations, so a malformed layer surfaces at
 * apply-time with a clear error.
 *
 * For `mutations`, we validate each entry strictly.
 */
export function validateLayoutPlan(raw: unknown): LayoutPlan | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  if (obj.kind === "full_replacement") {
    const schema = asRecord(obj.schema);
    if (!schema) return null;
    // Required top-level fields on a CanvasTemplateSchema.
    if (!isNonEmptyString(schema.id)) return null;
    if (!isNonEmptyString(schema.name)) return null;
    if (!isFiniteNum(schema.width) || schema.width <= 0) return null;
    if (!isFiniteNum(schema.height) || schema.height <= 0) return null;
    if (!asArray(schema.layers)) return null;
    return {
      kind: "full_replacement",
      schema: schema as unknown as CanvasTemplateSchema,
    };
  }

  if (obj.kind === "mutations") {
    const arr = asArray(obj.changes);
    if (!arr) return null;
    const changes: LayerMutation[] = [];
    for (const entry of arr) {
      const m = validateMutation(entry);
      if (!m) return null;
      changes.push(m);
    }
    return { kind: "mutations", changes };
  }

  return null;
}

// ===========================================================================
// CritiqueResult (Pass 4)
// ===========================================================================

// NOTE (Task #67, 2026-05-25): this validator enforces JSON SHAPE only. Brand
// hard-rule content (logo size, eyebrow size, agent-field bans, etc.) is
// enforced deterministically by `./hard-rule-checker.ts` — see that module.
export function validateCritiqueResult(raw: unknown): CritiqueResult | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  if (typeof obj.passed !== "boolean") return null;

  const issuesRaw = asArray(obj.issues) ?? [];
  const issues = issuesRaw.filter((i): i is string => isString(i));

  const notes = isString(obj.notes) ? obj.notes : "";

  let revised: LayoutPlan | undefined;
  if (obj.revised !== undefined && obj.revised !== null) {
    const r = validateLayoutPlan(obj.revised);
    if (!r) return null;
    revised = r;
  }

  // Invariant: if passed=false, revised must be present. Claude is told
  // this explicitly in the system prompt but we still defend.
  if (obj.passed === false && !revised) return null;

  return {
    passed: obj.passed,
    issues,
    revised,
    notes,
  };
}

// ===========================================================================
// Light helpers used by the pipeline to type-narrow layer kinds
// ===========================================================================

export function isTextLayer(l: unknown): l is TextLayer {
  const obj = asRecord(l);
  return obj !== null && obj.kind === "text";
}

export function isImageLayer(l: unknown): l is ImageLayer {
  const obj = asRecord(l);
  return obj !== null && obj.kind === "image";
}

export function isShapeLayer(l: unknown): l is ShapeLayer {
  const obj = asRecord(l);
  return obj !== null && obj.kind === "shape";
}
