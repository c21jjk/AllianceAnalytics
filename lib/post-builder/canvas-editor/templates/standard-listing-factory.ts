/**
 * Standard Listing template factory — `createStandardListingTemplate(postType, format)`
 * --------------------------------------------------------------------------------------
 *
 * v8 STANDARD NEW LISTING — the everyday-tier listing poster. Replaces the
 * earlier v8 Minimal Frame layout (gallery-poster centered type) with a more
 * direct editorial composition modeled on the real FB posts the brokerage
 * publishes for sub-$949K listings:
 *
 *   • Top-left:  serif eyebrow ("NEW LISTING") stacked above the address
 *                + city, with a small price line tucked under the eyebrow.
 *   • Top-right: small dark "C21 ALLIANCE" badge image (gold seal + wordmark).
 *   • Middle:    hero photo, edge-to-edge horizontally, generous height.
 *   • Bottom:    full-width dark band with a tracked, small-caps feature row,
 *                e.g. "4 BEDROOM | 2.5 BATHROOM | SUNSET VIEWS".
 *
 * Why this layout (vs. the older Minimal Frame "centered type below the
 * photo"):
 *   • Reads at thumbnail size — the eyebrow + address are anchored in the
 *     top-left where viewers' eyes land first; the bottom band carries
 *     specs without competing with the photo.
 *   • Mirrors the brokerage's existing FB voice for sub-luxury listings —
 *     polished, direct, but less "magazine cover" than Excellence Collection.
 *   • Symmetric C21 badge in the top-right anchors the brand without
 *     consuming the photo area.
 *
 * Generates 15 templates: 5 post types × 3 formats. Same shape as the other
 * factories in this directory so the registry can iterate uniformly.
 *
 * Per-post-type accents:
 *   • just_listed   → NEW LISTING eyebrow, list price under it.
 *   • just_sold     → NEWLY SOLD eyebrow, close price, red SOLD stamp on
 *                     the LEFT side of the hero (right side is occupied
 *                     by the C21 badge).
 *   • under_contract→ UNDER CONTRACT eyebrow, literal "Under Contract"
 *                     text in the price slot (no boundField, per the
 *                     validator's category-specific rule).
 *   • open_house    → OPEN HOUSE eyebrow, italic gold open-house line
 *                     between the price and the address (mirrors the
 *                     minimal-frame variant's openHouseLine treatment).
 *   • price_reduction → NEW PRICE eyebrow, refreshed list price, green
 *                       ↓ NEW PRICE stamp on the LEFT side of the hero.
 *
 * Layer numbering (z) — kept monotonic for clarity, gaps allowed:
 *   z=0   light surface background (relies on backgroundColor, no layer)
 *   z=1   hero photo (edge-to-edge horizontally between the top stack
 *         and the bottom dark band)
 *   z=2   bottom dark band (full-width rect, ink900)
 *   z=3   bottom feature row text (small caps, tracked, white)
 *   z=4   eyebrow text (top-left, Playfair Display, large)
 *   z=5   open-house line                  (only when showOpenHouseLine)
 *   z=6   price text                       (or "Under Contract" literal)
 *   z=7   address line (small caps, tracked, ink700)
 *   z=8   city line (small caps, tracked, ink700)
 *   z=9   C21 ALLIANCE badge image (top-right, small)
 *   z=10  side badge stamp shape           (only when badge configured)
 *   z=11  side badge stamp text            (only when badge configured)
 *
 * Story-format note: per the IG/FB safe-zones guidance, the top stack stays
 * below y≈250 and the bottom band stays above y≈1720 (1920 − 200). The
 * hero photo fills the safe-area middle.
 */

import type {
  CanvasLayer,
  CanvasTemplateSchema,
  PostFormat,
  PostType,
} from "../types";
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
import { C21_ALLIANCE_GREY_LOGO } from "./brand-logos";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Public URL for the "C21 ALLIANCE Grey" badge asset — dark rectangular
 * lockup with the gold C21 seal + gold "ALLIANCE" wordmark. Lives in the
 * brand-assets Supabase bucket; uploaded by John 2026-05-17. Placed in the
 * top-right corner of every template as the symmetric brand anchor.
 */
// why: shared registry — see ./brand-logos.ts for the rationale on why
// logo URLs live in one file instead of inline constants per factory.
// All five active templates (v2, v3, v6, v8, v9, v10) now import from
// brand-logos so a logo re-upload only requires updating one URL.
const C21_BADGE_URL = C21_ALLIANCE_GREY_LOGO;

// ---------------------------------------------------------------------------
// Per-format layout numbers
// ---------------------------------------------------------------------------

/**
 * Layout numbers for a single format. Top-left text stack + hero + bottom
 * dark band + top-right C21 badge image, with optional side badge stamp
 * for just_sold + price_reduction (anchored on the LEFT since the badge
 * image occupies top-right).
 *
 * All coordinates are top-left origin, pixels at the unmultiplied canvas
 * resolution from PLATFORM_DIMENSIONS.
 */
interface FormatLayout {
  width: number;
  height: number;
  /** Top-left text stack — eyebrow, price, address, city. */
  topStack: {
    /** Left margin shared by every text layer in the stack. */
    left: number;
    /** Width allocated to each line (long addresses wrap inside this). */
    width: number;
    eyebrow: { top: number; fontSize: number };
    price: { top: number; fontSize: number };
    openHouse: { top: number; fontSize: number };
    address: { top: number; fontSize: number };
    city: { top: number; fontSize: number };
  };
  /** Hero photo rect — fills horizontally edge-to-edge. */
  hero: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  /** Bottom dark band + small-caps feature row text. */
  bottomBand: {
    /** Top edge of the dark rectangle. */
    top: number;
    /** Height of the dark rectangle. */
    height: number;
    /** Vertical offset of the feature-row text within the band. */
    textTop: number;
    fontSize: number;
  };
  /** C21 ALLIANCE badge image — top-right corner. */
  badgeImage: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  /** Side badge stamp (just_sold + price_reduction). Anchored on the LEFT. */
  sideBadge: {
    left: number;
    top: number;
    width: number;
    height: number;
    angle: number;
    fontSize: number;
  };
}

// why: the layout numbers below are sized so that — across all three formats —
// the C21 ALLIANCE badge in the top-right has ≥40px of margin from the canvas
// edge and never overlaps the top text stack. The hero photo is edge-to-edge
// horizontally (left=0, width=full canvas) since the bottom band gives the
// composition its frame; left-edge padding would compete with the band.
const LAYOUTS: Record<PostFormat, FormatLayout> = {
  // ── Square 1:1 (1080×1080) ────────────────────────────────────────────────

  // ── Portrait 4:5 (1080×1350) ──────────────────────────────────────────────
  portrait_4x5: {
    width: 1080,
    height: 1350,
    topStack: {
      left: 60,
      width: 720,
      eyebrow: { top: 64, fontSize: 64 },
      price: { top: 146, fontSize: 24 },
      openHouse: { top: 180, fontSize: 24 },
      // why: design review 2026-05-17 — bump address to 28 / city 26.
      address: { top: 214, fontSize: 28 },
      city: { top: 256, fontSize: 26 },
    },
    hero: {
      left: 0,
      top: 320,
      width: 1080,
      height: 880,
    },
    bottomBand: {
      top: 1200,
      height: 150,
      // why: 1200 + (150-24)/2 = 1263
      textTop: 1263,
      fontSize: 24,
    },
    badgeImage: {
      left: 820,
      top: 60,
      width: 200,
      height: 80,
    },
    sideBadge: {
      left: 40,
      top: 360,
      width: 220,
      height: 90,
      angle: -8,
      fontSize: 42,
    },
  },

  // ── Story 9:16 (1080×1920) ────────────────────────────────────────────────
  // why: top stack starts at y=280 (just below 250px safe zone). Bottom band
  // ends at y=1720 (top of 200px bottom safe zone) so the dark band ends at
  // 1720 and any UI overlay sits below it.
  story_9x16: {
    width: 1080,
    height: 1920,
    topStack: {
      left: 70,
      width: 740,
      eyebrow: { top: 290, fontSize: 76 },
      price: { top: 386, fontSize: 28 },
      openHouse: { top: 424, fontSize: 28 },
      // why: design review 2026-05-17 — story extends the square (26/24) +
      // portrait (28/26) progression to 32/30 so the address dominates the
      // city at story scale (post viewed at full-screen on phone).
      address: { top: 468, fontSize: 32 },
      city: { top: 514, fontSize: 30 },
    },
    hero: {
      left: 0,
      top: 580,
      width: 1080,
      height: 980,
    },
    bottomBand: {
      top: 1560,
      height: 160,
      // why: 1560 + (160-28)/2 = 1626
      textTop: 1626,
      fontSize: 28,
    },
    badgeImage: {
      // why: top-right but BELOW the 250px Story top safe zone so the IG/FB
      // UI doesn't cover the C21 lockup. left=820, top=280.
      left: 820,
      top: 280,
      width: 220,
      height: 90,
    },
    sideBadge: {
      left: 50,
      top: 620,
      width: 240,
      height: 100,
      angle: -8,
      fontSize: 48,
    },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming
// ---------------------------------------------------------------------------

interface BadgeConfig {
  text: string;
  fill: string;
}

interface PriceConfig {
  mode: "list" | "close" | "label";
  fallbackText: string;
  boundField: "price" | "close_price" | null;
}

interface PostTypeConfig {
  eyebrow: string;
  price: PriceConfig;
  /** Side badge stamp — when null, no stamp is drawn. */
  badge: BadgeConfig | null;
  showOpenHouseLine: boolean;
  templateNamePrefix: string;
  idPrefix: PostType;
  description: (format: PostFormat) => string;
}

function describeFormat(format: PostFormat): string {
  switch (format) {
    case "portrait_4x5":
      return "Portrait 4:5";
    case "story_9x16":
      return "Story 9:16";
  }
}

const POST_TYPE_CONFIGS: Record<PostType, PostTypeConfig> = {
  just_listed: {
    // why: "NEW LISTING" mirrors the brokerage's editorial voice in real FB
    // posts for sub-$949K homes — feels current without shouting "JUST".
    eyebrow: "NEW LISTING",
    price: { mode: "list", fallbackText: "$849,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "New Listing",
    idPrefix: "just_listed",
    description: (f) =>
      `${describeFormat(f)} standard listing poster — serif eyebrow + address top-left, C21 badge top-right, edge-to-edge hero photo, dark feature band along the bottom.`,
  },
  just_sold: {
    eyebrow: "NEWLY SOLD",
    price: { mode: "close", fallbackText: "$815,000", boundField: "close_price" },
    // why: red SOLD stamp on the LEFT side of the hero — top-right is
    // occupied by the C21 ALLIANCE badge image so the stamp can't sit there.
    badge: { text: "SOLD", fill: "#B91C1C" },
    showOpenHouseLine: false,
    templateNamePrefix: "Newly Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} standard closed-deal poster — red SOLD stamp on the left of the hero, close price under the eyebrow.`,
  },
  under_contract: {
    eyebrow: "UNDER CONTRACT",
    // why: no dollar amount on under-contract posts. Show "Under Contract" in
    // the price slot as a literal label with no boundField (validator exempts
    // this category from the price/close_price binding requirement).
    price: { mode: "label", fallbackText: "Under Contract", boundField: null },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} standard pipeline-status poster — "Under Contract" replaces the price slot under the serif eyebrow.`,
  },
  open_house: {
    eyebrow: "OPEN HOUSE",
    price: { mode: "list", fallbackText: "$849,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} standard open-house poster — italic gold date/time line between the eyebrow and the address.`,
  },
  price_reduction: {
    eyebrow: "NEW PRICE",
    price: { mode: "list", fallbackText: "$799,000", boundField: "price" },
    // why: green ↓ NEW PRICE stamp on the LEFT for the same reason as
    // just_sold — top-right is locked to the brand badge.
    badge: { text: "↓ NEW PRICE", fill: "#15803D" },
    showOpenHouseLine: false,
    templateNamePrefix: "New Price",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} standard reduction poster — green ↓ NEW PRICE stamp on the left of the hero, refreshed list price under the eyebrow.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a single Standard Listing template for the given (postType, format).
 *
 * The function is deterministic — calling it twice with the same inputs
 * produces identical layer trees (same ids, same numbers). Stability matters
 * for snapshot diffing and Supabase persistence.
 *
 * @param postType — which of the five post categories
 * @param format   — which aspect ratio (square / portrait / story)
 * @returns a CanvasTemplateSchema ready to register in index.ts
 */
export function createStandardListingTemplate(
  postType: PostType,
  format: PostFormat,
): CanvasTemplateSchema {
  const layout = LAYOUTS[format];
  const cfg = POST_TYPE_CONFIGS[postType];

  const formatShort: Record<PostFormat, string> = {
    portrait_4x5: "portrait",
    story_9x16: "story",
  };

  // ── layer tree ──────────────────────────────────────────────────────────
  const layers: CanvasLayer[] = [
    // ---- z=1  hero photo (edge-to-edge horizontally) ----
    // why: drawn FIRST in the layer array so the dark band at z=2 paints on
    // top of any photo overflow at the bottom edge. The photo's `objectFit:
    // "cover"` crops to fill, which is what we want for a horizontally
    // full-bleed hero.
    {
      kind: "image",
      id: "layer_hero_photo",
      name: "Hero photo",
      left: layout.hero.left,
      top: layout.hero.top,
      width: layout.hero.width,
      height: layout.hero.height,
      angle: 0,
      opacity: 1,
      z: 1,
      visible: true,
      locked: false,
      src: null,
      boundField: "hero_photo",
      objectFit: "cover",
      crossOrigin: "anonymous",
      cornerRadius: 0,
      borderColor: "transparent",
      borderWidth: 0,
    },

    // ---- z=2  bottom dark band (full-width ink900 rectangle) ----
    {
      kind: "shape",
      id: "layer_bottom_band",
      name: "Bottom dark band",
      left: 0,
      top: layout.bottomBand.top,
      width: layout.width,
      height: layout.bottomBand.height,
      angle: 0,
      opacity: 1,
      z: 2,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.ink900,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },

    // ---- z=3  feature row text (small caps, tracked, white) ----
    // why: a SINGLE text layer with literal fallback rather than three bound
    // layers. The TextBoundField union resolves to raw values ("4", "2.5")
    // with no unit labels; combining them into "4 BEDROOM | 2.5 BATHROOM"
    // would require either a string-templating boundField (not in the schema)
    // or three layers with manual positioning that wouldn't reflow with the
    // canvas width. One literal-text layer is the cleanest fit — Studio
    // editors can tweak the line per-post when the feature_highlight value
    // gets stale or when bed counts need correction.
    {
      kind: "text",
      id: "layer_feature_row",
      name: "Feature row",
      left: 0,
      top: layout.bottomBand.textTop,
      width: layout.width,
      height: layout.bottomBand.fontSize + 12,
      angle: 0,
      opacity: 1,
      z: 3,
      visible: true,
      locked: false,
      // why: literal text with " | " separators (spaces around pipes for
      // readability). Hydration at render time can rewrite this string from
      // `template_props.feature_highlight` + the listing's beds/baths.
      text: "4 BEDROOM  |  2.5 BATHROOM  |  SUNSET VIEWS",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.bottomBand.fontSize,
      fontWeight: 600,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.white,
      textAlign: "center",
      lineHeight: 1.2,
      // why: 240/1000em is the same tracking the minimal-frame factory uses
      // for small-caps rows — consistent visual rhythm across variants.
      charSpacing: 240,
      underline: false,
      linethrough: false,
      editable: true,
    },

    // ---- z=4  eyebrow text (top-left, large Playfair serif) ----
    {
      kind: "text",
      id: "layer_eyebrow",
      name: "Eyebrow",
      left: layout.topStack.left,
      top: layout.topStack.eyebrow.top,
      width: layout.topStack.width,
      height: layout.topStack.eyebrow.fontSize + 16,
      angle: 0,
      opacity: 1,
      z: 4,
      visible: true,
      locked: false,
      text: cfg.eyebrow,
      // why: NO boundField — the eyebrow phrasing is derived from
      // postType, not listing.status. The status_label bound field
      // returns "JUST LISTED" not the editorial "NEW LISTING" string,
      // so we keep the eyebrow as a hard-coded value per config.
      fontFamily: ALLIANCE_FONTS.playfair,
      fontSize: layout.topStack.eyebrow.fontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "left",
      lineHeight: 1.04,
      charSpacing: -10,
      underline: false,
      linethrough: false,
      editable: true,
    },
  ];

  // ---- z=5  open-house line (italic gold) — only for open_house ----
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "text",
      id: "layer_open_house_line",
      name: "Open House date/time",
      left: layout.topStack.left,
      top: layout.topStack.openHouse.top,
      width: layout.topStack.width,
      height: layout.topStack.openHouse.fontSize + 10,
      angle: 0,
      opacity: 1,
      z: 5,
      visible: true,
      locked: false,
      text: "Saturday · 11:00 AM – 1:00 PM",
      boundField: "open_house_date",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.topStack.openHouse.fontSize,
      fontWeight: 500,
      // why: italic + gold600 mirrors the minimal-frame openHouseLine —
      // keeps the date/time line distinct from the address rows below.
      fontStyle: "italic",
      fill: ALLIANCE_COLORS.gold600,
      textAlign: "left",
      lineHeight: 1.2,
      charSpacing: 80,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=6  price (small line under the eyebrow) OR "Under Contract" label ----
  // why: the price sits BELOW the eyebrow but ABOVE the address — a tight
  // 4-line stack reads as a single editorial block from top-left. Smaller
  // than the eyebrow so the headline stays the dominant element.
  layers.push({
    kind: "text",
    id: "layer_price",
    name: cfg.price.mode === "label" ? "Status (Under Contract)" : "Price",
    left: layout.topStack.left,
    top: layout.topStack.price.top,
    width: layout.topStack.width,
    height: layout.topStack.price.fontSize + 12,
    angle: 0,
    opacity: 1,
    z: 6,
    visible: true,
    locked: false,
    text: cfg.price.fallbackText,
    // why: spread the bound-field key conditionally so under_contract (which
    // has no boundField) doesn't ship with `boundField: undefined` in the JSON.
    ...(cfg.price.boundField ? { boundField: cfg.price.boundField } : {}),
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.topStack.price.fontSize,
    fontWeight: cfg.price.mode === "label" ? 800 : 700,
    fontStyle: "normal",
    // why: gold600 echoes the eyebrow color in the minimal-frame variant
    // and keeps the price visually subordinate to the larger eyebrow.
    fill: ALLIANCE_COLORS.gold600,
    textAlign: "left",
    lineHeight: 1.2,
    // why: dollar amounts read tighter at small sizes; labels (UPPERCASE
    // "Under Contract") get tracked out for emphasis.
    charSpacing: cfg.price.mode === "label" ? 200 : 40,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=7  address line (small caps, tracked, ink700) ----
  layers.push({
    kind: "text",
    id: "layer_address_line",
    name: "Address",
    left: layout.topStack.left,
    top: layout.topStack.address.top,
    width: layout.topStack.width,
    height: layout.topStack.address.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 7,
    visible: true,
    locked: false,
    text: "639 W SPRUCE AVENUE",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.topStack.address.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=8  city line (small caps, tracked, ink700) ----
  layers.push({
    kind: "text",
    id: "layer_city",
    name: "City",
    left: layout.topStack.left,
    top: layout.topStack.city.top,
    width: layout.topStack.width,
    height: layout.topStack.city.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 8,
    visible: true,
    locked: false,
    text: "NORTH WILDWOOD",
    boundField: "city",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.topStack.city.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=9  C21 ALLIANCE brand badge image (top-right) ----
  // why: a literal image layer (no boundField) — the brand mark is static
  // across all templates. `objectFit: "contain"` preserves the lockup's
  // aspect ratio inside the layer rect; we sized the rect (200×80 / 220×90)
  // to roughly match the asset's natural proportions so it renders without
  // letterbox bars.
  layers.push({
    kind: "image",
    id: "layer_c21_badge",
    name: "C21 Alliance badge",
    left: layout.badgeImage.left,
    top: layout.badgeImage.top,
    width: layout.badgeImage.width,
    height: layout.badgeImage.height,
    angle: 0,
    opacity: 1,
    z: 9,
    visible: true,
    locked: false,
    src: C21_BADGE_URL,
    objectFit: "contain",
    crossOrigin: "anonymous",
    cornerRadius: 0,
    borderColor: "transparent",
    borderWidth: 0,
  });

  // ---- z=10/11  side badge stamp (only when configured) ----
  // why: anchored on the LEFT side of the hero (the right side is reserved
  // for the C21 badge image). Rotated -8° to match the visual language of
  // SOLD / NEW PRICE stamps used across the other variants.
  if (cfg.badge) {
    layers.push({
      kind: "shape",
      id: "layer_badge_shape",
      name: "Badge stamp",
      left: layout.sideBadge.left,
      top: layout.sideBadge.top,
      width: layout.sideBadge.width,
      height: layout.sideBadge.height,
      angle: layout.sideBadge.angle,
      opacity: 0.95,
      z: 10,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: cfg.badge.fill,
      // why: white border separates the stamp visually from any photo
      // contents underneath — matches the minimal-frame badge treatment.
      stroke: ALLIANCE_COLORS.white,
      strokeWidth: 4,
      cornerRadius: 6,
      strokeDashArray: [],
    });
    layers.push({
      kind: "text",
      id: "layer_badge_text",
      name: "Badge text",
      left: layout.sideBadge.left,
      top:
        layout.sideBadge.top +
        Math.round((layout.sideBadge.height - layout.sideBadge.fontSize) / 2),
      width: layout.sideBadge.width,
      height: layout.sideBadge.fontSize + 8,
      angle: layout.sideBadge.angle,
      opacity: 1,
      z: 11,
      visible: true,
      locked: false,
      text: cfg.badge.text,
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.sideBadge.fontSize,
      fontWeight: 900,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.white,
      textAlign: "center",
      lineHeight: 1,
      charSpacing: 200,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  return {
    id: `canvas_${cfg.idPrefix}_v8_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Standard Listing · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v8",
    format,
    width: layout.width,
    height: layout.height,
    // why: clean near-white surface. Same warm-cream `#FCFCFB` the
    // minimal-frame variant uses so the standard tier and the editorial
    // tier share a paper tone — what changes is the type system, not the
    // surface color.
    backgroundColor: "#FCFCFB",
    backgroundImage: null,
    updatedAt: "2026-05-17T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: build all 5 post types × 3 formats = 15 standard-listing
 * templates. The registry (index.ts) calls this once at module-load time
 * alongside the other factory outputs.
 *
 * @returns array of 15 templates in (postType × format) outer-loop order.
 */
export function buildAllStandardListingTemplates(): readonly CanvasTemplateSchema[] {
  const postTypes: PostType[] = [
    "just_listed",
    "just_sold",
    "under_contract",
    "open_house",
    "price_reduction",
  ];
  const formats: PostFormat[] = ["portrait_4x5", "story_9x16"];
  const out: CanvasTemplateSchema[] = [];
  for (const pt of postTypes) {
    for (const f of formats) {
      out.push(createStandardListingTemplate(pt, f));
    }
  }
  return out;
}

export default buildAllStandardListingTemplates;
