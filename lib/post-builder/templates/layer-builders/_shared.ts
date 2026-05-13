/**
 * Path B — Layer-builder framework.
 *
 * Mirrors the existing primitives/_shared.ts helpers but emits arrays of
 * Layer objects (the LayerTree schema) instead of HTML strings. Each
 * primitive's "layer-builder" function uses these helpers to compose the
 * tree that seeds the Layer Editor.
 *
 * Naming convention:
 *   - Primitives' HTML helpers return HTML strings.
 *   - Layer builders return Layer[] (or full LayerTree).
 *   - Layer ids use stable semantic names ("eyebrow_text", "address",
 *     "footer_brand_mark") so the editor can refer to them and so undo
 *     history survives re-seeds.
 */

import type { Layer, RectLayer, TextLayer, GradientLayer, ImageLayer } from "../../layers/types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "../primitives/_shared";
import {
  buildChips,
  canonicalMlsHashtag,
  formatOpenHouse,
  resolvePriceText,
} from "../primitives/_shared";

export interface BuilderContext {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  /** Total canvas width for boundary-aware decisions (e.g. badge anchor). */
  canvasWidth: number;
  /** Total canvas height. */
  canvasHeight: number;
  /** Hero image URL(s). The first is always the primary; v4/v5 use index 1+. */
  heroImageUrls: string[];
  /**
   * Inset padding the content block respects. Defaults match the legacy
   * primitives (56px square, varies by format).
   */
  inset?: number;
}

/**
 * Re-export the registry-side helpers so layer-builders need only import
 * from this single shared module.
 */
export { buildChips, canonicalMlsHashtag, formatOpenHouse, resolvePriceText };

// ─── Primitive shape builders ───────────────────────────────────────

/**
 * Background hero image — full-bleed image fill.
 */
export function buildHeroImage(args: {
  src: string;
  width: number;
  height: number;
  id?: string;
  fit?: "cover" | "contain" | "fill";
}): ImageLayer {
  return {
    id: args.id ?? "hero_image",
    type: "image",
    name: "Hero photo",
    x: 0,
    y: 0,
    w: args.width,
    h: args.height,
    src: args.src,
    fit: args.fit ?? "cover",
  };
}

/**
 * Vertical-gradient tint over a hero photo. Mirrors the "hero-tint" CSS
 * gradient in v1/v2 primitives — dark at top + bottom, transparent in
 * the middle, so type sits readably over the image.
 */
export function buildHeroTint(args: {
  width: number;
  height: number;
  id?: string;
}): GradientLayer {
  return {
    id: args.id ?? "hero_tint",
    type: "gradient",
    name: "Hero tint",
    x: 0,
    y: 0,
    w: args.width,
    h: args.height,
    variant: "linear",
    angle: 0, // top→bottom
    stops: [
      { offset: 0, color: "#18181B", opacity: 0.55 },
      { offset: 0.14, color: "#18181B", opacity: 0.18 },
      { offset: 0.32, color: "#18181B", opacity: 0 },
      { offset: 0.5, color: "#18181B", opacity: 0 },
      { offset: 0.7, color: "#18181B", opacity: 0.55 },
      { offset: 1.0, color: "#18181B", opacity: 0.92 },
    ],
  };
}

/**
 * Eyebrow label — gradient line + uppercase text. Returns 2 layers
 * (rule + text) anchored at (x, y). The text label uses theme.eyebrow.
 */
export function buildEyebrowLayers(args: {
  ctx: BuilderContext;
  x: number;
  y: number;
  rule_width?: number;
  font_size?: number;
}): Layer[] {
  const { ctx } = args;
  const ruleWidth = args.rule_width ?? 56;
  const ruleHeight = 3;
  const fontSize = args.font_size ?? 22;
  const gap = 18;

  // Rule sits centered on the same baseline as the text label
  const ruleY = args.y + Math.round(fontSize / 2) - Math.round(ruleHeight / 2);
  const textX = args.x + ruleWidth + gap;

  return [
    {
      id: "eyebrow_rule",
      type: "gradient",
      name: "Eyebrow accent rule",
      x: args.x,
      y: ruleY,
      w: ruleWidth,
      h: ruleHeight,
      variant: "linear",
      angle: 90, // left → right
      stops: [
        { offset: 0, color: ctx.theme.accent },
        { offset: 1, color: ctx.theme.accent_dark },
      ],
      radius: 2,
    } satisfies GradientLayer,
    {
      id: "eyebrow_text",
      type: "text",
      name: "Eyebrow label",
      x: textX,
      y: args.y,
      w: ctx.canvasWidth - textX - 56,
      h: Math.ceil(fontSize * 1.4),
      text: ctx.theme.eyebrow,
      font: "Inter",
      size: fontSize,
      weight: 700,
      color: "#FBF7EE",
      letter_spacing: 0.32,
      uppercase: true,
      text_shadow: "0 2px 8px rgba(0,0,0,0.35)",
    } satisfies TextLayer,
  ];
}

/**
 * Optional Open House strip — gold pill above the gold rule that holds
 * the OH date+time. Returns [] when the listing has no OH or theme
 * doesn't show OH datetime.
 */
export function buildOpenHouseStripLayers(args: {
  ctx: BuilderContext;
  x: number;
  y: number;
  font_size?: number;
}): Layer[] {
  const { ctx } = args;
  if (!ctx.theme.show_open_house_datetime) return [];
  const text = formatOpenHouse(ctx.listing.oh_start_at, ctx.listing.oh_end_at);
  if (!text) return [];

  const fontSize = args.font_size ?? 22;
  const horzPad = 20;
  const vertPad = 10;
  // Estimate width of the text — uppercase letter-spacing 0.16em widens it.
  // Conservative rule of thumb: 0.62 × font_size per character + 16% bonus.
  const estTextWidth = Math.ceil(text.length * fontSize * 0.62 * 1.16);
  const w = estTextWidth + horzPad * 2;
  const h = Math.ceil(fontSize * 1.4) + vertPad * 2;

  return [
    {
      id: "oh_strip_bg",
      type: "rect",
      name: "OH strip background",
      x: args.x,
      y: args.y,
      w,
      h,
      fill: ctx.theme.accent,
      radius: 6,
    } satisfies RectLayer,
    {
      id: "oh_strip_text",
      type: "text",
      name: "OH strip text",
      x: args.x + horzPad,
      y: args.y + vertPad,
      w: estTextWidth,
      h: Math.ceil(fontSize * 1.4),
      text,
      font: "Inter",
      size: fontSize,
      weight: 800,
      color: "#18181B",
      letter_spacing: 0.16,
      uppercase: true,
    } satisfies TextLayer,
  ];
}

/**
 * Gold rule divider — horizontal accent line between the OH strip (or
 * eyebrow region) and the address.
 */
export function buildGoldRuleLayer(args: {
  ctx: BuilderContext;
  x: number;
  y: number;
  width?: number;
}): Layer {
  return {
    id: "gold_rule",
    type: "gradient",
    name: "Gold rule",
    x: args.x,
    y: args.y,
    w: args.width ?? 64,
    h: 4,
    variant: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: args.ctx.theme.accent },
      { offset: 1, color: args.ctx.theme.accent_dark },
    ],
    radius: 2,
  } satisfies GradientLayer;
}

/**
 * Address text — line 1 (street) is the prominent line. Box width =
 * canvas width minus inset on both sides; height supports up to 2
 * wrapped lines.
 */
export function buildAddressLayer(args: {
  ctx: BuilderContext;
  x: number;
  y: number;
  width: number;
  font_size?: number;
}): Layer | null {
  const { ctx } = args;
  const text = (ctx.listing.address ?? "").trim();
  if (!text) return null;
  const fontSize = args.font_size ?? 56;
  // Allow up to 2 lines of address.
  const h = Math.ceil(fontSize * 1.05 * 2);
  return {
    id: "address",
    type: "text",
    name: "Address",
    x: args.x,
    y: args.y,
    w: args.width,
    h,
    text,
    font: "Inter",
    size: fontSize,
    weight: 700,
    color: "#FFFFFF",
    line_height: 1.05,
    letter_spacing: -0.02,
    text_shadow: "0 2px 12px rgba(0,0,0,0.4)",
  } satisfies TextLayer;
}

/**
 * City + State + Zip line. Sits below address.
 */
export function buildCityStateLayer(args: {
  ctx: BuilderContext;
  x: number;
  y: number;
  width: number;
  font_size?: number;
}): Layer | null {
  const { ctx } = args;
  const cityState = [
    [ctx.listing.city, ctx.listing.state].filter(Boolean).join(", "),
    ctx.listing.zip,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!cityState) return null;
  const fontSize = args.font_size ?? 26;
  return {
    id: "citystate",
    type: "text",
    name: "City / State / Zip",
    x: args.x,
    y: args.y,
    w: args.width,
    h: Math.ceil(fontSize * 1.4),
    text: cityState,
    font: "Inter",
    size: fontSize,
    weight: 500,
    color: "#F1F1EF",
    letter_spacing: 0.04,
    uppercase: true,
    text_shadow: "0 1px 6px rgba(0,0,0,0.3)",
  } satisfies TextLayer;
}

/**
 * Price line. Style depends on theme.price_mode — "label" mode renders
 * smaller + uppercase (Under Contract). Returns null when the theme +
 * listing produce no price text.
 */
export function buildPriceLayer(args: {
  ctx: BuilderContext;
  x: number;
  y: number;
  width: number;
  font_size?: number;
}): Layer | null {
  const { ctx } = args;
  const priceText = resolvePriceText(ctx.listing, ctx.theme);
  if (!priceText) return null;

  const isLabelMode = ctx.theme.price_mode === "label";
  const fontSize = args.font_size ?? (isLabelMode ? 38 : 64);

  return {
    id: "price",
    type: "text",
    name: "Price",
    x: args.x,
    y: args.y,
    w: args.width,
    h: Math.ceil(fontSize * 1.2),
    text: priceText,
    font: "Inter",
    size: fontSize,
    weight: 800,
    color: ctx.theme.accent,
    line_height: 1,
    letter_spacing: isLabelMode ? 0.14 : -0.02,
    uppercase: isLabelMode,
    text_shadow: "0 2px 14px rgba(0,0,0,0.45)",
  } satisfies TextLayer;
}

/**
 * Bed / Bath / Property-type chip pills. Each chip is a rounded rect +
 * text. Auto-wraps via row tracking — chips that don't fit in current
 * row drop to the next.
 */
export function buildChipsLayers(args: {
  ctx: BuilderContext;
  x: number;
  y: number;
  width: number;
  /** Background tint behind chips — defaults to a translucent surface. */
  fill?: string;
  /** Border color — defaults to the theme accent at 55% alpha. */
  border?: string;
  text_color?: string;
}): { layers: Layer[]; height: number } {
  const { ctx } = args;
  const chips = buildChips(ctx.listing);
  if (chips.length === 0) return { layers: [], height: 0 };

  const fontSize = 22;
  const horzPad = 22;
  const vertPad = 12;
  const gap = 12;
  const fill = args.fill ?? "rgba(252,252,251,0.10)";
  const border = args.border ?? "rgba(201,169,97,0.55)";
  const textColor = args.text_color ?? "#FCFCFB";

  const out: Layer[] = [];
  let cx = args.x;
  let cy = args.y;
  let rowHeight = 0;
  let i = 0;
  for (const chip of chips) {
    // Estimate width: 0.62 × font × char_count × 1.08 (letter_spacing 0.08em)
    const textW = Math.ceil(chip.length * fontSize * 0.62 * 1.08);
    const chipW = textW + horzPad * 2;
    const chipH = Math.ceil(fontSize * 1.4) + vertPad * 2;

    // Wrap to next row when overflow.
    if (cx + chipW > args.x + args.width) {
      cx = args.x;
      cy += chipH + gap;
    }
    rowHeight = Math.max(rowHeight, chipH);

    out.push({
      id: `chip_bg_${i}`,
      type: "rect",
      name: `Chip background — ${chip}`,
      x: cx,
      y: cy,
      w: chipW,
      h: chipH,
      fill,
      stroke: border,
      stroke_width: 1.5,
      radius: 999,
    } satisfies RectLayer);
    out.push({
      id: `chip_text_${i}`,
      type: "text",
      name: `Chip text — ${chip}`,
      x: cx + horzPad,
      y: cy + vertPad,
      w: textW,
      h: Math.ceil(fontSize * 1.4),
      text: chip,
      font: "Inter",
      size: fontSize,
      weight: 600,
      color: textColor,
      letter_spacing: 0.08,
    } satisfies TextLayer);

    cx += chipW + gap;
    i += 1;
  }
  // Total height occupied: from y to (cy + rowHeight)
  const totalHeight = cy - args.y + rowHeight;
  return { layers: out, height: totalHeight };
}

/**
 * Footer block: top border line + brand mark + brand text + MLS hashtag.
 * Returns layers + the height consumed, so the caller can stack things
 * above it.
 */
export function buildFooterLayers(args: {
  ctx: BuilderContext;
  x: number;
  y: number;
  width: number;
  /** Border / brand text color (defaults to the white-on-dark style). */
  text_color?: string;
  border_color?: string;
  /** Brand mark "21" tile fill — defaults to theme accent gradient. */
}): Layer[] {
  const { ctx } = args;
  const textColor = args.text_color ?? "#FCFCFB";
  const borderColor = args.border_color ?? "rgba(252,252,251,0.18)";
  const mlsHashtag = canonicalMlsHashtag(ctx.listing.mls_number, ctx.listing.source_mls);

  // Top border line
  const borderY = args.y;
  // Brand mark + content sit below the border with 22px padding-top.
  const blockY = borderY + 22;
  const markSize = 38;

  const out: Layer[] = [];
  out.push({
    id: "footer_border",
    type: "rect",
    name: "Footer divider",
    x: args.x,
    y: borderY,
    w: args.width,
    h: 1,
    fill: borderColor,
  } satisfies RectLayer);

  // Brand mark — gradient tile with "21".
  out.push({
    id: "footer_brand_mark",
    type: "gradient",
    name: "Brand mark tile",
    x: args.x,
    y: blockY,
    w: markSize,
    h: markSize,
    variant: "linear",
    angle: 135,
    stops: [
      { offset: 0, color: ctx.theme.accent },
      { offset: 1, color: ctx.theme.accent_dark },
    ],
    radius: 8,
  } satisfies GradientLayer);
  out.push({
    id: "footer_brand_mark_text",
    type: "text",
    name: "Brand mark — 21",
    x: args.x,
    y: blockY,
    w: markSize,
    h: markSize,
    text: "21",
    font: "Inter",
    size: 18,
    weight: 800,
    color: "#18181B",
    letter_spacing: -0.02,
    align: "center",
    vertical_align: "middle",
  } satisfies TextLayer);

  // Brand wordmark
  const wordmarkX = args.x + markSize + 12;
  out.push({
    id: "footer_brand_text",
    type: "text",
    name: "Century 21 Alliance",
    x: wordmarkX,
    y: blockY + 8,
    w: 360,
    h: 24,
    text: "Century 21 Alliance",
    font: "Inter",
    size: 18,
    weight: 700,
    color: textColor,
    letter_spacing: 0.18,
    uppercase: true,
  } satisfies TextLayer);

  // MLS hashtag — right-aligned
  const mlsW = 360;
  out.push({
    id: "footer_mls_tag",
    type: "text",
    name: "MLS hashtag",
    x: args.x + args.width - mlsW,
    y: blockY + 9,
    w: mlsW,
    h: 22,
    text: mlsHashtag,
    font: "Inter",
    size: 16,
    weight: 600,
    color: typeof textColor === "string" && textColor.startsWith("#FCFCFB")
      ? "rgba(252,252,251,0.65)"
      : textColor,
    letter_spacing: 0.16,
    uppercase: true,
    align: "right",
  } satisfies TextLayer);

  return out;
}

/** Approximate height the footer block consumes (border + padding + mark). */
export const FOOTER_HEIGHT = 1 + 22 + 38; // ~61

/**
 * Optional badge layers — SOLD stamp / banner / etc.  Returns [] when
 * theme has no badge configured (Just Listed / Under Contract / OH).
 */
export function buildBadgeLayers(args: {
  ctx: BuilderContext;
}): Layer[] {
  const { ctx } = args;
  if (!ctx.theme.badge) return [];

  const text = ctx.theme.badge.text;
  const colorMap: Record<NonNullable<NonNullable<PostTypeTheme["badge"]>["color"]>, { bg: string; fg: string }> = {
    red: { bg: "rgba(184, 60, 60, 0.92)", fg: "#FFFFFF" },
    gold: { bg: "rgba(201, 169, 97, 0.95)", fg: "#18181B" },
    green: { bg: "rgba(47, 143, 92, 0.95)", fg: "#FFFFFF" },
  };
  const colors = colorMap[ctx.theme.badge.color ?? "red"];

  if (ctx.theme.badge.style === "stamp") {
    // Rotated-8deg stamp anchored top-right at (right=56, top=110)
    const fontSize = 38;
    const horzPad = 32;
    const vertPad = 14;
    const estW = Math.ceil(text.length * fontSize * 0.62 * 1.18) + horzPad * 2; // +18% letter-spacing 0.18em
    const h = Math.ceil(fontSize * 1.4) + vertPad * 2;
    const x = ctx.canvasWidth - 56 - estW;
    const y = 110;

    return [
      {
        id: "badge_stamp_bg",
        type: "rect",
        name: "Badge stamp background",
        x,
        y,
        w: estW,
        h,
        rotation: -8,
        fill: colors.bg,
        stroke: "#FCFCFB",
        stroke_width: 5,
        radius: 8,
      } satisfies RectLayer,
      {
        id: "badge_stamp_text",
        type: "text",
        name: "Badge stamp text",
        x,
        y,
        w: estW,
        h,
        rotation: -8,
        text,
        font: "Inter",
        size: fontSize,
        weight: 800,
        color: colors.fg,
        letter_spacing: 0.18,
        uppercase: true,
        align: "center",
        vertical_align: "middle",
        text_shadow: "0 2px 8px rgba(0,0,0,0.25)",
      } satisfies TextLayer,
    ];
  }

  // Banner — full-width across the top photo area
  const fontSize = 30;
  const vertPad = 12;
  const y = 130;
  const h = Math.ceil(fontSize * 1.4) + vertPad * 2;
  return [
    {
      id: "badge_banner_bg",
      type: "rect",
      name: "Badge banner background",
      x: 0,
      y,
      w: ctx.canvasWidth,
      h,
      fill: colors.bg,
    } satisfies RectLayer,
    {
      id: "badge_banner_text",
      type: "text",
      name: "Badge banner text",
      x: 0,
      y,
      w: ctx.canvasWidth,
      h,
      text,
      font: "Inter",
      size: fontSize,
      weight: 800,
      color: colors.fg,
      letter_spacing: 0.32,
      uppercase: true,
      align: "center",
      vertical_align: "middle",
      text_shadow: "0 2px 6px rgba(0,0,0,0.35)",
    } satisfies TextLayer,
  ];
}
