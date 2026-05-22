/**
 * Just Sold Celebration template factory — `createJustSoldCelebrationTemplate(postType, format)`
 * -----------------------------------------------------------------------------------------------
 *
 * v9 JUST SOLD CELEBRATION — the brokerage's first variant designed AROUND a
 * closed deal rather than retrofitted from a listing card. The senior design
 * reviewer flagged that every just_sold today is just a regular listing
 * template with a small red "SOLD" stamp slapped on — a missed conversion
 * opportunity since closed deals are the brokerage's strongest social proof.
 *
 * This variant treats the closed deal as the visual hero:
 *
 *   • Full-bleed hero photo with a vertical dark-gradient scrim (top-clear →
 *     bottom-darkest) so the bottom-half headline type reads against any
 *     architecture photo without obscuring the home in the top half.
 *   • An angled gold sash banner across the upper region carrying the post-
 *     type word in heavy white tracked sans — rotated -7° for visual energy
 *     ("something happened"). On just_sold the sash says "JUST SOLD" and is
 *     intentionally the loudest element of the composition. On the other
 *     post types the sash tones down (still angled, still gold, but smaller
 *     and shorter) so the variant still feels high-energy without screaming
 *     "SOLD" on a Just Listed post.
 *   • Below the photo midline the close_price (or list price for non-sold
 *     types) renders HUGE in gold Playfair, with a small "SOLD FOR" / "LIST
 *     PRICE" / "NEW PRICE" / "OPEN HOUSE" eyebrow above it in tracked
 *     small-caps. Address + city sit below in tracked small-caps white.
 *   • A pair of gold star/sparkle accents (rendered as rotated diamond-rect
 *     shapes — the schema doesn't have a "star" primitive) flank the sash on
 *     just_sold to reinforce the confetti-drop energy. The other post types
 *     get a single right-side accent.
 *   • C21 ALLIANCE Grey badge anchors the top-right corner.
 *
 * Variant string: `"v9"`. Generates 15 templates (5 post types × 3 formats).
 *
 * Layer numbering (z) — kept monotonic for clarity, gaps allowed:
 *   z=0   hero photo (full-bleed)
 *   z=1   vertical dark-gradient scrim (top transparent → bottom 65% black)
 *   z=2   left sparkle accent          (just_sold only)
 *   z=3   right sparkle accent
 *   z=4   angled gold sash banner shape
 *   z=5   angled sash banner text      (JUST SOLD / NEW LISTING / etc.)
 *   z=6   small-caps eyebrow above the price ("SOLD FOR" / "LIST PRICE" / ...)
 *   z=7   price headline (huge gold Playfair) — or "UNDER CONTRACT" label
 *   z=8   thin gold underline rule below the price (editorial finisher)
 *   z=9   address line (small caps, tracked, warm-white)
 *   z=10  city line (small caps, tracked, warm-white)
 *   z=11  open-house italic gold line  (only when showOpenHouseLine)
 *   z=12  C21 ALLIANCE badge image     (top-right)
 *
 * Story-format note:
 *   The top 250px and bottom 200px of a story canvas are reserved for IG/FB
 *   overlays. The sash anchors at y≈340 (below the top safe zone), the price
 *   block centers around the canvas vertical midline (~960), and the address
 *   block ends at y≈1680 — well above the 1720 bottom-safe-zone threshold.
 */

import type {
  CanvasLayer,
  CanvasTemplateSchema,
  PostFormat,
  PostType,
} from "../types";
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
import { C21_ALLIANCE_WHITE_LOGO } from "./brand-logos";

// ---------------------------------------------------------------------------
// Brand asset
// ---------------------------------------------------------------------------

/**
 * C21 ALLIANCE White logo for Just Sold Celebration.
 *
 * Why white (not grey): the photo carries a dark gradient scrim from the
 * bottom up + the sash banner overlays the photo top-right. Both surfaces
 * are dark — the white wordmark reads everywhere. Resolved from the shared
 * brand-logos registry so a re-upload only touches one file.
 *
 * Rendered with `objectFit: "contain"` so the asset letterboxes inside its
 * rect without distortion.
 */
const C21_BADGE_URL = C21_ALLIANCE_WHITE_LOGO;

// ---------------------------------------------------------------------------
// Per-format layout numbers
// ---------------------------------------------------------------------------

/**
 * Layout numbers for a single format. Top-left origin, pixels at the
 * unmultiplied canvas resolution from PLATFORM_DIMENSIONS.
 */
interface FormatLayout {
  width: number;
  height: number;
  /** Vertical dark-gradient scrim — covers the LOWER half of the canvas. */
  scrim: { top: number; height: number };
  /** Angled sash banner — anchored in the upper region of the canvas. */
  sash: {
    /** Whether the sash spans full width (just_sold) or is shorter (others). */
    fullWidthLeft: number;
    fullWidthWidth: number;
    shortLeft: number;
    shortWidth: number;
    /** Sash height + font size for the banner word(s). */
    height: number;
    /** Vertical center of the sash band. */
    top: number;
    fullFontSize: number;
    shortFontSize: number;
    /** Rotation angle in degrees clockwise. */
    angle: number;
  };
  /** Small-caps eyebrow above the price headline. */
  eyebrow: {
    top: number;
    fontSize: number;
  };
  /** Huge price headline — the second hero of the composition. */
  price: {
    top: number;
    fullFontSize: number;
    /** Smaller font size when the price slot carries a literal label
     *  ("Under Contract") instead of a dollar amount. */
    labelFontSize: number;
  };
  /** Thin gold underline rule below the price. */
  priceRule: {
    top: number;
    width: number;
    height: number;
  };
  /** Address + city stacked below the price. */
  addressBlock: {
    addressTop: number;
    cityTop: number;
    fontSize: number;
  };
  /** Open-house italic gold line — slots between eyebrow and price. */
  openHouse: {
    top: number;
    fontSize: number;
  };
  /** Sparkle accents flanking the sash (diamond shapes rotated 45°). */
  sparkle: {
    leftX: number;
    rightX: number;
    /** Top edge of the sparkle's bounding rect. */
    y: number;
    size: number;
  };
  /** C21 ALLIANCE badge — top-right corner. */
  badge: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

// why: layouts are tuned per format so the sash + price + address block read
// at roughly the same visual proportions across portrait / story.
// The price always sits in the LOWER HALF of the canvas where the scrim
// guarantees legibility against bright hero photos.
const LAYOUTS: Record<PostFormat, FormatLayout> = {
  // ── Portrait 4:5 (1080×1350) ──────────────────────────────────────────────
  portrait_4x5: {
    width: 1080,
    height: 1350,
    scrim: {
      // why: scrim takes lower ~58% on portrait — leaves room above for the
      // taller sash + sparkles + breathing room over the home photo.
      top: 560,
      height: 790,
    },
    sash: {
      fullWidthLeft: -80,
      fullWidthWidth: 1240,
      shortLeft: 200,
      shortWidth: 680,
      height: 140,
      top: 230,
      fullFontSize: 98,
      shortFontSize: 60,
      angle: -7,
    },
    eyebrow: {
      top: 790,
      fontSize: 30,
    },
    price: {
      top: 836,
      fullFontSize: 156,
      labelFontSize: 88,
    },
    priceRule: {
      top: 1020,
      width: 260,
      height: 3,
    },
    addressBlock: {
      addressTop: 1056,
      cityTop: 1108,
      fontSize: 28,
    },
    openHouse: {
      top: 836,
      fontSize: 32,
    },
    sparkle: {
      leftX: 70,
      rightX: 940,
      y: 270,
      size: 68,
    },
    badge: {
      left: 820,
      top: 60,
      width: 200,
      height: 80,
    },
  },

  // ── Story 9:16 (1080×1920) ────────────────────────────────────────────────
  // why: sash anchors at y=380 (below 250 top safe zone); price block
  // centers around y=1140 (canvas midline +180); address ends at y≈1680
  // (above 1720 bottom safe zone).
  story_9x16: {
    width: 1080,
    height: 1920,
    scrim: {
      top: 840,
      height: 1080,
    },
    sash: {
      fullWidthLeft: -80,
      fullWidthWidth: 1240,
      shortLeft: 200,
      shortWidth: 680,
      height: 160,
      top: 380,
      fullFontSize: 116,
      shortFontSize: 72,
      angle: -7,
    },
    eyebrow: {
      top: 1080,
      fontSize: 34,
    },
    price: {
      top: 1132,
      fullFontSize: 196,
      labelFontSize: 112,
    },
    priceRule: {
      top: 1356,
      width: 300,
      height: 4,
    },
    addressBlock: {
      addressTop: 1400,
      cityTop: 1456,
      fontSize: 32,
    },
    openHouse: {
      top: 1132,
      fontSize: 36,
    },
    sparkle: {
      leftX: 70,
      rightX: 940,
      y: 420,
      size: 80,
    },
    badge: {
      // why: per Story safe zone, badge sits BELOW the 250px top overlay.
      left: 820,
      top: 280,
      width: 220,
      height: 90,
    },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming
// ---------------------------------------------------------------------------

interface PriceConfig {
  mode: "list" | "close" | "label";
  fallbackText: string;
  boundField: "price" | "close_price" | null;
  /** Small-caps eyebrow above the price headline. */
  eyebrow: string;
}

interface SashConfig {
  text: string;
  /** When true, the sash spans canvas-edge to canvas-edge in heavy type
   *  (used for just_sold — the hero moment). When false, a shorter
   *  centered sash sits over the upper region. */
  fullWidth: boolean;
}

interface PostTypeConfig {
  sash: SashConfig;
  price: PriceConfig;
  /** When true, render two sparkle accents (left + right). When false,
   *  only the right-side accent renders — keeps the non-sold variants
   *  high-energy without overdoing the confetti. */
  twoSparkles: boolean;
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
    sash: { text: "NEW LISTING", fullWidth: false },
    price: {
      mode: "list",
      fallbackText: "$849,000",
      boundField: "price",
      eyebrow: "LIST PRICE",
    },
    twoSparkles: false,
    showOpenHouseLine: false,
    templateNamePrefix: "New Listing",
    idPrefix: "just_listed",
    description: (f) =>
      `${describeFormat(f)} Just Sold Celebration applied to a new listing — angled gold sash with "NEW LISTING" over the home photo, list price huge in gold Playfair below.`,
  },
  just_sold: {
    // why: just_sold is THE variant's signature — sash is full-width and
    // shouts "JUST SOLD"; flanked by two sparkles; price is the hero number
    // and the small-caps eyebrow reads "SOLD FOR" to frame the close_price.
    sash: { text: "JUST SOLD", fullWidth: true },
    price: {
      mode: "close",
      fallbackText: "$815,000",
      boundField: "close_price",
      eyebrow: "SOLD FOR",
    },
    twoSparkles: true,
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} closed-deal celebration — full-width angled "JUST SOLD" sash, twin gold sparkles, oversized gold close price below. The signature look of the v9 variant.`,
  },
  under_contract: {
    sash: { text: "UNDER CONTRACT", fullWidth: false },
    // why: no dollar amount on under-contract posts; "Under Contract" sits
    // in the price slot as a literal label (no boundField — validator
    // exempts this category from the price/close_price binding requirement).
    price: {
      mode: "label",
      fallbackText: "Under Contract",
      boundField: null,
      eyebrow: "STATUS",
    },
    twoSparkles: false,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} pipeline-status celebration — angled "UNDER CONTRACT" sash over the photo, "Under Contract" label centered in the lower half.`,
  },
  open_house: {
    sash: { text: "OPEN HOUSE", fullWidth: false },
    price: {
      mode: "list",
      fallbackText: "$849,000",
      boundField: "price",
      eyebrow: "OFFERED AT",
    },
    twoSparkles: false,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} open-house celebration — angled "OPEN HOUSE" sash, italic gold date/time line above the offered-at price.`,
  },
  price_reduction: {
    sash: { text: "PRICE IMPROVED", fullWidth: false },
    price: {
      mode: "list",
      fallbackText: "$799,000",
      boundField: "price",
      eyebrow: "NEW PRICE",
    },
    twoSparkles: false,
    showOpenHouseLine: false,
    templateNamePrefix: "Price Improved",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} price-improvement celebration — angled "PRICE IMPROVED" sash over the photo, refreshed list price huge in gold below.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a single Just Sold Celebration template for the given
 * (postType, format). Deterministic — same inputs always produce the same
 * layer tree.
 *
 * @param postType — which of the five post categories
 * @param format   — which aspect ratio (portrait / story)
 * @returns a CanvasTemplateSchema ready to register in index.ts
 */
export function createJustSoldCelebrationTemplate(
  postType: PostType,
  format: PostFormat,
): CanvasTemplateSchema {
  const layout = LAYOUTS[format];
  const cfg = POST_TYPE_CONFIGS[postType];

  const formatShort: Record<PostFormat, string> = {
    portrait_4x5: "portrait",
    story_9x16: "story",
  };

  // ── derived sash geometry ───────────────────────────────────────────────
  const sashLeft = cfg.sash.fullWidth
    ? layout.sash.fullWidthLeft
    : layout.sash.shortLeft;
  const sashWidth = cfg.sash.fullWidth
    ? layout.sash.fullWidthWidth
    : layout.sash.shortWidth;
  const sashFontSize = cfg.sash.fullWidth
    ? layout.sash.fullFontSize
    : layout.sash.shortFontSize;
  // why: text layer's top must offset down inside the sash rect so the
  // baseline sits roughly centered. Sash rect top is layout.sash.top.
  const sashTextTop =
    layout.sash.top + Math.round((layout.sash.height - sashFontSize) / 2);

  // ── layer tree ──────────────────────────────────────────────────────────
  const layers: CanvasLayer[] = [
    // ---- z=0  hero photo (full-bleed) ----
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

    // ---- z=1  vertical dark-gradient scrim ----
    // why: a linear gradient (top transparent → bottom 65% black) is the
    // schema-native way to fade the bottom half of the photo so the price
    // + address type reads cleanly. ShapeLayer.fill accepts GradientFill;
    // angleDeg=90 is top-to-bottom (CSS convention). Two stops, in [0, 1].
    // Without the gradient the bottom half would be a flat dark rectangle
    // and the seam would clash with the photo above it.
    {
      kind: "shape",
      id: "layer_bottom_scrim",
      name: "Bottom gradient scrim",
      left: 0,
      top: layout.scrim.top,
      width: layout.width,
      height: layout.scrim.height,
      angle: 0,
      opacity: 1,
      z: 1,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: {
        kind: "linear",
        angleDeg: 90,
        stops: [
          { offset: 0, color: "#00000000" },
          { offset: 0.4, color: "#000000A6" },
          { offset: 1, color: "#000000E6" },
        ],
      },
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
  ];

  // ---- z=2  left sparkle accent (just_sold only) ----
  // why: a 45°-rotated gold square reads as a diamond/sparkle at small
  // sizes — the schema has no "star" primitive. Two on just_sold = twin
  // confetti accents flanking the sash; one on the other post types keeps
  // the energy without overdoing it.
  if (cfg.twoSparkles) {
    layers.push({
      kind: "shape",
      id: "layer_sparkle_left",
      name: "Sparkle accent (left)",
      left: layout.sparkle.leftX,
      top: layout.sparkle.y,
      width: layout.sparkle.size,
      height: layout.sparkle.size,
      angle: 45,
      opacity: 0.9,
      z: 2,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 6,
      strokeDashArray: [],
    });
  }

  // ---- z=3  right sparkle accent ----
  layers.push({
    kind: "shape",
    id: "layer_sparkle_right",
    name: "Sparkle accent (right)",
    left: layout.sparkle.rightX,
    top: layout.sparkle.y,
    width: layout.sparkle.size,
    height: layout.sparkle.size,
    angle: 45,
    opacity: 0.9,
    z: 3,
    visible: true,
    locked: false,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.gold500,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 6,
    strokeDashArray: [],
  });

  // ---- z=4  angled gold sash banner shape ----
  layers.push({
    kind: "shape",
    id: "layer_sash_shape",
    name: "Gold sash banner",
    left: sashLeft,
    top: layout.sash.top,
    width: sashWidth,
    height: layout.sash.height,
    angle: layout.sash.angle,
    opacity: 0.98,
    z: 4,
    visible: true,
    locked: false,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.gold500,
    // why: thin white stroke separates the sash from the photo behind it,
    // matching the badge-stamp treatment used on other v8/v2 templates.
    stroke: ALLIANCE_COLORS.white,
    strokeWidth: 3,
    cornerRadius: 4,
    strokeDashArray: [],
  });

  // ---- z=5  angled sash banner text ----
  layers.push({
    kind: "text",
    id: "layer_sash_text",
    name: `Sash banner — "${cfg.sash.text}"`,
    left: sashLeft,
    top: sashTextTop,
    width: sashWidth,
    height: sashFontSize + 12,
    angle: layout.sash.angle,
    opacity: 1,
    z: 5,
    visible: true,
    locked: false,
    text: cfg.sash.text,
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: sashFontSize,
    fontWeight: 900,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "center",
    lineHeight: 1,
    // why: heavy tracking (320/1000em) makes the banner read as a wide,
    // confident shout rather than a tight word — same rhythm as the bold-
    // stats status label.
    charSpacing: 320,
    underline: false,
    linethrough: false,
    editable: true,
    // why: a soft drop-shadow lifts the white type off the gold sash and
    // adds dimension — reinforces the celebratory energy without crossing
    // into chunky/cartoon territory.
    effect: {
      kind: "lift",
      opacity: 0.5,
    },
  });

  // ---- z=6  small-caps eyebrow above the price ----
  layers.push({
    kind: "text",
    id: "layer_price_eyebrow",
    name: `Price eyebrow — "${cfg.price.eyebrow}"`,
    left: 0,
    top: layout.eyebrow.top,
    width: layout.width,
    height: layout.eyebrow.fontSize + 10,
    angle: 0,
    opacity: 0.9,
    z: 6,
    visible: true,
    locked: false,
    text: cfg.price.eyebrow,
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.eyebrow.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "center",
    lineHeight: 1,
    charSpacing: 320,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=7  price headline (huge gold Playfair) or "Under Contract" label ----
  // why: this is the SECOND visual hero after the sash. For just_sold the
  // close_price is the punchline — render it at the largest font size in
  // the composition. For under_contract the "Under Contract" literal sits
  // in the same slot at a smaller size, in heavy sans (not serif) since
  // it's a status word, not a number.
  layers.push({
    kind: "text",
    id: "layer_price_headline",
    name:
      cfg.price.mode === "label" ? "Status (Under Contract)" : "Price headline",
    left: 0,
    top: layout.price.top,
    width: layout.width,
    height: layout.price.fullFontSize + 24,
    angle: 0,
    opacity: 1,
    z: 7,
    visible: true,
    locked: false,
    text: cfg.price.fallbackText,
    // why: spread the boundField key conditionally so under_contract (which
    // has no boundField) doesn't ship with `boundField: undefined` in JSON.
    ...(cfg.price.boundField ? { boundField: cfg.price.boundField } : {}),
    fontFamily:
      cfg.price.mode === "label"
        ? ALLIANCE_FONTS.bodySans
        : ALLIANCE_FONTS.playfair,
    fontSize:
      cfg.price.mode === "label"
        ? layout.price.labelFontSize
        : layout.price.fullFontSize,
    fontWeight: cfg.price.mode === "label" ? 800 : 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "center",
    lineHeight: 1,
    // why: dollar amounts read tighter at very large sizes (-20 ems);
    // the "Under Contract" label gets tracked out (+200) for emphasis.
    charSpacing: cfg.price.mode === "label" ? 200 : -20,
    underline: false,
    linethrough: false,
    editable: true,
    // why: a splice effect (offset duplicate with a darker outline) on the
    // big serif price gives it dimensional pop against the scrim — the
    // detail that makes "SOLD FOR $815,000" feel like a banner moment.
    // Skip on the label mode where it would muddy the smaller word.
    ...(cfg.price.mode === "label"
      ? {}
      : {
          effect: {
            kind: "splice" as const,
            offsetX: 4,
            offsetY: 4,
            outlineColor: ALLIANCE_COLORS.ink900,
            outlineWidth: 0,
          },
        }),
  });

  // ---- z=8  thin gold underline rule below the price ----
  // why: a small editorial flourish — closes the price's visual block and
  // separates it from the address stack below. 220-300px centered.
  const priceRuleLeft = Math.round(
    (layout.width - layout.priceRule.width) / 2,
  );
  layers.push({
    kind: "shape",
    id: "layer_price_rule",
    name: "Gold underline",
    left: priceRuleLeft,
    top: layout.priceRule.top,
    width: layout.priceRule.width,
    height: layout.priceRule.height,
    angle: 0,
    opacity: 1,
    z: 8,
    visible: true,
    locked: false,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.gold500,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 2,
    strokeDashArray: [],
  });

  // ---- z=9  address line (small caps, tracked, warm-white) ----
  layers.push({
    kind: "text",
    id: "layer_address_line",
    name: "Address",
    left: 0,
    top: layout.addressBlock.addressTop,
    width: layout.width,
    height: layout.addressBlock.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 9,
    visible: true,
    locked: false,
    text: "639 W SPRUCE AVENUE",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.addressBlock.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteWarm,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 240,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=10  city line (small caps, tracked, warm-white-dim) ----
  layers.push({
    kind: "text",
    id: "layer_city_line",
    name: "City",
    left: 0,
    top: layout.addressBlock.cityTop,
    width: layout.width,
    height: layout.addressBlock.fontSize + 10,
    angle: 0,
    opacity: 0.9,
    z: 10,
    visible: true,
    locked: false,
    text: "NORTH WILDWOOD",
    boundField: "city",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.addressBlock.fontSize,
    fontWeight: 500,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteDim,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 240,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=11  open-house italic gold line — only for open_house ----
  // why: for open_house the price slot stays at layout.price.top with the
  // offered-at amount; this italic date/time line sits between the eyebrow
  // and price by overriding its own y-position to layout.openHouse.top
  // which is set to the same top as the price block — but we render it
  // just above by sitting in the eyebrow's gap. Layered z=11 paints on top
  // of the eyebrow but BELOW the price (z=7)... actually z=11 > z=7 so it
  // sits ABOVE the price layer. Position is on the canvas-y axis so this
  // is fine — they don't overlap horizontally because the open-house line
  // is intentionally positioned NOT under the price. We rely on the y
  // position being just above the price block; in practice the layout
  // numbers set `openHouse.top === price.top` here so the line REPLACES
  // the visual real estate the price would take — meaning open_house
  // posts have the italic line where the dollar amount would otherwise
  // be... NO — re-read: we want italic line ABOVE the price still. Push
  // it up by ~50px.
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "text",
      id: "layer_open_house_line",
      name: "Open House date/time",
      left: 0,
      // why: tuck the italic line just under the eyebrow but above the
      // price block — `eyebrow.top + eyebrow.fontSize + 6px gap`.
      top: layout.eyebrow.top + layout.eyebrow.fontSize + 8,
      width: layout.width,
      height: layout.openHouse.fontSize + 10,
      angle: 0,
      opacity: 1,
      z: 11,
      visible: true,
      locked: false,
      text: "Saturday · 11:00 AM – 1:00 PM",
      boundField: "open_house_date",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.openHouse.fontSize,
      fontWeight: 500,
      fontStyle: "italic",
      fill: ALLIANCE_COLORS.gold500,
      textAlign: "center",
      lineHeight: 1.2,
      charSpacing: 80,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=12  C21 ALLIANCE badge image (top-right) ----
  layers.push({
    kind: "image",
    id: "layer_c21_badge",
    name: "C21 Alliance badge",
    left: layout.badge.left,
    top: layout.badge.top,
    width: layout.badge.width,
    height: layout.badge.height,
    angle: 0,
    opacity: 1,
    z: 12,
    visible: true,
    locked: false,
    src: C21_BADGE_URL,
    objectFit: "contain",
    crossOrigin: "anonymous",
    cornerRadius: 0,
    borderColor: "transparent",
    borderWidth: 0,
  });

  return {
    id: `canvas_${cfg.idPrefix}_v9_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Just Sold Celebration · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v9",
    format,
    width: layout.width,
    height: layout.height,
    // why: dark Obsessed-Grey backdrop in case the hero photo fails to
    // load — the scrim + type would still read on a near-black surface,
    // while a white background would flash visibly during photo load.
    backgroundColor: ALLIANCE_COLORS.ink900,
    backgroundImage: null,
    updatedAt: "2026-05-17T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: build all 5 post types × 3 formats = 15 Just Sold Celebration
 * templates. The registry (index.ts) calls this once at module-load time
 * alongside the other factory outputs.
 *
 * @returns array of 15 templates in (postType × format) outer-loop order.
 */
export function buildAllJustSoldCelebrationTemplates(): readonly CanvasTemplateSchema[] {
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
      out.push(createJustSoldCelebrationTemplate(pt, f));
    }
  }
  return out;
}

export default buildAllJustSoldCelebrationTemplates;
