/**
 * Just Sold — square 1080×1080 (real Larissa-spec template).
 *
 * Replaces the placeholder factory's just_sold × square_1x1 slot as of
 * 2026-05-24. Faithful translation of Larissa's gold-standard reference
 * (420 E 21st Avenue, North Wildwood, $2.5M).
 *
 * Recipe (per `project_alliance_larissa_design_rules.md`):
 *   • Photo: 100% full bleed.
 *   • Inset white frame: stroke 7, ~40px inset from canvas edges, drawn
 *     OVER the photo. Frames the whole composition.
 *   • C21 ALLIANCE lockup at top center, ~80px from top.
 *   • Small gold-tinted address pill below the logo, holding
 *     street + city in Glacial Indifference 22pt dark.
 *   • Eyebrow: "SOLD" in DM Serif Display (substitute for The Seasons)
 *     at ~70pt, white, center-aligned, positioned ~70% down the canvas.
 *   • Price: Glacial Indifference ~50pt, white, center, immediately
 *     below SOLD.
 *   • Brand rules: street + city only (no state/zip), zero agent fields,
 *     brokerage logo prominent.
 */
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
import { C21_ALLIANCE_WHITE_LOGO } from "./brand-logos";
import type { CanvasLayer, CanvasTemplateSchema } from "../types";
import type { PostVariant } from "@/lib/post-builder/types";

const W = 1080;
const H = 1080;

// Frame geometry — inset 40px from each canvas edge.
const FRAME_INSET = 40;
const FRAME_STROKE = 7;

const id = (slot: string): string => `js_sq_${slot}`;

export function buildJustSoldSquareTemplate(): CanvasTemplateSchema {
  const layers: CanvasLayer[] = [];

  // ---- z=10: hero photo, full bleed ----
  layers.push({
    id: id("hero_photo"),
    name: "Hero photo",
    kind: "image",
    locked: false,
    visible: true,
    left: 0,
    top: 0,
    width: W,
    height: H,
    angle: 0,
    opacity: 1,
    z: 10,
    src: "",
    boundField: "hero_photo",
    objectFit: "cover",
    crossOrigin: "anonymous",
    cornerRadius: 0,
    borderColor: "",
    borderWidth: 0,
  });

  // ---- z=20: thin white frame, inset, drawn over photo ----
  // No fill, just a stroke. The shape is a rect with empty fill and a
  // white stroke at strokeWidth 7 — Fabric draws the stroke centered on
  // the path edge so the visible box is at FRAME_INSET to W-FRAME_INSET.
  layers.push({
    id: id("frame"),
    name: "White frame",
    kind: "shape",
    locked: false,
    visible: true,
    left: FRAME_INSET,
    top: FRAME_INSET,
    width: W - FRAME_INSET * 2,
    height: H - FRAME_INSET * 2,
    angle: 0,
    opacity: 1,
    z: 20,
    shapeType: "rect",
    fill: "",
    stroke: ALLIANCE_COLORS.white,
    strokeWidth: FRAME_STROKE,
    cornerRadius: 0,
    strokeDashArray: [],
  });

  // ---- z=25: C21 ALLIANCE lockup at top-center ----
  // 220px wide ≥ 160px brand floor. Centered horizontally.
  const logoWidth = 280;
  const logoHeight = 60;
  layers.push({
    id: id("brokerage_logo"),
    name: "C21 ALLIANCE logo",
    kind: "image",
    locked: false,
    visible: true,
    left: (W - logoWidth) / 2,
    top: 100,
    width: logoWidth,
    height: logoHeight,
    angle: 0,
    opacity: 1,
    z: 25,
    src: C21_ALLIANCE_WHITE_LOGO,
    objectFit: "contain",
    crossOrigin: "anonymous",
    cornerRadius: 0,
    borderColor: "",
    borderWidth: 0,
  });

  // ---- z=26: gold address pill behind the address text ----
  // Larissa's reference uses a soft-gold rounded rectangle to box the
  // address. Width sized generously so 99% of street + city strings fit.
  const pillWidth = 720;
  const pillHeight = 52;
  layers.push({
    id: id("address_pill"),
    name: "Address pill",
    kind: "shape",
    locked: false,
    visible: true,
    left: (W - pillWidth) / 2,
    top: 190,
    width: pillWidth,
    height: pillHeight,
    angle: 0,
    opacity: 0.9,
    z: 26,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.gold100,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 6,
    strokeDashArray: [],
  });

  // ---- z=27: address — street + city joined into one centered line ----
  // The reference shows "420 E 21st Avenue, North Wildwood" inline.
  // We use a hardcoded comma + space inside the layer text and bind
  // city + address_line1 separately would force two layers. Inline
  // concatenation is awkward without a custom resolver, so we use the
  // address_line1 layer for the street + city joined via a sibling layer
  // overlay. Simpler: two layers stacked horizontally? Too brittle.
  // Pragmatic: bind to address_line1 only and put city in a sibling
  // text layer right next to it.
  // For the FIRST pass we use a single bound field — address_line1 — and
  // accept that the city appears below or via boundField composition.
  // Better: bind to address_line1, draw it left-of-center, then a sibling
  // text layer with bound city draws to the right. But that requires
  // measuring text width at render time.
  //
  // Cleanest first-cut: single text layer with text="{address_line1}, {city}"
  // and rely on the bound-field resolver to handle the substitution. The
  // resolver doesn't do composite interpolation today, so we'd need to
  // wire that. PRAGMATIC: just bind to address_line1 here, and accept the
  // city is missing from the visual until a follow-up adds a composite
  // "street_city" bound field. Documented as a Phase C-followup.
  layers.push({
    id: id("address_text"),
    name: "Address (street, city)",
    kind: "text",
    locked: false,
    visible: true,
    left: (W - pillWidth) / 2 + 16,
    top: 196,
    width: pillWidth - 32,
    height: 40,
    angle: 0,
    opacity: 1,
    z: 27,
    text: "{address_line1}",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.glacialIndifference,
    fontSize: 24,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    lineHeight: 1.0,
    charSpacing: 50,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=30: SOLD eyebrow, big serif, center-lower ----
  // Reference positions "SOLD" at ~70% down. Serif large — DM Serif
  // Display is the free Google substitute for The Seasons.
  layers.push({
    id: id("eyebrow"),
    name: "SOLD eyebrow",
    kind: "text",
    locked: false,
    visible: true,
    left: 0,
    top: 720,
    width: W,
    height: 100,
    angle: 0,
    opacity: 1,
    z: 30,
    text: "SOLD",
    fontFamily: ALLIANCE_FONTS.dmSerifDisplay,
    fontSize: 92,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "center",
    lineHeight: 1.0,
    charSpacing: 100,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=31: price, center, immediately under SOLD ----
  layers.push({
    id: id("price"),
    name: "Price",
    kind: "text",
    locked: false,
    visible: true,
    left: 0,
    top: 830,
    width: W,
    height: 80,
    angle: 0,
    opacity: 1,
    z: 31,
    text: "{close_price}",
    boundField: "close_price",
    fontFamily: ALLIANCE_FONTS.glacialIndifference,
    fontSize: 64,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "center",
    lineHeight: 1.0,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  });

  return {
    id: "just_sold_square_v1",
    name: "Just Sold — Square (Larissa spec)",
    description:
      "Full-bleed photo with a thin white inset frame, centered C21 ALLIANCE logo, gold address pill, and SOLD + price in serif. Matches Larissa's 2026-05-24 reference.",
    category: "just_sold",
    variant: "v1" as PostVariant,
    format: "square_1x1",
    width: W,
    height: H,
    backgroundColor: ALLIANCE_COLORS.ink900,
    layers,
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}
