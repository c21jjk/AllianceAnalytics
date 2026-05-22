/**
 * Coming Soon Teaser template factory — `createComingSoonTeaserTemplate(postType, format)`
 * -----------------------------------------------------------------------------------------
 *
 * v10 COMING SOON TEASER — the brokerage's first ANTICIPATORY variant. Where
 * v9 Just Sold Celebration is loud and triumphant (angled sashes, oversized
 * price headlines, gold sparkles), v10 is restrained, gated, "withholding."
 * The viewer should feel that something is coming and want to know more —
 * not have it given to them. NJ shore market timing makes pre-listing buzz a
 * conversion-critical post style: getting the neighborhood talking about a
 * property the WEEK BEFORE it hits MLS routinely wins listings.
 *
 * The visual mechanics that signal "we're not showing you the whole thing yet":
 *
 *   • Photo with a STRONG bottom-up dark vignette/scrim that obscures
 *     ~55-60% of the image — the lower half fades to near-black, hiding the
 *     foreground details. The top of the photo (typically sky/roofline) is
 *     left visible. Effect: viewer can tell "it's a house" but not "which
 *     house, at what address." For non-anticipatory post types (sold,
 *     under_contract, etc.) the same scrim is used but at lower intensity
 *     since there's no longer anything to withhold.
 *
 *   • Massive MIXED-WEIGHT headline in centered Playfair Display, the
 *     variant's signature element. Two layers butted side-by-side:
 *       - Word A in light Playfair (weight 300), warm-cream fill — soft,
 *         atmospheric, almost a whisper.
 *       - Word B in heavy Playfair (weight 900), gold500 fill — the anchor
 *         word that lands.
 *     For just_listed: "COMING / SOON" (the signature use case). For other
 *     post types: "JUST / SOLD", "UNDER / CONTRACT", "OPEN / HOUSE", "NEW /
 *     PRICE" — same mixed-weight technique adapted to the post type. The
 *     headline sits centered in the canvas's vertical middle so the eye
 *     lands on it BEFORE the photo registers — the photo becomes context
 *     rather than the subject.
 *
 *   • A small-caps tracked subhead below the headline ("BE THE FIRST TO
 *     SEE IT" for just_listed; subhead suppressed for other post types
 *     since the eyebrow is no longer ambiguous). The line is intentionally
 *     short and gold so it reads as a hand-set marquee invitation rather
 *     than a marketing tagline.
 *
 *   • A thin GOLD HAIRLINE RULE flanks the headline horizontally — a single
 *     line of refinement that frames the type without enclosing it in a
 *     box. Box treatments would feel "complete"; an open hairline feels
 *     "in progress."
 *
 *   • Address withheld. For just_listed the address slot reads literally
 *     "ADDRESS COMING SOON" in tracked small-caps gold, with the city
 *     resolved (so the neighborhood gets a tease but the door doesn't).
 *     For other post types the actual address resolves normally — no
 *     point withholding info on a closed deal.
 *
 *   • Price is REQUIRED by the validator for non-under_contract types but
 *     visually de-emphasized on the just_listed variant: small, opaque-but-
 *     dim, tucked just under the city as a "starting" line ("STARTING AT
 *     $XXX,XXX"). For sold/open_house/price_reduction the price renders at
 *     normal size since withholding it would be self-defeating.
 *
 *   • C21 ALLIANCE Grey badge anchors the top-right corner — same brand-
 *     anchor pattern as v8/v9.
 *
 *   • Negative space is the LOUDEST element. The top half of the canvas
 *     stays photo + headline, the bottom third is the dark scrim with a
 *     small block of type, and ~20% of the canvas is intentionally empty
 *     gold-on-black breathing room above and below the headline. This is
 *     the opposite of v9's edge-to-edge sash energy.
 *
 * Variant string: `"v10"`. Generates 15 templates (5 post types × 3 formats).
 *
 * Layer numbering (z) — monotonic, gaps allowed:
 *   z=0   hero photo (full-bleed)
 *   z=1   bottom-up dark gradient scrim (the "veil" — covers lower 55-60%)
 *   z=2   left gold hairline rule (flanks headline)
 *   z=3   right gold hairline rule
 *   z=4   headline word A (light Playfair, warm-cream)   ─ mixed-weight pair
 *   z=5   headline word B (heavy Playfair, gold)         ─ mixed-weight pair
 *   z=6   subhead          (small-caps tracked gold, just_listed only)
 *   z=7   address line     ("ADDRESS COMING SOON" or resolved)
 *   z=8   city line        (resolved)
 *   z=9   price line       (de-emphasized on just_listed, normal otherwise)
 *   z=10  open-house italic line (open_house only)
 *   z=11  C21 ALLIANCE badge image
 *
 * Story-format safe zones (250px top / 200px bottom):
 *   The badge sits at y≈280 (below top safe zone). The headline centers around
 *   y≈960 (canvas midline). The address/city/price block ends at y≈1680, well
 *   above the 1720 bottom-safe-zone threshold.
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
 * C21 ALLIANCE White logo for Coming Soon Teaser.
 *
 * Why white (not grey): the photo has a heavy bottom-up dark veil and the
 * teaser word stack sits over the darkest part. The brand badge anchors
 * the top-right corner — and most photos have a brighter sky at the top,
 * but the badge still benefits from white-on-photo legibility for the
 * occasional dusk/night listing photo. Resolved from the shared brand-logos
 * registry so a re-upload only touches one file.
 */
const C21_BADGE_URL = C21_ALLIANCE_WHITE_LOGO;

// ---------------------------------------------------------------------------
// Per-format layout numbers
// ---------------------------------------------------------------------------

/**
 * Layout numbers for a single format. Top-left origin, pixels at the
 * unmultiplied canvas resolution from PLATFORM_DIMENSIONS.
 *
 * The composition anchors on the canvas's VERTICAL CENTER — the headline
 * lands at ~52% of canvas height for square/portrait and ~50% for story.
 * Above the headline: just the photo + a brand badge in the top-right.
 * Below the headline: scrim, subhead, address/city/price block.
 */
interface FormatLayout {
  width: number;
  height: number;
  /** Bottom-up dark gradient scrim — covers lower 55-60% of the canvas. */
  scrim: { top: number; height: number };
  /** Mixed-weight headline — two layers butted side-by-side. */
  headline: {
    /** Vertical position (top edge) of both headline words. */
    top: number;
    /** Font size for both words (same size, different weight + fill). */
    fontSize: number;
    /** Pixel gap between word A and word B (sized to roughly one space). */
    gap: number;
    /** Per-character pixel estimate for sizing the layer boxes. */
    perCharWidthEstimate: number;
  };
  /** Gold hairline rules flanking the headline. */
  hairline: {
    /** Vertical center of the hairline (matches headline midline). */
    centerY: number;
    /** Length of each hairline (left + right are mirrored). */
    width: number;
    height: number;
    /** Horizontal gap between the hairline's inner edge and the headline. */
    gapFromHeadline: number;
  };
  /** Small-caps subhead below the headline (just_listed only). */
  subhead: {
    top: number;
    fontSize: number;
  };
  /** Address + city + price stack below the subhead. */
  textBlock: {
    addressTop: number;
    cityTop: number;
    priceTop: number;
    fontSize: number;
    priceFontSizeNormal: number;
    /** Smaller price size used on just_listed (de-emphasized). */
    priceFontSizeDimmed: number;
  };
  /** Open-house italic line (open_house only) — slots above the address. */
  openHouse: {
    top: number;
    fontSize: number;
  };
  /** C21 ALLIANCE badge — top-right corner. */
  badge: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

// why: each format positions the headline near the canvas vertical center so
// the eye lands on the mixed-weight type before registering the photo. The
// scrim's top edge sits just BELOW the headline midline so the headline reads
// against the still-visible top half of the photo while the bottom half fades
// to near-black behind the address/price block. Negative space (empty scrim)
// surrounds the lower text block to reinforce the "whispered" feel.
const LAYOUTS: Record<PostFormat, FormatLayout> = {
  // ── Square 1:1 (1080×1080) ────────────────────────────────────────────────

  // ── Portrait 4:5 (1080×1350) ──────────────────────────────────────────────
  portrait_4x5: {
    width: 1080,
    height: 1350,
    scrim: {
      // why: scrim starts at y=620 and runs to the bottom — covers ~54%.
      top: 620,
      height: 730,
    },
    headline: {
      // why: y=560 → midline ~635 (canvas vertical center is 675, so headline
      // sits just ABOVE center which reads as "premium magazine" alignment).
      top: 560,
      fontSize: 132,
      gap: 42,
      perCharWidthEstimate: 78,
    },
    hairline: {
      centerY: 626,
      width: 96,
      height: 1,
      gapFromHeadline: 42,
    },
    subhead: {
      top: 740,
      fontSize: 24,
    },
    textBlock: {
      addressTop: 1080,
      cityTop: 1128,
      priceTop: 1192,
      fontSize: 24,
      priceFontSizeNormal: 72,
      priceFontSizeDimmed: 24,
    },
    openHouse: {
      top: 1032,
      fontSize: 24,
    },
    badge: {
      left: 820,
      top: 60,
      width: 200,
      height: 80,
    },
  },

  // ── Story 9:16 (1080×1920) ────────────────────────────────────────────────
  // why: badge anchors at y=280 (below 250px top safe zone). Headline centers
  // around y=940 (just above canvas midline 960). Address/price stack ends
  // around y≈1680 — clear of the 1720 bottom safe zone.
  story_9x16: {
    width: 1080,
    height: 1920,
    scrim: {
      // why: scrim starts at y=900 and runs ~1020px to the bottom — covers
      // ~53%. Top of scrim sits 60px below the headline midline so headline
      // reads against the photo, not against the scrim's dark band.
      top: 900,
      height: 1020,
    },
    headline: {
      // why: y=840 → midline ~926; canvas midline is 960 so the headline
      // sits just above true center, leaving ~70px of "anticipation" between
      // the headline and the dark scrim below.
      top: 840,
      fontSize: 168,
      gap: 52,
      perCharWidthEstimate: 100,
    },
    hairline: {
      centerY: 926,
      width: 124,
      height: 2,
      gapFromHeadline: 52,
    },
    subhead: {
      top: 1056,
      fontSize: 28,
    },
    textBlock: {
      addressTop: 1496,
      cityTop: 1552,
      priceTop: 1620,
      fontSize: 28,
      priceFontSizeNormal: 88,
      priceFontSizeDimmed: 28,
    },
    openHouse: {
      top: 1444,
      fontSize: 28,
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
  /** When true, render the price at the dimmed/smaller size (used on
   *  just_listed where the price is withheld-ish, present only to satisfy
   *  the validator + give buyers a starting reference). */
  dimmed: boolean;
  /** Optional prefix text appended in the layer's literal — "STARTING AT"
   *  for just_listed; null for normal post types. */
  prefix: string | null;
}

interface PostTypeConfig {
  /**
   * Mixed-weight headline split. `wordA` renders light + warm-cream (soft
   * descriptor); `wordB` renders heavy + gold (the anchor word that lands).
   */
  headlineWordA: string;
  headlineWordB: string;
  price: PriceConfig;
  /**
   * Subhead below the headline — only set for just_listed (the signature
   * "BE THE FIRST TO SEE IT" tease). null for other post types where the
   * headline alone carries the message.
   */
  subhead: string | null;
  /** When true, the address resolves to a withheld literal instead of the
   *  bound field. Only true for just_listed (the signature withholding). */
  withholdAddress: boolean;
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
    // why: the signature use case — "COMING SOON" mixed-weight is THE v10
    // hero. Light "COMING" whispers; heavy gold "SOON" lands.
    headlineWordA: "COMING",
    headlineWordB: "SOON",
    price: {
      mode: "list",
      fallbackText: "$849,000",
      boundField: "price",
      // why: price is required by the validator but on just_listed we
      // intentionally minimize it — render small + dim under a "STARTING AT"
      // eyebrow so the dollar figure feels like reference info, not the
      // headline. The tease is the headline, not the number.
      dimmed: true,
      prefix: "STARTING AT",
    },
    subhead: "BE THE FIRST TO SEE IT",
    withholdAddress: true,
    showOpenHouseLine: false,
    templateNamePrefix: "Coming Soon",
    idPrefix: "just_listed",
    description: (f) =>
      `${describeFormat(f)} pre-market teaser — mixed-weight "COMING SOON" headline over a partially obscured photo, address withheld, "BE THE FIRST TO SEE IT" subhead. The v10 signature look for pre-listing buzz.`,
  },
  just_sold: {
    headlineWordA: "JUST",
    headlineWordB: "SOLD",
    price: {
      mode: "close",
      fallbackText: "$815,000",
      boundField: "close_price",
      // why: no withholding on a closed deal — surface the close price at
      // normal Playfair-gold size as the secondary visual anchor below the
      // headline. The teaser composition still applies (scrim, hairlines,
      // negative space) but the data is fully revealed.
      dimmed: false,
      prefix: null,
    },
    subhead: null,
    withholdAddress: false,
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} restrained closed-deal poster — mixed-weight "JUST SOLD" headline over a vignetted photo, close price + address revealed below. Same teaser composition as the just_listed variant but without the withholding.`,
  },
  under_contract: {
    headlineWordA: "UNDER",
    headlineWordB: "CONTRACT",
    // why: no dollar amount on under-contract posts; the validator exempts
    // this category from the price/close_price binding requirement. We omit
    // the price layer entirely — the headline IS the message.
    price: {
      mode: "label",
      fallbackText: "",
      boundField: null,
      dimmed: false,
      prefix: null,
    },
    subhead: null,
    withholdAddress: false,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} restrained pipeline-status poster — mixed-weight "UNDER CONTRACT" headline over a vignetted photo, address revealed below. No price (per the category's validator exemption).`,
  },
  open_house: {
    headlineWordA: "OPEN",
    headlineWordB: "HOUSE",
    price: {
      mode: "list",
      fallbackText: "$849,000",
      boundField: "price",
      dimmed: false,
      prefix: null,
    },
    subhead: "THIS WEEKEND",
    withholdAddress: false,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} restrained open-house invitation — mixed-weight "OPEN HOUSE" headline over a vignetted photo, italic gold date/time line above the price block.`,
  },
  price_reduction: {
    headlineWordA: "NEW",
    headlineWordB: "PRICE",
    price: {
      mode: "list",
      fallbackText: "$799,000",
      boundField: "price",
      dimmed: false,
      prefix: null,
    },
    subhead: null,
    withholdAddress: false,
    showOpenHouseLine: false,
    templateNamePrefix: "New Price",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} restrained price-improvement poster — mixed-weight "NEW PRICE" headline over a vignetted photo, refreshed list price revealed below.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a single Coming Soon Teaser template for the given (postType, format).
 * Deterministic — same inputs always produce the same layer tree.
 *
 * @param postType — which of the five post categories
 * @param format   — which aspect ratio (square / portrait / story)
 * @returns a CanvasTemplateSchema ready to register in index.ts
 */
export function createComingSoonTeaserTemplate(
  postType: PostType,
  format: PostFormat,
): CanvasTemplateSchema {
  const layout = LAYOUTS[format];
  const cfg = POST_TYPE_CONFIGS[postType];

  const formatShort: Record<PostFormat, string> = {
    portrait_4x5: "portrait",
    story_9x16: "story",
  };

  // ── derived headline geometry ───────────────────────────────────────────
  // why: same per-character estimation pattern as the v3 Excellence Collection
  // factory — each word's layer width is approximated from
  // `perCharWidthEstimate × word.length`, then the two layers are positioned
  // side-by-side with a fixed pixel gap. textAlign:"center" inside each layer
  // means a slight over-allocation just adds horizontal padding around the
  // word — never a visual misalignment.
  const wordAWidth = Math.round(
    cfg.headlineWordA.length * layout.headline.perCharWidthEstimate,
  );
  const wordBWidth = Math.round(
    cfg.headlineWordB.length * layout.headline.perCharWidthEstimate,
  );
  const headlineTotalWidth = wordAWidth + layout.headline.gap + wordBWidth;
  const headlineLeftA = Math.round((layout.width - headlineTotalWidth) / 2);
  const headlineLeftB = headlineLeftA + wordAWidth + layout.headline.gap;

  // ── derived hairline geometry ───────────────────────────────────────────
  // why: hairlines flank the OUTER edges of the headline at the headline's
  // visual midline. Left hairline ends at (headlineLeftA - gapFromHeadline);
  // right hairline starts at (headlineLeftA + headlineTotalWidth + gap).
  const hairlineLeftRight =
    headlineLeftA - layout.hairline.gapFromHeadline - layout.hairline.width;
  const hairlineRightLeft =
    headlineLeftA + headlineTotalWidth + layout.hairline.gapFromHeadline;
  const hairlineTop = layout.hairline.centerY - Math.round(layout.hairline.height / 2);

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

    // ---- z=1  bottom-up dark gradient scrim (the "veil") ----
    // why: a top-to-bottom linear gradient with stops calibrated to fade IN
    // quickly. The top edge starts already at 45% black so the headline (which
    // sits ABOVE the scrim) has a soft transition behind it, then ramps to
    // 95% black at the bottom — obscuring foreground details on the just_listed
    // signature use case. On other post types the same scrim runs but the
    // address/price block reads against the dark bottom rather than veiling
    // hidden information.
    {
      kind: "shape",
      id: "layer_bottom_veil",
      name: "Bottom veil scrim",
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
          // why: starts at ~45% black to soften the seam where the scrim
          // meets the photo above — a hard line would feel like a horizon
          // crop rather than a veil.
          { offset: 0, color: "#00000073" },
          { offset: 0.35, color: "#000000B3" },
          { offset: 1, color: "#000000F2" },
        ],
      },
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 0,
      strokeDashArray: [],
    },
  ];

  // ---- z=2  left gold hairline rule ----
  // why: two thin gold lines flank the headline horizontally — refinement
  // marks that frame the type without enclosing it. An open hairline reads
  // "in progress / about to begin"; a box would read "complete." Same visual
  // language as a luxury invitation card.
  layers.push({
    kind: "shape",
    id: "layer_hairline_left",
    name: "Hairline rule (left)",
    left: hairlineLeftRight,
    top: hairlineTop,
    width: layout.hairline.width,
    height: layout.hairline.height,
    angle: 0,
    opacity: 0.85,
    z: 2,
    visible: true,
    locked: false,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.gold500,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 0,
    strokeDashArray: [],
  });

  // ---- z=3  right gold hairline rule ----
  layers.push({
    kind: "shape",
    id: "layer_hairline_right",
    name: "Hairline rule (right)",
    left: hairlineRightLeft,
    top: hairlineTop,
    width: layout.hairline.width,
    height: layout.hairline.height,
    angle: 0,
    opacity: 0.85,
    z: 3,
    visible: true,
    locked: false,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.gold500,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 0,
    strokeDashArray: [],
  });

  // ---- z=4  headline word A (light Playfair, warm-cream) ----
  // why: light weight 300 in warm-cream against the photo gives the word a
  // "soft / whispered" feel — almost dissolving into the background. The
  // soft lift effect adds just enough shadow contrast to keep the type
  // legible without sharpening it into a "hard" headline.
  layers.push({
    kind: "text",
    id: "layer_headline_word_a",
    name: `Headline "${cfg.headlineWordA}"`,
    left: headlineLeftA,
    top: layout.headline.top,
    width: wordAWidth,
    height: layout.headline.fontSize + 24,
    angle: 0,
    opacity: 0.92,
    z: 4,
    visible: true,
    locked: false,
    text: cfg.headlineWordA,
    fontFamily: ALLIANCE_FONTS.playfair,
    fontSize: layout.headline.fontSize,
    // why: thin weight 300 reads as "atmospheric / preliminary." 100/200 would
    // disappear at thumbnail size; 400 would compete with the heavy anchor.
    fontWeight: 300,
    fontStyle: "italic",
    // why: warm-cream (FBF7EE) fills against a dark veiled photo. White would
    // feel clinical; warm-cream matches the gold accents in temperature.
    fill: ALLIANCE_COLORS.whiteWarm,
    textAlign: "center",
    lineHeight: 1,
    // why: open tracking (60/1000em) gives the light word "breath" — italic
    // characters need a touch more space to avoid optical crowding.
    charSpacing: 60,
    underline: false,
    linethrough: false,
    editable: true,
    effect: {
      kind: "lift",
      opacity: 0.45,
    },
  });

  // ---- z=5  headline word B (heavy Playfair, gold — the anchor) ----
  // why: weight 900 + gold500 + tightly tracked → the word that LANDS.
  // High contrast against word A creates the mixed-weight rhythm that signals
  // "premium editorial" — same technique the v3 Excellence Collection uses
  // for "NEW LISTING" but with weights flipped (v3 outlines word A; v10
  // fills both, contrast comes from weight + color).
  layers.push({
    kind: "text",
    id: "layer_headline_word_b",
    name: `Headline "${cfg.headlineWordB}"`,
    left: headlineLeftB,
    top: layout.headline.top,
    width: wordBWidth,
    height: layout.headline.fontSize + 24,
    angle: 0,
    opacity: 1,
    z: 5,
    visible: true,
    locked: false,
    text: cfg.headlineWordB,
    fontFamily: ALLIANCE_FONTS.playfair,
    fontSize: layout.headline.fontSize,
    // why: weight 900 is the heaviest Playfair available — the anchor word
    // needs to "land" with maximum gravity to balance the airy word A.
    fontWeight: 900,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "center",
    lineHeight: 1,
    // why: tight tracking (-20/1000em) on the heavy word — dense letterforms
    // amplify the weight contrast against word A's spaced-out italics.
    charSpacing: -20,
    underline: false,
    linethrough: false,
    editable: true,
    effect: {
      kind: "lift",
      opacity: 0.4,
    },
  });

  // ---- z=6  subhead (small-caps tracked gold) — only when set ----
  // why: short, hand-set marquee invitation. Suppressed on most post types
  // because the mixed-weight headline already carries the message.
  if (cfg.subhead) {
    layers.push({
      kind: "text",
      id: "layer_subhead",
      name: `Subhead — "${cfg.subhead}"`,
      left: 0,
      top: layout.subhead.top,
      width: layout.width,
      height: layout.subhead.fontSize + 10,
      angle: 0,
      opacity: 0.85,
      z: 6,
      visible: true,
      locked: false,
      text: cfg.subhead,
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.subhead.fontSize,
      // why: weight 600 + tracked = clean small-caps marquee. Heavier would
      // compete with the headline; lighter would dissolve.
      fontWeight: 600,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.gold500,
      textAlign: "center",
      lineHeight: 1,
      // why: wide tracking (380/1000em) reads as a hand-set sign — the visual
      // equivalent of a velvet rope.
      charSpacing: 380,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=10  open-house italic gold line — only for open_house ----
  // why: layered BEFORE the address block so it sits just above the address
  // row visually. z=10 is fine — it doesn't overlap with the headline or
  // hairlines, only with the address stack below it.
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "text",
      id: "layer_open_house_line",
      name: "Open House date/time",
      left: 0,
      top: layout.openHouse.top,
      width: layout.width,
      height: layout.openHouse.fontSize + 10,
      angle: 0,
      opacity: 1,
      z: 10,
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

  // ---- z=7  address line (withheld literal OR resolved bound field) ----
  // why: for just_listed the address is the central tease — render a literal
  // "ADDRESS COMING SOON" instead of binding to address_line1. For all other
  // post types, bind normally. The layer always exists at the same z-position
  // so the visual rhythm is identical across post types.
  layers.push({
    kind: "text",
    id: "layer_address_line",
    name: cfg.withholdAddress ? "Address (withheld)" : "Address",
    left: 0,
    top: layout.textBlock.addressTop,
    width: layout.width,
    height: layout.textBlock.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 7,
    visible: true,
    locked: false,
    text: cfg.withholdAddress
      ? "ADDRESS COMING SOON"
      : "639 W SPRUCE AVENUE",
    // why: spread the boundField key conditionally — when withheld, no
    // hydration should overwrite the literal "ADDRESS COMING SOON" string.
    ...(cfg.withholdAddress ? {} : { boundField: "address_line1" as const }),
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.textBlock.fontSize,
    fontWeight: 700,
    fontStyle: "normal",
    // why: gold500 on the withheld address gives it a "marquee" feel — a
    // gold line of teaser type. On resolved addresses use warm-cream so the
    // address reads as info rather than ornament.
    fill: cfg.withholdAddress
      ? ALLIANCE_COLORS.gold500
      : ALLIANCE_COLORS.whiteWarm,
    textAlign: "center",
    lineHeight: 1.2,
    // why: wide tracking matches the subhead's marquee rhythm.
    charSpacing: 280,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=8  city line (always resolved — gives neighborhood tease) ----
  // why: even on just_listed where the address is withheld, the CITY resolves
  // normally — "ADDRESS COMING SOON" in the line above + the actual city
  // below gives the neighborhood a tease without surrendering the door.
  layers.push({
    kind: "text",
    id: "layer_city_line",
    name: "City",
    left: 0,
    top: layout.textBlock.cityTop,
    width: layout.width,
    height: layout.textBlock.fontSize + 10,
    angle: 0,
    opacity: 0.9,
    z: 8,
    visible: true,
    locked: false,
    text: "NORTH WILDWOOD",
    boundField: "city",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.textBlock.fontSize,
    fontWeight: 500,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.whiteDim,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 280,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=9  price line (required by validator on non-under_contract) ----
  // why: under_contract is exempt from the price binding rule — omit the
  // layer entirely. For just_listed render small + dim with a "STARTING AT"
  // prefix so the figure feels like reference info, not the headline. For
  // sold/open_house/price_reduction render at normal Playfair-gold size
  // since withholding price would be self-defeating on a closed/active deal.
  if (cfg.price.mode !== "label") {
    const priceFontSize = cfg.price.dimmed
      ? layout.textBlock.priceFontSizeDimmed
      : layout.textBlock.priceFontSizeNormal;
    // why: when dimmed, prepend the prefix as a single line so the layer
    // resolves to e.g. "STARTING AT $849,000" — keeps the boundField on the
    // layer (price is required by the validator) while letting the prefix
    // sit on the same line. At hydration time the boundField text REPLACES
    // the literal, so the prefix would normally be lost; we accept that
    // tradeoff because the visual treatment (small, dim, tracked) already
    // signals "reference info" without the literal prefix word. Future
    // hydration could string-template the prefix back in; for now the
    // boundField alone is sufficient on hydrated output.
    const priceLiteral = cfg.price.prefix
      ? `${cfg.price.prefix}  ${cfg.price.fallbackText}`
      : cfg.price.fallbackText;
    layers.push({
      kind: "text",
      id: "layer_price",
      name: "Price",
      left: 0,
      top: layout.textBlock.priceTop,
      width: layout.width,
      height: priceFontSize + 16,
      angle: 0,
      opacity: cfg.price.dimmed ? 0.75 : 1,
      z: 9,
      visible: true,
      locked: false,
      text: priceLiteral,
      // why: bound field is REQUIRED for non-under_contract by the validator
      // (invariant 6). Type-narrowed inside this branch to a non-null union.
      ...(cfg.price.boundField
        ? { boundField: cfg.price.boundField }
        : {}),
      // why: serif Playfair for the bold-mode price (luxury convention);
      // small sans for the dimmed/"starting at" presentation on just_listed.
      fontFamily: cfg.price.dimmed
        ? ALLIANCE_FONTS.bodySans
        : ALLIANCE_FONTS.playfair,
      fontSize: priceFontSize,
      fontWeight: cfg.price.dimmed ? 600 : 700,
      fontStyle: "normal",
      // why: gold500 keeps the price visually tied to the headline + hairlines.
      // On just_listed the lower opacity + smaller size handles the
      // de-emphasis; the color stays gold for brand consistency.
      fill: ALLIANCE_COLORS.gold500,
      textAlign: "center",
      lineHeight: 1,
      // why: dimmed price gets wide tracking (marquee feel matching subhead);
      // normal price gets tight tracking (dollar amounts read tighter at
      // large sizes).
      charSpacing: cfg.price.dimmed ? 280 : -20,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=11  C21 ALLIANCE badge image (top-right) ----
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
    z: 11,
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
    id: `canvas_${cfg.idPrefix}_v10_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Coming Soon Teaser · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v10",
    format,
    width: layout.width,
    height: layout.height,
    // why: dark Obsessed-Grey backdrop in case the hero photo fails to load —
    // the scrim + type would still read on a near-black surface. White
    // backgrounds flash visibly during photo load on a teaser composition
    // where mood is the entire point.
    backgroundColor: ALLIANCE_COLORS.ink900,
    backgroundImage: null,
    updatedAt: "2026-05-17T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: build all 5 post types × 3 formats = 15 Coming Soon Teaser
 * templates. The registry (index.ts) calls this once at module-load time
 * alongside the other factory outputs.
 *
 * @returns array of 15 templates in (postType × format) outer-loop order.
 */
export function buildAllComingSoonTeaserTemplates(): readonly CanvasTemplateSchema[] {
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
      out.push(createComingSoonTeaserTemplate(pt, f));
    }
  }
  return out;
}

export default buildAllComingSoonTeaserTemplates;
