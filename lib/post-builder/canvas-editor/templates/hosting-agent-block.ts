/**
 * Hosting-agent corner block — shared helper for Open House templates.
 * ---------------------------------------------------------------------
 *
 * Phase 4 of the hosting-agent attribution feature (2026-05-27).
 *
 * Emits a 4-layer cluster anchored bottom-right of an Open House canvas:
 *
 *   • Pill background  — soft semi-transparent white card, rounded corners.
 *     Sits behind the photo + text so the block reads cleanly over either
 *     a photo background (white-pill keeps the text legible) or a flat-
 *     color background (the pill blends to the surrounding white).
 *   • Hosting photo    — circular ImageLayer bound to `hosting_agent_photo`.
 *                        Anchored on the right side of the block.
 *   • Hosting name     — TextLayer bound to `hosting_agent_name`.
 *   • Hosting phone    — TextLayer bound to `hosting_agent_phone`.
 *                        Sits directly under the name.
 *
 * Bound-field fallback semantics (handled in `fabric-factory.ts` at render
 * time):
 *   • `hosting_agent_*` resolves to the listing-agent equivalent when the
 *     hosting field is null / empty. So single-listing OH where hosting =
 *     listing agent "just works" with the same template.
 *   • Phone may resolve to an empty string when Alliance Dash has no number
 *     for the host. The text layer renders empty content — Fabric draws
 *     nothing for the empty string and the surrounding pill keeps the
 *     visual structure of the block. Slight gap between name + (empty)
 *     phone, but no broken / hanging-element artifact.
 *
 * Why a helper module (vs inlining each block):
 *   The square (1080×1080) and story (1080×1920) OH templates use the
 *   same block recipe. Centralizing the geometry + fonts + bound fields
 *   means a tweak (e.g., wider pill, larger photo) updates everywhere
 *   in one place. The factory also returns layers ready to spread into
 *   the template's `layers` array — no caller-side composition.
 *
 * Why not `hideIfEmpty`:
 *   `types.ts` doesn't expose a `hideIfEmpty` flag on TextLayer as of
 *   2026-05-27. Adding one would touch the schema, the Fabric factory,
 *   the headless renderer, and `loadFromJSON` round-tripping. Out of
 *   scope for this phase. Empty content renders as nothing — visually
 *   acceptable; the name still anchors the block.
 */
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
import type { CanvasLayer, ImageLayer, ShapeLayer, TextLayer } from "../types";

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
   * Format-aware sizing knob. Square keeps the photo at 72px; portrait /
   * story bumps it to 80px because there's more breathing room.
   */
  format: "square_1x1" | "story_9x16";
}

/**
 * Build the 4-layer hosting-agent block. Returns the layers in z-order
 * (background pill first, foreground photo + text on top).
 *
 * Geometry (square 1:1):
 *   • Block: 320×120, anchored 24px inset from bottom-right.
 *   • Pill background: full block bounds, rounded 16px, soft white.
 *   • Photo: 72×72 circle, right-side of block, vertically centered.
 *   • Name: left-aligned text, top portion of left column.
 *   • Phone: left-aligned text, directly below name.
 *
 * Geometry (story 9:16):
 *   • Block: 320×140 (slightly taller — bigger photo + roomier text).
 *   • Photo: 80×80 circle.
 *   • Pill background: rounded 18px.
 */
export function buildHostingAgentBlock(
  input: HostingAgentBlockInput,
): CanvasLayer[] {
  const { canvasWidth, canvasHeight, idPrefix, baseZ, format } = input;

  // ---- Per-format sizing knobs ----
  const isStory = format === "story_9x16";
  const photoSize = isStory ? 80 : 72;
  const blockHeight = isStory ? 140 : 120;
  const blockWidth = 320;
  const pillRadius = isStory ? 18 : 16;
  // why: inset is uniform — 24px from each edge. Keeps the block clear of
  // the brokerage logo on templates that have one in the same corner; if
  // a future template needs more clearance, the caller can pass a custom
  // anchor (out of scope here).
  const inset = 24;

  // Anchor coordinates — bottom-right of the canvas.
  const blockLeft = canvasWidth - blockWidth - inset;
  const blockTop = canvasHeight - blockHeight - inset;

  // Photo coordinates — right side of block, vertically centered.
  const photoLeft = blockLeft + blockWidth - photoSize - 16;
  const photoTop = blockTop + (blockHeight - photoSize) / 2;

  // Text column — left of the photo. Width = block width minus photo + gutters.
  const textColLeft = blockLeft + 18;
  const textColWidth = blockWidth - photoSize - 18 - 16 - 12;

  // Name baseline — upper third of the block. Phone sits 6px below name.
  const nameHeight = 24;
  const phoneHeight = 22;
  // why: vertically center the (name + gap + phone) cluster inside the block.
  const nameGap = 6;
  const totalTextH = nameHeight + nameGap + phoneHeight;
  const nameTop = blockTop + (blockHeight - totalTextH) / 2;
  const phoneTop = nameTop + nameHeight + nameGap;

  const layers: CanvasLayer[] = [];

  // ---- z=baseZ: pill background ----
  // Soft semi-transparent white — works over both photo backgrounds (keeps
  // text legible) and flat-color backgrounds (blends in). Using Fabric's
  // opacity prop on a white fill rather than an rgba string so the schema
  // round-trips cleanly via toObject()/loadFromJSON.
  const pill: ShapeLayer = {
    id: `${idPrefix}_hosting_pill`,
    name: "Hosting agent — pill",
    kind: "shape",
    locked: false,
    visible: true,
    left: blockLeft,
    top: blockTop,
    width: blockWidth,
    height: blockHeight,
    angle: 0,
    // why: 0.92 matches the spec — semi-transparent white. Leaves enough
    // bleed-through that a photo background's texture stays present, but
    // dark text on top still reads at IG thumbnail scale.
    opacity: 0.92,
    z: baseZ,
    shapeType: "rect",
    fill: ALLIANCE_COLORS.white,
    stroke: "",
    strokeWidth: 0,
    cornerRadius: pillRadius,
    strokeDashArray: [],
  };
  layers.push(pill);

  // ---- z=baseZ+1: agent name ----
  // Livvic matches what the OH templates already use (open-house-square.ts
  // body fonts are all Livvic). 18pt Semibold reads clearly at IG
  // thumbnail scale on a 1080×1080 export.
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
    z: baseZ + 1,
    text: "{hosting_agent_name}",
    boundField: "hosting_agent_name",
    fontFamily: ALLIANCE_FONTS.livvic,
    fontSize: 18,
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

  // ---- z=baseZ+2: phone ----
  // Muted ink for hierarchy — the host's NAME is the primary attribution,
  // phone is the supporting "how to reach them". ink800 gives ~20% less
  // visual weight than the name's ink900 without going so light it
  // disappears on the soft-white pill.
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
    z: baseZ + 2,
    // why: literal empty fallback. When Alliance Dash has no phone for the
    // host (or hosting + listing-agent both lack one) the resolver returns
    // "" and this layer renders nothing. No `hideIfEmpty` schema flag
    // exists today — see helper docblock.
    text: "",
    boundField: "hosting_agent_phone",
    fontFamily: ALLIANCE_FONTS.livvic,
    fontSize: 16,
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

  // ---- z=baseZ+3: circular photo ----
  // Circular clip via cornerRadius set to half the layer's width — this is
  // the same trick the AI brand-prompt instructs Claude to use for the
  // hosting headshot. Falls back to the listing agent's photo when the
  // host's headshot isn't in brand_assets (resolver in fabric-factory).
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
    z: baseZ + 3,
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
  };
  layers.push(photo);

  return layers;
}
