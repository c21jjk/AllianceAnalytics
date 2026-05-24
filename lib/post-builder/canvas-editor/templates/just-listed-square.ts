/**
 * Just Listed — square 1080×1080 (real Larissa-spec template).
 *
 * Replaces the placeholder factory's just_listed × square_1x1 slot as of
 * 2026-05-24. Faithfully translates Larissa's gold-standard reference
 * (308 Osprey Ct, Cape May Court House) into a CanvasTemplateSchema.
 *
 * Recipe (per `project_alliance_larissa_design_rules.md`):
 *   • Photo: ~85% of canvas height. Full-bleed across the top.
 *   • Info band: Obsessed Grey (#252526) rectangle covering bottom ~15-20%.
 *   • Eyebrow: "Just Listed" in Kaushan Script (substitute for Above the
 *     Beyond Script) at ~90pt, white, positioned to OVERLAY the
 *     photo/band boundary so the script flows over both.
 *   • Body: address (street + city stacked), beds/baths/sqft, price —
 *     all Nunito at ~22pt, white, left-aligned inside the dark band.
 *   • Logo: C21 ALLIANCE white lockup on the right of the dark band.
 *   • Brand rules enforced: street + city only (no state/zip), zero
 *     agent fields, brokerage logo ≥160px.
 */
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
import { C21_ALLIANCE_WHITE_LOGO } from "./brand-logos";
import type { CanvasLayer, CanvasTemplateSchema } from "../types";
import type { PostVariant } from "@/lib/post-builder/types";

// Canvas dimensions — locked to PLATFORM_DIMENSIONS["square_1x1"]. Off-by-
// one breaks the runtime validator in templates/index.ts.
const W = 1080;
const H = 1080;

// Info band geometry — sits on the bottom 25% of the canvas. The script
// eyebrow extends ~50px ABOVE the band, sitting on the photo/band edge.
const BAND_HEIGHT = 240;
const BAND_TOP = H - BAND_HEIGHT;

// why: layer ids prefixed with "jl_sq_" so saved posts that use this
// template have human-readable layer references in their layer_tree.
const id = (slot: string): string => `jl_sq_${slot}`;

export function buildJustListedSquareTemplate(): CanvasTemplateSchema {
  const layers: CanvasLayer[] = [];

  // ---- z=10: hero photo, full bleed across full canvas ----
  // The info band sits on TOP of the photo (z=20), so the photo extends
  // behind the band. This avoids a hard edge where photo meets band —
  // the script eyebrow can sit cleanly over the transition.
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

  // ---- z=20: dark info band, bottom 25% ----
  layers.push({
    id: id("info_band"),
    name: "Info band",
    kind: "shape",
    locked: false,
    visible: true,
    left: 0,
    top: BAND_TOP,
    width: W,
    height: BAND_HEIGHT,
    angle: 0,
    opacity: 1,
    z: 20,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.ink900,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: 0,
    strokeDashArray: [],
  });

  // ---- z=30: "Just Listed" script eyebrow, large + into the photo ----
  // 2026-05-24 John feedback: "Just Listed" needs to stand out — even
  // embedded into the photo. Bumped from 96pt → 140pt and pushed up
  // ~110px above the band so most of the script sits on the photo
  // itself. White on photo + 140pt mass means it reads at thumbnail
  // scale on Instagram.
  layers.push({
    id: id("eyebrow"),
    name: "Just Listed eyebrow",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: BAND_TOP - 130,
    width: W - 120,
    height: 180,
    angle: 0,
    opacity: 1,
    z: 30,
    text: "Just Listed",
    fontFamily: ALLIANCE_FONTS.kaushanScript,
    fontSize: 140,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "center",
    lineHeight: 1.0,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
    // why: "lift" preset — subtle drop shadow at 60% opacity. Keeps
    // "Just Listed" legible against busy photos (foliage, kitchens)
    // without looking stamped. The preset's fixed black + 4px offset +
    // 12px blur is the canvas-editor's house style for text-on-photo.
    effect: {
      kind: "lift",
      opacity: 0.6,
    },
  });

  // ---- z=31: street address, Nunito Bold, left-aligned inside band ----
  // Larissa's spec: ~22pt body. Bump to 32pt for square-format
  // legibility at Instagram thumbnail scale (reference image looked
  // good at ~32-36pt visually).
  layers.push({
    id: id("address_street"),
    name: "Street address",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: BAND_TOP + 100,
    width: 720,
    height: 50,
    angle: 0,
    opacity: 1,
    z: 31,
    text: "{address_line1}",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.nunito,
    fontSize: 34,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "left",
    lineHeight: 1.1,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=32: city (NEVER state, NEVER zip — Larissa hard rule) ----
  // 2026-05-24 John feedback: city was too small. Bumped 22pt → 30pt.
  layers.push({
    id: id("address_city"),
    name: "City",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: BAND_TOP + 144,
    width: 720,
    height: 44,
    angle: 0,
    opacity: 1,
    z: 32,
    text: "{city}",
    boundField: "city",
    fontFamily: ALLIANCE_FONTS.nunito,
    fontSize: 30,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "left",
    lineHeight: 1.1,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=33: beds/baths/sqft summary line ----
  // 2026-05-24 John feedback: beds/baths was too small. Bumped 20pt →
  // 28pt. Resolver returns "4 BR / 2.5 BA" via the "beds_baths" bound
  // field — single short phrase that benefits from the size bump.
  layers.push({
    id: id("beds_baths"),
    name: "Beds / Baths",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: BAND_TOP + 188,
    width: 720,
    height: 40,
    angle: 0,
    opacity: 1,
    z: 33,
    text: "{beds_baths}",
    boundField: "beds_baths",
    fontFamily: ALLIANCE_FONTS.nunito,
    fontSize: 28,
    fontWeight: 500,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.white,
    textAlign: "left",
    lineHeight: 1.1,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=34: price, right-aligned, gold accent ----
  // Reference uses small price text in the same Nunito; we place it on
  // the right side of the band so it reads as a discrete "tag" against
  // the address block on the left. Gold accent for hierarchy emphasis.
  layers.push({
    id: id("price"),
    name: "Price",
    kind: "text",
    locked: false,
    visible: true,
    left: W - 380,
    top: BAND_TOP + 100,
    width: 320,
    height: 56,
    angle: 0,
    opacity: 1,
    z: 34,
    text: "{price}",
    boundField: "price",
    fontFamily: ALLIANCE_FONTS.nunito,
    fontSize: 38,
    fontWeight: 800,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.gold500,
    textAlign: "right",
    lineHeight: 1.0,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=35: C21 ALLIANCE brokerage logo, bottom-right of band ----
  // 2026-05-24 John feedback: logo needs to be larger. Bumped from
  // 220×50 → 320×72 so the lockup reads clearly at IG thumbnail scale.
  layers.push({
    id: id("brokerage_logo"),
    name: "C21 ALLIANCE logo",
    kind: "image",
    locked: false,
    visible: true,
    left: W - 360,
    top: BAND_TOP + 158,
    width: 320,
    height: 72,
    angle: 0,
    opacity: 1,
    z: 35,
    src: C21_ALLIANCE_WHITE_LOGO,
    objectFit: "contain",
    crossOrigin: "anonymous",
    cornerRadius: 0,
    borderColor: "",
    borderWidth: 0,
  });

  return {
    id: "just_listed_square_v1",
    name: "Just Listed — Square (Larissa spec)",
    description:
      "Photo-heavy with a dark info band and a script Just Listed eyebrow overlapping the band edge. Matches Larissa's 2026-05-24 gold-standard reference.",
    category: "just_listed",
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
