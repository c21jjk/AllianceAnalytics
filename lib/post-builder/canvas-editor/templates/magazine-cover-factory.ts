/**
 * Magazine Cover template factory — `createMagazineCoverTemplate(postType, format)`
 * --------------------------------------------------------------------------------
 *
 * v6 Magazine Cover — the "Architectural Digest / Dwell" layout. A full-bleed
 * hero photo dominates the upper ~62% of the canvas, then steps cleanly into
 * a warm cream lower panel that holds the type stack:
 *   eyebrow (gold rule + status label) → city headline (display serif) →
 *   address subhead → optional Open House chip → price + beds/baths chips →
 *   brand mark + MLS tag in the corner.
 *
 * The signature contrast with v1 Hero Editorial and v2 Bold Stats:
 *   • v1 / v2 lean modern-grey (dark surfaces, sans type).
 *   • v6 leans editorial-cream + serif. This is the "luxury listing"
 *     variant Larissa reaches for when the listing's exterior photography
 *     can carry the top half on its own and we want the typography to
 *     read like a magazine cover, not a real-estate flyer.
 *
 * Generates 15 templates: 5 post types × 3 formats.
 *
 * Design parity with the V1 HTML primitives (`primitives/v6-magazine-cover*.ts`):
 *   • Cream background `#FBF7EE` — mapped to ALLIANCE_COLORS.whiteWarm so
 *     a future brand-tweak is a single-file change.
 *   • Photo height ratios mirror V1: square ~62% (670/1080), portrait
 *     ~62% (840/1350), story dominant middle (1180−250=930px of visible
 *     photo between the top safe zone and the cream panel).
 *   • City headline in Playfair Display, very large (96 / 110 / 130pt) —
 *     this is the visual anchor of the design.
 *   • Price in gold Playfair (NOT the sans we use in v1/v2) — the serif
 *     numeral is what gives v6 its editorial feel.
 *   • Open-House chip is gold-on-dark when present (`open_house` only).
 *   • Badge stamp anchors to top-right of the photo (just_sold, price_reduction).
 *   • V1's gradient-fill eyebrow rule is rendered as a solid gold rect here —
 *     the canvas-editor schema doesn't support gradient fills (per project
 *     scope rules) and a solid gold reads identically at this scale.
 *
 * Layer numbering (z):
 *   z=0  hero photo (top ~62% on square/portrait; top safe zone → cream on story)
 *   z=1  cream lower panel rect (also doubles as bg when photo top-margin exists)
 *   z=2  thin gold rule at the photo / panel boundary (subtle editorial flourish)
 *   z=3  gold accent rule (eyebrow)
 *   z=4  status label (eyebrow text, gold-dark)
 *   z=5  city headline (display serif, ink)
 *   z=6  address subhead (sans, ink-mid)
 *   z=7  optional open-house chip rect       (only when showOpenHouseLine)
 *   z=8  optional open-house chip text       (only when showOpenHouseLine)
 *   z=9  price (gold serif, oversized)       (skipped when under_contract)
 *   z=10 beds/baths inline row
 *   z=11 brand mark ("CENTURY 21 ALLIANCE")
 *   z=12 MLS number tag
 *   z=13 badge stamp rect                    (only when badge configured)
 *   z=14 badge stamp text                    (only when badge configured)
 *
 * Why the under_contract template omits the price layer:
 *   The task brief says "every template (except under_contract) has a price/
 *   close_price-bound text layer". under_contract communicates pipeline
 *   status, not a number — putting "Under Contract" in a price-shaped slot
 *   would confuse the binding contract. Instead we surface "Under Contract"
 *   through the eyebrow label (which already says "UNDER CONTRACT") and let
 *   the city/address carry the design. This matches the validator's
 *   invariant and the V1 primitive's `price_mode: "label"` behavior.
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
 * Geometry for a single format. All values in canvas pixels, top-left origin.
 *
 * Why every coordinate is hand-tuned rather than derived from a single
 * "padding scale": magazine layouts breathe differently at every aspect
 * ratio — the square wants tighter margins to keep the city headline from
 * dominating; portrait gets +16px more padding because the extra vertical
 * room lets the type stack spread; story uses 80px margins and respects
 * the platform safe zones at top (0–250) and bottom (1720–1920).
 */
interface FormatLayout {
  width: number;
  height: number;
  /** Bottom edge of the hero photo / top edge of the cream panel. */
  photoBottom: number;
  /**
   * Top edge of the hero photo. 0 for square + portrait. For story we
   * preserve the IG/FB/TikTok top safe zone (250px reserved for the
   * profile chip + progress bars) so the photo doesn't get clipped by
   * platform UI.
   */
  photoTop: number;
  /** Eyebrow block (gold rule + status label) inside the cream panel. */
  eyebrow: {
    left: number;
    ruleTop: number;
    ruleWidth: number;
    labelLeft: number;
    labelTop: number;
    labelFontSize: number;
  };
  /** Subtle gold hairline at the photo / cream-panel seam. */
  seamRule: { top: number; height: number };
  /** City headline (display serif, the visual anchor of the design). */
  city: { top: number; fontSize: number };
  /** Address subhead — uppercase tracked sans below the city. */
  address: { top: number; fontSize: number };
  /** Optional Open House chip (open_house category only). */
  openHouseChip: {
    top: number;
    height: number;
    width: number;
    fontSize: number;
  };
  /** Price slot (gold Playfair serif). */
  price: { top: number; fontSize: number; labelFontSize: number };
  /** Beds/baths chip row, sits just under the price. */
  bedsBaths: { top: number; fontSize: number };
  /** Footer line — brand mark on the left, MLS tag on the right. */
  footer: {
    top: number;
    brandWidth: number;
    brandFontSize: number;
    mlsFontSize: number;
    mlsRight: number;
    mlsWidth: number;
  };
  /** Horizontal text margins inside the cream panel. */
  padding: { left: number; right: number };
  /** Badge stamp anchor — sits over the hero photo, upper-right. */
  badge: {
    left: number;
    top: number;
    width: number;
    height: number;
    angle: number;
    fontSize: number;
  };
}

/**
 * The actual per-format coordinates.
 *
 * Story safe-zone math (the load-bearing decision):
 *   • Top safe zone: 0–250px (profile chip + story progress bars).
 *     Hero photo starts at y=250 so platform UI never clips the image.
 *   • Bottom safe zone: 1720–1920px (Send-arrow + reply UI).
 *     All type lives at y < 1700; the cream panel extends to the bottom
 *     of the canvas but the brand-mark / MLS line sits at y=1660 (60px
 *     above the safe-zone boundary) so they remain visible.
 *   • The hero photo is 250 → 1180 (930px of vertical photo — dominant
 *     in the visible middle of the screen). The cream panel runs from
 *     1180 → 1920 (540px tall, but the lower 200px is the safe zone).
 *     This matches the V1 story primitive's `top: 1180px` panel start.
 */
const LAYOUTS: Record<PostFormat, FormatLayout> = {
  square_1x1: {
    width: 1080,
    height: 1080,
    photoTop: 0,
    photoBottom: 670,
    eyebrow: {
      left: 56,
      ruleTop: 718,
      ruleWidth: 60,
      labelLeft: 132, // 56 + 60 + 16 gap
      labelTop: 712,
      labelFontSize: 18,
    },
    seamRule: { top: 670, height: 1 },
    city: { top: 748, fontSize: 96 },
    address: { top: 862, fontSize: 22 },
    openHouseChip: { top: 902, height: 40, width: 360, fontSize: 18 },
    price: { top: 952, fontSize: 60, labelFontSize: 36 },
    bedsBaths: { top: 1000, fontSize: 14 },
    footer: {
      top: 1024,
      brandWidth: 540,
      brandFontSize: 11,
      mlsFontSize: 11,
      mlsRight: 56,
      mlsWidth: 320,
    },
    padding: { left: 56, right: 56 },
    badge: { left: 776, top: 88, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
  portrait_4x5: {
    width: 1080,
    height: 1350,
    photoTop: 0,
    photoBottom: 840,
    eyebrow: {
      left: 72,
      ruleTop: 902,
      ruleWidth: 60,
      labelLeft: 150, // 72 + 60 + 18 gap
      labelTop: 894,
      labelFontSize: 20,
    },
    seamRule: { top: 840, height: 1 },
    city: { top: 932, fontSize: 110 },
    address: { top: 1062, fontSize: 24 },
    openHouseChip: { top: 1106, height: 44, width: 380, fontSize: 20 },
    price: { top: 1166, fontSize: 68, labelFontSize: 40 },
    bedsBaths: { top: 1224, fontSize: 15 },
    footer: {
      top: 1262,
      brandWidth: 600,
      brandFontSize: 12,
      mlsFontSize: 12,
      mlsRight: 72,
      mlsWidth: 320,
    },
    padding: { left: 72, right: 72 },
    badge: { left: 768, top: 96, width: 240, height: 100, angle: -8, fontSize: 48 },
  },
  // why: Story photo starts at y=250 (top safe zone preserved) and ends at
  // y=1180 — gives 930px of dominant photo in the visible middle. Cream
  // panel runs 1180→1920 but all critical type stays above y=1700 so the
  // bottom safe zone (1720–1920) is honored. Type sizes scale up: city at
  // 130pt is thumb-stopping in vertical scroll.
  story_9x16: {
    width: 1080,
    height: 1920,
    photoTop: 250,
    photoBottom: 1180,
    eyebrow: {
      left: 80,
      ruleTop: 1246,
      ruleWidth: 72,
      labelLeft: 174, // 80 + 72 + 22 gap
      labelTop: 1236,
      labelFontSize: 26,
    },
    seamRule: { top: 1180, height: 1 },
    city: { top: 1284, fontSize: 130 },
    address: { top: 1438, fontSize: 30 },
    openHouseChip: { top: 1492, height: 56, width: 460, fontSize: 24 },
    price: { top: 1562, fontSize: 84, labelFontSize: 48 },
    bedsBaths: { top: 1640, fontSize: 18 },
    footer: {
      top: 1684,
      brandWidth: 700,
      brandFontSize: 14,
      mlsFontSize: 14,
      mlsRight: 80,
      mlsWidth: 320,
    },
    padding: { left: 80, right: 80 },
    // why: badge top = STORY_SAFE_ZONE.top (250) + 60px = 310, mirrors the
    // V1 primitive's `top: ${STORY_SAFE_ZONE.top + 60}px` rule. Keeps the
    // stamp clear of the platform's profile-chip overlay.
    badge: { left: 720, top: 310, width: 280, height: 120, angle: -8, fontSize: 56 },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming — same shape as bold-stats-factory's POST_TYPE_CONFIGS
// so a future shared-config refactor can collapse all three factories into one.
// ---------------------------------------------------------------------------

interface BadgeConfig {
  text: string;
  fill: string;
}

interface PriceConfig {
  mode: "list" | "close" | "label";
  fallbackText: string;
  /**
   * Null for label-mode (under_contract) — the factory omits the price
   * layer entirely for that case rather than emit an unbound text layer.
   */
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
      `${describeFormat(f)} Magazine Cover — editorial cream panel under a dominant hero photo, big serif city headline + gold price.`,
  },
  just_sold: {
    eyebrow: "JUST SOLD",
    price: { mode: "close", fallbackText: "$905,000", boundField: "close_price" },
    badge: { text: "SOLD", fill: "#B91C1C" },
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} Magazine Cover — red SOLD stamp on the photo, close price in editorial serif on the cream panel.`,
  },
  under_contract: {
    eyebrow: "UNDER CONTRACT",
    // why: label-mode used by no layer here — under_contract intentionally
    // skips the price slot (status comes through the eyebrow). Kept on the
    // config for symmetry with the other factories.
    price: { mode: "label", fallbackText: "Under Contract", boundField: null },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} Magazine Cover — pipeline-status variant; city + address carry the editorial layout, no price shown.`,
  },
  open_house: {
    eyebrow: "OPEN HOUSE",
    price: { mode: "list", fallbackText: "$929,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} Magazine Cover — gold open-house chip above the price, editorial serif headline on cream.`,
  },
  price_reduction: {
    eyebrow: "PRICE REDUCED",
    price: { mode: "list", fallbackText: "$899,000", boundField: "price" },
    badge: { text: "↓ NEW PRICE", fill: "#15803D" },
    showOpenHouseLine: false,
    templateNamePrefix: "Price Reduced",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} Magazine Cover — green new-price stamp on the photo, refreshed list price on the cream panel.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a single v6 Magazine Cover template for the given post type + format.
 *
 * The returned schema satisfies the editor's runtime invariants:
 *   • width/height match PLATFORM_DIMENSIONS[format]
 *   • every template has a hero_photo-bound image layer (z=0)
 *   • every template except under_contract has a price/close_price text layer
 *   • all layer ids are unique within the template
 *   • the template id is unique registry-wide (canvas_${postType}_v6_${format})
 *   • schemaVersion: 1
 */
export function createMagazineCoverTemplate(
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

  const innerWidth = layout.width - layout.padding.left - layout.padding.right;
  const photoHeight = layout.photoBottom - layout.photoTop;
  const panelHeight = layout.height - layout.photoBottom;

  const layers: CanvasLayer[] = [
    // ---- z=0  hero photo ----
    // why: photo occupies only the top region (not full-bleed) so the cream
    // panel below is the natural background, not an overlay. For story
    // format, the photo also leaves the top safe zone empty — that strip
    // is filled by the cream backgroundColor of the template.
    {
      kind: "image",
      id: "layer_hero_photo",
      name: "Hero photo",
      left: 0,
      top: layout.photoTop,
      width: layout.width,
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
    // ---- z=1  cream lower panel ----
    // why: although the template's backgroundColor is already cream, we
    // render an explicit rect here so the layer panel surfaces the panel
    // as an editable element AND so future variants can darken/recolor
    // the panel without touching the template-level background.
    {
      kind: "shape",
      id: "layer_cream_panel",
      name: "Cream panel",
      left: 0,
      top: layout.photoBottom,
      width: layout.width,
      height: panelHeight,
      angle: 0,
      opacity: 1,
      z: 1,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.whiteWarm,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
    // ---- z=2  hairline gold rule at the photo/panel seam ----
    // why: a 1px gold hairline is the subtle editorial flourish that
    // separates v6 from v1/v2. Reads as "designed", not just "split".
    {
      kind: "shape",
      id: "layer_seam_rule",
      name: "Photo/panel seam",
      left: 0,
      top: layout.seamRule.top,
      width: layout.width,
      height: layout.seamRule.height,
      angle: 0,
      opacity: 0.55,
      z: 2,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
    // ---- z=3  eyebrow rule (gold) ----
    {
      kind: "shape",
      id: "layer_eyebrow_rule",
      name: "Eyebrow rule",
      left: layout.eyebrow.left,
      top: layout.eyebrow.ruleTop,
      width: layout.eyebrow.ruleWidth,
      height: 3,
      angle: 0,
      opacity: 1,
      z: 3,
      visible: true,
      locked: false,
      shapeType: "rect",
      // why: V1 uses a left→right gradient (gold500→gold600); the canvas
      // schema doesn't support gradient fills, so we render the average —
      // solid gold500 — which reads identically at this 3px height.
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 2,
      strokeDashArray: [],
    },
    // ---- z=4  status label (eyebrow text) ----
    // why: eyebrow text uses gold600 (the darker "accent_dark" in V1
    // theme) for legibility on cream — pure gold500 is too light against
    // cream at this small size.
    {
      kind: "text",
      id: "layer_status_label",
      name: "Status label",
      left: layout.eyebrow.labelLeft,
      top: layout.eyebrow.labelTop,
      width: 500,
      height: layout.eyebrow.labelFontSize + 14,
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
      fill: ALLIANCE_COLORS.gold600,
      textAlign: "left",
      lineHeight: 1.1,
      charSpacing: 160,
      underline: false,
      linethrough: false,
      editable: true,
    },
    // ---- z=5  city headline (the visual anchor) ----
    // why: Playfair Display is the project's de-facto luxury real-estate
    // headline font. Negative charSpacing tightens the display serif so
    // ascenders/descenders don't look gappy at 96–130pt.
    {
      kind: "text",
      id: "layer_city_headline",
      name: "City headline",
      left: layout.padding.left,
      top: layout.city.top,
      width: innerWidth,
      height: layout.city.fontSize + 24,
      angle: 0,
      opacity: 1,
      z: 5,
      visible: true,
      locked: false,
      text: "Wildwood",
      boundField: "city",
      fontFamily: ALLIANCE_FONTS.playfair,
      fontSize: layout.city.fontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "left",
      lineHeight: 1,
      charSpacing: -20,
      underline: false,
      linethrough: false,
      editable: true,
    },
    // ---- z=6  address subhead ----
    {
      kind: "text",
      id: "layer_address_line",
      name: "Address",
      left: layout.padding.left,
      top: layout.address.top,
      width: innerWidth,
      height: layout.address.fontSize + 14,
      angle: 0,
      opacity: 1,
      z: 6,
      visible: true,
      locked: false,
      text: "117 E Maple Ave",
      boundField: "address_line1",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.address.fontSize,
      fontWeight: 500,
      fontStyle: "normal",
      // why: ink700 is the mid-tone "secondary text on cream" color —
      // less heavy than the city headline so the visual hierarchy stays
      // photo → city → address.
      fill: ALLIANCE_COLORS.ink700,
      textAlign: "left",
      lineHeight: 1.2,
      charSpacing: 80,
      underline: false,
      linethrough: false,
      editable: true,
    },
  ];

  // ---- z=7 / z=8  open-house chip (rect + text) — only when configured ----
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "shape",
      id: "layer_open_house_chip_bg",
      name: "Open House chip",
      left: layout.padding.left,
      top: layout.openHouseChip.top,
      width: layout.openHouseChip.width,
      height: layout.openHouseChip.height,
      angle: 0,
      opacity: 1,
      z: 7,
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
      // why: chip text is centered vertically inside the chip rect by
      // hand-calculating the y offset — Fabric's Textbox doesn't expose
      // verticalAlign in v6, so we approximate with (chipH - fontSize)/2.
      left: layout.padding.left + 16,
      top:
        layout.openHouseChip.top +
        Math.round(
          (layout.openHouseChip.height - layout.openHouseChip.fontSize) / 2,
        ),
      width: layout.openHouseChip.width - 32,
      height: layout.openHouseChip.fontSize + 6,
      angle: 0,
      opacity: 1,
      z: 8,
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
      charSpacing: 140,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=9  price (gold serif) — skipped for under_contract ----
  // why: the validator requires a price/close_price-bound text layer on
  // every template EXCEPT under_contract. We branch on boundField === null
  // (label-mode) and omit the layer entirely rather than emit a literal-
  // text layer that would lie about its binding contract.
  if (cfg.price.boundField !== null) {
    layers.push({
      kind: "text",
      id: "layer_price",
      name: "Price",
      left: layout.padding.left,
      top: layout.price.top,
      width: innerWidth,
      height: layout.price.fontSize + 18,
      angle: 0,
      opacity: 1,
      z: 9,
      visible: true,
      locked: false,
      text: cfg.price.fallbackText,
      boundField: cfg.price.boundField,
      // why: serif numerals are the v6 signature — Playfair for price
      // separates this variant cleanly from v1 (sans price) and v2 (sans
      // price, oversized). The serif also pairs naturally with the city
      // headline above.
      fontFamily: ALLIANCE_FONTS.playfair,
      fontSize: layout.price.fontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.gold500,
      textAlign: "left",
      lineHeight: 1,
      charSpacing: -20,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=10  beds/baths inline row ----
  layers.push({
    kind: "text",
    id: "layer_beds_baths",
    name: "Beds · Baths",
    left: layout.padding.left,
    top: layout.bedsBaths.top,
    width: innerWidth,
    height: layout.bedsBaths.fontSize + 8,
    angle: 0,
    opacity: 1,
    z: 10,
    visible: true,
    locked: false,
    text: "4 BR · 3 BA",
    boundField: "beds_baths",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.bedsBaths.fontSize,
    fontWeight: 600,
    fontStyle: "normal",
    // why: mid-tone ink700 keeps the chip row visually subordinate to
    // the price (gold) and city headline (ink900). Mirrors V1 primitive's
    // "#525250" but pulled from the brand token for consistency.
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 180,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=11  brand mark ("CENTURY 21 ALLIANCE") ----
  layers.push({
    kind: "text",
    id: "layer_brand_name",
    name: "Brand mark",
    left: layout.padding.left,
    top: layout.footer.top,
    width: layout.footer.brandWidth,
    height: layout.footer.brandFontSize + 8,
    angle: 0,
    opacity: 0.6,
    z: 11,
    visible: true,
    locked: false,
    text: "CENTURY 21 ALLIANCE",
    boundField: "office_name",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.footer.brandFontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "left",
    lineHeight: 1.4,
    charSpacing: 180,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=12  MLS number tag ----
  layers.push({
    kind: "text",
    id: "layer_mls_number",
    name: "MLS #",
    left: layout.width - layout.footer.mlsRight - layout.footer.mlsWidth,
    top: layout.footer.top,
    width: layout.footer.mlsWidth,
    height: layout.footer.mlsFontSize + 8,
    angle: 0,
    opacity: 0.6,
    z: 12,
    visible: true,
    locked: false,
    text: "MLS #607680",
    boundField: "mls_number",
    fontFamily: ALLIANCE_FONTS.monoNum,
    fontSize: layout.footer.mlsFontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "right",
    lineHeight: 1.4,
    charSpacing: 160,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=13 / z=14  badge stamp (only for just_sold + price_reduction) ----
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
      z: 13,
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
      z: 14,
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
    id: `canvas_${cfg.idPrefix}_v6_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Magazine Cover · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v6",
    format,
    width: layout.width,
    height: layout.height,
    // why: cream background is the natural lower-panel color AND the
    // story-format's top safe-zone fill (between y=0 and y=250, before
    // the photo starts). Matches the V1 primitive's `body { background:
    // #FBF7EE }`. Sourced from the brand token so future brand evolutions
    // (e.g., shifting whiteWarm cooler) propagate everywhere.
    backgroundColor: ALLIANCE_COLORS.whiteWarm,
    backgroundImage: null,
    updatedAt: "2026-05-15T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: all 5 post types × 3 formats = 15 Magazine Cover templates.
 * The registry calls this once at module-load time alongside the v1 / v2 / v3
 * factory outputs. Returned templates are independent objects (no shared
 * mutable state between them) so they can be safely cached.
 */
export function buildAllMagazineCoverTemplates(): CanvasTemplateSchema[] {
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
      out.push(createMagazineCoverTemplate(pt, f));
    }
  }
  return out;
}
