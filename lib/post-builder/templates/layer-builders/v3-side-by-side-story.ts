/**
 * v3 · Side-by-Side · Story 9:16 · 1080×1920 (LayerTree builder)
 *
 * Vertical flip with safe-zone aware spacing. Photo top 1100px, light data
 * block below ending above the bottom safe zone, with the gold seam
 * separating photo from data.
 */

import type {
  GradientLayer,
  Layer,
  LayerTree,
  RectLayer,
  TextLayer,
} from "../../layers/types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "../primitives/_shared";
import { STORY_SAFE_ZONE, buildChips } from "../primitives/_shared";
import {
  buildBadgeLayers,
  buildFooterLayers,
  buildHeroImage,
  buildOpenHouseStripLayers,
  buildPriceLayer,
  FOOTER_HEIGHT,
  type BuilderContext,
} from "./_shared";

export function buildV3SideBySideStory(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1920;
  const photoHeight = 1100;
  const seamHeight = 6;
  const dataPadX = 72;
  const dataPadTop = 64;
  const dataPadBottom = STORY_SAFE_ZONE.bottom + 30;

  const ctx: BuilderContext = {
    listing: args.listing,
    theme: args.theme,
    canvasWidth: W,
    canvasHeight: H,
    heroImageUrls: args.heroImageUrls,
    inset: 72,
  };

  const layers: Layer[] = [];

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
      { offset: 0, color: "#18181B", opacity: 0.65 },
      { offset: 0.18, color: "#18181B", opacity: 0.20 },
      { offset: 0.36, color: "#18181B", opacity: 0 },
      { offset: 1, color: "#18181B", opacity: 0.20 },
    ],
  } satisfies GradientLayer);

  // Photo eyebrow below safe zone
  layers.push({
    id: "photo_eyebrow_rule",
    type: "gradient",
    name: "Photo eyebrow accent",
    x: 72,
    y: STORY_SAFE_ZONE.top + 40 + Math.round(32 / 2) - 2,
    w: 72,
    h: 4,
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
    x: 72 + 72 + 22,
    y: STORY_SAFE_ZONE.top + 40,
    w: W - 72 - 72 - 22 - 72,
    h: Math.ceil(32 * 1.4),
    text: args.theme.eyebrow,
    font: "Inter",
    size: 32,
    weight: 700,
    color: "#FBF7EE",
    letter_spacing: 0.32,
    uppercase: true,
    text_shadow: "0 2px 8px rgba(0,0,0,0.4)",
  } satisfies TextLayer);

  // Seam
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

  // Data row bg
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
  let cursorY = photoHeight + seamHeight + dataPadTop;

  const ohPlaceholder = buildOpenHouseStripLayers({
    ctx,
    x: dataLeft,
    y: 0,
    font_size: 26,
  });
  if (ohPlaceholder.length > 0) {
    const ohHeight = ohPlaceholder[0].h;
    layers.push(
      ...buildOpenHouseStripLayers({
        ctx,
        x: dataLeft,
        y: cursorY,
        font_size: 26,
      }),
    );
    cursorY += ohHeight + 18;
  }

  layers.push({
    id: "data_eyebrow",
    type: "text",
    name: "Data row eyebrow",
    x: dataLeft,
    y: cursorY,
    w: dataWidth,
    h: Math.ceil(18 * 1.4),
    text: args.theme.eyebrow,
    font: "Inter",
    size: 18,
    weight: 700,
    color: args.theme.accent_dark,
    letter_spacing: 0.30,
    uppercase: true,
  } satisfies TextLayer);
  cursorY += Math.ceil(18 * 1.4) + 16;

  const ADDRESS_FONT = 60;
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

  const CITYSTATE_FONT = 24;
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

  const footerY = H - dataPadBottom - FOOTER_HEIGHT;
  const PRICE_FONT = args.theme.price_mode === "label" ? 50 : 84;
  const priceHeight = Math.ceil(PRICE_FONT * 1.0);
  const priceRowY = footerY - 24 - priceHeight;

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

  const chips = buildChips(args.listing);
  if (chips.length > 0) {
    const STAT_FONT = 22;
    const STAT_GAP = 18;
    const DOT_SIZE = 6;
    let totalW = 0;
    const sizes: number[] = [];
    for (let i = 0; i < chips.length; i++) {
      const w = Math.ceil(chips[i].length * STAT_FONT * 0.62 * 1.14);
      sizes.push(w);
      totalW += w;
      if (i > 0) totalW += DOT_SIZE + STAT_GAP * 2;
    }
    const statsY = priceRowY + priceHeight - Math.ceil(STAT_FONT * 1.4) - 8;
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

  // Badge — anchor in mid-photo area
  const badge = buildBadgeLayers({ ctx });
  for (const b of badge) {
    if (b.id === "badge_stamp_bg" || b.id === "badge_stamp_text") {
      b.y = 380;
      b.x = b.x + (56 - 80); // right anchor from 56 → 80
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
      template_id: `${args.theme.post_type}_story_v3`,
      post_type: args.theme.post_type,
      variant: "v3",
      format: "story_9x16",
      seeded_at: new Date().toISOString(),
    },
  };
}
