/**
 * Hosting-agent corner block — shared helper for Open House templates.
 * ---------------------------------------------------------------------
 *
 * Phase 4 of the hosting-agent attribution feature (2026-05-27).
 *
 * Emits a 3-layer cluster anchored bottom-right of an Open House canvas:
 *
 *   • Hosting name     — TextLayer bound to `hosting_agent_name`.
 *                        Left column, top of the (name + gap + phone)
 *                        cluster, vertically centered against the photo.
 *   • Hosting phone    — TextLayer bound to `hosting_agent_phone`.
 *                        Sits directly under the name.
 *   • Hosting photo    — circular ImageLayer bound to `hosting_agent_photo`.
 *                        Anchored on the right side of the block.
 *                        Uses `hideIfEmpty: true` so the layer drops out
 *                        entirely when the host's headshot isn't in
 *                        brand_assets (block degrades gracefully to a
 *                        text-only attribution rather than rendering a
 *                        dashed-outline placeholder rect).
 *
 * 2026-05-27 — pill background removed and geometry expanded to match
 * Larissa's reference design (pic 1). The block now sits directly on the
 * canvas white with name/phone text in the dark Livvic body fonts. The
 * old soft-white pill was redundant on a white-canvas OH template and
 * crowded the visual.
 *
 * Bound-field fallback semantics (handled in `fabric-factory.ts` at render
 * time):
 *   • `hosting_agent_*` resolves to the listing-agent equivalent when the
 *     hosting field is null / empty. So single-listing OH where hosting =
 *     listing agent "just works" with the same template.
 *   • Phone may resolve to an empty string when Alliance Dash has no number
 *     for the host. The text layer renders empty content — Fabric draws
 *     nothing for the empty string. Slight gap below the name but no
 *     broken / hanging-element artifact.
 *
 * Why a helper module (vs inlining each block):
 *   The square (1080×1080) and story (1080×1920) OH templates use the
 *   same block recipe. Centralizing the geometry + fonts + bound fields
 *   means a tweak (e.g., wider photo, taller text) updates everywhere
 *   in one place. The factory also returns layers ready to spread into
 *   the template's `layers` array — no caller-side composition.
 */
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
import type { CanvasLayer, ImageLayer, TextLayer } from "../types";

/**
 * Input shape — caller passes the canvas dimensions and a layer-id prefix
 * so a template's layer ids stay namespaced (e.g. `oh_sq_hosting_*` vs
 * `placeholder_open_house_story_9x16_hosting_*`).
 *
 * `format` drives the block sizing: portrait/story gets a slightly larger
 * photo since there's more room on the long axis; square keeps the block
 * compact so it doesn't crowd the brokerage logo.
 */
export interface HostingAgentBlockInput {
  /** Canvas width in px. */
  canvasWidth: number;
  /** Canvas height in px. */
  canvasHeight: number;
  /**
   * Layer-id prefix — typically the template's slot helper (e.g. "oh_sq").
   * Each emitted layer's id becomes `${idPrefix}_hosting_<slot>`.
   */
  idPrefix: string;
  /**
   * Base z value. The block emits 4 layers at z, z+1, z+2, z+3 so the caller
   * can slot them above (or below) other template elements without
   * collisions.
   */
  baseZ: number;
  /**
   * Format-aware sizing knob. Square gets a 560×260 block; story gets
   * 580×280 (extra room on the long axis). Photo is a fixed 220px in
   * both — it's the visual anchor of the block and shouldn't shrink.
   */
  format: "square_1x1" | "story_9x16";
}

/**
 * Build the 3-layer hosting-agent block. Returns the layers in z-order
 * (name → phone → photo, foreground on top).
 *
 * Geometry (square 1:1):
 *   • Block: 560×260, anchored 40px inset from bottom-right.
 *   • Photo: 220×220 circle, right-side of block, vertically centered.
 *   • Name: Livvic 28pt Bold, left-aligned, top of text cluster.
 *   • Phone: Livvic 22pt Regular, left-aligned, ~12px below name baseline.
 *
 * Geometry (story 9:16):
 *   • Block: 580×280.
 *   • Photo: 220×220 circle (same as square — block stays anchored visually).
 */
export function buildHostingAgentBlock(
  input: HostingAgentBlockInput,
): CanvasLayer[] {
  const { canvasWidth, canvasHeight, idPrefix, baseZ, format } = input;

  // ---- Per-format sizing knobs ----
  const isStory = format === "story_9x16";
  // why: photo is the visual anchor — 220px keeps it a strong presence at
  // IG thumbnail scale. Same size for both formats so the block reads
  // consistently across single-OH (square) and story exports.
  const photoSize = 220;
  const blockWidth = isStory ? 580 : 560;
  const blockHeight = isStory ? 280 : 260;
  // why: 40px inset (was 24) — gives the bigger block more breathing room
  // from the canvas edge so it doesn't look crowded. Matches Larissa's
  // reference where the block sits clearly inside the canvas margin.
  const inset = 40;

  // Anchor coordinates — bottom-right of the canvas.
  const blockLeft = canvasWidth - blockWidth - inset;
  const blockTop = canvasHeight - blockHeight - inset;

  // Photo coordinates — right side of block, vertically centered.
  // photoLeft sits 20px in from the block's right edge.
  const photoLeft = blockLeft + blockWidth - photoSize - 20;
  const photoTop = blockTop + (blockHeight - photoSize) / 2;

  // Text column — left of the photo. 24px left margin from the block's
  // left edge; 16px gutter between text column and the photo. Width is
  // whatever's left after we account for both margins + the photo.
  const textColLeft = blockLeft + 24;
  const textColWidth = blockWidth - photoSize - 20 - 24 - 16;

  // Text sizing — name larger, phone slightly smaller; ink800 on phone
  // for soft hierarchy beneath the ink900 name.
  const nameHeight = 36;
  const phoneHeight = 28;
  // why: vertically center the (name + gap + phone) cluster against the
  // 220px photo on the right. Without this the text would float at the
  // top of the block while the photo sits centered, breaking the visual
  // pairing.
  const nameGap = 12;
  const totalTextH = nameHeight + nameGap + phoneHeight;
  const nameTop = blockTop + (blockHeight - totalTextH) / 2;
  const phoneTop = nameTop + nameHeight + nameGap;

  const layers: CanvasLayer[] = [];

  // ---- z=baseZ: agent name ----
  // Livvic matches what the OH templates already use (open-house-square.ts
  // body fonts are all Livvic). 28pt Bold gives the name strong presence
  // against the white canvas — pic-1 spec.
  const nameText: TextLayer = {
    id: `${idPrefix}_hosting_name`,
    name: "Hosting agent — name",
    kind: "text",
    locked: false,
    visible: true,
    left: textColLeft,
    top: nameTop,
    width: textColWidth,
    height: nameHeight,
    angle: 0,
    opacity: 1,
    z: baseZ,
    text: "{hosting_agent_name}",
    boundField: "hosting_agent_name",
    fontFamily: ALLIANCE_FONTS.livvic,
    fontSize: 28,
    fontWeight: 700,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "left",
    lineHeight: 1.1,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  };
  layers.push(nameText);

  // ---- z=baseZ+1: phone ----
  // Muted ink for hierarchy — the host's NAME is the primary attribution,
  // phone is the supporting "how to reach them". ink800 gives ~20% less
  // visual weight than the name's ink900 without going so light it
  // disappears on the white canvas.
  const phoneText: TextLayer = {
    id: `${idPrefix}_hosting_phone`,
    name: "Hosting agent — phone",
    kind: "text",
    locked: false,
    visible: true,
    left: textColLeft,
    top: phoneTop,
    width: textColWidth,
    height: phoneHeight,
    angle: 0,
    opacity: 1,
    z: baseZ + 1,
    // why: literal empty fallback. When Alliance Dash has no phone for the
    // host (or hosting + listing-agent both lack one) the resolver returns
    // "" and this layer renders nothing.
    text: "",
    boundField: "hosting_agent_phone",
    fontFamily: ALLIANCE_FONTS.livvic,
    fontSize: 22,
    fontWeight: 400,
    fontStyle: "normal",
    fill: ALLIANCE_COLORS.ink800,
    textAlign: "left",
    lineHeight: 1.1,
    charSpacing: 0,
    underline: false,
    linethrough: false,
    editable: true,
  };
  layers.push(phoneText);

  // ---- z=baseZ+2: circular photo ----
  // Circular clip via cornerRadius set to half the layer's width — this is
  // the same trick the AI brand-prompt instructs Claude to use for the
  // hosting headshot. Falls back to the listing agent's photo when the
  // host's headshot isn't in brand_assets (resolver in fabric-factory).
  //
  // `hideIfEmpty: true` — when the resolver returns null/empty (no
  // brand_assets match for the host's name) the layer is dropped entirely
  // rather than rendering an empty dashed-outline placeholder. The block
  // degrades to a text-only attribution.
  const photo: ImageLayer = {
    id: `${idPrefix}_hosting_photo`,
    name: "Hosting agent — photo",
    kind: "image",
    locked: false,
    visible: true,
    left: photoLeft,
    top: photoTop,
    width: photoSize,
    height: photoSize,
    angle: 0,
    opacity: 1,
    z: baseZ + 2,
    src: null,
    boundField: "hosting_agent_photo",
    objectFit: "cover",
    crossOrigin: "anonymous",
    // why: cornerRadius = half the width clips to a perfect circle. Fabric
    // applies this as a clipPath at draw time; matches how the AI design
    // pipeline emits circular agent thumbnails per the brand-prompt.
    cornerRadius: Math.floor(photoSize / 2),
    borderColor: "",
    borderWidth: 0,
    hideIfEmpty: true,
  };
  layers.push(photo);

  return layers;
}
