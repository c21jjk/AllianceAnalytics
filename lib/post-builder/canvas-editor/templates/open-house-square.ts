/**
 * Open House (retail) — square 1080×1080 (real Larissa-spec template).
 *
 * Replaces the placeholder factory's open_house × square_1x1 slot as of
 * 2026-05-24. Faithful translation of Larissa's gold-standard reference
 * (220 Village Road, Villas).
 *
 * Recipe (per `project_alliance_larissa_design_rules.md`):
 *   • Background: white (#FFFFFF). NOT dark — Open House is the airy
 *     post type.
 *   • Photo: ~50% of canvas, centered horizontally, in a rounded
 *     rectangle with ~24px corner radius. Generous whitespace ABOVE
 *     and BELOW.
 *   • Date/time at top: Livvic 28pt, dark, center-aligned.
 *   • Eyebrow: HUGE composition — "Open" in Allura (substitute for
 *     Beautifully Delicious Script) at ~280-300pt, dark, OVERLAPPING
 *     with "HOUSE" in Livvic at ~88pt, dark. The script "Open"
 *     should flow visually over/around the "HOUSE" sans text.
 *   • Address below photo: street + city only, Livvic 28pt center.
 *   • Logo: C21 ALLIANCE at the bottom of the canvas. >=240px wide.
 *   • Brand rules: street + city only (no state/zip), zero agent
 *     fields, brokerage logo prominent.
 */
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
import { C21_ALLIANCE_WHITE_LOGO } from "./brand-logos";
import { buildHostingAgentBlock } from "./hosting-agent-block";
import type { CanvasLayer, CanvasTemplateSchema } from "../types";
import type { PostVariant } from "@/lib/post-builder/types";

const W = 1080;
const H = 1080;

const id = (slot: string): string => `oh_sq_${slot}`;

export function buildOpenHouseSquareTemplate(): CanvasTemplateSchema {
  const layers: CanvasLayer[] = [];

  // ---- z=10: hero photo, ~50% canvas, centered, rounded corners ----
  // 720×540 (4:3 aspect), centered. The photo sits in the middle of the
  // canvas with breathing room above and below for the eyebrow + footer.
  const photoWidth = 800;
  const photoHeight = 500;
  const photoLeft = (W - photoWidth) / 2;
  const photoTop = 360;
  layers.push({
    id: id("hero_photo"),
    name: "Hero photo",
    kind: "image",
    locked: false,
    visible: true,
    left: photoLeft,
    top: photoTop,
    width: photoWidth,
    height: photoHeight,
    angle: 0,
    opacity: 1,
    z: 10,
    src: "",
    boundField: "hero_photo",
    objectFit: "cover",
    crossOrigin: "anonymous",
    cornerRadius: 24,
    borderColor: "",
    borderWidth: 0,
  });

  // ---- z=20: date/time bar — top-LEFT half ----
  // 2026-05-27 — moved from centered to the left half so the C21
  // ALLIANCE logo can occupy the top-right. Width = half the canvas
  // minus the left inset; text remains center-aligned within that
  // narrower column so it reads as its own block.
  layers.push({
    id: id("date_time"),
    name: "Open House date + time",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: 90,
    width: W / 2 - 60,
    height: 36,
    angle: 0,
    opacity: 1,
    z: 20,
    text: "SATURDAY · TIME TBD",
    boundField: "open_house_date",
    fontFamily: ALLIANCE_FONTS.livvic,
    fontSize: 26,
    fontWeight: 500,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    lineHeight: 1.0,
    charSpacing: 200,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=30: HUGE "Open" script eyebrow ----
  // Larissa's reference puts "Open" at ~314pt in Beautifully Delicious
  // Script. We use Allura (free Google substitute) at 240pt — slightly
  // smaller because Allura is taller-set than the original. Positioned
  // so it overlaps with "HOUSE" (z=31 below) — "Open" flows from upper-
  // left toward the "HOUSE" baseline.
  layers.push({
    id: id("eyebrow_script"),
    name: "Open (script)",
    kind: "text",
    locked: false,
    visible: true,
    left: 40,
    top: 120,
    width: 720,
    height: 280,
    angle: 0,
    opacity: 1,
    z: 30,
    text: "Open",
    fontFamily: ALLIANCE_FONTS.allura,
    fontSize: 240,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "left",
    lineHeight: 1.0,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=31: "HOUSE" sans, smaller, sits to the right of "Open" ----
  // Per the reference, "Open" script overlays/touches "HOUSE" sans.
  // We position HOUSE to the right of Open's natural width and slightly
  // below the baseline so the script flows over the H.
  layers.push({
    id: id("eyebrow_sans"),
    name: "HOUSE (sans)",
    kind: "text",
    locked: false,
    visible: true,
    left: 540,
    top: 220,
    width: 500,
    height: 100,
    angle: 0,
    opacity: 1,
    z: 31,
    text: "HOUSE",
    fontFamily: ALLIANCE_FONTS.livvic,
    fontSize: 80,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "left",
    lineHeight: 1.0,
    charSpacing: 100,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=40: address line below photo, street + city bottom-LEFT ----
  // 2026-05-27 — moved from centered to bottom-LEFT to mirror Larissa's
  // reference: the hosting-agent block now occupies the bottom-right
  // half of the slide, so address text gets the bottom-left half.
  layers.push({
    id: id("address_street"),
    name: "Street address",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: photoTop + photoHeight + 50,
    width: 500,
    height: 38,
    angle: 0,
    opacity: 1,
    z: 40,
    text: "{address_line1}",
    boundField: "address_line1",
    fontFamily: ALLIANCE_FONTS.livvic,
    fontSize: 28,
    fontWeight: 600,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "left",
    lineHeight: 1.0,
    charSpacing: 100,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=41: city, bottom-LEFT under street ----
  layers.push({
    id: id("address_city"),
    name: "City",
    kind: "text",
    locked: false,
    visible: true,
    left: 60,
    top: 952,
    width: 500,
    height: 30,
    angle: 0,
    opacity: 1,
    z: 41,
    text: "{city}",
    boundField: "city",
    fontFamily: ALLIANCE_FONTS.livvic,
    fontSize: 22,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "left",
    lineHeight: 1.0,
    charSpacing: 50,
    underline: false,
    linethrough: false,
    editable: true,
  });

  // ---- z=50: C21 ALLIANCE logo — TOP-RIGHT ----
  // 2026-05-27 — moved from bottom-center to top-right so the bottom-
  // right corner is reserved for the hosting-agent block. Width
  // shrinks slightly to fit alongside the date/time bar on the left.
  // Reference uses the dark-text version since the background is white.
  // Our brand-logos.ts only exports the white-on-dark lockup at the
  // C21_ALLIANCE_WHITE_LOGO export. The Grey variant exists at
  // C21_ALLIANCE_GREY_LOGO — use that for light-background templates.
  const logoWidth = 260;
  const logoHeight = 52;
  layers.push({
    id: id("brokerage_logo"),
    name: "C21 ALLIANCE logo",
    kind: "image",
    locked: false,
    visible: true,
    left: W - logoWidth - 50,
    top: 80,
    width: logoWidth,
    height: logoHeight,
    angle: 0,
    opacity: 1,
    z: 50,
    // why: ImageBoundField resolver returns the WHITE lockup by default
    // (for dark backgrounds). On Open House (white background) we
    // explicitly point at the GREY lockup via literal src instead of
    // boundField. AI Design rewrites of this template should keep this
    // explicit src; the brand-prompt's open_house recipe documents this.
    src: "https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/15c6c2ea-dc9f-45c1-8f65-3cd412ba8299.png",
    objectFit: "contain",
    crossOrigin: "anonymous",
    cornerRadius: 0,
    borderColor: "",
    borderWidth: 0,
  });

  void C21_ALLIANCE_WHITE_LOGO;

  // ---- z=60+: hosting-agent corner block (bottom-right) ----
  // Added 2026-05-27 per John's policy override: OH posts (single + multi)
  // now carry a hosting-agent attribution block. The block resolves to the
  // listing agent when no hosting override is set, so this single template
  // covers both retail OH (host = listing agent) and multi-OH carousel
  // per-property slides (host varies per slide). Block lives above the
  // logo's z=50 so it draws on top if positions ever overlap.
  layers.push(
    ...buildHostingAgentBlock({
      canvasWidth: W,
      canvasHeight: H,
      idPrefix: "oh_sq",
      baseZ: 60,
      format: "square_1x1",
    }),
  );

  return {
    id: "open_house_square_v1",
    name: "Open House — Square (Larissa spec)",
    description:
      "Airy white background with a centered rounded photo, huge Open script eyebrow overlapping HOUSE sans, street + city below, C21 ALLIANCE Grey logo at the bottom. Matches Larissa's 2026-05-24 reference.",
    category: "open_house",
    variant: "v1" as PostVariant,
    format: "square_1x1",
    width: W,
    height: H,
    backgroundColor: ALLIANCE_COLORS.white,
    layers,
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}
