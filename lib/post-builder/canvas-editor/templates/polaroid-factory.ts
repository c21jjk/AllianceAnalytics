/**
 * Polaroid template factory — `createPolaroidTemplate(postType, format)`
 * ------------------------------------------------------------------------------
 *
 * v7 Polaroid — the "kraft-paper Pinterest" layout. A tilted white polaroid
 * card sits on a warm tan background; the hero photo lives inside the
 * polaroid's photo area; the polaroid's bottom strip carries a Pacifico
 * script caption (e.g., "Just Listed"). Address, city/state/zip, price, and
 * beds/baths stack on the kraft surface below the polaroid. Optional
 * SOLD / NEW PRICE stamp lands on top of the photo at a different tilt for
 * stamped-souvenir feel.
 *
 * Generates 10 templates: 5 post types × 2 formats.
 *
 * Design parity with the V1 HTML primitives (`primitives/v7-polaroid*.ts`):
 *   • Same kraft-paper background `#F5EBCF` (matches `ALLIANCE_COLORS.gold100`).
 *   • Same polaroid tilt direction (~ -2° in V1; we go a touch further to
 *     -4° on portrait and -3° on story — more obviously "polaroid"
 *     at thumbnail size, where the V1's 2° read as accidental misalignment).
 *   • Same Pacifico script caption — `ALLIANCE_FONTS.pacifico`, all-caps off
 *     so the script glyphs work properly. V1 used uppercase Inter for the
 *     caption; we move that to the script font to match the brief.
 *   • Same per-format dimensions:
 *       portrait_4x5 polaroid roughly y=70 → 880,  type stack 950 → 1310
 *       story_9x16   polaroid roughly y=310 → 1240, type stack 1330 → 1700
 *
 * Polaroid rotation handling (the hard part):
 *   The polaroid is a *group* of 4 layers that share the same `angle`:
 *     • shadow rect (offset down+right of the white card)
 *     • white card (the polaroid itself)
 *     • photo (cover-fit, clipped by cornerRadius=0 to the photo area)
 *     • caption text (Pacifico script, on the bottom strip)
 *   Because Fabric rotates around the *center* of each layer's bounding box,
 *   we pre-calculate each layer's center, rotate the offset from the
 *   polaroid's pivot to each child's center, then derive top-left back from
 *   the rotated center. This way the four layers travel together visually.
 *
 * Shadow approximation (since ShapeLayer has no `shadow` field today):
 *   We place a darker rect UNDER the white card, offset by ~14-20px down and
 *   right, at the SAME angle as the white card. Opacity tuned to ~0.18 so it
 *   reads as a cast shadow rather than a duplicate card. When the canvas
 *   editor grows a real `shadow` field on ShapeLayer (planned), this trick
 *   can be replaced with a single property on the white card.
 *
 * Layer numbering (z):
 *   z=0  kraft background fill (the canvas backgroundColor handles this, but
 *        we keep a layer-less background and start shapes at z=1)
 *   z=1  polaroid shadow rect
 *   z=2  polaroid white card
 *   z=3  hero photo (inside the polaroid's photo area)
 *   z=4  polaroid caption strip text (Pacifico script)
 *   z=5  address line
 *   z=6  city/state/zip
 *   z=7  open-house line (Pacifico, only for open_house)
 *   z=8  gold price (or "Under Contract" label)
 *   z=9  beds · baths chip row
 *   z=10 brand name footer ("CENTURY 21 ALLIANCE")
 *   z=11 MLS number caption
 *   z=12 badge stamp rect (only when configured)
 *   z=13 badge stamp text (only when configured)
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
 * Geometry for the polaroid group. All four polaroid layers (shadow, card,
 * photo, caption) share `angle` and pivot around the canvas's horizontal
 * center. `cardLeft`/`cardTop` are the unrotated top-left of the white card;
 * Fabric rotates around the layer center, so visually the polaroid sits
 * where its center lands after rotation.
 */
interface PolaroidGeometry {
  /** Rotation degrees. Negative = counter-clockwise tilt. */
  angle: number;
  /** White card outer dimensions. */
  cardLeft: number;
  cardTop: number;
  cardWidth: number;
  cardHeight: number;
  /** Inner photo area — offsets relative to the unrotated card. */
  photoInsetLeft: number;
  photoInsetTop: number;
  photoWidth: number;
  photoHeight: number;
  /** Caption strip (the bottom ~20% of the polaroid below the photo). */
  captionTop: number;
  captionHeight: number;
  captionFontSize: number;
  /** Shadow offset under the white card (added to cardLeft/cardTop). */
  shadowOffsetX: number;
  shadowOffsetY: number;
}

interface FormatLayout {
  width: number;
  height: number;
  polaroid: PolaroidGeometry;
  /** Type stack on the kraft background, below the polaroid. */
  stack: {
    paddingLeft: number;
    paddingRight: number;
    address: { top: number; fontSize: number };
    cityStateZip: { top: number; fontSize: number };
    openHouse: { top: number; fontSize: number };
    price: { top: number; fontSize: number };
    bedsBaths: { top: number; fontSize: number };
  };
  /** Footer line — brand name + MLS hashtag, centered on the kraft. */
  footer: {
    top: number;
    brandFontSize: number;
    mlsTop: number;
    mlsFontSize: number;
  };
  /**
   * Badge stamp — sits on top of the polaroid photo at a different angle
   * than the polaroid itself, so it reads as a separate stamped element.
   * Coordinates are in unrotated canvas space (Fabric will rotate the
   * badge around its own center via `angle`).
   */
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
  // why: portrait gives the polaroid a more vertical photo (760x680) so the
  // print reads as a true photo-album page. Type stack starts at y=950 to
  // leave room for the larger polaroid card.
  portrait_4x5: {
    width: 1080,
    height: 1350,
    polaroid: {
      angle: -4,
      cardLeft: 128, // (1080 - 824) / 2
      cardTop: 70,
      cardWidth: 824,
      cardHeight: 800,
      photoInsetLeft: 32,
      photoInsetTop: 32,
      photoWidth: 760,
      photoHeight: 680,
      captionTop: 712,
      captionHeight: 88,
      captionFontSize: 60,
      shadowOffsetX: 14,
      shadowOffsetY: 22,
    },
    stack: {
      paddingLeft: 72,
      paddingRight: 72,
      address: { top: 950, fontSize: 56 },
      cityStateZip: { top: 1024, fontSize: 20 },
      openHouse: { top: 1064, fontSize: 32 },
      price: { top: 1100, fontSize: 72 },
      bedsBaths: { top: 1200, fontSize: 17 },
    },
    footer: {
      top: 1268,
      brandFontSize: 14,
      mlsTop: 1290,
      mlsFontSize: 13,
    },
    badge: {
      left: 740,
      top: 200,
      width: 240,
      height: 104,
      angle: 12,
      fontSize: 48,
    },
  },
  // why: story preserves the IG/FB/TikTok safe zones (250px top, 200px
  // bottom). Polaroid sits in the visible middle (y=310 → 1240), type stack
  // 1330 → 1700, footer at 1772 so it's clear of the bottom safe zone.
  story_9x16: {
    width: 1080,
    height: 1920,
    polaroid: {
      angle: -3,
      cardLeft: 118, // (1080 - 844) / 2
      cardTop: 310,
      cardWidth: 844,
      cardHeight: 940,
      photoInsetLeft: 32,
      photoInsetTop: 32,
      photoWidth: 780,
      photoHeight: 820,
      captionTop: 852,
      captionHeight: 88,
      captionFontSize: 70,
      shadowOffsetX: 16,
      shadowOffsetY: 26,
    },
    stack: {
      paddingLeft: 80,
      paddingRight: 80,
      address: { top: 1330, fontSize: 64 },
      cityStateZip: { top: 1414, fontSize: 22 },
      openHouse: { top: 1456, fontSize: 36 },
      price: { top: 1494, fontSize: 82 },
      bedsBaths: { top: 1606, fontSize: 18 },
    },
    footer: {
      top: 1666,
      brandFontSize: 14,
      mlsTop: 1690,
      mlsFontSize: 14,
    },
    badge: {
      // why: story badge is larger (the polaroid is bigger) and sits on the
      // photo's upper-right at a +12 tilt against the polaroid's -3 tilt —
      // a ~15° delta reads as a separate stamped element, not a fold of
      // the polaroid.
      left: 720,
      top: 470,
      width: 280,
      height: 120,
      angle: 12,
      fontSize: 56,
    },
  },
};

// ---------------------------------------------------------------------------
// Per-post-type theming — same shape as the other v1/v2/v3 factories so a
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
  /** Caption strip text on the polaroid (script style, mixed case). */
  caption: string;
  price: PriceConfig;
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
    caption: "Just Listed",
    price: { mode: "list", fallbackText: "$929,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Just Listed",
    idPrefix: "just_listed",
    description: (f) =>
      `${describeFormat(f)} polaroid layout — kraft-paper background, tilted polaroid frame with Pacifico caption.`,
  },
  just_sold: {
    caption: "Just Sold",
    price: { mode: "close", fallbackText: "$905,000", boundField: "close_price" },
    badge: { text: "SOLD", fill: "#B91C1C" },
    showOpenHouseLine: false,
    templateNamePrefix: "Just Sold",
    idPrefix: "just_sold",
    description: (f) =>
      `${describeFormat(f)} polaroid layout — red SOLD stamp tilted on the photo, close price on the kraft surface.`,
  },
  under_contract: {
    caption: "Under Contract",
    price: { mode: "label", fallbackText: "Under Contract", boundField: null },
    badge: null,
    showOpenHouseLine: false,
    templateNamePrefix: "Under Contract",
    idPrefix: "under_contract",
    description: (f) =>
      `${describeFormat(f)} polaroid layout — "Under Contract" replaces the price slot, Pacifico caption on the polaroid.`,
  },
  open_house: {
    caption: "Open House",
    price: { mode: "list", fallbackText: "$929,000", boundField: "price" },
    badge: null,
    showOpenHouseLine: true,
    templateNamePrefix: "Open House",
    idPrefix: "open_house",
    description: (f) =>
      `${describeFormat(f)} polaroid layout — Pacifico open-house date line sits between the address and the price.`,
  },
  price_reduction: {
    caption: "Price Drop",
    price: { mode: "list", fallbackText: "$899,000", boundField: "price" },
    badge: { text: "NEW PRICE", fill: "#15803D" },
    showOpenHouseLine: false,
    templateNamePrefix: "Price Reduced",
    idPrefix: "price_reduction",
    description: (f) =>
      `${describeFormat(f)} polaroid layout — green NEW PRICE stamp on the photo, refreshed list price below.`,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a single v7 Polaroid template for the given post type + format.
 *
 * The function is deterministic: same inputs always produce the same
 * `CanvasTemplateSchema`. No randomness in IDs, timestamps, or layer order
 * — this is required so the templates panel can dedupe across rebuilds.
 */
export function createPolaroidTemplate(
  postType: PostType,
  format: PostFormat,
): CanvasTemplateSchema {
  const layout = LAYOUTS[format];
  const cfg = POST_TYPE_CONFIGS[postType];
  const p = layout.polaroid;

  const formatShort: Record<PostFormat, string> = {
    portrait_4x5: "portrait",
    story_9x16: "story",
  };

  const innerWidth = layout.width - layout.stack.paddingLeft - layout.stack.paddingRight;

  // why: the four polaroid layers (shadow, card, photo, caption) share the
  // same `angle`. We position each by its unrotated top-left + width/height
  // and trust Fabric to rotate around each layer's bounding-box center. The
  // photo + caption coordinates are computed relative to the card's
  // top-left so they stay aligned regardless of the chosen angle — the
  // rotation lands the whole group as a visual unit because their centers
  // are co-located along the polaroid's vertical axis.

  const layers: CanvasLayer[] = [
    // ---- z=1  polaroid shadow rect ----
    // why: ShapeLayer has no `shadow` field yet (see header). We fake a
    // cast shadow with a slightly larger dark rect offset down+right
    // under the white card, at the same rotation. Opacity ~0.18 reads as
    // a soft shadow rather than a duplicate card. When we add a real
    // shadow prop to ShapeLayer, delete this layer + the offsets above.
    {
      kind: "shape",
      id: "layer_polaroid_shadow",
      name: "Polaroid shadow",
      left: p.cardLeft + p.shadowOffsetX,
      top: p.cardTop + p.shadowOffsetY,
      width: p.cardWidth,
      height: p.cardHeight,
      angle: p.angle,
      opacity: 0.18,
      z: 1,
      visible: true,
      locked: false,
      shapeType: "rect",
      fill: ALLIANCE_COLORS.ink900,
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 4,
      strokeDashArray: [],
    },
    // ---- z=2  polaroid white card ----
    {
      kind: "shape",
      id: "layer_polaroid_card",
      name: "Polaroid card",
      left: p.cardLeft,
      top: p.cardTop,
      width: p.cardWidth,
      height: p.cardHeight,
      angle: p.angle,
      opacity: 1,
      z: 2,
      visible: true,
      locked: false,
      shapeType: "rect",
      // why: V1 uses `#FCFCFB` — a hair off pure white so the polaroid
      // doesn't blow out against the kraft tan. No brand token matches
      // this exact "warm photo paper" shade; the literal is intentional.
      fill: "#FCFCFB",
      stroke: "",
      strokeWidth: 0,
      cornerRadius: 4,
      strokeDashArray: [],
    },
    // ---- z=3  hero photo (inside the polaroid's photo area) ----
    // why: positioned by absolute canvas coords (cardLeft + photoInset).
    // The image's angle matches the card; Fabric rotates around the
    // image's own bounding-box center, which coincides with the photo
    // area's geometric center — so the photo rotates *with* the card
    // rather than independently. cornerRadius=0 keeps the photo's sharp
    // rectangular crop inside the white card frame.
    {
      kind: "image",
      id: "layer_hero_photo",
      name: "Hero photo",
      left: p.cardLeft + p.photoInsetLeft,
      top: p.cardTop + p.photoInsetTop,
      width: p.photoWidth,
      height: p.photoHeight,
      angle: p.angle,
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
    // ---- z=4  polaroid caption (Pacifico script) ----
    // why: the V1 uses uppercase Inter; the canvas-editor brief asks for
    // Pacifico (`ALLIANCE_FONTS.pacifico`) to lean into the casual
    // hand-written feel. Mixed case (e.g., "Just Listed") because script
    // fonts look broken in all-caps.
    {
      kind: "text",
      id: "layer_polaroid_caption",
      name: "Polaroid caption",
      left: p.cardLeft + 24,
      top: p.cardTop + p.captionTop + Math.round((p.captionHeight - p.captionFontSize) / 2) - 8,
      width: p.cardWidth - 48,
      height: p.captionHeight,
      angle: p.angle,
      opacity: 1,
      z: 4,
      visible: true,
      locked: false,
      text: cfg.caption,
      // why: NO boundField — the polaroid caption is the variant's signature
      // hand-written line. status_label hydrates to "JUST LISTED" all-caps,
      // which would defeat the Pacifico vibe.
      fontFamily: ALLIANCE_FONTS.pacifico,
      fontSize: p.captionFontSize,
      fontWeight: 400,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "center",
      lineHeight: 1.0,
      charSpacing: 10,
      underline: false,
      linethrough: false,
      editable: true,
    },
    // ---- z=5  address line (on kraft background, below polaroid) ----
    {
      kind: "text",
      id: "layer_address_line",
      name: "Address",
      left: layout.stack.paddingLeft,
      top: layout.stack.address.top,
      width: innerWidth,
      height: layout.stack.address.fontSize + 14,
      angle: 0,
      opacity: 1,
      z: 5,
      visible: true,
      locked: false,
      text: "117 E Maple Ave",
      boundField: "address_line1",
      fontFamily: ALLIANCE_FONTS.playfair,
      fontSize: layout.stack.address.fontSize,
      fontWeight: 700,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "center",
      lineHeight: 1.05,
      charSpacing: -10,
      underline: false,
      linethrough: false,
      editable: true,
    },
    // ---- z=6  city/state/zip ----
    {
      kind: "text",
      id: "layer_city_state_zip",
      name: "City · State · Zip",
      left: layout.stack.paddingLeft,
      top: layout.stack.cityStateZip.top,
      width: innerWidth,
      height: layout.stack.cityStateZip.fontSize + 10,
      angle: 0,
      opacity: 1,
      z: 6,
      visible: true,
      locked: false,
      text: "WILDWOOD, NJ 08260",
      boundField: "city_state_zip",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: layout.stack.cityStateZip.fontSize,
      fontWeight: 500,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.ink700,
      textAlign: "center",
      lineHeight: 1.2,
      charSpacing: 200,
      underline: false,
      linethrough: false,
      editable: true,
    },
  ];

  // ---- z=7  optional open-house Pacifico line ----
  if (cfg.showOpenHouseLine) {
    layers.push({
      kind: "text",
      id: "layer_open_house",
      name: "Open House date/time",
      left: layout.stack.paddingLeft,
      top: layout.stack.openHouse.top,
      width: innerWidth,
      height: layout.stack.openHouse.fontSize + 10,
      angle: 0,
      opacity: 1,
      z: 7,
      visible: true,
      locked: false,
      text: "Saturday · 11:00 AM – 1:00 PM",
      // why: open_house_date is the formatted-date string; the editor's
      // hydrator concatenates date + time when both are present. If the
      // user wants only the time on this line, they edit the boundField
      // in the layer panel.
      boundField: "open_house_date",
      fontFamily: ALLIANCE_FONTS.pacifico,
      fontSize: layout.stack.openHouse.fontSize,
      fontWeight: 400,
      fontStyle: "normal",
      fill: ALLIANCE_COLORS.gold600,
      textAlign: "center",
      lineHeight: 1.0,
      charSpacing: 10,
      underline: false,
      linethrough: false,
      editable: true,
    });
  }

  // ---- z=8  price (or "Under Contract" label) ----
  layers.push({
    kind: "text",
    id: "layer_price",
    name: cfg.price.mode === "label" ? "Status (Under Contract)" : "Price",
    left: layout.stack.paddingLeft,
    top: layout.stack.price.top,
    width: innerWidth,
    height: layout.stack.price.fontSize + 18,
    angle: 0,
    opacity: 1,
    z: 8,
    visible: true,
    locked: false,
    text: cfg.price.fallbackText,
    ...(cfg.price.boundField ? { boundField: cfg.price.boundField } : {}),
    // why: in label mode ("Under Contract") we drop to Inter all-caps at
    // 60% of the price slot — Playfair italic-y numerals don't look right
    // wrapping a sentence-cased label.
    fontFamily:
      cfg.price.mode === "label" ? ALLIANCE_FONTS.bodySans : ALLIANCE_FONTS.playfair,
    fontSize:
      cfg.price.mode === "label"
        ? Math.round(layout.stack.price.fontSize * 0.6)
        : layout.stack.price.fontSize,
    fontWeight: cfg.price.mode === "label" ? 800 : 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "center",
    lineHeight: 1.0,
    charSpacing: cfg.price.mode === "label" ? 200 : -20,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=9  beds · baths chip row ----
  layers.push({
    kind: "text",
    id: "layer_beds_baths",
    name: "Beds · Baths",
    left: layout.stack.paddingLeft,
    top: layout.stack.bedsBaths.top,
    width: innerWidth,
    height: layout.stack.bedsBaths.fontSize + 10,
    angle: 0,
    opacity: 1,
    z: 9,
    visible: true,
    locked: false,
    text: "4 BR · 3 BA",
    boundField: "beds_baths",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.stack.bedsBaths.fontSize,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink700,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=10  brand name footer ----
  layers.push({
    kind: "text",
    id: "layer_brand_name",
    name: "Brand name",
    left: layout.stack.paddingLeft,
    top: layout.footer.top,
    width: innerWidth,
    height: layout.footer.brandFontSize + 10,
    angle: 0,
    opacity: 0.6,
    z: 10,
    visible: true,
    locked: false,
    text: "CENTURY 21 ALLIANCE",
    boundField: "office_name",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: layout.footer.brandFontSize,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 220,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=11  MLS number caption ----
  layers.push({
    kind: "text",
    id: "layer_mls_number",
    name: "MLS #",
    left: layout.stack.paddingLeft,
    top: layout.footer.mlsTop,
    width: innerWidth,
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
    fill: ALLIANCE_COLORS.ink800,
    textAlign: "center",
    lineHeight: 1.2,
    charSpacing: 160,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=12/13  badge stamp (only when configured) ----
  // why: the badge sits over the polaroid photo at a DIFFERENT angle than
  // the polaroid (V1: -12° badge vs -2° polaroid). Here we use +12° against
  // the polaroid's -3/-4° tilt — total delta ~15-16° reads as a hand-
  // stamped element layered on top of the framed photo, not a fold of the
  // polaroid. Same red SOLD / green NEW PRICE conventions as v1/v2/v3.
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
    id: `canvas_${cfg.idPrefix}_v7_${formatShort[format]}`,
    name: `${cfg.templateNamePrefix} · Polaroid · ${describeFormat(format)}`,
    description: cfg.description(format),
    category: postType,
    variant: "v7",
    format,
    width: layout.width,
    height: layout.height,
    // why: the kraft-paper tan IS the `ALLIANCE_COLORS.gold100` token (both
    // resolve to "#F5EBCF"), so we use the token rather than the literal.
    // If the brand evolves and gold100 shifts, the polaroid background
    // updates with it — single-file change in tokens.ts.
    backgroundColor: ALLIANCE_COLORS.gold100,
    backgroundImage: null,
    updatedAt: "2026-05-15T00:00:00Z",
    schemaVersion: 1,
    layers,
  };
}

/**
 * Convenience: all 5 post types × 2 formats = 10 polaroid templates.
 * The registry (`templates/index.ts`) calls this once at module-load time
 * alongside the v1 Hero Editorial + v2 Bold Stats + v3 Side-by-Side outputs.
 */
export function buildAllPolaroidTemplates(): CanvasTemplateSchema[] {
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
      out.push(createPolaroidTemplate(pt, f));
    }
  }
  return out;
}
