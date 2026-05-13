/**
 * v3 · Side-by-Side · Portrait 4:5 · 1080×1350 (LayerTree builder)
 *
 * Vertical flip of the side-by-side: photo top 675px, light data block
 * bottom 670px (with the 5px gold seam between). Inline stats with dot
 * separators on the data row.
 */

import type {
  GradientLayer,
  Layer,
  LayerTree,
  RectLayer,
  TextLayer,
} from "../../layers/types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "../primitives/_shared";
import { buildChips } from "../primitives/_shared";
import {
  buildBadgeLayers,
  buildFooterLayers,
  buildHeroImage,
  buildOpenHouseStripLayers,
  buildPriceLayer,
  FOOTER_HEIGHT,
  type BuilderContext,
} from "./_shared";

export function buildV3SideBySidePortrait(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1350;
  const photoHeight = 675;
  const seamHeight = 5;
  const dataPadX = 64;
  const dataPadY = 52;

  const ctx: BuilderContext = {
    listing: args.listing,
    theme: args.theme,
    canvasWidth: W,
    canvasHeight: H,
    heroImageUrls: args.heroImageUrls,
    inset: 56,
  };

  const layers: Layer[] = [];

  // Photo (top half)
  layers.push(
    buildHeroImage({
      src: args.heroImageUrls[0] ?? "",
      width: W,
      height: photoHeight,
    }),
  );
  layers.push({
    id: "photo_tint",
    type: "gradient",
    name: "Photo tint",
    x: 0,
    y: 0,
    w: W,
    h: photoHeight,
    variant: "linear",
    angle: 0,
    stops: [
      { offset: 0, color: "#18181B", opacity: 0.40 },
      { offset: 0.22, color: "#18181B", opacity: 0 },
      { offset: 0.78, color: "#18181B", opacity: 0 },
      { offset: 1, color: "#18181B", opacity: 0.20 },
    ],
  } satisfies GradientLayer);

  // Photo eyebrow (white)
  layers.push({
    id: "photo_eyebrow_rule",
    type: "gradient",
    name: "Photo eyebrow accent",
    x: 56,
    y: 60 + Math.round(22 / 2) - 1,
    w: 56,
    h: 3,
    variant: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: args.theme.accent },
      { offset: 1, color: args.theme.accent_dark },
    ],
    radius: 2,
  } satisfies GradientLayer);
  layers.push({
    id: "photo_eyebrow_text",
    type: "text",
    name: "Photo eyebrow",
    x: 56 + 56 + 18,
    y: 60,
    w: W - 56 - 56 - 18 - 56,
    h: Math.ceil(22 * 1.4),
    text: args.theme.eyebrow,
    font: "Inter",
    size: 22,
    weight: 700,
    color: "#FBF7EE",
    letter_spacing: 0.32,
    uppercase: true,
    text_shadow: "0 2px 8px rgba(0,0,0,0.4)",
  } satisfies TextLayer);

  // Seam (gold)
  layers.push({
    id: "seam_rule",
    type: "gradient",
    name: "Photo / data seam",
    x: 0,
    y: photoHeight,
    w: W,
    h: seamHeight,
    variant: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: args.theme.accent },
      { offset: 1, color: args.theme.accent_dark },
    ],
  } satisfies GradientLayer);

  // Data row background (light)
  layers.push({
    id: "data_row_bg",
    type: "rect",
    name: "Data row background",
    x: 0,
    y: photoHeight + seamHeight,
    w: W,
    h: H - photoHeight - seamHeight,
    fill: "#FCFCFB",
  } satisfies RectLayer);

  const dataLeft = dataPadX;
  const dataWidth = W - dataPadX * 2;
  let cursorY = photoHeight + seamHeight + dataPadY;

  // Optional OH strip
  const ohPlaceholder = buildOpenHouseStripLayers({
    ctx,
    x: dataLeft,
    y: 0,
    font_size: 22,
  });
  if (ohPlaceholder.length > 0) {
    const ohHeight = ohPlaceholder[0].h;
    layers.push(
      ...buildOpenHouseStripLayers({
        ctx,
        x: dataLeft,
        y: cursorY,
        font_size: 22,
      }),
    );
    cursorY += ohHeight + 16;
  }

  // Data eyebrow (small, accent_dark)
  layers.push({
    id: "data_eyebrow",
    type: "text",
    name: "Data row eyebrow",
    x: dataLeft,
    y: cursorY,
    w: dataWidth,
    h: Math.ceil(14 * 1.4),
    text: args.theme.eyebrow,
    font: "Inter",
    size: 14,
    weight: 700,
    color: args.theme.accent_dark,
    letter_spacing: 0.30,
    uppercase: true,
  } satisfies TextLayer);
  cursorY += Math.ceil(14 * 1.4) + 14;

  // Address
  const ADDRESS_FONT = 56;
  const addressText = (args.listing.address ?? "").trim();
  if (addressText) {
    layers.push({
      id: "address",
      type: "text",
      name: "Address",
      x: dataLeft,
      y: cursorY,
      w: dataWidth,
      h: Math.ceil(ADDRESS_FONT * 1.04 * 2),
      text: addressText,
      font: "Inter",
      size: ADDRESS_FONT,
      weight: 700,
      color: "#18181B",
      line_height: 1.04,
      letter_spacing: -0.02,
    } satisfies TextLayer);
    cursorY += Math.ceil(ADDRESS_FONT * 1.04) + 10;
  }

  const CITYSTATE_FONT = 22;
  const cityState = [
    [args.listing.city, args.listing.state].filter(Boolean).join(", "),
    args.listing.zip,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (cityState) {
    layers.push({
      id: "citystate",
      type: "text",
      name: "City / State / Zip",
      x: dataLeft,
      y: cursorY,
      w: dataWidth,
      h: Math.ceil(CITYSTATE_FONT * 1.4),
      text: cityState,
      font: "Inter",
      size: CITYSTATE_FONT,
      weight: 500,
      color: "#525250",
      letter_spacing: 0.08,
      uppercase: true,
    } satisfies TextLayer);
    cursorY += Math.ceil(CITYSTATE_FONT * 1.4) + 28;
  }

  // Price + stats row anchored above footer
  const footerY = H - dataPadY - FOOTER_HEIGHT;
  const PRICE_FONT = args.theme.price_mode === "label" ? 46 : 76;
  const priceHeight = Math.ceil(PRICE_FONT * 1.0);
  const priceRowY = footerY - 22 - priceHeight;

  const price = buildPriceLayer({
    ctx,
    x: dataLeft,
    y: priceRowY,
    width: Math.floor(dataWidth * 0.55),
    font_size: PRICE_FONT,
  });
  if (price) {
    const p = price as TextLayer;
    p.color = args.theme.accent_dark;
    p.weight = 900;
    p.line_height = 1;
    p.letter_spacing = args.theme.price_mode === "label" ? 0.06 : -0.03;
    p.text_shadow = undefined;
    layers.push(p);
  }

  // Inline stats right-aligned, with dot separators
  const chips = buildChips(args.listing);
  if (chips.length > 0) {
    const STAT_FONT = 20;
    const STAT_GAP = 16;
    const DOT_SIZE = 5;
    let totalW = 0;
    const sizes: number[] = [];
    for (let i = 0; i < chips.length; i++) {
      const w = Math.ceil(chips[i].length * STAT_FONT * 0.62 * 1.14);
      sizes.push(w);
      totalW += w;
      if (i > 0) totalW += DOT_SIZE + STAT_GAP * 2;
    }
    const statsY = priceRowY + priceHeight - Math.ceil(STAT_FONT * 1.4) - 10;
    let cx = dataLeft + dataWidth - totalW;
    for (let i = 0; i < chips.length; i++) {
      if (i > 0) {
        layers.push({
          id: `stat_dot_${i}`,
          type: "rect",
          name: "Stat separator",
          x: cx + STAT_GAP - DOT_SIZE / 2,
          y: statsY + Math.ceil(STAT_FONT * 1.4 / 2) - DOT_SIZE / 2,
          w: DOT_SIZE,
          h: DOT_SIZE,
          fill: args.theme.accent,
          radius: 999,
        } satisfies RectLayer);
        cx += STAT_GAP * 2 + DOT_SIZE;
      }
      layers.push({
        id: `stat_text_${i}`,
        type: "text",
        name: `Stat — ${chips[i]}`,
        x: cx,
        y: statsY,
        w: sizes[i],
        h: Math.ceil(STAT_FONT * 1.4),
        text: chips[i],
        font: "Inter",
        size: STAT_FONT,
        weight: 600,
        color: "#18181B",
        letter_spacing: 0.14,
        uppercase: true,
      } satisfies TextLayer);
      cx += sizes[i];
    }
  }

  // Footer (light theme)
  const footerLayers = buildFooterLayers({
    ctx,
    x: dataLeft,
    y: footerY,
    width: dataWidth,
    text_color: "#18181B",
    border_color: "#E5E5E2",
  });
  for (const layer of footerLayers) {
    if (layer.id === "footer_mls_tag" && layer.type === "text") {
      (layer as TextLayer).color = "#737370";
    }
  }
  layers.push(...footerLayers);

  // Badge — slight nudge from default (top: 100px right: 64 px)
  const badge = buildBadgeLayers({ ctx });
  for (const b of badge) {
    if (b.id === "badge_stamp_bg" || b.id === "badge_stamp_text") {
      b.y = 100;
      b.x = b.x + (56 - 64); // shift right anchor from 56 → 64
    }
  }
  layers.push(...badge);

  return {
    schema_version: 1,
    width: W,
    height: H,
    background: "#FCFCFB",
    layers,
    source: {
      template_id: `${args.theme.post_type}_portrait_v3`,
      post_type: args.theme.post_type,
      variant: "v3",
      format: "portrait_4x5",
      seeded_at: new Date().toISOString(),
    },
  };
}
