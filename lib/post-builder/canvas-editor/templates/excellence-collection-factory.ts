/**
 * Excellence Collection template factory — `createExcellenceCollectionTemplate(postType, format)`
 * -----------------------------------------------------------------------------------------------
 *
 * v3 Excellence Collection — the brokerage's premium-tier layout. Replaces the
 * older "Side-by-Side" v3 (which was a horizontally-split magazine listing
 * card). Excellence Collection is automatically used for listings priced
 * ≥ $949,000 and is the most restrained of the catalog: a luxury-magazine
 * cover, big mixed-weight type, generous white space, a thin gold rule.
 *
 *   • v1 Hero Editorial         — full-bleed photo + dark scrim
 *   • v2 Bold Stats             — 60/40 split, photo over dark data pane
 *   • v3 Excellence Collection  — premium poster, framed photo, big serif type   ← this file
 *   • v6 Magazine Cover         — overlapping cover-text-over-photo
 *   • v7 Polaroid               — playful taped-down snapshot
 *   • v8 Minimal Frame          — gallery-poster minimalism (close cousin of v3)
 *
 * Generates 15 templates: 5 post types × 3 formats.
 *
 * Design parity with the reference sample (real FB post the brokerage
 * published — see project_alliance_template_rebuild_plan_2026-05-17.md):
 *
 *   [Excellence Collection logo, centered top]
 *
 *   NEW LISTING                (huge mixed-weight serif — "NEW"
 *                               in lighter outlined gold, "LISTING"
 *                               in solid dark)
 *
 *   [Hero photo with generous white margin around it,
 *    not edge-to-edge]
 *
 *   ──────────── gold horizontal divider ────────────
 *
 *   $2,950,000                  (big gold serif)
 *
 *   1934 WEST AVENUE | OCEAN CITY        (small caps, centered)
 *
 *   No bed/bath, no MLS#, no feature row, no badge stamp. Stays minimal.
 *
 * Signature look — mixed-weight eyebrow:
 *   The "NEW LISTING" eyebrow is TWO text layers side-by-side:
 *     • "NEW" / "NEWLY" / "UNDER" / "OPEN" — hollow gold (outline effect),
 *       smaller weight; reads as the descriptor.
 *     • "LISTING" / "SOLD" / "CONTRACT" / "HOUSE" / "PRICE" — solid ink900,
 *       heavy weight; reads as the anchor word.
 *   Splitting the eyebrow into two layers (rather than one layer with mixed
 *   formatting) is necessary because the TextLayer schema applies one
 *   font-weight + fill + effect across the whole string. The two layers are
 *   precomputed to butt up against each other with a single-space-width gap.
 *
 * Address line at the bottom — STREET | CITY:
 *   Three text layers (street + pipe + city) arranged horizontally. The pipe
 *   character lives in its own layer so we don't depend on the rendered
 *   width of `boundField`-resolved text matching the literal placeholder —
 *   if `address_line1` resolves to a long street name, the pipe + city
 *   layers still hold their absolute positions. The visual effect of "street
 *   centered on the canvas with pipe + city trailing" is close enough; we
 *   accept a small horizontal drift on extreme address lengths in exchange
 *   for layout simplicity. See the `addressRow` block below for the math.
 *
 * Story-format safe zones:
 *   IG/FB Story top overlay covers ~250px; the bottom caption/sticker area
 *   covers ~200px. We keep the logo at top=120 (above the safe zone is fine
 *   since the logo IS a brand mark — the overlay obscuring half of it would
 *   only be a problem for time-sensitive content), but the eyebrow is at
 *   y=300 (clear of overlay) and the bottom address line ends at y≈1690
 *   (clear of the bottom 1720 safe-zone boundary).
 *
 * Layer numbering (z) — kept monotonic, gaps allowed:
 *   z=0   logo (Excellence Collection mark, centered top, literal URL)
 *   z=1   eyebrow word A    ("NEW" — outlined gold)
 *   z=2   eyebrow word B    ("LISTING" — solid ink)
 *   z=3   hero photo        (boundField: hero_photo)
 *   z=4   gold divider rule (horizontal, below the photo)
 *   z=5   price             (Playfair gold) OR "UNDER CONTRACT" label (under_contract)
 *   z=6   open-house line   (italic gold, only for open_house)
 *   z=7   address street    (boundField: address_line1)
 *   z=8   address pipe      ("|", static)
 *   z=9   address city      (boundField: city)
 *
 * Why no badge stamp on Excellence Collection:
 *   The eyebrow already conveys post_type ("NEWLY SOLD", "NEW PRICE", etc).
 *   A rotated red SOLD stamp in the corner would clash with the minimalist
 *   editorial aesthetic — same call the V1 primitives made for this variant.
 */

import type {
  CanvasLayer,
  CanvasTemplateSchema,
  PostFormat,
  PostType,
} from "../types";
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";

// ---------------------------------------------------------------------------
// Logo asset
// ---------------------------------------------------------------------------

/**
 * Excellence Collection logo — uploaded via the brand-assets pipeline. Native
 * dimensions are 3600×2025 (a wide horizontal mark). The image layer renders
 * with `objectFit: "contain"` so the layer's bounding box dictates the
 * displayed size + the logo letterboxes inside it without distortion.
 */
const EXCELLENCE_LOGO_URL =
  "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/f07233b0-a22b-4595-bc06-98cddd65e993.png";

/** Logo's native aspect ratio (width / height). Drives the rendered height
 *  given a chosen width per format. 3600/2025 ≈ 1.7778. */
const LOGO_ASPECT_RATIO = 3600 / 2025;

// ---------------------------------------------------------------------------
// Per-format layout numbers
// ---------------------------------------------------------------------------

/**
 * Layout numbers for a single format. Pixel positions are in the canvas's
 * top-left coordinate system (not CSS-centered) — every centered element has
 * its left edge precomputed by symmetry: left = (canvasWidth - elementWidth) / 2.
 *
 * The width budget for the eyebrow + price + address-row is determined
 * per-format to keep the type silhouette consistent across aspect ratios:
 * fontSize scales up for portrait/story so the type reads at the same visual
 * size relative to the canvas.
 */
interface FormatLayout {
  width: number;
  height: number;
  /** Excellence Collection logo, centered top. */
  logo: {
    top: number;
    width: number;
  };
  /**
   * Mixed-weight eyebrow row. The full eyebrow text is split across two
   * layers, side-by-side. Total visual width is computed as
   * approximateWordAWidth + gap + approximateWordBWidth.
   */
  eyebrow: {
    /** Top of both eyebrow layers (they share a baseline). */
    top: number;
    /** Font size for both words (same size, different weight + fill). */
    fontSize: number;
    /**
     * Pixel gap between the end of word A and the start of word B. Sized to
     * roughly one space's width at the font/size combo.
     */
    gap: number;
    /**
     * Per-character pixel estimate used to compute each word's box width
     * (and therefore the row's centered left edge). The estimate is
     * intentionally generous — over-allocating the layer box never visually
     * misaligns the type because each layer is `textAlign: "center"`, so
     * extra room just means more padding around the word.
     */
    perCharWidthEstimate: number;
  };
  /** Hero photo block. Centered with generous white margin on every side. */
  photo: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  /** Gold horizontal divider below the photo, centered. */
  divider: {
    top: number;
    width: number;
    height: number;
  };
  /** Price (or "Under Contract" label for under_contract). Centered. */
  price: {
    top: number;
    fontSize: number;
  };
  /** Open-house date/time italic line — only rendered for open_house. */
  openHouse: {
    top: number;
    fontSize: number;
  };
  /**
   * STREET | CITY address row at the bottom. Three text layers stacked
   * horizontally. The pipe sits centered on the canvas; the street layer
   * is right-aligned ending just before the pipe; the city layer is
   * left-aligned starting just after.
   */
  addressRow: {
    top: number;
    fontSize: number;
    /** Width allocated to the street text layer (right-aligned). */
    streetWidth: number;
    /** Width allocated to the city text layer (left-aligned). */
    cityWidth: number;
    /** Horizontal pad between street/city and the pipe character. */
    pipeGap: number;
    /** Pipe character's layer width. ~one-character box centered on canvas. */
    pipeWidth: number;
  };
}

// why: layout numbers below are tuned to the reference sample. Photo dimensions
// give it room to breathe — at square_1x1 the photo is ~70% of the canvas
// width with ~150px above (logo + eyebrow) and ~280px below (divider through
// address). Portrait + story scale proportionally.
const LAYOUTS: Record<PostFormat, FormatLayout> = {
  // ── Square 1:1 (1080×1080) ────────────────────────────────────────────────
  square_1x1: {
    width: 1080,
    height: 1080,
    logo: {
      // why: top=40 with width=280 puts the logo's bottom edge at ~198
      // (280 / 1.7778 = ~157 height), leaving comfortable space before the
      // eyebrow at y=230.
      top: 40,
      width: 280,
    },
    eyebrow: {
      top: 220,
      fontSize: 72,
      gap: 24,
      perCharWidthEstimate: 42,
    },
    photo: {
      // why: 760×420 centered. left = (1080-760)/2 = 160. Top=340 leaves
      // ~80px from the eyebrow's baseline.
      left: 160,
      top: 340,
      width: 760,
      height: 420,
    },
    divider: {
      // why: divider sits 30px below the photo (760+340=760 photo bottom,
      // divider at y=790). Width=440 centered → left = (1080-440)/2 = 320.
      top: 790,
      width: 440,
      height: 2,
    },
    price: {
      top: 830,
      fontSize: 74,
    },
    openHouse: {
      top: 916,
      fontSize: 22,
    },
    addressRow: {
      // why: at y=946 the address bottom edge sits at ~970, leaving ~110px
      // of bottom whitespace that frames the composition.
      top: 946,
      fontSize: 22,
      streetWidth: 480,
      cityWidth: 480,
      pipeGap: 14,
      pipeWidth: 20,
    },
  },

  // ── Portrait 4:5 (1080×1350) ──────────────────────────────────────────────
  portrait_4x5: {
    width: 1080,
    height: 1350,
    logo: {
      // why: top=60, width=320 → logo bottom ≈ 60 + (320/1.7778) = ~240.
      top: 60,
      width: 320,
    },
    eyebrow: {
      top: 270,
      fontSize: 92,
      gap: 28,
      perCharWidthEstimate: 52,
    },
    photo: {
      // why: 820×560 centered. left = (1080-820)/2 = 130. Top=430 leaves
      // ~50px from the eyebrow's bottom edge.
      left: 130,
      top: 430,
      width: 820,
      height: 560,
    },
    divider: {
      // photo bottom at 990 → divider at y=1030.
      top: 1030,
      width: 480,
      height: 2,
    },
    price: {
      top: 1080,
      fontSize: 92,
    },
    openHouse: {
      top: 1186,
      fontSize: 24,
    },
    addressRow: {
      // why: y=1220 leaves ~100px bottom margin.
      top: 1220,
      fontSize: 24,
      streetWidth: 520,
      cityWidth: 520,
      pipeGap: 16,
      pipeWidth: 22,
    },
  },

  // ── Story 9:16 (1080×1920) ────────────────────────────────────────────────
  // why: logo at y=120 sits inside the top safe zone (~250px) — the
  // Excellence Collection mark is a brand fixture, so partial overlap with
  // the IG/FB profile header is acceptable and the mark stays legible. The
  // eyebrow + photo + type stack all sit BELOW the safe zone.
  story_9x16: {
    width: 1080,
    height: 1920,
    logo: {
      top: 120,
      width: 360,
    },
    eyebrow: {
      // why: y=370 is well below the 250px top safe zone.
      top: 370,
      fontSize: 108,
      gap: 32,
      perCharWidthEstimate: 60,
    },
    photo: {
      // why: 880×700 centered. left = (1080-880)/2 = 100.
      left: 100,
      top: 560,
      width: 880,
      height: 700,
    },
    divider: {
      // photo bottom at 1260 → divider at y=1320.
      top: 1320,
      width: 540,
      height: 2,
    },
    price: {
      top: 1380,
      fontSize: 108,
    },
    openHouse: {
      top: 1512,
      fontSize: 28,
    },
    addressRow: {
      // why: y=1560 ends at ~1590, well clear of the 1720 bottom safe zone.
      top: 1560,
      fontSize: 28,
      streetWidth: 560,
      cityWidth: 560,
      pipeGap: 18,
      pipeWidth: 26,
    },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming — mirrors POST_TYPE_CONFIGS shape from sibling factories
// ---------------------------------------------------------------------------

interface PriceConfig {
  mode: "list" | "close" | "label";
  fallbackText: string;
  boundField: "price" | "close_price" | null;
}

interface PostTypeConfig {
  /**
   * Mixed-weight eyebrow split. `wordA` renders as outlined-gold (the
   * descriptor); `wordB` renders as solid ink900 (the anchor). Together they
   * read as "NEW LISTING", "NEWLY SOLD", etc.
   */
  eyebrowWordA: string;
  eyebrowWordB: string;
  price: PriceConfig;
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
    eyebrowWordA: "NEW",
    eyebrowWordB: "LISTING",
    price: { mode: "list", fallbackText: "$2,950,000", boundField: "price" },
    showOpenHouseLine: false,
    templateNamePrefix: "Just Listed",
    idPrefix: "just_listed",
    description: (f) =>
      `${describeFormat(f)} Excellence Collection cover — outlined-gold "NEW" + solid "LISTING" eyebrow over a centered hero photo, Playfair price below a gold divider.`,
  },
  just_sold: {
    eyebrowWordA: "NEWLY",
    eyebrowWordB: "SOLD",
    price: {
      mode: "close",
      fallbackText: "$2,750,000",
      boundField: "close_price",
    },
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} Excellence Collection closed-deal cover — outlined-gold "NEWLY" + solid "SOLD" eyebrow; close price centered below the divider. No badge stamp.`,
  },
  under_contract: {
    eyebrowWordA: "UNDER",
    eyebrowWordB: "CONTRACT",
    // why: no dollar amount on under-contract posts. The price slot becomes
    // a small "UNDER CONTRACT" label (sans, gold) — but the eyebrow is the
    // primary status indicator. Both pieces reinforce the same message
    // without competing visually because the label is much smaller.
    price: {
      mode: "label",
      fallbackText: "Under Contract",
      boundField: null,
    },
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} Excellence Collection pipeline-status cover — outlined-gold "UNDER" + solid "CONTRACT" eyebrow; "Under Contract" replaces the price slot.`,
  },
  open_house: {
    eyebrowWordA: "OPEN",
    eyebrowWordB: "HOUSE",
    price: { mode: "list", fallbackText: "$2,950,000", boundField: "price" },
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} Excellence Collection open-house cover — italic gold date/time line above the list price, centered below the gold divider.`,
  },
  price_reduction: {
    eyebrowWordA: "NEW",
    eyebrowWordB: "PRICE",
    price: { mode: "list", fallbackText: "$2,850,000", boundField: "price" },
    showOpenHouseLine: false,
    templateNamePrefix: "Price Reduced",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} Excellence Collection price-update cover — outlined-gold "NEW" + solid "PRICE" eyebrow; refreshed list price centered below the divider. No badge stamp.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a single Excellence Collection template for the given
 * (postType, format). Deterministic — same inputs always produce the same
 * layer tree (same ids, same numbers), which is important for snapshot
 * stability when templates are persisted to Supabase.
 *
 * @param postType — which of the five post categories
 * @param format   — which aspect ratio (square / portrait / story)
 * @returns a CanvasTemplateSchema ready to register in index.ts
 */
export function createExcellenceCollectionTemplate(
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
  // Logo centered top.
  const logoLeft = Math.round((layout.width - layout.logo.width) / 2);
  const logoHeight = Math.round(layout.logo.width / LOGO_ASPECT_RATIO);

  // Eyebrow row math — two text layers butted side-by-side.
  // why: we approximate each word's pixel width from `perCharWidthEstimate ×
  // word length`. textAlign:"center" inside the layer box means a slight
  // over-allocation (e.g., "NEW" measured at 3×42=126px but visually ~110px)
  // just adds horizontal padding around the word — not a visual misalignment.
  // The gap between layers is a fixed pixel value, so the rendered words sit
  // exactly `gap` pixels apart at the inner edges of the two boxes.
  const wordAWidth = Math.round(
    cfg.eyebrowWordA.length * layout.eyebrow.perCharWidthEstimate,
  );
  const wordBWidth = Math.round(
    cfg.eyebrowWordB.length * layout.eyebrow.perCharWidthEstimate,
  );
  const eyebrowTotalWidth = wordAWidth + layout.eyebrow.gap + wordBWidth;
  const eyebrowLeftA = Math.round((layout.width - eyebrowTotalWidth) / 2);
  const eyebrowLeftB = eyebrowLeftA + wordAWidth + layout.eyebrow.gap;

  // Gold divider centered.
  const dividerLeft = Math.round((layout.width - layout.divider.width) / 2);

  // STREET | CITY row math — pipe centered on the canvas, street + city
  // flanking it. The street layer is right-aligned ending just before the
  // pipe; the city layer is left-aligned starting just after.
  const pipeLeft = Math.round((layout.width - layout.addressRow.pipeWidth) / 2);
  const streetLeft =
    pipeLeft - layout.addressRow.pipeGap - layout.addressRow.streetWidth;
  const cityLeft =
    pipeLeft + layout.addressRow.pipeWidth + layout.addressRow.pipeGap;

  // Price width — generous horizontal allocation since price strings are
  // narrow ("$2,950,000") and we want them centered horizontally with plenty
  // of breathing room.
  const priceLeft = 80;
  const priceWidth = layout.width - 160;

  // Open-house line uses the same horizontal margins as the price.
  const openHouseLeft = priceLeft;
  const openHouseWidth = priceWidth;

  // ── layer tree ──────────────────────────────────────────────────────────
  const layers: CanvasLayer[] = [
    // ---- z=0  Excellence Collection logo (centered top, contained) ----
    // why: boundField: null + literal src URL — the logo is a brand fixture,
    // not a listing-driven image. objectFit:"contain" letterboxes the wide
    // 3600×2025 mark inside its bounding box without distortion.
    {
      kind: "image",
      id: "layer_excellence_logo",
      name: "Excellence Collection logo",
      left: logoLeft,
      top: layout.logo.top,
      width: layout.logo.width,
      height: logoHeight,
      angle: 0,
      opacity: 1,
      z: 0,
      visible: true,
      locked: false,
      src: EXCELLENCE_LOGO_URL,
      // why: no boundField — `src` is the canonical URL and there is no
      // ImageBoundField that resolves to a brand-asset URL today. If the
      // brand-assets pipeline gains an "excellence_logo" bound field later,
      // swap this to that field and drop the literal src.
      objectFit: "contain",
      crossOrigin: "anonymous",
      cornerRadius: 0,
      borderColor: "transparent",
      borderWidth: 0,
    },

    // ---- z=1  eyebrow word A ("NEW" / "NEWLY" / "UNDER" / "OPEN") ----
    // why: outlined-gold via the TextEffect `outline` preset. The text fill
    // is the warm-white background color so the LETTERS render hollow and
    // only the gold stroke is visible. Setting fill to whiteWarm rather than
    // an empty string is important because Fabric renders empty-string fill
    // as solid black on text (unlike shapes).
    {
      kind: "text",
      id: "layer_eyebrow_word_a",
      name: `Eyebrow "${cfg.eyebrowWordA}"`,
      left: eyebrowLeftA,
      top: layout.eyebrow.top,
      width: wordAWidth,
      height: layout.eyebrow.fontSize + 20,
      angle: 0,
      opacity: 0.95,
      z: 1,
      visible: true,
      locked: false,
      text: cfg.eyebrowWordA,
      fontFamily: ALLIANCE_FONTS.playfair,
      fontSize: layout.eyebrow.fontSize,
      // why: thin weight + outline effect produces the lighter "hollow"
      // descriptor word.
      fontWeight: 400,
      fontStyle: "normal",
      // why: fill matches the canvas background so only the stroke is
      // visible — produces the "hollow gold" look in the reference sample.
      fill: "#FCFCFB",
      textAlign: "center",
      lineHeight: 1,
      charSpacing: -20,
      underline: false,
      linethrough: false,
      editable: true,
      effect: {
        kind: "outline",
        // why: 3px stroke at fontSize 72-108 reads as a refined hairline
        // outline at every format — thicker would look chunky, thinner would
        // disappear at the smaller square_1x1 size.
        width: 3,
        color: ALLIANCE_COLORS.gold500,
      },
    },

    // ---- z=2  eyebrow word B ("LISTING" / "SOLD" / "CONTRACT" / ...) ----
    {
      kind: "text",
      id: "layer_eyebrow_word_b",
      name: `Eyebrow "${cfg.eyebrowWordB}"`,
      left: eyebrowLeftB,
      top: layout.eyebrow.top,
      width: wordBWidth,
      height: layout.eyebrow.fontSize + 20,
      angle: 0,
      opacity: 1,
      z: 2,
      visible: true,
      locked: false,
      text: cfg.eyebrowWordB,
      fontFamily: ALLIANCE_FONTS.playfair,
      fontSize: layout.eyebrow.fontSize,
      // why: heavy weight + solid ink for the anchor word — high contrast
      // against the lighter outlined descriptor.
      fontWeight: 800,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "center",
      lineHeight: 1,
      charSpacing: -20,
      underline: false,
      linethrough: false,
      editable: true,
    },

    // ---- z=3  hero photo (centered, generous margin) ----
    {
      kind: "image",
      id: "layer_hero_photo",
      name: "Hero photo",
      left: layout.photo.left,
      top: layout.photo.top,
      width: layout.photo.width,
      height: layout.photo.height,
      angle: 0,
      opacity: 1,
      z: 3,
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

    // ---- z=4  gold horizontal divider rule (below the photo) ----
    {
      kind: "shape",
      id: "layer_gold_divider",
      name: "Gold divider",
      left: dividerLeft,
      top: layout.divider.top,
      width: layout.divider.width,
      height: layout.divider.height,
      angle: 0,
      opacity: 1,
      z: 4,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.gold500,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 1,
      strokeDashArray: [],
    },
  ];

  // ---- z=5  price (Playfair gold) OR "Under Contract" label (sans gold) ----
  layers.push({
    kind: "text",
    id: "layer_price",
    name: cfg.price.mode === "label" ? "Status (Under Contract)" : "Price",
    left: priceLeft,
    top: layout.price.top,
    width: priceWidth,
    height: layout.price.fontSize + 24,
    angle: 0,
    opacity: 1,
    z: 5,
    visible: true,
    locked: false,
    text: cfg.price.fallbackText,
    // why: only attach boundField when defined — schema doesn't accept
    // boundField: undefined (the typed field is optional, not nullable).
    ...(cfg.price.boundField ? { boundField: cfg.price.boundField } : {}),
    // why: serif Playfair for dollar amounts (luxury-real-estate convention);
    // bold sans uppercase for the "Under Contract" status word.
    fontFamily:
      cfg.price.mode === "label"
        ? ALLIANCE_FONTS.bodySans
        : ALLIANCE_FONTS.playfair,
    // why: label-mode is "Under Contract" — much narrower than $X,XXX,XXX,
    // so we shrink the type to ~52% of the price slot to keep it from
    // dominating the composition (it's a status indicator, not a headline;
    // the eyebrow does the headline duty).
    fontSize:
      cfg.price.mode === "label"
        ? Math.round(layout.price.fontSize * 0.52)
        : layout.price.fontSize,
    fontWeight: cfg.price.mode === "label" ? 800 : 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "center",
    lineHeight: 1,
    charSpacing: cfg.price.mode === "label" ? 240 : -10,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=6  open-house italic gold line — only for open_house ----
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "text",
      id: "layer_open_house_line",
      name: "Open House date/time",
      left: openHouseLeft,
      top: layout.openHouse.top,
      width: openHouseWidth,
      height: layout.openHouse.fontSize + 10,
      angle: 0,
      opacity: 1,
      z: 6,
      visible: true,
      locked: false,
      text: "Saturday · 11:00 AM – 1:00 PM",
      boundField: "open_house_date",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.openHouse.fontSize,
      // why: italic + gold600 (the darker shade) gives the date/time line a
      // hand-written invitation feel without leaning on a script font that
      // would clash with the rest of the type system.
      fontStyle: "italic",
      fontWeight: 500,
      fill: ALLIANCE_COLORS.gold600,
      textAlign: "center",
      lineHeight: 1.2,
      charSpacing: 80,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=7  address — street (right-aligned, ends just before the pipe) ----
  layers.push({
    kind: "text",
    id: "layer_address_street",
    name: "Address — street",
    left: streetLeft,
    top: layout.addressRow.top,
    width: layout.addressRow.streetWidth,
    height: layout.addressRow.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 7,
    visible: true,
    locked: false,
    text: "1934 WEST AVENUE",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.addressRow.fontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "right",
    lineHeight: 1.2,
    // why: heavy tracking on a small caps line — mirrors the reference
    // sample's "1934 WEST AVENUE | OCEAN CITY" rendering.
    charSpacing: 240,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=8  address — pipe separator (centered character) ----
  // why: a dedicated text layer for the "|" lets the street + city layers
  // hold their absolute positions even when address_line1 / city resolve to
  // longer or shorter strings than the literal placeholders. The pipe sits
  // dead-center on the canvas; street + city flank it with `pipeGap` of
  // horizontal breathing room on each side.
  layers.push({
    kind: "text",
    id: "layer_address_pipe",
    name: "Address — separator",
    left: pipeLeft,
    top: layout.addressRow.top,
    width: layout.addressRow.pipeWidth,
    height: layout.addressRow.fontSize + 10,
    angle: 0,
    opacity: 0.7,
    z: 8,
    visible: true,
    locked: false,
    text: "|",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.addressRow.fontSize,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=9  address — city (left-aligned, starts just after the pipe) ----
  layers.push({
    kind: "text",
    id: "layer_address_city",
    name: "Address — city",
    left: cityLeft,
    top: layout.addressRow.top,
    width: layout.addressRow.cityWidth,
    height: layout.addressRow.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 9,
    visible: true,
    locked: false,
    text: "OCEAN CITY",
    boundField: "city",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.addressRow.fontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "left",
    lineHeight: 1.2,
    charSpacing: 240,
    underline: false,
    linethrough: false,
    editable: true,
  });

  return {
    id: `canvas_${cfg.idPrefix}_v3_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Excellence Collection · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v3",
    format,
    width: layout.width,
    height: layout.height,
    // why: near-white `#FCFCFB` matches the minimal-frame variant — the same
    // gallery-paper background that lets the gold + ink type land cleanly.
    // ALLIANCE_COLORS.whiteWarm (#FBF7EE) is a warmer cream used for on-photo
    // text, NOT this cooler off-white surface — keep them distinct so the
    // future Brand-panel swatch picker doesn't conflate the two.
    backgroundColor: "#FCFCFB",
    backgroundImage: null,
    updatedAt: "2026-05-17T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: build all 5 post types × 3 formats = 15 Excellence Collection
 * templates. The registry (index.ts) calls this once at module-load time
 * alongside the other factory outputs.
 *
 * @returns array of 15 templates in (postType × format) outer-loop order.
 */
export function buildAllExcellenceCollectionTemplates(): readonly CanvasTemplateSchema[] {
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
      out.push(createExcellenceCollectionTemplate(pt, f));
    }
  }
  return out;
}

export default buildAllExcellenceCollectionTemplates;
