/**
 * v2 · Bold Stats · Story 9:16 · 1080×1920 (LayerTree builder)
 *
 * Photo top 1100px (~57%), dark data pane 820px below ending above the bottom
 * safe zone. Vertical price + stat stack to fit the narrow story width.
 */

import type { GradientLayer, Layer, LayerTree, RectLayer, TextLayer } from "../../layers/types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "../primitives/_shared";
import { STORY_SAFE_ZONE, buildChips } from "../primitives/_shared";
import {
  buildBadgeLayers,
  buildEyebrowLayers,
  buildFooterLayers,
  buildHeroImage,
  buildOpenHouseStripLayers,
  buildPriceLayer,
  FOOTER_HEIGHT,
  type BuilderContext,
} from "./_shared";

export function buildV2BoldStatsStory(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1920;
  const inset = 72;
  const photoHeight = 1100;
  const dataPanePad = 60;
  const dataPaneBottomPad = STORY_SAFE_ZONE.bottom + 30;

  const ctx: BuilderContext = {
    listing: args.listing,
    theme: args.theme,
    canvasWidth: W,
    canvasHeight: H,
    heroImageUrls: args.heroImageUrls,
    inset,
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
    id: "hero_tint",
    type: "gradient",
    name: "Hero tint",
    x: 0,
    y: 0,
    w: W,
    h: photoHeight,
    variant: "linear",
    angle: 0,
    stops: [
      { offset: 0, color: "#18181B", opacity: 0.65 },
      { offset: 0.14, color: "#18181B", opacity: 0.30 },
      { offset: 0.32, color: "#18181B", opacity: 0 },
      { offset: 1, color: "#18181B", opacity: 0.30 },
    ],
  } satisfies GradientLayer);

  layers.push(
    ...buildEyebrowLayers({
      ctx,
      x: inset,
      y: STORY_SAFE_ZONE.top + 40,
      rule_width: 72,
      font_size: 32,
    }),
  );

  layers.push({
    id: "data_pane_bg",
    type: "rect",
    name: "Data pane background",
    x: 0,
    y: photoHeight,
    w: W,
    h: H - photoHeight,
    fill: "#18181B",
  } satisfies RectLayer);

  const dataLeft = inset;
  const dataWidth = W - inset * 2;
  const dataTop = photoHeight + dataPanePad;

  let cursorY = dataTop;

  const ohPlaceholder = buildOpenHouseStripLayers({
    ctx,
    x: dataLeft,
    y: 0,
    font_size: 26,
  });
  if (ohPlaceholder.length > 0) {
    const ohHeight = ohPlaceholder[0].h;
    const placedOH = buildOpenHouseStripLayers({
      ctx,
      x: dataLeft,
      y: cursorY,
      font_size: 26,
    });
    layers.push(...placedOH);
    cursorY += ohHeight + 18;
  }

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
      h: Math.ceil(ADDRESS_FONT * 1.05 * 2),
      text: addressText,
      font: "Inter",
      size: ADDRESS_FONT,
      weight: 700,
      color: "#FFFFFF",
      line_height: 1.05,
      letter_spacing: -0.02,
    } satisfies TextLayer);
    cursorY += Math.ceil(ADDRESS_FONT * 1.05) + 10;
  }

  const CITYSTATE_FONT = 26;
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
      color: "#A3A3A0",
      letter_spacing: 0.06,
      uppercase: true,
    } satisfies TextLayer);
    cursorY += Math.ceil(CITYSTATE_FONT * 1.4) + 24;
  }

  layers.push({
    id: "gold_rule",
    type: "gradient",
    name: "Gold rule",
    x: dataLeft,
    y: cursorY,
    w: 88,
    h: 4,
    variant: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: args.theme.accent },
      { offset: 1, color: args.theme.accent_dark },
    ],
    radius: 2,
  } satisfies GradientLayer);
  cursorY += 4 + 22;

  // Price (vertical stack — not a row in story)
  const PRICE_FONT = args.theme.price_mode === "label" ? 72 : 132;
  const priceHeight = Math.ceil(PRICE_FONT * 0.95);
  const price = buildPriceLayer({
    ctx,
    x: dataLeft,
    y: cursorY,
    width: dataWidth,
    font_size: PRICE_FONT,
  });
  if (price) {
    const priceTextLayer = price as TextLayer;
    priceTextLayer.line_height = 0.95;
    priceTextLayer.weight = 900;
    priceTextLayer.text_shadow = undefined;
    layers.push(priceTextLayer);
    cursorY += priceHeight + 18;
  }

  // Stats below price (still inline with dot separators)
  const chips = buildChips(args.listing);
  if (chips.length > 0) {
    const STAT_FONT = 26;
    const STAT_GAP = 18;
    const DOT_SIZE = 6;
    let cx = dataLeft;
    const statsY = cursorY;
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
      const w = Math.ceil(chips[i].length * STAT_FONT * 0.62 * 1.16);
      layers.push({
        id: `stat_text_${i}`,
        type: "text",
        name: `Stat — ${chips[i]}`,
        x: cx,
        y: statsY,
        w,
        h: Math.ceil(STAT_FONT * 1.4),
        text: chips[i],
        font: "Inter",
        size: STAT_FONT,
        weight: 600,
        color: "#FCFCFB",
        letter_spacing: 0.16,
        uppercase: true,
      } satisfies TextLayer);
      cx += w;
    }
  }

  // Footer pinned to bottom (above safe zone)
  const footerY = H - dataPaneBottomPad - FOOTER_HEIGHT;
  const footerLayers = buildFooterLayers({
    ctx,
    x: dataLeft,
    y: footerY,
    width: dataWidth,
  });
  layers.push(...footerLayers);

  layers.push(...buildBadgeLayers({ ctx }));

  return {
    schema_version: 1,
    width: W,
    height: H,
    background: "#18181B",
    layers,
    source: {
      template_id: `${args.theme.post_type}_story_v2`,
      post_type: args.theme.post_type,
      variant: "v2",
      format: "story_9x16",
      seeded_at: new Date().toISOString(),
    },
  };
}
