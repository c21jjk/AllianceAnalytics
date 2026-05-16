/**
 * Minimal Frame template factory — `createMinimalFrameTemplate(postType, format)`
 * ------------------------------------------------------------------------------
 *
 * v8 Minimal Frame — the "gallery-poster minimalism" layout. Extreme negative
 * space, a thin gold-rule frame around the hero photo, and a centered type
 * stack BELOW the photo. Think print-ad / museum placard. The architectural
 * choice is the most restrained of the catalog so far:
 *   • v1 Hero Editorial — full-bleed photo + dark scrim at the bottom
 *   • v2 Bold Stats     — 60/40 split, photo on top + dark data pane below
 *   • v3 Side By Side   — photo card next to a tall data card
 *   • v8 Minimal Frame  — light surface, framed photo island, type centered
 *                          below. Maximum breathing room.
 *
 * Generates 15 templates: 5 post types × 3 formats.
 *
 * Design parity with the V1 HTML primitives:
 *   `lib/post-builder/templates/primitives/v8-minimal-frame.ts`         (square)
 *   `lib/post-builder/templates/primitives/v8-minimal-frame-portrait.ts`
 *   `lib/post-builder/templates/primitives/v8-minimal-frame-story.ts`
 *
 *   • Near-white surface `#FCFCFB` (mirrors V1's `background: #FCFCFB`).
 *     No token matches this exact value — `ALLIANCE_COLORS.whiteWarm`
 *     is the warmer `#FBF7EE` used for on-photo text. We use a literal
 *     hex with a `// why:` comment per the template-author skill.
 *   • Gold-rule frame around the hero — a single ShapeLayer rect with empty
 *     fill and gold stroke. The V1 CSS uses `border: 2px solid <gold>` with
 *     12–14px padding to the photo — we mirror that by sizing the frame rect
 *     12–14px larger than the photo rect on all sides.
 *   • Eyebrow row ABOVE the frame: short gold rule + uppercase status label +
 *     short gold rule, all centered. We model this as three layers (left rule
 *     rect, label text, right rule rect) since the schema has no flex/gap.
 *   • Type stack centered BELOW the photo:
 *       - Address (Playfair Display, large serif, ink900)
 *       - City/State/Zip (muted, uppercase, tracked)
 *       - Optional Open House line (italic, gold) — only for open_house
 *       - Price (Playfair serif, gold) OR Label ("Under Contract", uppercase
 *         sans, gold) for under_contract
 *       - Beds/baths row (small, uppercase, tracked, muted)
 *   • Footer at the bottom, centered: "CENTURY 21 ALLIANCE" + MLS #, both
 *     uppercase, tracked, low-opacity ink. Two text layers stacked.
 *   • Badge stamp (just_sold + price_reduction) anchored top-right of the
 *     CANVAS — outside the gold frame — at angle: -8. Matches v1+v2 anchor
 *     convention so badges feel consistent across variants.
 *
 * Story-format note: V1 uses `STORY_SAFE_ZONE.top` (~250px) + 30 for the
 * eyebrow and `STORY_SAFE_ZONE.bottom` (~200px) + 30 for the footer. We bake
 * the same margins into the layout numbers below (eyebrow at y=280, footer
 * baseline at y=1690) so type stays clear of IG/FB UI overlays.
 *
 * Layer numbering (z) — kept monotonic for clarity, gaps allowed:
 *   z=0   background frame (gold-rule rectangle around hero — drawn FIRST so
 *         the photo layer paints over its interior, leaving only the border)
 *   z=1   hero photo (sits inside the frame's interior padding)
 *   z=2   eyebrow rule left
 *   z=3   eyebrow rule right
 *   z=4   eyebrow status label (between the two rules)
 *   z=5   address line (serif)
 *   z=6   city/state/zip
 *   z=7   open house line              (only when showOpenHouseLine)
 *   z=8   price (serif gold) OR label (sans gold)
 *   z=9   beds/baths row
 *   z=10  brand mark text
 *   z=11  MLS number text
 *   z=12  badge stamp rect             (only when badge configured)
 *   z=13  badge stamp text             (only when badge configured)
 *
 * The gold frame at z=0 with `fill: ""` (no fill) + gold stroke renders as
 * an outline only; the photo at z=1 then occupies the frame's interior. We
 * size the photo layer slightly smaller than the frame and position it inside
 * the frame's padding so visually there's breathing room between the gold
 * line and the photo's edge — matching V1's `padding: 12px` inside the frame.
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

/**
 * Layout numbers for a single format. Mirrors the inline pixel positions in
 * the V1 primitives but scaled / re-anchored to the canvas-editor's
 * top-left coordinate system (V1 uses CSS `transform: translateX(-50%)` for
 * centering; we precompute the left edge instead).
 */
interface FormatLayout {
  width: number;
  height: number;
  /** Eyebrow row — gold rules flanking the status label. */
  eyebrow: {
    /** Vertical center of the eyebrow row (rules + label baseline). */
    top: number;
    /** Length of each side rule, in px. */
    ruleWidth: number;
    /** Gap between the rule and the label text. */
    gap: number;
    /** Width allocated to the label text (centered between the two rules). */
    labelWidth: number;
    labelFontSize: number;
  };
  /**
   * Gold-rule frame around the hero photo. Defines the OUTER rectangle.
   * The photo layer is inset by `framePadding` on all sides so there is
   * breathing room between the gold stroke and the photo edge.
   */
  frame: {
    left: number;
    top: number;
    width: number;
    height: number;
    /** Distance from the frame's inner edge to the photo's outer edge. */
    padding: number;
    /** Stroke thickness, in px. */
    strokeWidth: number;
  };
  /** Type-stack positions below the framed photo. Centered horizontally. */
  body: {
    /** Left margin for the centered stack (right margin = same by symmetry). */
    horizontalMargin: number;
    address: { top: number; fontSize: number };
    cityStateZip: { top: number; fontSize: number };
    openHouse: { top: number; fontSize: number };
    price: { top: number; fontSize: number };
    bedsBaths: { top: number; fontSize: number };
  };
  /** Footer block — brand mark on top, MLS # on bottom, both centered. */
  footer: {
    brandTop: number;
    brandFontSize: number;
    mlsTop: number;
    mlsFontSize: number;
  };
  /** Badge stamp anchor — top-right of the canvas, outside the photo frame. */
  badge: {
    left: number;
    top: number;
    width: number;
    height: number;
    angle: number;
    fontSize: number;
  };
}

// why: layout numbers below are derived from the V1 primitives, then converted
// from CSS-centered positioning to top-left absolute coordinates. The schema
// has no flex/gap primitives, so we precompute the left edges by symmetry:
// for a centered element of width W on a 1080-wide canvas, left = (1080 - W) / 2.
const LAYOUTS: Record<PostFormat, FormatLayout> = {
  // ── Square 1:1 (1080×1080) ────────────────────────────────────────────────
  // V1 reference: photo 760×500 centered at top=240; type stack at y=800;
  // eyebrow at y=110; footer at bottom: 36 → ~1010 baseline.
  square_1x1: {
    width: 1080,
    height: 1080,
    eyebrow: {
      top: 100,
      ruleWidth: 70,
      gap: 18,
      labelWidth: 360,
      labelFontSize: 22,
    },
    frame: {
      // why: V1 has photo 760×500 at top=240 with 12px internal padding,
      // making the OUTER frame 784×524 centered. Left = (1080-784)/2 = 148.
      left: 148,
      top: 228,
      width: 784,
      height: 524,
      padding: 12,
      strokeWidth: 3,
    },
    body: {
      horizontalMargin: 80,
      address: { top: 800, fontSize: 60 },
      cityStateZip: { top: 880, fontSize: 22 },
      openHouse: { top: 916, fontSize: 22 },
      price: { top: 944, fontSize: 60 },
      bedsBaths: { top: 1014, fontSize: 18 },
    },
    footer: {
      brandTop: 1018,
      brandFontSize: 14,
      mlsTop: 1042,
      mlsFontSize: 14,
    },
    badge: { left: 800, top: 60, width: 220, height: 90, angle: -8, fontSize: 42 },
  },

  // ── Portrait 4:5 (1080×1350) ──────────────────────────────────────────────
  // V1 reference: photo 820×600 centered at top=320; type stack at y=990;
  // eyebrow at y=130; footer at bottom: 44 → ~1260 baseline.
  portrait_4x5: {
    width: 1080,
    height: 1350,
    eyebrow: {
      top: 120,
      ruleWidth: 80,
      gap: 20,
      labelWidth: 400,
      labelFontSize: 24,
    },
    frame: {
      // why: V1 photo 820×600 with 12px padding → outer 844×624 centered.
      // Left = (1080-844)/2 = 118.
      left: 118,
      top: 308,
      width: 844,
      height: 624,
      padding: 12,
      strokeWidth: 3,
    },
    body: {
      horizontalMargin: 80,
      address: { top: 990, fontSize: 72 },
      cityStateZip: { top: 1086, fontSize: 22 },
      openHouse: { top: 1126, fontSize: 22 },
      price: { top: 1158, fontSize: 68 },
      bedsBaths: { top: 1240, fontSize: 18 },
    },
    footer: {
      brandTop: 1272,
      brandFontSize: 16,
      mlsTop: 1302,
      mlsFontSize: 16,
    },
    badge: { left: 820, top: 64, width: 220, height: 90, angle: -8, fontSize: 42 },
  },

  // ── Story 9:16 (1080×1920) ────────────────────────────────────────────────
  // V1 reference: eyebrow at STORY_SAFE_ZONE.top + 30 = 280; photo 880×680
  // centered at top=420; type stack at y=1200; footer at STORY_SAFE_ZONE.bottom
  // + 30 = 230 from bottom = ~1690 baseline.
  story_9x16: {
    width: 1080,
    height: 1920,
    eyebrow: {
      // why: y=280 sits just below the IG/FB top safe zone (250px). Eyebrow
      // rules + label centered with extra width since the type is larger.
      top: 270,
      ruleWidth: 90,
      gap: 22,
      labelWidth: 460,
      labelFontSize: 28,
    },
    frame: {
      // why: V1 photo 880×680 with 14px padding → outer 908×708 centered.
      // Left = (1080-908)/2 = 86.
      left: 86,
      top: 406,
      width: 908,
      height: 708,
      padding: 14,
      strokeWidth: 3,
    },
    body: {
      horizontalMargin: 90,
      address: { top: 1200, fontSize: 88 },
      cityStateZip: { top: 1316, fontSize: 26 },
      openHouse: { top: 1364, fontSize: 26 },
      price: { top: 1402, fontSize: 80 },
      bedsBaths: { top: 1500, fontSize: 22 },
    },
    footer: {
      // why: footer text ends at y≈1690 (above the 1720 bottom safe zone).
      // Two stacked lines with ~30px line height each.
      brandTop: 1640,
      brandFontSize: 18,
      mlsTop: 1676,
      mlsFontSize: 18,
    },
    badge: { left: 820, top: 300, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming — identical shape to bold-stats-factory's POST_TYPE_CONFIGS
// so the orchestrator (index.ts) can treat all factories uniformly and any
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
      `${describeFormat(f)} minimal-frame layout — gold-rule framed photo on a near-white surface with centered Playfair type below.`,
  },
  just_sold: {
    eyebrow: "JUST SOLD",
    price: { mode: "close", fallbackText: "$905,000", boundField: "close_price" },
    // why: red SOLD stamp matches v1/v2 — consistent badge language across variants.
    badge: { text: "SOLD", fill: "#B91C1C" },
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} minimal-frame closed-deal poster — red SOLD stamp top-right, close price centered below the framed photo.`,
  },
  under_contract: {
    eyebrow: "UNDER CONTRACT",
    // why: no dollar amount on under-contract posts. Show the status word
    // in the price slot, set as a label with no boundField.
    price: { mode: "label", fallbackText: "Under Contract", boundField: null },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} minimal-frame pipeline-status poster — "Under Contract" replaces the price slot, type centered below.`,
  },
  open_house: {
    eyebrow: "OPEN HOUSE",
    price: { mode: "list", fallbackText: "$929,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} minimal-frame open-house poster — italic gold date/time line above the price, list price centered.`,
  },
  price_reduction: {
    eyebrow: "PRICE REDUCED",
    price: { mode: "list", fallbackText: "$899,000", boundField: "price" },
    badge: { text: "↓ NEW PRICE", fill: "#15803D" },
    showOpenHouseLine: false,
    templateNamePrefix: "Price Reduced",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} minimal-frame reduction poster — green ↓ NEW PRICE stamp top-right, refreshed list price centered below.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a single v8 Minimal Frame template for the given (postType, format).
 *
 * The function is deterministic — calling it twice with the same inputs
 * produces identical layer trees (same ids, same numbers). This is important
 * for snapshot stability when templates are persisted to Supabase and later
 * compared for schema drift.
 *
 * @param postType — which of the five post categories
 * @param format   — which aspect ratio (square / portrait / story)
 * @returns a CanvasTemplateSchema ready to register in index.ts
 */
export function createMinimalFrameTemplate(
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

  // ── derived helpers ─────────────────────────────────────────────────────
  // Centered horizontal positions for the eyebrow row + type stack.
  const innerStackWidth = layout.width - layout.body.horizontalMargin * 2;

  // Eyebrow row: [rule] [gap] [label] [gap] [rule]
  // Total width = ruleWidth + gap + labelWidth + gap + ruleWidth.
  const eyebrowTotalWidth =
    layout.eyebrow.ruleWidth * 2 +
    layout.eyebrow.gap * 2 +
    layout.eyebrow.labelWidth;
  const eyebrowLeft = Math.round((layout.width - eyebrowTotalWidth) / 2);
  const eyebrowRuleLeftA = eyebrowLeft;
  const eyebrowLabelLeft =
    eyebrowLeft + layout.eyebrow.ruleWidth + layout.eyebrow.gap;
  const eyebrowRuleLeftB =
    eyebrowLabelLeft + layout.eyebrow.labelWidth + layout.eyebrow.gap;
  // Eyebrow rules are 1px tall — center them on the label's vertical midpoint.
  // The label's `top` is the text's top edge; visual baseline is roughly
  // `top + fontSize * 0.7`. We approximate the rule's vertical center as
  // `top + fontSize / 2`.
  const eyebrowRuleTop =
    layout.eyebrow.top + Math.round(layout.eyebrow.labelFontSize / 2);

  // Photo sits INSIDE the gold-rule frame with `padding` breathing room.
  const photoLeft = layout.frame.left + layout.frame.padding;
  const photoTop = layout.frame.top + layout.frame.padding;
  const photoWidth = layout.frame.width - layout.frame.padding * 2;
  const photoHeight = layout.frame.height - layout.frame.padding * 2;

  // ── layer tree ──────────────────────────────────────────────────────────
  const layers: CanvasLayer[] = [
    // ---- z=0  gold-rule frame (outline rectangle around the photo) ----
    // why: drawn FIRST so the photo at z=1 paints over its interior. With
    // `fill: ""` (empty) the rect renders as outline-only — Fabric treats
    // empty-string fill as no fill. The gold stroke remains visible around
    // the photo's edges as the gallery-poster frame.
    {
      kind: "shape",
      id: "layer_photo_frame",
      name: "Gold rule frame",
      left: layout.frame.left,
      top: layout.frame.top,
      width: layout.frame.width,
      height: layout.frame.height,
      angle: 0,
      opacity: 1,
      z: 0,
      visible: true,
      locked: false,
      shapeType: "rect",
      // why: empty-string fill renders as outlined-only per the ShapeLayer
      // docstring ("Empty string = no fill (lines, outlined shapes)").
      fill: "",
      stroke: ALLIANCE_COLORS.gold500,
      strokeWidth: layout.frame.strokeWidth,
      cornerRadius: 0,
      strokeDashArray: [],
    },

    // ---- z=1  hero photo (inside the frame's padding) ----
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

    // ---- z=2  eyebrow rule (left) ----
    {
      kind: "shape",
      id: "layer_eyebrow_rule_left",
      name: "Eyebrow rule (left)",
      left: eyebrowRuleLeftA,
      top: eyebrowRuleTop,
      width: layout.eyebrow.ruleWidth,
      height: 2,
      angle: 0,
      opacity: 1,
      z: 2,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 1,
      strokeDashArray: [],
    },

    // ---- z=3  eyebrow rule (right) ----
    {
      kind: "shape",
      id: "layer_eyebrow_rule_right",
      name: "Eyebrow rule (right)",
      left: eyebrowRuleLeftB,
      top: eyebrowRuleTop,
      width: layout.eyebrow.ruleWidth,
      height: 2,
      angle: 0,
      opacity: 1,
      z: 3,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 1,
      strokeDashArray: [],
    },

    // ---- z=4  eyebrow status label (centered between the rules) ----
    {
      kind: "text",
      id: "layer_status_label",
      name: "Status label",
      left: eyebrowLabelLeft,
      top: layout.eyebrow.top,
      width: layout.eyebrow.labelWidth,
      height: layout.eyebrow.labelFontSize + 12,
      angle: 0,
      opacity: 1,
      z: 4,
      visible: true,
      locked: false,
      text: cfg.eyebrow,
      boundField: "status_label",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.eyebrow.labelFontSize,
      fontWeight: 700,
      fontStyle: "normal",
      // why: gold600 is the darker shade for the eyebrow label on a light
      // surface — gold500 reserved for the rules + price for visual rhythm.
      fill: ALLIANCE_COLORS.gold600,
      textAlign: "center",
      lineHeight: 1.1,
      charSpacing: 240,
      underline: false,
      linethrough: false,
      editable: true,
    },
  ];

  // ---- z=5  address (serif, ink, centered) ----
  layers.push({
    kind: "text",
    id: "layer_address_line",
    name: "Address",
    left: layout.body.horizontalMargin,
    top: layout.body.address.top,
    width: innerStackWidth,
    height: layout.body.address.fontSize + 18,
    angle: 0,
    opacity: 1,
    z: 5,
    visible: true,
    locked: false,
    text: "117 E Maple Ave",
    boundField: "address_line1",
    // why: Playfair Display is the variant's signature — gives the print-ad
    // editorial feel called out in the V1 primitives (CSS imports Playfair
    // explicitly for these surfaces).
    fontFamily: ALLIANCE_FONTS.playfair,
    fontSize: layout.body.address.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    lineHeight: 1.04,
    charSpacing: -10,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=6  city/state/zip (muted, uppercase, tracked) ----
  layers.push({
    kind: "text",
    id: "layer_city_state_zip",
    name: "City · State · Zip",
    left: layout.body.horizontalMargin,
    top: layout.body.cityStateZip.top,
    width: innerStackWidth,
    height: layout.body.cityStateZip.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 6,
    visible: true,
    locked: false,
    text: "WILDWOOD, NJ 08260",
    boundField: "city_state_zip",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.body.cityStateZip.fontSize,
    fontWeight: 500,
    fontStyle: "normal",
    // why: ink700 at full opacity reads as a muted secondary on the
    // near-white surface — matches V1's `#525250` muted grey.
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 120,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=7  open-house line (italic gold) — only for open_house ----
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "text",
      id: "layer_open_house_line",
      name: "Open House date/time",
      left: layout.body.horizontalMargin,
      top: layout.body.openHouse.top,
      width: innerStackWidth,
      height: layout.body.openHouse.fontSize + 10,
      angle: 0,
      opacity: 1,
      z: 7,
      visible: true,
      locked: false,
      text: "Saturday · 11:00 AM – 1:00 PM",
      boundField: "open_house_date",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.body.openHouse.fontSize,
      fontWeight: 500,
      // why: italic + gold600 mirrors V1's `.open-house` style — gives the
      // date/time line a hand-written invitation feel without script fonts.
      fontStyle: "italic",
      fill: ALLIANCE_COLORS.gold600,
      textAlign: "center",
      lineHeight: 1.2,
      charSpacing: 80,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=8  price (Playfair serif gold) OR label ("Under Contract", sans gold) ----
  layers.push({
    kind: "text",
    id: "layer_price",
    name: cfg.price.mode === "label" ? "Status (Under Contract)" : "Price",
    left: layout.body.horizontalMargin,
    top: layout.body.price.top,
    width: innerStackWidth,
    height: layout.body.price.fontSize + 18,
    angle: 0,
    opacity: 1,
    z: 8,
    visible: true,
    locked: false,
    text: cfg.price.fallbackText,
    // why: spread the bound-field key conditionally so under_contract (which
    // has no boundField) doesn't ship with `boundField: undefined` in the JSON.
    ...(cfg.price.boundField ? { boundField: cfg.price.boundField } : {}),
    // why: V1 distinguishes price vs. label modes via different fonts —
    // serif Playfair for dollar amounts (luxury-real-estate convention),
    // bold sans uppercase for the "Under Contract" status word.
    fontFamily:
      cfg.price.mode === "label"
        ? ALLIANCE_FONTS.bodySans
        : ALLIANCE_FONTS.playfair,
    // why: label-mode is "Under Contract" — much narrower than $X,XXX,XXX,
    // so we shrink the type to ~58% of the price slot. Matches v1/v2 V1 ratio.
    fontSize:
      cfg.price.mode === "label"
        ? Math.round(layout.body.price.fontSize * 0.58)
        : layout.body.price.fontSize,
    fontWeight: cfg.price.mode === "label" ? 800 : 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "center",
    lineHeight: 1,
    charSpacing: cfg.price.mode === "label" ? 200 : -10,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=9  beds/baths row (small, uppercase, tracked) ----
  layers.push({
    kind: "text",
    id: "layer_beds_baths",
    name: "Beds · Baths",
    left: layout.body.horizontalMargin,
    top: layout.body.bedsBaths.top,
    width: innerStackWidth,
    height: layout.body.bedsBaths.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 9,
    visible: true,
    locked: false,
    text: "4 BR · 3 BA",
    boundField: "beds_baths",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.body.bedsBaths.fontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 240,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=10  brand mark (centered, muted, tracked) ----
  layers.push({
    kind: "text",
    id: "layer_brand_name",
    name: "Brand name",
    left: layout.body.horizontalMargin,
    top: layout.footer.brandTop,
    width: innerStackWidth,
    height: layout.footer.brandFontSize + 8,
    angle: 0,
    // why: 0.6 opacity on ink900 reproduces V1's `rgba(24,24,27,0.55)` muted
    // footer color without needing rgba-hex strings the schema doesn't accept.
    opacity: 0.6,
    z: 10,
    visible: true,
    locked: false,
    text: "CENTURY 21 ALLIANCE",
    boundField: "office_name",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.footer.brandFontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 240,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=11  MLS number (centered below brand mark) ----
  layers.push({
    kind: "text",
    id: "layer_mls_number",
    name: "MLS #",
    left: layout.body.horizontalMargin,
    top: layout.footer.mlsTop,
    width: innerStackWidth,
    height: layout.footer.mlsFontSize + 8,
    angle: 0,
    opacity: 0.55,
    z: 11,
    visible: true,
    locked: false,
    text: "MLS #607680",
    boundField: "mls_number",
    fontFamily: ALLIANCE_FONTS.monoNum,
    fontSize: layout.footer.mlsFontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=12/13  badge stamp (only when configured) ----
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
      z: 12,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: cfg.badge.fill,
      // why: white border separates the stamp visually from the near-white
      // background — matches V1's `border-color: #FCFCFB` on the badge.
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
      z: 13,
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
    id: `canvas_${cfg.idPrefix}_v8_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Minimal Frame · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v8",
    format,
    width: layout.width,
    height: layout.height,
    // why: near-white `#FCFCFB` matches V1's body background. No token maps
    // exactly to this value — `ALLIANCE_COLORS.whiteWarm` is `#FBF7EE`, a
    // warmer cream used for on-photo text. The minimal-frame surface needs
    // a cooler off-white to read as gallery paper, not warm parchment.
    backgroundColor: "#FCFCFB",
    backgroundImage: null,
    updatedAt: "2026-05-15T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: build all 5 post types × 3 formats = 15 minimal-frame templates.
 * The registry (index.ts) calls this once at module-load time alongside the
 * other factory outputs (v1 hero-editorial, v2 bold-stats, v3 side-by-side).
 *
 * @returns array of 15 templates in (postType × format) outer-loop order.
 */
export function buildAllMinimalFrameTemplates(): CanvasTemplateSchema[] {
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
      out.push(createMinimalFrameTemplate(pt, f));
    }
  }
  return out;
}
