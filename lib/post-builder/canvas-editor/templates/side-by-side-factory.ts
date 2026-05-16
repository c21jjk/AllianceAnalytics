/**
 * Side-by-Side template factory — `createSideBySideTemplate(postType, format)`
 * ------------------------------------------------------------------------------
 *
 * v3 Side-by-Side — the "magazine listing card" layout. Photo column on the
 * left, structured data card on the right, with a gold accent border on the
 * data card's photo-facing edge. The variant's defining detail is the
 * label-value stat list (BEDS / BATHS / TYPE) — a vertical stack of small
 * label/value pairs separated by thin dividers, lifted directly from the
 * V1 HTML primitive. That structured detail is what makes v3 feel distinct
 * from v1 (everything over a photo) and v2 (oversized type on a dark pane).
 *
 * Generates 15 templates: 5 post types × 3 formats.
 *
 * Design parity with the V1 HTML primitive (`primitives/v3-side-by-side*.ts`):
 *   • Square + Portrait keep the horizontal 55/45 split (photo left,
 *     data right). 4px gold border on the data column's left edge.
 *   • **Story 9:16 transforms to a vertical split** — photo on top
 *     (0→1140), cream data card on the bottom (1140→1720) with the gold
 *     accent flipped to a top border. True side-by-side at 9:16 reads
 *     badly and clashes with platform safe zones; preserving the data
 *     card's IDENTITY (cream surface, gold accent, structured stats) is
 *     what matters. Canva-mindset call: respect the canvas.
 *   • V1's structured stats (BEDS / BATHS / TYPE label-value pairs with
 *     thin dividers) survive in Square + Portrait. Story drops the TYPE
 *     row because the vertical real estate is tighter — keeps the layout
 *     uncluttered at smaller scale.
 *   • V1's "21" brand glyph is dropped here in favor of a text-only
 *     footer, same call as bold-stats-factory. Identification rides on
 *     the office_name binding.
 *
 * Layer numbering (z) — horizontal mode (square + portrait):
 *   z=0  photo (left column, cropped)
 *   z=1  photo tint
 *   z=2  eyebrow rule (over photo)
 *   z=3  eyebrow text (over photo)
 *   z=4  data column background (cream)
 *   z=5  gold accent border (4px, photo-facing edge of data column)
 *   z=6  optional open-house chip rect
 *   z=7  optional open-house chip text
 *   z=8  secondary eyebrow (gold, inside data column)
 *   z=9  address
 *   z=10 city/state/zip
 *   z=11 gold rule (inside data column)
 *   z=12 price
 *   z=13 stat row 1 label ("BEDS")
 *   z=14 stat row 1 value
 *   z=15 stat row 1 divider (thin line)
 *   z=16 stat row 2 label ("BATHS")
 *   z=17 stat row 2 value
 *   z=18 stat row 2 divider (omitted in story mode)
 *   z=19 stat row 3 label ("TYPE")    (omitted in story mode)
 *   z=20 stat row 3 value             (omitted in story mode)
 *   z=21 brand name
 *   z=22 mls number tag
 *   z=23 badge stamp shape            (only when badge configured)
 *   z=24 badge stamp text             (only when badge configured)
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

/** Whether the photo + data card sit side-by-side ("horizontal") or stacked. */
type LayoutMode = "horizontal" | "vertical";

interface HorizontalSplit {
  mode: "horizontal";
  /** Right edge of the photo column / left edge of the data column. */
  splitX: number;
  /** Width of the data column. */
  dataWidth: number;
}

interface VerticalSplit {
  mode: "vertical";
  /** Bottom of the photo / top of the data card. */
  splitY: number;
  /** Height of the data card (= canvas height - splitY - bottomSafeMargin). */
  dataHeight: number;
}

type SplitConfig = HorizontalSplit | VerticalSplit;

interface FormatLayout {
  width: number;
  height: number;
  split: SplitConfig;
  /** Padding inside the data card. */
  dataPad: { left: number; right: number; top: number; bottom: number };
  /** Photo column eyebrow (over the photo). */
  photoEyebrow: {
    left: number;
    ruleTop: number;
    ruleWidth: number;
    labelTop: number;
    labelFontSize: number;
  };
  /** Subtle tint over the photo, kept light so the photo still leads. */
  photoTint: { top: number; height: number; opacity: number };
  /** Data card secondary eyebrow (gold, above the address). */
  dataEyebrow: { top: number; fontSize: number };
  /** Optional open-house chip — positioned above the secondary eyebrow. */
  openHouseChip: {
    top: number;
    height: number;
    fontSize: number;
    width: number;
  };
  address: { top: number; fontSize: number };
  cityStateZip: { top: number; fontSize: number };
  goldRule: { top: number; width: number };
  price: { top: number; fontSize: number };
  /** Stat list — anchored y, row height, label/value font sizes. */
  stats: {
    top: number;
    rowHeight: number;
    labelFontSize: number;
    valueFontSize: number;
    /** When false, omit the TYPE row (Story uses 2-row stats). */
    includeTypeRow: boolean;
  };
  /** Footer line — brand on left, MLS on right inside the data card. */
  footer: {
    top: number;
    brandFontSize: number;
    mlsFontSize: number;
  };
  /** Badge stamp anchor — straddles the photo / data boundary. */
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
    split: { mode: "horizontal", splitX: 594, dataWidth: 486 },
    dataPad: { left: 48, right: 48, top: 96, bottom: 56 },
    photoEyebrow: {
      left: 48,
      ruleTop: 64,
      ruleWidth: 50,
      labelTop: 80,
      labelFontSize: 20,
    },
    photoTint: { top: 0, height: 220, opacity: 0.35 },
    dataEyebrow: { top: 132, fontSize: 14 },
    openHouseChip: { top: 100, height: 40, fontSize: 18, width: 280 },
    address: { top: 178, fontSize: 40 },
    cityStateZip: { top: 252, fontSize: 16 },
    goldRule: { top: 296, width: 60 },
    price: { top: 320, fontSize: 52 },
    stats: {
      top: 420,
      rowHeight: 56,
      labelFontSize: 12,
      valueFontSize: 22,
      includeTypeRow: true,
    },
    footer: {
      top: 982,
      brandFontSize: 15,
      mlsFontSize: 13,
    },
    // why: badge straddles the photo column / data column boundary so it
    // reads as a magazine "stamp." Matches V1 v3's `.badge-stamp` override.
    badge: { left: 414, top: 96, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
  portrait_4x5: {
    width: 1080,
    height: 1350,
    split: { mode: "horizontal", splitX: 594, dataWidth: 486 },
    dataPad: { left: 48, right: 48, top: 112, bottom: 64 },
    photoEyebrow: {
      left: 56,
      ruleTop: 72,
      ruleWidth: 56,
      labelTop: 90,
      labelFontSize: 22,
    },
    photoTint: { top: 0, height: 260, opacity: 0.35 },
    dataEyebrow: { top: 154, fontSize: 15 },
    openHouseChip: { top: 116, height: 44, fontSize: 20, width: 320 },
    address: { top: 208, fontSize: 46 },
    cityStateZip: { top: 290, fontSize: 18 },
    goldRule: { top: 340, width: 68 },
    price: { top: 370, fontSize: 60 },
    stats: {
      top: 488,
      rowHeight: 64,
      labelFontSize: 13,
      valueFontSize: 24,
      includeTypeRow: true,
    },
    footer: {
      top: 1240,
      brandFontSize: 16,
      mlsFontSize: 14,
    },
    badge: { left: 410, top: 116, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
  // why: Story 9:16 transforms to a vertical split — photo top, cream card
  // bottom with a gold TOP border instead of a left border. The 580px-tall
  // data card hosts the eyebrow + address + city + price + 2 stat rows +
  // footer above the bottom safe zone (1720). 3 stat rows would crowd the
  // card; we drop the TYPE row but keep BEDS/BATHS for the variant's
  // characteristic structured-list look.
  story_9x16: {
    width: 1080,
    height: 1920,
    split: { mode: "vertical", splitY: 1140, dataHeight: 580 },
    dataPad: { left: 80, right: 80, top: 56, bottom: 32 },
    photoEyebrow: {
      left: 80,
      ruleTop: 156,
      ruleWidth: 72,
      labelTop: 182,
      labelFontSize: 30,
    },
    photoTint: { top: 0, height: 280, opacity: 0.4 },
    dataEyebrow: { top: 1180, fontSize: 18 },
    openHouseChip: { top: 1156, height: 52, fontSize: 24, width: 420 },
    address: { top: 1216, fontSize: 60 },
    cityStateZip: { top: 1294, fontSize: 22 },
    goldRule: { top: 1342, width: 92 },
    price: { top: 1366, fontSize: 76 },
    stats: {
      top: 1480,
      rowHeight: 60,
      labelFontSize: 14,
      valueFontSize: 28,
      includeTypeRow: false,
    },
    footer: {
      top: 1666,
      brandFontSize: 20,
      mlsFontSize: 18,
    },
    // why: Story badge sits in the upper-right of the photo half, away from
    // both top safe zone (≤250) AND the data card top boundary at y=1140.
    badge: { left: 760, top: 320, width: 280, height: 120, angle: -8, fontSize: 56 },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming — same shape as bold-stats-factory + hero-editorial.
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
      `${describeFormat(f)} side-by-side — photo column, cream data card with structured BEDS/BATHS list and a gold accent border.`,
  },
  just_sold: {
    eyebrow: "JUST SOLD",
    price: { mode: "close", fallbackText: "$905,000", boundField: "close_price" },
    badge: { text: "SOLD", fill: "#B91C1C" },
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} closed-deal side-by-side — red SOLD stamp on the boundary, close price in the data card.`,
  },
  under_contract: {
    eyebrow: "UNDER CONTRACT",
    price: { mode: "label", fallbackText: "Under Contract", boundField: null },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} pipeline-status side-by-side — "Under Contract" sits in the price slot of the data card.`,
  },
  open_house: {
    eyebrow: "OPEN HOUSE",
    price: { mode: "list", fallbackText: "$929,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} open-house side-by-side — gold date/time chip leads the data card above the secondary eyebrow.`,
  },
  price_reduction: {
    eyebrow: "PRICE REDUCED",
    price: { mode: "list", fallbackText: "$899,000", boundField: "price" },
    badge: { text: "↓ NEW PRICE", fill: "#15803D" },
    showOpenHouseLine: false,
    templateNamePrefix: "Price Reduced",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} reduction side-by-side — green ↓ NEW PRICE stamp on the boundary, refreshed list price in the data card.`,
  },
};

// ---------------------------------------------------------------------------
// Stat-row layer helpers
// ---------------------------------------------------------------------------

/** Layer kind for the stat-row dividers — kept as a single helper so the
 *  three (or two) divider lines in each template are shaped identically. */
function buildStatDivider(
  layout: FormatLayout,
  dataLeft: number,
  dataInnerWidth: number,
  top: number,
  zIndex: number,
  rowIndex: number,
): CanvasLayer {
  return {
    kind: "shape",
    id: `layer_stat_divider_${rowIndex}`,
    name: `Stat divider ${rowIndex}`,
    left: dataLeft + layout.dataPad.left,
    top,
    width: dataInnerWidth,
    height: 1,
    angle: 0,
    opacity: 1,
    z: zIndex,
    visible: true,
    locked: false,
    shapeType: "rect",
    fill: "#E5E5E2",
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 0,
    strokeDashArray: [],
  };
}

interface StatRowConfig {
  label: string;
  fallbackValue: string;
  boundField: "beds" | "baths" | "property_type";
}

function buildStatRow(
  layout: FormatLayout,
  dataLeft: number,
  dataInnerWidth: number,
  rowTop: number,
  zLabel: number,
  zValue: number,
  rowIndex: number,
  cfg: StatRowConfig,
): CanvasLayer[] {
  // why: label is left-aligned at the start of the row, value is
  // right-aligned at the end. The visual is "BEDS .................. 4" —
  // a tabular look the reader's eye scans top-to-bottom.
  const labelWidth = Math.round(dataInnerWidth * 0.55);
  const valueWidth = dataInnerWidth - labelWidth;
  return [
    {
      kind: "text",
      id: `layer_stat_${rowIndex}_label`,
      name: `${cfg.label} label`,
      left: dataLeft + layout.dataPad.left,
      top: rowTop,
      width: labelWidth,
      height: layout.stats.labelFontSize + 10,
      angle: 0,
      opacity: 1,
      z: zLabel,
      visible: true,
      locked: false,
      text: cfg.label,
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.stats.labelFontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: "#737370",
      textAlign: "left",
      lineHeight: 1.2,
      charSpacing: 200,
      underline: false,
      linethrough: false,
      editable: true,
    },
    {
      kind: "text",
      id: `layer_stat_${rowIndex}_value`,
      name: `${cfg.label} value`,
      left: dataLeft + layout.dataPad.left + labelWidth,
      // why: value sits a touch higher than label to optically center on
      // the row baseline — the value's larger fontSize would otherwise
      // render lower than the small uppercase label.
      top:
        rowTop -
        Math.round((layout.stats.valueFontSize - layout.stats.labelFontSize) / 2),
      width: valueWidth,
      height: layout.stats.valueFontSize + 10,
      angle: 0,
      opacity: 1,
      z: zValue,
      visible: true,
      locked: false,
      text: cfg.fallbackValue,
      boundField: cfg.boundField,
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.stats.valueFontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "right",
      lineHeight: 1.1,
      charSpacing: -10,
      underline: false,
      linethrough: false,
      editable: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSideBySideTemplate(
  postType: PostType,
  format: PostFormat,
): CanvasTemplateSchema {
  const layout = LAYOUTS[format];
  const cfg = POST_TYPE_CONFIGS[postType];
  const split = layout.split;

  const formatShort: Record<PostFormat, string> = {
    square_1x1: "square",
    portrait_4x5: "portrait",
    story_9x16: "story",
  };

  // ---- Geometry for the photo + data card depending on split mode ----
  const photoLeft = 0;
  const photoTop = 0;
  const photoWidth = split.mode === "horizontal" ? split.splitX : layout.width;
  const photoHeight =
    split.mode === "horizontal" ? layout.height : split.splitY;

  const dataLeft = split.mode === "horizontal" ? split.splitX : 0;
  const dataTop = split.mode === "horizontal" ? 0 : split.splitY;
  const dataWidth =
    split.mode === "horizontal" ? split.dataWidth : layout.width;
  const dataHeight =
    split.mode === "horizontal" ? layout.height : split.dataHeight;
  const dataInnerWidth = dataWidth - layout.dataPad.left - layout.dataPad.right;

  // Gold accent — left edge of the data column for horizontal, top edge
  // for vertical. 4px thick either way.
  const accent =
    split.mode === "horizontal"
      ? {
          left: dataLeft,
          top: 0,
          width: 4,
          height: layout.height,
        }
      : {
          left: 0,
          top: split.splitY,
          width: layout.width,
          height: 4,
        };

  const layers: CanvasLayer[] = [
    // ---- z=0  photo ----
    {
      kind: "image",
      id: "layer_hero_photo",
      name: "Hero photo",
      left: photoLeft,
      top: photoTop,
      width: photoWidth,
      height: photoHeight,
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
    // ---- z=1  photo tint ----
    {
      kind: "shape",
      id: "layer_photo_tint",
      name: "Photo tint",
      left: photoLeft,
      top: layout.photoTint.top,
      width: photoWidth,
      height: layout.photoTint.height,
      angle: 0,
      opacity: layout.photoTint.opacity,
      z: 1,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: "#000000",
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
    // ---- z=2  eyebrow rule (over photo) ----
    {
      kind: "shape",
      id: "layer_photo_eyebrow_rule",
      name: "Photo eyebrow rule",
      left: layout.photoEyebrow.left,
      top: layout.photoEyebrow.ruleTop,
      width: layout.photoEyebrow.ruleWidth,
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
    // ---- z=3  eyebrow text (over photo) ----
    {
      kind: "text",
      id: "layer_photo_eyebrow_text",
      name: "Photo eyebrow",
      left: layout.photoEyebrow.left,
      top: layout.photoEyebrow.labelTop,
      width: 500,
      height: layout.photoEyebrow.labelFontSize + 14,
      angle: 0,
      opacity: 1,
      z: 3,
      visible: true,
      locked: false,
      text: cfg.eyebrow,
      // why: NO boundField — status_label hydrates from listing.status,
      // not the POST category. Literal cfg.eyebrow is the source of truth.
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.photoEyebrow.labelFontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.whiteWarm,
      textAlign: "left",
      lineHeight: 1.1,
      charSpacing: 300,
      underline: false,
      linethrough: false,
      editable: true,
    },
    // ---- z=4  data card background (cream) ----
    {
      kind: "shape",
      id: "layer_data_card",
      name: "Data card",
      left: dataLeft,
      top: dataTop,
      width: dataWidth,
      height: dataHeight,
      angle: 0,
      opacity: 1,
      z: 4,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: "#FCFCFB",
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
    // ---- z=5  gold accent border ----
    {
      kind: "shape",
      id: "layer_gold_accent",
      name: "Gold accent",
      left: accent.left,
      top: accent.top,
      width: accent.width,
      height: accent.height,
      angle: 0,
      opacity: 1,
      z: 5,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
  ];

  // ---- z=6/7  open-house chip (only when configured) ----
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "shape",
      id: "layer_open_house_chip_bg",
      name: "Open House chip",
      left: dataLeft + layout.dataPad.left,
      top: layout.openHouseChip.top,
      width: layout.openHouseChip.width,
      height: layout.openHouseChip.height,
      angle: 0,
      opacity: 1,
      z: 6,
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
      left: dataLeft + layout.dataPad.left + 14,
      top:
        layout.openHouseChip.top +
        Math.round(
          (layout.openHouseChip.height - layout.openHouseChip.fontSize) / 2,
        ),
      width: layout.openHouseChip.width - 28,
      height: layout.openHouseChip.fontSize + 8,
      angle: 0,
      opacity: 1,
      z: 7,
      visible: true,
      locked: false,
      text: "Saturday · 11:00 AM – 1:00 PM",
      boundField: "open_house_date",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.openHouseChip.fontSize,
      fontWeight: 800,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "left",
      lineHeight: 1,
      charSpacing: 160,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=8  secondary eyebrow (gold, inside data card) ----
  layers.push({
    kind: "text",
    id: "layer_data_eyebrow",
    name: "Data eyebrow",
    left: dataLeft + layout.dataPad.left,
    top: layout.dataEyebrow.top,
    width: dataInnerWidth,
    height: layout.dataEyebrow.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 8,
    visible: true,
    locked: false,
    text: cfg.eyebrow,
    // why: NO boundField — see hero-editorial-factory note.
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.dataEyebrow.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold600,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 320,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=9  address ----
  layers.push({
    kind: "text",
    id: "layer_address_line",
    name: "Address",
    left: dataLeft + layout.dataPad.left,
    top: layout.address.top,
    width: dataInnerWidth,
    height: layout.address.fontSize * 2 + 14,
    angle: 0,
    opacity: 1,
    z: 9,
    visible: true,
    locked: false,
    text: "117 E Maple Ave",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.address.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "left",
    lineHeight: 1.05,
    charSpacing: -20,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=10  city/state/zip ----
  layers.push({
    kind: "text",
    id: "layer_city_state_zip",
    name: "City · State · Zip",
    left: dataLeft + layout.dataPad.left,
    top: layout.cityStateZip.top,
    width: dataInnerWidth,
    height: layout.cityStateZip.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 10,
    visible: true,
    locked: false,
    text: "Wildwood, NJ 08260",
    boundField: "city_state_zip",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.cityStateZip.fontSize,
    fontWeight: 500,
    fontStyle: "normal",
    fill: "#525250",
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 100,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=11  gold rule (inside data card) ----
  layers.push({
    kind: "shape",
    id: "layer_data_gold_rule",
    name: "Gold rule",
    left: dataLeft + layout.dataPad.left,
    top: layout.goldRule.top,
    width: layout.goldRule.width,
    height: 3,
    angle: 0,
    opacity: 1,
    z: 11,
    visible: true,
    locked: false,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.gold500,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 2,
    strokeDashArray: [],
  });

  // ---- z=12  price ----
  layers.push({
    kind: "text",
    id: "layer_price",
    name: cfg.price.mode === "label" ? "Status (Under Contract)" : "Price",
    left: dataLeft + layout.dataPad.left,
    top: layout.price.top,
    width: dataInnerWidth,
    height: layout.price.fontSize + 18,
    angle: 0,
    opacity: 1,
    z: 12,
    visible: true,
    locked: false,
    text: cfg.price.fallbackText,
    ...(cfg.price.boundField ? { boundField: cfg.price.boundField } : {}),
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize:
      cfg.price.mode === "label"
        ? Math.round(layout.price.fontSize * 0.62)
        : layout.price.fontSize,
    fontWeight: 900,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold600,
    textAlign: "left",
    lineHeight: 1,
    charSpacing: cfg.price.mode === "label" ? 80 : -30,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=13..N  stat list (2 or 3 rows depending on format) ----
  const includeType = layout.stats.includeTypeRow;
  const rowDefs: StatRowConfig[] = includeType
    ? [
        { label: "BEDS", fallbackValue: "4", boundField: "beds" },
        { label: "BATHS", fallbackValue: "3", boundField: "baths" },
        { label: "TYPE", fallbackValue: "Single Family", boundField: "property_type" },
      ]
    : [
        { label: "BEDS", fallbackValue: "4", boundField: "beds" },
        { label: "BATHS", fallbackValue: "3", boundField: "baths" },
      ];

  let zCounter = 13;
  for (let i = 0; i < rowDefs.length; i++) {
    const rowTop = layout.stats.top + i * layout.stats.rowHeight;
    const rowLayers = buildStatRow(
      layout,
      dataLeft,
      dataInnerWidth,
      rowTop,
      zCounter,
      zCounter + 1,
      i + 1,
      rowDefs[i],
    );
    layers.push(...rowLayers);
    zCounter += 2;
    // why: add a divider between rows but NOT after the last row — the
    // section ends visually at the final value, not at another line.
    if (i < rowDefs.length - 1) {
      const dividerTop = rowTop + layout.stats.rowHeight - 12;
      layers.push(
        buildStatDivider(
          layout,
          dataLeft,
          dataInnerWidth,
          dividerTop,
          zCounter,
          i + 1,
        ),
      );
      zCounter += 1;
    }
  }

  // ---- footer brand name ----
  const footerBrandLeft = dataLeft + layout.dataPad.left;
  const footerBrandWidth = Math.round(dataInnerWidth * 0.62);
  const footerMlsLeft = footerBrandLeft + footerBrandWidth;
  const footerMlsWidth = dataInnerWidth - footerBrandWidth;
  layers.push({
    kind: "text",
    id: "layer_brand_name",
    name: "Brand name",
    left: footerBrandLeft,
    top: layout.footer.top,
    width: footerBrandWidth,
    height: layout.footer.brandFontSize + 10,
    angle: 0,
    opacity: 1,
    z: zCounter,
    visible: true,
    locked: false,
    text: "CENTURY 21 ALLIANCE",
    boundField: "office_name",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.footer.brandFontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  });
  zCounter += 1;

  // ---- footer MLS tag ----
  layers.push({
    kind: "text",
    id: "layer_mls_number",
    name: "MLS #",
    left: footerMlsLeft,
    top:
      layout.footer.top +
      Math.round((layout.footer.brandFontSize - layout.footer.mlsFontSize) / 2),
    width: footerMlsWidth,
    height: layout.footer.mlsFontSize + 10,
    angle: 0,
    opacity: 0.7,
    z: zCounter,
    visible: true,
    locked: false,
    text: "MLS #607680",
    boundField: "mls_number",
    fontFamily: ALLIANCE_FONTS.monoNum,
    fontSize: layout.footer.mlsFontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: "#737370",
    textAlign: "right",
    lineHeight: 1.2,
    charSpacing: 160,
    underline: false,
    linethrough: false,
    editable: true,
  });
  zCounter += 1;

  // ---- badge stamp (only when configured) ----
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
      z: zCounter,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: cfg.badge.fill,
      stroke: ALLIANCE_COLORS.white,
      strokeWidth: 4,
      cornerRadius: 6,
      strokeDashArray: [],
    });
    zCounter += 1;
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
      z: zCounter,
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
    id: `canvas_${cfg.idPrefix}_v3_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Side-by-Side · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v3",
    format,
    width: layout.width,
    height: layout.height,
    backgroundColor:
      split.mode === "horizontal" ? "#FCFCFB" : ALLIANCE_COLORS.ink900,
    backgroundImage: null,
    updatedAt: "2026-05-15T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: all 5 post types × 3 formats = 15 side-by-side templates.
 * The registry calls this once at module-load time alongside the v1 + v2
 * factory outputs.
 *
 * Reference for the unused-vars guard:
 *   `LayoutMode` is exposed at module scope so future variant authors can
 *   re-use the same horizontal/vertical split pattern without re-deriving
 *   the type union. Mark as exported even though the file doesn't read it
 *   internally to keep TS happy.
 */
export type { LayoutMode };
export function buildAllSideBySideTemplates(): CanvasTemplateSchema[] {
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
      out.push(createSideBySideTemplate(pt, f));
    }
  }
  return out;
}
