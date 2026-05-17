/**
 * Bold Stats template factory — `createBoldStatsTemplate(postType, format)`
 * ------------------------------------------------------------------------------
 *
 * v2 Bold Stats — the "60/40 split" layout. Photo dominates the top, dark data
 * pane carries the type underneath. The architectural choice is different from
 * v1 Hero Editorial (which puts everything over a single full-bleed photo with
 * a scrim at the bottom): here the photo gets to breathe and the type lives on
 * its own surface. Best for listings where the exterior / architecture is the
 * story — the photo isn't fighting overlaid text.
 *
 * Generates 15 templates: 5 post types × 3 formats.
 *
 * Design parity with the V1 HTML primitive (`primitives/v2-bold-stats*.ts`):
 *   • Same 60/40 vertical split across Square + Portrait.
 *   • For Story 9:16, the data band hugs the bottom safe zone (y=1120 → 1720)
 *     and the photo bleeds 0 → 1920 with the upper portion serving as the
 *     thumb-stopping image; the data band sits over the lower third of the
 *     photo with a dark fill.
 *   • Same gold-accent rule + oversized gold price + uppercase city/state.
 *   • V1's `.hero-tint` linear-gradient is approximated by a single semi-
 *     opaque dark scrim near the top of the photo, just enough to keep the
 *     eyebrow legible. ShapeLayer.fill is hex-only in the current schema —
 *     adding gradient fills is a separate, larger schema change we'll do
 *     when v6 Magazine Cover ships (it needs them more than v2 does).
 *   • V1's "21" brand mark glyph is omitted here in favor of a simpler text
 *     footer ("CENTURY 21 ALLIANCE"). The mark is decorative; the brand
 *     name bound to `office_name` already carries the same identification.
 *
 * Layer numbering (z):
 *   z=0  hero photo (full bleed)
 *   z=1  light scrim near top of photo (eyebrow legibility)
 *   z=2  eyebrow accent rule (gold)
 *   z=3  status label (eyebrow text)
 *   z=4  dark data pane background rect
 *   z=5  optional open-house chip rect       (only when showOpenHouseLine)
 *   z=6  optional open-house chip text       (only when showOpenHouseLine)
 *   z=7  address
 *   z=8  city/state/zip
 *   z=9  gold rule (inside data pane)
 *   z=10 price (oversized)
 *   z=11 beds/baths inline row
 *   z=12 brand name ("CENTURY 21 ALLIANCE")
 *   z=13 mls number tag
 *   z=14 badge stamp rect                    (only when badge configured)
 *   z=15 badge stamp text                    (only when badge configured)
 */

import type {
  CanvasLayer,
  CanvasTemplateSchema,
  PostFormat,
  PostType,
} from "../types";
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";

// ---------------------------------------------------------------------------
// Per-format layout numbers
// ---------------------------------------------------------------------------

interface FormatLayout {
  width: number;
  height: number;
  /** Bottom edge of the photo / top edge of the data pane. */
  photoBottom: number;
  /** Subtle scrim near the top of the photo — keeps the eyebrow readable. */
  topScrim: { top: number; height: number; opacity: number };
  /** Eyebrow block (gold rule + status label) over the photo. */
  eyebrow: {
    left: number;
    ruleTop: number;
    ruleWidth: number;
    labelTop: number;
    labelFontSize: number;
  };
  /** Padding + y positions for the body type stack inside the data pane. */
  body: {
    paddingLeft: number;
    paddingRight: number;
    openHouseChip: { top: number; height: number; fontSize: number; width: number };
    address: { top: number; fontSize: number };
    cityStateZip: { top: number; fontSize: number };
    goldRule: { top: number; width: number };
    price: { top: number; fontSize: number };
    bedsBaths: { top: number; fontSize: number };
  };
  /** Footer line — brand name on left, MLS code on right. */
  footer: {
    top: number;
    brandWidth: number;
    brandFontSize: number;
    mlsFontSize: number;
    mlsRight: number;
    mlsWidth: number;
  };
  /** Badge stamp — same anchor as v1 Hero Editorial; sits over the photo. */
  badge: {
    left: number;
    top: number;
    width: number;
    height: number;
    angle: number;
    fontSize: number;
  };
}

const LAYOUTS: Record<PostFormat, FormatLayout> = {
  square_1x1: {
    width: 1080,
    height: 1080,
    photoBottom: 648,
    // why: design review 2026-05-17 — scrim 0.35 was too thin under bright
    // beach photos; eyebrow text washed out. 0.50 keeps the photo legible
    // while guaranteeing the eyebrow + badge stay readable.
    topScrim: { top: 0, height: 180, opacity: 0.50 },
    eyebrow: {
      left: 56,
      ruleTop: 64,
      ruleWidth: 56,
      labelTop: 80,
      labelFontSize: 22,
    },
    body: {
      paddingLeft: 56,
      paddingRight: 56,
      openHouseChip: { top: 692, height: 44, fontSize: 20, width: 340 },
      address: { top: 752, fontSize: 44 },
      cityStateZip: { top: 818, fontSize: 20 },
      goldRule: { top: 868, width: 72 },
      price: { top: 894, fontSize: 88 },
      bedsBaths: { top: 962, fontSize: 19 },
    },
    footer: {
      top: 1018,
      brandWidth: 540,
      brandFontSize: 18,
      mlsFontSize: 16,
      mlsRight: 56,
      mlsWidth: 360,
    },
    badge: { left: 760, top: 88, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
  portrait_4x5: {
    width: 1080,
    height: 1350,
    photoBottom: 810,
    topScrim: { top: 0, height: 220, opacity: 0.50 },
    eyebrow: {
      left: 64,
      ruleTop: 76,
      ruleWidth: 64,
      labelTop: 94,
      labelFontSize: 26,
    },
    body: {
      paddingLeft: 64,
      paddingRight: 64,
      openHouseChip: { top: 860, height: 48, fontSize: 22, width: 380 },
      address: { top: 926, fontSize: 52 },
      cityStateZip: { top: 1004, fontSize: 24 },
      goldRule: { top: 1060, width: 84 },
      price: { top: 1090, fontSize: 104 },
      bedsBaths: { top: 1166, fontSize: 22 },
    },
    footer: {
      top: 1278,
      brandWidth: 600,
      brandFontSize: 20,
      mlsFontSize: 18,
      mlsRight: 64,
      mlsWidth: 360,
    },
    badge: { left: 800, top: 108, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
  // why: for Story 9:16 we keep the 60/40 spirit but anchor the data band to
  // the platform's bottom safe zone (1720 max-y to avoid Send-arrow overlay).
  // Photo bleeds full canvas; the data pane is an opaque dark rect overlaid
  // on the lower portion, giving the price + address the thumb-stopping scale
  // Story format rewards.
  story_9x16: {
    width: 1080,
    height: 1920,
    photoBottom: 1140,
    topScrim: { top: 0, height: 300, opacity: 0.42 },
    eyebrow: {
      left: 80,
      ruleTop: 156,
      ruleWidth: 76,
      labelTop: 182,
      labelFontSize: 32,
    },
    body: {
      paddingLeft: 80,
      paddingRight: 80,
      openHouseChip: { top: 1186, height: 56, fontSize: 26, width: 440 },
      address: { top: 1262, fontSize: 72 },
      cityStateZip: { top: 1364, fontSize: 30 },
      goldRule: { top: 1432, width: 92 },
      price: { top: 1466, fontSize: 132 },
      bedsBaths: { top: 1572, fontSize: 26 },
    },
    footer: {
      top: 1672,
      brandWidth: 700,
      brandFontSize: 24,
      mlsFontSize: 22,
      mlsRight: 80,
      mlsWidth: 360,
    },
    badge: { left: 760, top: 224, width: 280, height: 120, angle: -8, fontSize: 56 },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming — identical shape to hero-editorial-factory's so any
// future shared-config refactor is a single-file move.
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
  badge: BadgeConfig | null;
  showOpenHouseLine: boolean;
  templateNamePrefix: string;
  idPrefix: PostType;
  description: (format: PostFormat) => string;
}

function describeFormat(format: PostFormat): string {
  switch (format) {
    case "square_1x1":
      return "Square 1:1";
    case "portrait_4x5":
      return "Portrait 4:5";
    case "story_9x16":
      return "Story 9:16";
  }
}

const POST_TYPE_CONFIGS: Record<PostType, PostTypeConfig> = {
  just_listed: {
    eyebrow: "JUST LISTED",
    price: { mode: "list", fallbackText: "$929,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Just Listed",
    idPrefix: "just_listed",
    description: (f) =>
      `${describeFormat(f)} bold-stats layout — photo on top, oversized gold price on a dark data pane below.`,
  },
  just_sold: {
    eyebrow: "JUST SOLD",
    price: { mode: "close", fallbackText: "$905,000", boundField: "close_price" },
    badge: { text: "SOLD", fill: "#B91C1C" },
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} closed-deal bold-stats — red SOLD stamp on the photo, close price oversized below.`,
  },
  under_contract: {
    eyebrow: "UNDER CONTRACT",
    price: { mode: "label", fallbackText: "Under Contract", boundField: null },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} pipeline-status bold-stats — "Under Contract" replaces the price slot.`,
  },
  open_house: {
    eyebrow: "OPEN HOUSE",
    price: { mode: "list", fallbackText: "$929,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} open-house bold-stats — gold date/time chip leads the data pane above the price.`,
  },
  price_reduction: {
    eyebrow: "PRICE REDUCED",
    price: { mode: "list", fallbackText: "$899,000", boundField: "price" },
    badge: { text: "↓ NEW PRICE", fill: "#15803D" },
    showOpenHouseLine: false,
    templateNamePrefix: "Price Reduced",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} reduction bold-stats — green ↓ NEW PRICE stamp on the photo, refreshed list price below.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBoldStatsTemplate(
  postType: PostType,
  format: PostFormat,
): CanvasTemplateSchema {
  const layout = LAYOUTS[format];
  const cfg = POST_TYPE_CONFIGS[postType];

  const formatShort: Record<PostFormat, string> = {
    square_1x1: "square",
    portrait_4x5: "portrait",
    story_9x16: "story",
  };

  const innerWidth =
    layout.width - layout.body.paddingLeft - layout.body.paddingRight;

  const layers: CanvasLayer[] = [
    // ---- z=0  hero photo (full bleed) ----
    {
      kind: "image",
      id: "layer_hero_photo",
      name: "Hero photo",
      left: 0,
      top: 0,
      width: layout.width,
      height: layout.height,
      angle: 0,
      opacity: 1,
      z: 0,
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
    // ---- z=1  top scrim — eyebrow legibility ----
    {
      kind: "shape",
      id: "layer_top_scrim",
      name: "Top scrim",
      left: 0,
      top: layout.topScrim.top,
      width: layout.width,
      height: layout.topScrim.height,
      angle: 0,
      opacity: layout.topScrim.opacity,
      z: 1,
      visible: true,
      locked: false,
      shapeType: "rect",
      // why: pure black at low opacity reads as a gentle gradient against
      // bright hero photos without veering toward "blocky dark band."
      fill: "#000000",
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
    // ---- z=2  gold accent rule ----
    {
      kind: "shape",
      id: "layer_eyebrow_rule",
      name: "Gold accent rule",
      left: layout.eyebrow.left,
      top: layout.eyebrow.ruleTop,
      width: layout.eyebrow.ruleWidth,
      height: 3,
      angle: 0,
      opacity: 1,
      z: 2,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 2,
      strokeDashArray: [],
    },
    // ---- z=3  status label ----
    {
      kind: "text",
      id: "layer_status_label",
      name: "Status label",
      left: layout.eyebrow.left,
      top: layout.eyebrow.labelTop,
      width: 600,
      height: layout.eyebrow.labelFontSize + 14,
      angle: 0,
      opacity: 1,
      z: 3,
      visible: true,
      locked: false,
      text: cfg.eyebrow,
      // why: NO boundField — status_label hydrates from listing.status
      // (active → "JUST LISTED") and would clobber the post-category
      // eyebrow on Open House / Under Contract / Price Reduced posts.
      // The literal cfg.eyebrow is the source of truth.
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.eyebrow.labelFontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.whiteWarm,
      textAlign: "left",
      lineHeight: 1.1,
      // why: design review 2026-05-17 — charSpacing 320 was so wide that
      // 11-character eyebrows like "PRICE REDUCED" hit the badge on
      // 1080-wide canvases. 260 keeps the editorial spread while staying
      // within the eyebrow column.
      charSpacing: 260,
      underline: false,
      linethrough: false,
      editable: true,
    },
    // ---- z=4  data pane background ----
    {
      kind: "shape",
      id: "layer_data_pane",
      name: "Data pane",
      left: 0,
      top: layout.photoBottom,
      width: layout.width,
      height: layout.height - layout.photoBottom,
      angle: 0,
      // why: full opacity for square + portrait (the data pane covers the
      // bottom 40% cleanly). For Story we keep full opacity too — the photo
      // bleeds underneath but is hidden by the opaque rect, which matches
      // the V1 primitive's intent (data pane is a distinct surface, not a
      // tinted overlay).
      opacity: 1,
      z: 4,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.ink900,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
  ];

  // ---- z=5/6  open-house chip (rect + text) — only when configured ----
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "shape",
      id: "layer_open_house_chip_bg",
      name: "Open House chip",
      left: layout.body.paddingLeft,
      top: layout.body.openHouseChip.top,
      width: layout.body.openHouseChip.width,
      height: layout.body.openHouseChip.height,
      angle: 0,
      opacity: 1,
      z: 5,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 6,
      strokeDashArray: [],
    });
    layers.push({
      kind: "text",
      id: "layer_open_house_chip_text",
      name: "Open House date/time",
      // why: chip text sits centered vertically inside the chip rect. We
      // approximate that with a hand-calculated padding rather than using
      // Fabric verticalAlign (Textbox doesn't support it natively in v6).
      left: layout.body.paddingLeft + 16,
      top:
        layout.body.openHouseChip.top +
        Math.round(
          (layout.body.openHouseChip.height -
            layout.body.openHouseChip.fontSize) /
            2,
        ),
      width: layout.body.openHouseChip.width - 32,
      height: layout.body.openHouseChip.fontSize + 8,
      angle: 0,
      opacity: 1,
      z: 6,
      visible: true,
      locked: false,
      text: "Saturday · 11:00 AM – 1:00 PM",
      boundField: "open_house_date",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.body.openHouseChip.fontSize,
      fontWeight: 800,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "left",
      lineHeight: 1,
      charSpacing: 180,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=7  address ----
  layers.push({
    kind: "text",
    id: "layer_address_line",
    name: "Address",
    left: layout.body.paddingLeft,
    top: layout.body.address.top,
    width: innerWidth,
    height: layout.body.address.fontSize + 14,
    angle: 0,
    opacity: 1,
    z: 7,
    visible: true,
    locked: false,
    text: "117 E Maple Ave",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.body.address.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "left",
    lineHeight: 1.05,
    charSpacing: -20,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=8  city/state/zip ----
  layers.push({
    kind: "text",
    id: "layer_city_state_zip",
    name: "City · State · Zip",
    left: layout.body.paddingLeft,
    top: layout.body.cityStateZip.top,
    width: innerWidth,
    height: layout.body.cityStateZip.fontSize + 12,
    angle: 0,
    opacity: 1,
    z: 8,
    visible: true,
    locked: false,
    text: "Wildwood, NJ 08260",
    boundField: "city_state_zip",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.body.cityStateZip.fontSize,
    fontWeight: 500,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteDim,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 100,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=9  gold rule ----
  layers.push({
    kind: "shape",
    id: "layer_gold_rule",
    name: "Gold rule",
    left: layout.body.paddingLeft,
    top: layout.body.goldRule.top,
    width: layout.body.goldRule.width,
    height: 3,
    angle: 0,
    opacity: 1,
    z: 9,
    visible: true,
    locked: false,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.gold500,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 2,
    strokeDashArray: [],
  });

  // ---- z=10  price (oversized) ----
  layers.push({
    kind: "text",
    id: "layer_price",
    name: cfg.price.mode === "label" ? "Status (Under Contract)" : "Price",
    left: layout.body.paddingLeft,
    top: layout.body.price.top,
    width: 800,
    height: layout.body.price.fontSize + 18,
    angle: 0,
    opacity: 1,
    z: 10,
    visible: true,
    locked: false,
    text: cfg.price.fallbackText,
    ...(cfg.price.boundField ? { boundField: cfg.price.boundField } : {}),
    fontFamily: ALLIANCE_FONTS.bodySans,
    // why: label-mode is "Under Contract" text — much narrower than $X,XXX,XXX,
    // so we shrink the type to ~62% of the price slot. Mirrors v1 + v2 V1.
    fontSize:
      cfg.price.mode === "label"
        ? Math.round(layout.body.price.fontSize * 0.62)
        : layout.body.price.fontSize,
    fontWeight: 900,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "left",
    lineHeight: 0.95,
    charSpacing: cfg.price.mode === "label" ? 80 : -40,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=11  beds/baths inline row ----
  layers.push({
    kind: "text",
    id: "layer_beds_baths",
    name: "Beds · Baths",
    left: layout.body.paddingLeft,
    top: layout.body.bedsBaths.top,
    width: innerWidth,
    height: layout.body.bedsBaths.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 11,
    visible: true,
    locked: false,
    text: "4 BR · 3 BA",
    boundField: "beds_baths",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.body.bedsBaths.fontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteWarm,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=12  brand name ----
  layers.push({
    kind: "text",
    id: "layer_brand_name",
    name: "Brand name",
    left: layout.body.paddingLeft,
    top: layout.footer.top,
    width: layout.footer.brandWidth,
    height: layout.footer.brandFontSize + 12,
    angle: 0,
    opacity: 0.92,
    z: 12,
    visible: true,
    locked: false,
    text: "CENTURY 21 ALLIANCE",
    boundField: "office_name",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.footer.brandFontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteWarm,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 220,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=13  MLS number tag ----
  // why: design review 2026-05-17 — MLS removed from square + portrait feed
  // cards (it lives in the caption + hashtags anyway, and the card is more
  // readable without it). Kept visible on story format only because story
  // captions get truncated by the IG/FB Story UI, so the on-image hashtag
  // serves as the auto-link cue for the listing.
  layers.push({
    kind: "text",
    id: "layer_mls_number",
    name: "MLS #",
    left: layout.width - layout.footer.mlsRight - layout.footer.mlsWidth,
    top:
      layout.footer.top +
      Math.round(
        (layout.footer.brandFontSize - layout.footer.mlsFontSize) / 2,
      ),
    width: layout.footer.mlsWidth,
    height: layout.footer.mlsFontSize + 10,
    angle: 0,
    opacity: 0.7,
    z: 13,
    visible: format === "story_9x16",
    locked: false,
    text: "MLS #607680",
    boundField: "mls_number",
    fontFamily: ALLIANCE_FONTS.monoNum,
    fontSize: layout.footer.mlsFontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteDim,
    textAlign: "right",
    lineHeight: 1.2,
    charSpacing: 160,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=14/15  badge stamp (only when configured) ----
  if (cfg.badge) {
    layers.push({
      kind: "shape",
      id: "layer_badge_shape",
      name: "Badge stamp",
      left: layout.badge.left,
      top: layout.badge.top,
      width: layout.badge.width,
      height: layout.badge.height,
      angle: layout.badge.angle,
      opacity: 0.95,
      z: 14,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: cfg.badge.fill,
      stroke: ALLIANCE_COLORS.white,
      strokeWidth: 4,
      cornerRadius: 6,
      strokeDashArray: [],
    });
    layers.push({
      kind: "text",
      id: "layer_badge_text",
      name: "Badge text",
      left: layout.badge.left,
      top:
        layout.badge.top +
        Math.round((layout.badge.height - layout.badge.fontSize) / 2),
      width: layout.badge.width,
      height: layout.badge.fontSize + 8,
      angle: layout.badge.angle,
      opacity: 1,
      z: 15,
      visible: true,
      locked: false,
      text: cfg.badge.text,
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.badge.fontSize,
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
    id: `canvas_${cfg.idPrefix}_v2_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Bold Stats · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v2",
    format,
    width: layout.width,
    height: layout.height,
    backgroundColor: "#FFFFFF",
    backgroundImage: null,
    updatedAt: "2026-05-15T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: all 5 post types × 3 formats = 15 bold-stats templates.
 * The registry calls this once at module-load time alongside the v1 + v3
 * factory outputs.
 */
export function buildAllBoldStatsTemplates(): CanvasTemplateSchema[] {
  const postTypes: PostType[] = [
    "just_listed",
    "just_sold",
    "under_contract",
    "open_house",
    "price_reduction",
  ];
  const formats: PostFormat[] = ["square_1x1", "portrait_4x5", "story_9x16"];
  const out: CanvasTemplateSchema[] = [];
  for (const pt of postTypes) {
    for (const f of formats) {
      out.push(createBoldStatsTemplate(pt, f));
    }
  }
  return out;
}
