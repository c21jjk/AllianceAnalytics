/**
 * 2026-05-24 placeholder factory — the ONLY templates currently in the
 * factory canvas registry.
 *
 * Background: between Phase 2 (AI Design pipeline) and the 2026-05-24
 * refactor, we maintained 90 hand-coded factory templates (v2 Bold Stats,
 * v3 Excellence Collection, v6 Magazine Cover, v8 Standard, v9 Just Sold,
 * v10 Coming Soon — each across 5 post types × 3 formats). They were
 * built before we had visual references from Larissa and never matched
 * her actual brand voice. Per her request, the full catalog was deleted
 * and replaced with this minimal placeholder set.
 *
 * Purpose of these placeholders:
 *   1. Keep `findCanvasTemplate(post_type, variant, format)` returning
 *      something so AI Design and Studio don't crash on empty lookup.
 *   2. Serve as a visible "Coming Soon — template under construction"
 *      surface so Larissa knows the new system is intentionally minimal.
 *   3. Give the AI Design pipeline clean, low-noise starting schemas to
 *      rewrite (the old factories had so much decorative bloat that AI
 *      output partially inherited their busyness).
 *
 * Replacement strategy: as Larissa ships new design samples from Canva,
 * we author a real template per (post_type × format) tuple that matches
 * the sample's visual recipe. Replace the placeholder one-by-one. No
 * variant axis — single template per (post_type × format), no "v2/v3/v6"
 * choices in the picker.
 *
 * Brand rules enforced in every placeholder:
 *   • Street + city address only (no state, no zip)
 *   • No agent fields (per post-type policy: never on JL/SOLD/OH)
 *   • C21 ALLIANCE brokerage logo prominent (>= 200px wide)
 *   • Status eyebrow ("JUST LISTED" / "SOLD" / etc.) clearly visible
 *   • All dimensions match PLATFORM_DIMENSIONS — 1080×1080 for square,
 *     1080×1920 for story
 */
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
import { C21_ALLIANCE_WHITE_LOGO } from "./brand-logos";
import type {
  CanvasLayer,
  CanvasTemplateSchema,
  ImageLayer,
  PostFormat,
  ShapeLayer,
  TextLayer,
} from "../types";
import { PLATFORM_DIMENSIONS } from "../types";
import type { PostType, PostVariant } from "@/lib/post-builder/types";

// =============================================================================
// Per-post-type status labels for the eyebrow
// =============================================================================

const STATUS_LABELS: Record<PostType, string> = {
  just_listed: "JUST LISTED",
  just_sold: "SOLD",
  under_contract: "UNDER CONTRACT",
  open_house: "OPEN HOUSE",
  price_reduction: "PRICE REDUCED",
};

// =============================================================================
// Per-post-type background tint (subtle gold for celebration, ink for default)
// =============================================================================

const BAND_FILL: Record<PostType, string> = {
  just_listed: ALLIANCE_COLORS.ink900, // Obsessed Grey
  just_sold: ALLIANCE_COLORS.ink900,
  under_contract: ALLIANCE_COLORS.ink900,
  open_house: ALLIANCE_COLORS.ink900,
  price_reduction: ALLIANCE_COLORS.ink900,
};

// =============================================================================
// Layer ID helpers — stable IDs so the editor's undo behaves predictably
// =============================================================================

function layerId(post_type: PostType, format: PostFormat, name: string): string {
  return `placeholder_${post_type}_${format}_${name}`;
}

// =============================================================================
// Build a single placeholder template
// =============================================================================
//
// Layout (square 1080×1080):
//   • Hero photo, full bleed (entire canvas)
//   • Dark info band at bottom 25% (270px tall)
//   • Status eyebrow ("JUST LISTED", etc.) in gold at the top of the band
//   • Street address on its own line
//   • City on its own line
//   • Price on its own line (right-aligned in the band)
//   • C21 ALLIANCE logo at the bottom-right of the band (200px wide)
//   • Subtle "Template under construction" stamp at top-right corner
//
// Layout (story 1080×1920):
//   Same structural elements but stretched to portrait dimensions —
//   hero photo fills the safe middle band (top 250 to bottom 200
//   reserved for IG/TT UI), info band slides up to start at y=1450.
//
// why: minimal layer count (8 layers per template) so the AI Design
// pipeline has clean, low-noise starting ground. Old factories had
// 15-30 layers of decorative bloat.

function buildPlaceholderTemplate(
  post_type: PostType,
  format: PostFormat,
): CanvasTemplateSchema {
  const dims = PLATFORM_DIMENSIONS[format];
  const isSquare = format === "square_1x1";
  // Info band geometry — bottom 25% of the canvas
  const bandHeight = Math.round(dims.height * 0.25);
  const bandTop = dims.height - bandHeight;

  const layers: CanvasLayer[] = [];

  // ---- Layer 1: hero photo (full bleed) ----
  const photoLayer: ImageLayer = {
    id: layerId(post_type, format, "hero_photo"),
    name: "Hero photo",
    kind: "image",
    locked: false,
    visible: true,
    left: 0,
    top: 0,
    width: dims.width,
    height: dims.height,
    angle: 0,
    opacity: 1,
    z: 10,
    src: "",
    boundField: "hero_photo",
    objectFit: "cover",
    crossOrigin: "anonymous",
    cornerRadius: 0,
    borderColor: "",
    borderWidth: 0,
  };
  layers.push(photoLayer);

  // ---- Layer 2: dark info band at bottom ----
  const bandLayer: ShapeLayer = {
    id: layerId(post_type, format, "info_band"),
    name: "Info band",
    kind: "shape",
    locked: false,
    visible: true,
    left: 0,
    top: bandTop,
    width: dims.width,
    height: bandHeight,
    angle: 0,
    opacity: 0.92,
    z: 20,
    shapeType: "rect",
    fill: BAND_FILL[post_type],
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 0,
    strokeDashArray: [],
  };
  layers.push(bandLayer);

  // ---- Layer 3: status eyebrow ("JUST LISTED", "SOLD", etc.) ----
  const eyebrowText: TextLayer = {
    id: layerId(post_type, format, "status_eyebrow"),
    name: "Status eyebrow",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: bandTop + 36,
    width: dims.width - 120,
    height: 60,
    angle: 0,
    opacity: 1,
    z: 30,
    text: STATUS_LABELS[post_type],
    fontFamily: ALLIANCE_FONTS.oswald,
    fontSize: 48,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "left",
    lineHeight: 1.0,
    charSpacing: 250,
    underline: false,
    linethrough: false,
    editable: true,
  };
  layers.push(eyebrowText);

  // ---- Layer 4: street address ----
  const streetText: TextLayer = {
    id: layerId(post_type, format, "address_street"),
    name: "Street address",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: bandTop + 110,
    width: dims.width - 350,
    height: 56,
    angle: 0,
    opacity: 1,
    z: 31,
    text: "{address_line1}",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.nunito,
    fontSize: 36,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "left",
    lineHeight: 1.1,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  };
  layers.push(streetText);

  // ---- Layer 5: city (NEVER state, NEVER zip — per Larissa rule) ----
  const cityText: TextLayer = {
    id: layerId(post_type, format, "address_city"),
    name: "City",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: bandTop + 160,
    width: dims.width - 350,
    height: 36,
    angle: 0,
    opacity: 1,
    z: 32,
    text: "{city}",
    boundField: "city",
    fontFamily: ALLIANCE_FONTS.nunito,
    fontSize: 24,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "left",
    lineHeight: 1.1,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  };
  layers.push(cityText);

  // ---- Layer 6: price (right-aligned, gold accent for emphasis) ----
  // Just Sold uses close_price; other types use list price.
  const priceField = post_type === "just_sold" ? "close_price" : "price";
  const priceText: TextLayer = {
    id: layerId(post_type, format, "price"),
    name: "Price",
    kind: "text",
    locked: false,
    visible: true,
    left: dims.width - 280,
    top: bandTop + 110,
    width: 220,
    height: 60,
    angle: 0,
    opacity: 1,
    z: 33,
    text: "{price}",
    boundField: priceField,
    fontFamily: ALLIANCE_FONTS.nunito,
    fontSize: 40,
    fontWeight: 800,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "right",
    lineHeight: 1.0,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  };
  layers.push(priceText);

  // ---- Layer 7: C21 ALLIANCE brokerage logo (>= 200px wide per Larissa rule) ----
  // Embedded SVG via data URI so the logo is always available without a
  // network fetch. Width set to 220px — comfortably above the 160px brand
  // floor and small enough not to compete with the address text.
  const logoLayer: ImageLayer = {
    id: layerId(post_type, format, "brokerage_logo"),
    name: "C21 ALLIANCE logo",
    kind: "image",
    locked: false,
    visible: true,
    left: dims.width - 240,
    top: bandTop + bandHeight - 70,
    width: 220,
    height: 50,
    angle: 0,
    opacity: 1,
    z: 34,
    src: C21_ALLIANCE_WHITE_LOGO,
    objectFit: "contain",
    crossOrigin: "anonymous",
    cornerRadius: 0,
    borderColor: "",
    borderWidth: 0,
  };
  layers.push(logoLayer);

  // ---- Layer 8: small "Coming Soon" stamp — visual signal these are placeholders ----
  // Sits in the top-right corner so it doesn't crowd the photo. Removed
  // once a real template replaces this one.
  const placeholderStamp: TextLayer = {
    id: layerId(post_type, format, "placeholder_stamp"),
    name: "Placeholder stamp (delete in real template)",
    kind: "text",
    locked: false,
    visible: true,
    left: dims.width - 280,
    top: 32,
    width: 240,
    height: 24,
    angle: 0,
    opacity: 0.7,
    z: 50,
    text: "TEMPLATE UNDER CONSTRUCTION",
    fontFamily: ALLIANCE_FONTS.oswald,
    fontSize: 12,
    fontWeight: 500,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "right",
    lineHeight: 1.0,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  };
  layers.push(placeholderStamp);

  // why: cast suppresses unused-var lint on isSquare; reserved for
  // future square-vs-story specific tweaks (e.g., taller info band on
  // story to clear the IG safe zone). Keeping the variable readable.
  void isSquare;

  return {
    id: `placeholder_${post_type}_${format}`,
    name: `${STATUS_LABELS[post_type]} — placeholder`,
    description:
      "Minimal placeholder template — replace with a real design once Larissa ships a Canva reference.",
    category: post_type,
    // why: variant axis is soft-deprecated to a single "v1" value. Every
    // placeholder carries "v1" so findCanvasTemplate(post_type, "v1", format)
    // returns this row. Per-post-type variant choice in the UI is gone.
    variant: "v1" as PostVariant,
    format,
    width: dims.width,
    height: dims.height,
    backgroundColor: ALLIANCE_COLORS.ink900,
    layers,
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

// =============================================================================
// Public builder — emits 5 post_types × 2 formats = 10 placeholder templates
// =============================================================================

const POST_TYPES_TO_BUILD: ReadonlyArray<PostType> = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
] as const;

const FORMATS_TO_BUILD: ReadonlyArray<PostFormat> = [
  "square_1x1",
  "story_9x16",
] as const;

/**
 * Build all placeholder templates. Called by templates/index.ts to populate
 * the canonical CANVAS_TEMPLATES array.
 *
 * 2026-05-24 Phase C — exclusion list: certain (post_type × format) tuples
 * now have REAL Larissa-spec templates living in their own files. We skip
 * those slots here so the placeholder doesn't conflict with the real
 * template at lookup time. As Larissa ships more references, add the
 * corresponding tuples to SKIP_TUPLES.
 */
const SKIP_TUPLES: ReadonlyArray<{ post_type: PostType; format: PostFormat }> = [
  { post_type: "just_listed", format: "square_1x1" },
  { post_type: "just_sold", format: "square_1x1" },
  { post_type: "open_house", format: "square_1x1" },
] as const;

function shouldSkip(post_type: PostType, format: PostFormat): boolean {
  return SKIP_TUPLES.some(
    (t) => t.post_type === post_type && t.format === format,
  );
}

export function buildAllPlaceholderTemplates(): CanvasTemplateSchema[] {
  const out: CanvasTemplateSchema[] = [];
  for (const post_type of POST_TYPES_TO_BUILD) {
    for (const format of FORMATS_TO_BUILD) {
      if (shouldSkip(post_type, format)) continue;
      out.push(buildPlaceholderTemplate(post_type, format));
    }
  }
  return out;
}
