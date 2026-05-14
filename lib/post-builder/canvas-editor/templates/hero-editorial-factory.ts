/**
 * Hero Editorial template factory — `createHeroEditorialTemplate(postType, format)`
 * ------------------------------------------------------------------------------
 *
 * One factory function that generates the v1 "Hero Editorial" canvas-editor
 * template for ANY of the 5 post types × 3 formats = 15 templates total.
 *
 * Why a factory instead of 15 hand-authored files:
 *   - The visual language (full-bleed hero photo + dark scrim + gold accent rule
 *     + stacked type along the bottom band) is identical across post types.
 *   - The only post-type-specific bits are: eyebrow label text, price layer
 *     mode (list / close / "Under Contract" label), an optional badge stamp
 *     (SOLD or ↓ NEW PRICE), and the open-house date/time line.
 *   - Adding a 6th post type later is a one-line config addition here instead
 *     of 3 new files.
 *
 * Layout numbers were lifted verbatim from the original hand-authored files:
 *   just-listed-hero-square.ts / -portrait.ts / -story.ts (deleted now that
 *   they're factory-generated). Anyone who needs to recover the exact pre-
 *   refactor schemas can pull them from git history at the previous commit.
 *
 * Coordinate system: top-left origin, pixels at canvas logical resolution.
 * See lib/post-builder/canvas-editor/types.ts for the full schema contract.
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
  /** Dark scrim band at the bottom — covers the type stack so it's legible. */
  scrim: { top: number; height: number };
  /** Eyebrow block (gold rule + status label) lives in the top-left padding. */
  eyebrow: { left: number; ruleTop: number; ruleWidth: number; labelTop: number; labelFontSize: number };
  /** Body type stack along the bottom band — address, city, price, beds/baths. */
  body: {
    paddingLeft: number;
    paddingRight: number;
    address: { top: number; fontSize: number };
    cityStateZip: { top: number; fontSize: number };
    price: { top: number; fontSize: number };
    bedsBaths: { top: number; fontSize: number };
  };
  /** Footer line — office name on left/right, MLS code below. */
  footer: {
    officeTop: number;
    mlsTop: number;
    officeFontSize: number;
    mlsFontSize: number;
    officeAlign: "left" | "right";
    officeLeft: number;
    officeWidth: number;
  };
  /** Optional open-house date/time slot — inserted between cityStateZip and price. */
  openHouse: { top: number; fontSize: number };
  /** Badge stamp position when a badge is configured (Just Sold, Price Reduction). */
  badge: { left: number; top: number; width: number; height: number; angle: number; fontSize: number };
}

const LAYOUTS: Record<PostFormat, FormatLayout> = {
  square_1x1: {
    width: 1080,
    height: 1080,
    scrim: { top: 700, height: 380 },
    eyebrow: { left: 60, ruleTop: 60, ruleWidth: 56, labelTop: 78, labelFontSize: 24 },
    body: {
      paddingLeft: 60,
      paddingRight: 60,
      address: { top: 760, fontSize: 56 },
      cityStateZip: { top: 840, fontSize: 24 },
      price: { top: 900, fontSize: 72 },
      bedsBaths: { top: 1010, fontSize: 20 },
    },
    footer: {
      officeTop: 1010,
      mlsTop: 1042,
      officeFontSize: 14,
      mlsFontSize: 11,
      officeAlign: "right",
      officeLeft: 760,
      officeWidth: 260,
    },
    openHouse: { top: 880, fontSize: 22 },
    badge: { left: 760, top: 80, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
  portrait_4x5: {
    width: 1080,
    height: 1350,
    scrim: { top: 880, height: 470 },
    eyebrow: { left: 60, ruleTop: 60, ruleWidth: 64, labelTop: 80, labelFontSize: 26 },
    body: {
      paddingLeft: 60,
      paddingRight: 60,
      address: { top: 960, fontSize: 64 },
      cityStateZip: { top: 1055, fontSize: 26 },
      price: { top: 1125, fontSize: 84 },
      bedsBaths: { top: 1255, fontSize: 22 },
    },
    footer: {
      officeTop: 1255,
      mlsTop: 1290,
      officeFontSize: 14,
      mlsFontSize: 11,
      officeAlign: "right",
      officeLeft: 720,
      officeWidth: 300,
    },
    openHouse: { top: 1100, fontSize: 24 },
    badge: { left: 800, top: 100, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
  story_9x16: {
    width: 1080,
    height: 1920,
    scrim: { top: 1120, height: 800 },
    eyebrow: { left: 80, ruleTop: 140, ruleWidth: 72, labelTop: 165, labelFontSize: 32 },
    body: {
      paddingLeft: 80,
      paddingRight: 80,
      address: { top: 1220, fontSize: 76 },
      cityStateZip: { top: 1340, fontSize: 32 },
      price: { top: 1430, fontSize: 108 },
      bedsBaths: { top: 1590, fontSize: 28 },
    },
    footer: {
      officeTop: 1700,
      mlsTop: 1740,
      officeFontSize: 18,
      mlsFontSize: 14,
      officeAlign: "left",
      officeLeft: 80,
      officeWidth: 920,
    },
    openHouse: { top: 1400, fontSize: 30 },
    badge: { left: 760, top: 200, width: 280, height: 120, angle: -8, fontSize: 56 },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming
// ---------------------------------------------------------------------------

interface BadgeConfig {
  text: string;
  /** Fill color (hex). White text always — pairs with red/green/dark. */
  fill: string;
}

interface PriceConfig {
  /** Which value populates the price slot. "label" uses the literal text below. */
  mode: "list" | "close" | "label";
  /** Fallback text — also used as the literal display before hydration. */
  fallbackText: string;
  /** Bound field name when mode is "list" or "close". */
  boundField: "price" | "close_price" | null;
}

interface PostTypeConfig {
  /** Status-label eyebrow ("JUST LISTED" etc). */
  eyebrow: string;
  /** Price layer behavior. */
  price: PriceConfig;
  /** Optional badge stamp drawn over the photo. */
  badge: BadgeConfig | null;
  /** When true, an open-house date/time line is inserted into the body stack. */
  showOpenHouseLine: boolean;
  /** Display name suffix used for the template name + id. */
  templateNamePrefix: string;
  /** Template id prefix — drives findCanvasTemplate(); MUST match the PostType. */
  idPrefix: PostType;
  /** One-sentence description shown in the templates panel. */
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
      `${describeFormat(f)} hero — full-bleed photo with a dark scrim and gold-accented type along the bottom band.`,
  },
  just_sold: {
    eyebrow: "JUST SOLD",
    price: { mode: "close", fallbackText: "$905,000", boundField: "close_price" },
    badge: { text: "SOLD", fill: "#B91C1C" }, // red-700 — reads as final
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} closed-deal hero — red SOLD stamp over the photo, close price in gold along the bottom.`,
  },
  under_contract: {
    eyebrow: "UNDER CONTRACT",
    price: { mode: "label", fallbackText: "Under Contract", boundField: null },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} pipeline-status hero — "Under Contract" replaces the price slot; rest of the layout matches Just Listed.`,
  },
  open_house: {
    eyebrow: "OPEN HOUSE",
    price: { mode: "list", fallbackText: "$929,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} open-house hero — adds a date/time line above the price so the showing details lead.`,
  },
  price_reduction: {
    eyebrow: "PRICE REDUCED",
    price: { mode: "list", fallbackText: "$899,000", boundField: "price" },
    badge: { text: "↓ NEW PRICE", fill: "#15803D" }, // green-700 — reads as value/opportunity
    showOpenHouseLine: false,
    templateNamePrefix: "Price Reduced",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} reduction hero — green ↓ NEW PRICE stamp over the photo, refreshed list price below.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the canvas template for a given (postType, format) tuple. The result
 * is a full `CanvasTemplateSchema` ready to hand to the editor.
 *
 * Layer z-order:
 *   z=0  hero_photo
 *   z=1  dark_overlay (scrim)
 *   z=2  eyebrow_rule (gold)
 *   z=3  status_label (eyebrow text)
 *   z=4  address
 *   z=5  city/state/zip
 *   z=6  open_house_line (only when showOpenHouseLine)
 *   z=7  price
 *   z=8  beds/baths
 *   z=9  office_footer
 *   z=10 mls_number
 *   z=11 badge_shape (only when badge configured) — sits ABOVE everything
 *   z=12 badge_text   (only when badge configured)
 */
export function createHeroEditorialTemplate(
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

  const layers: CanvasLayer[] = [
    // ---- z=0  hero photo ----
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
    // ---- z=1  dark scrim ----
    {
      kind: "shape",
      id: "layer_dark_overlay",
      name: "Dark overlay",
      left: 0,
      top: layout.scrim.top,
      width: layout.width,
      height: layout.scrim.height,
      angle: 0,
      opacity: 0.65,
      z: 1,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.blackAt65,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
    // ---- z=2  gold rule above eyebrow ----
    {
      kind: "shape",
      id: "layer_eyebrow_rule",
      name: "Gold accent rule",
      left: layout.eyebrow.left,
      top: layout.eyebrow.ruleTop,
      width: layout.eyebrow.ruleWidth,
      height: 4,
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
    // ---- z=3  eyebrow status label ----
    {
      kind: "text",
      id: "layer_status_label",
      name: "Status label",
      left: layout.eyebrow.left,
      top: layout.eyebrow.labelTop,
      width: 500,
      height: layout.eyebrow.labelFontSize + 12,
      angle: 0,
      opacity: 1,
      z: 3,
      visible: true,
      locked: false,
      text: cfg.eyebrow,
      boundField: "status_label",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.eyebrow.labelFontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.white,
      textAlign: "left",
      lineHeight: 1.1,
      charSpacing: 300,
      underline: false,
      linethrough: false,
      editable: true,
    },
    // ---- z=4  address ----
    {
      kind: "text",
      id: "layer_address_line",
      name: "Address",
      left: layout.body.paddingLeft,
      top: layout.body.address.top,
      width: layout.width - layout.body.paddingLeft - layout.body.paddingRight,
      height: layout.body.address.fontSize + 14,
      angle: 0,
      opacity: 1,
      z: 4,
      visible: true,
      locked: false,
      text: "117 E Maple Ave",
      boundField: "address_line1",
      fontFamily: ALLIANCE_FONTS.displaySerif,
      fontSize: layout.body.address.fontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.white,
      textAlign: "left",
      lineHeight: 1.1,
      charSpacing: 0,
      underline: false,
      linethrough: false,
      editable: true,
    },
    // ---- z=5  city/state/zip ----
    {
      kind: "text",
      id: "layer_city_state_zip",
      name: "City · State · Zip",
      left: layout.body.paddingLeft,
      top: layout.body.cityStateZip.top,
      width: layout.width - layout.body.paddingLeft - layout.body.paddingRight,
      height: layout.body.cityStateZip.fontSize + 14,
      angle: 0,
      opacity: 1,
      z: 5,
      visible: true,
      locked: false,
      text: "Wildwood, NJ 08260",
      boundField: "city_state_zip",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.body.cityStateZip.fontSize,
      fontWeight: 400,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.whiteDim,
      textAlign: "left",
      lineHeight: 1.2,
      charSpacing: 100,
      underline: false,
      linethrough: false,
      editable: true,
    },
  ];

  // ---- z=6  open-house line (only when configured) ----
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "text",
      id: "layer_open_house_line",
      name: "Open House date/time",
      left: layout.body.paddingLeft,
      top: layout.openHouse.top,
      width: layout.width - layout.body.paddingLeft - layout.body.paddingRight,
      height: layout.openHouse.fontSize + 14,
      angle: 0,
      opacity: 1,
      z: 6,
      visible: true,
      locked: false,
      text: "Saturday · 11:00 AM – 1:00 PM",
      boundField: "open_house_date",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.openHouse.fontSize,
      fontWeight: 600,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.gold500,
      textAlign: "left",
      lineHeight: 1.2,
      charSpacing: 200,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=7  price ----
  // Why: Under Contract uses a literal label ("Under Contract") instead of
  // binding to a price field. The user can override the text in the editor.
  layers.push({
    kind: "text",
    id: "layer_price",
    name: cfg.price.mode === "label" ? "Status (Under Contract)" : "Price",
    left: layout.body.paddingLeft,
    top: layout.body.price.top,
    width: 700,
    height: layout.body.price.fontSize + 18,
    angle: 0,
    opacity: 1,
    z: 7,
    visible: true,
    locked: false,
    text: cfg.price.fallbackText,
    // Only set boundField when we're binding to actual price data
    ...(cfg.price.boundField ? { boundField: cfg.price.boundField } : {}),
    fontFamily: ALLIANCE_FONTS.displaySerif,
    fontSize: cfg.price.mode === "label" ? Math.round(layout.body.price.fontSize * 0.72) : layout.body.price.fontSize,
    fontWeight: 800,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "left",
    lineHeight: 1.05,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=8  beds/baths ----
  layers.push({
    kind: "text",
    id: "layer_beds_baths",
    name: "Beds · Baths",
    left: layout.body.paddingLeft,
    top: layout.body.bedsBaths.top,
    width: 600,
    height: layout.body.bedsBaths.fontSize + 12,
    angle: 0,
    opacity: 0.95,
    z: 8,
    visible: true,
    locked: false,
    text: "4 BR / 3 BA",
    boundField: "beds_baths",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.body.bedsBaths.fontSize,
    fontWeight: 500,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=9  office footer ----
  layers.push({
    kind: "text",
    id: "layer_office_footer",
    name: "Office",
    left: layout.footer.officeLeft,
    top: layout.footer.officeTop,
    width: layout.footer.officeWidth,
    height: layout.footer.officeFontSize + 14,
    angle: 0,
    opacity: 0.9,
    z: 9,
    visible: true,
    locked: false,
    text: "CENTURY 21 ALLIANCE",
    boundField: "office_name",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.footer.officeFontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteDim,
    textAlign: layout.footer.officeAlign,
    lineHeight: 1.2,
    charSpacing: 300,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=10  mls number ----
  layers.push({
    kind: "text",
    id: "layer_mls_number",
    name: "MLS #",
    left: layout.footer.officeLeft,
    top: layout.footer.mlsTop,
    width: layout.footer.officeWidth,
    height: layout.footer.mlsFontSize + 10,
    angle: 0,
    opacity: 0.7,
    z: 10,
    visible: true,
    locked: false,
    text: "MLS #607680",
    boundField: "mls_number",
    fontFamily: ALLIANCE_FONTS.monoNum,
    fontSize: layout.footer.mlsFontSize,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteDim,
    textAlign: layout.footer.officeAlign,
    lineHeight: 1.2,
    charSpacing: 100,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=11 + z=12  badge stamp (only when configured) ----
  // Why: drawn as a tilted rect + white text on top so it reads as a stamp
  // over the photo. User can move/rotate either layer in the editor. We push
  // these LAST so they sit above everything — including the scrim, in case
  // the user repositions the badge into the bottom band.
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
      z: 11,
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
      top: layout.badge.top + Math.round((layout.badge.height - layout.badge.fontSize) / 2),
      width: layout.badge.width,
      height: layout.badge.fontSize + 8,
      angle: layout.badge.angle,
      opacity: 1,
      z: 12,
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
    id: `canvas_${cfg.idPrefix}_v1_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Hero Editorial · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v1",
    format,
    width: layout.width,
    height: layout.height,
    backgroundColor: "#FFFFFF",
    backgroundImage: null,
    updatedAt: "2026-05-14T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: all 5 post types × 3 formats = 15 hero-editorial templates.
 * The registry calls this once at module-load time.
 */
export function buildAllHeroEditorialTemplates(): CanvasTemplateSchema[] {
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
      out.push(createHeroEditorialTemplate(pt, f));
    }
  }
  return out;
}
