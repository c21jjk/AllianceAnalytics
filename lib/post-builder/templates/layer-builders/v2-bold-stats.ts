/**
 * v2 · Bold Stats · Square 1080×1080 (LayerTree builder)
 *
 * Top 60% (648px) is the hero photo with a soft tint.
 * Bottom 40% (432px) is a dark `#18181B` data pane with:
 *   - optional Open House strip
 *   - address (white)
 *   - citystate (muted grey)
 *   - gold rule
 *   - price (oversized) + inline stats with dot separators (right-aligned)
 *   - footer at the very bottom
 */

import type { GradientLayer, Layer, LayerTree, RectLayer, TextLayer } from "../../layers/types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "../primitives/_shared";
import { buildChips } from "../primitives/_shared";
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

export function buildV2BoldStatsSquare(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1080;
  const inset = 56;
  const photoHeight = 648;
  const dataPanePad = 48;
  const dataPaneBottomPad = 44;

  const ctx: BuilderContext = {
    listing: args.listing,
    theme: args.theme,
    canvasWidth: W,
    canvasHeight: H,
    heroImageUrls: args.heroImageUrls,
    inset,
  };

  const layers: Layer[] = [];

  // 1. Hero photo (top 60%)
  layers.push(
    buildHeroImage({
      src: args.heroImageUrls[0] ?? "",
      width: W,
      height: photoHeight,
    }),
  );
  // 2. Subtle photo tint — only over photo region
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
      { offset: 0, color: "#18181B", opacity: 0.45 },
      { offset: 0.26, color: "#18181B", opacity: 0.05 },
      { offset: 0.52, color: "#18181B", opacity: 0 },
      { offset: 1, color: "#18181B", opacity: 0.35 },
    ],
  } satisfies GradientLayer);

  // 3. Eyebrow over photo
  layers.push(...buildEyebrowLayers({ ctx, x: inset, y: inset, font_size: 22 }));

  // 4. Dark data pane background (bottom 40%) — opaque rect first
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

  // 5. Data pane content — top-down stack inside the data pane
  const dataLeft = inset;
  const dataWidth = W - inset * 2;
  const dataTop = photoHeight + dataPanePad;

  let cursorY = dataTop;

  // OH strip (when applicable)
  const ohPlaceholder = buildOpenHouseStripLayers({
    ctx,
    x: dataLeft,
    y: 0,
    font_size: 20,
  });
  if (ohPlaceholder.length > 0) {
    const ohHeight = ohPlaceholder[0].h;
    const placedOH = buildOpenHouseStripLayers({
      ctx,
      x: dataLeft,
      y: cursorY,
      font_size: 20,
    });
    layers.push(...placedOH);
    cursorY += ohHeight + 14; // margin-bottom: 14
  }

  // Address (white, no shadow on dark pane)
  const ADDRESS_FONT = 44;
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
    cursorY += Math.ceil(ADDRESS_FONT * 1.05) + 6; // address height (1 line) + small gap
  }

  // City / state (muted grey)
  const CITYSTATE_FONT = 20;
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
    cursorY += Math.ceil(CITYSTATE_FONT * 1.4) + 18; // margin-top to gold-rule
  }

  // Gold rule (3px)
  layers.push({
    id: "gold_rule",
    type: "gradient",
    name: "Gold rule",
    x: dataLeft,
    y: cursorY,
    w: 72,
    h: 3,
    variant: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: args.theme.accent },
      { offset: 1, color: args.theme.accent_dark },
    ],
    radius: 2,
  } satisfies GradientLayer);
  cursorY += 3 + 12; // gold rule + margin-top to price-row

  // Price + stats row — pinned to the bottom, computed independently
  // Footer y first
  const footerY = H - dataPaneBottomPad - FOOTER_HEIGHT;
  const footerLayers = buildFooterLayers({
    ctx,
    x: dataLeft,
    y: footerY,
    width: dataWidth,
  });

  // Price + stat row sits in space between cursorY and footerY
  const PRICE_FONT = args.theme.price_mode === "label" ? 54 : 88;
  const priceHeight = Math.ceil(PRICE_FONT * 0.95);
  const priceRowY = footerY - 20 - priceHeight; // ~20px gap above footer

  const price = buildPriceLayer({
    ctx,
    x: dataLeft,
    y: priceRowY,
    width: Math.floor(dataWidth * 0.6),
    font_size: PRICE_FONT,
  });
  if (price) {
    // Override line-height + color so it matches v2's heavier treatment.
    const priceTextLayer = price as TextLayer;
    priceTextLayer.line_height = 0.95;
    priceTextLayer.weight = 900;
    priceTextLayer.text_shadow = undefined;
    layers.push(priceTextLayer);
  }

  // Inline stats (right-aligned). Build as text + tiny accent dots.
  const chips = buildChips(args.listing);
  if (chips.length > 0) {
    const STAT_FONT = 19;
    const STAT_GAP = 14;
    const DOT_SIZE = 4;
    // Compute total width right-to-left
    // Estimate widths: text width ~= chars × font × 0.62 × 1.16 (letter_spacing 0.16em)
    let totalW = 0;
    const sizes: number[] = [];
    for (let i = 0; i < chips.length; i++) {
      const w = Math.ceil(chips[i].length * STAT_FONT * 0.62 * 1.16);
      sizes.push(w);
      totalW += w;
      if (i > 0) totalW += DOT_SIZE + STAT_GAP * 2;
    }
    const statsY = priceRowY + priceHeight - Math.ceil(STAT_FONT * 1.4) - 10; // align bottom-ish
    let cx = dataLeft + dataWidth - totalW;
    for (let i = 0; i < chips.length; i++) {
      if (i > 0) {
        // Dot
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
        color: "#FCFCFB",
        letter_spacing: 0.16,
        uppercase: true,
      } satisfies TextLayer);
      cx += sizes[i];
    }
  }

  // Footer
  layers.push(...footerLayers);

  // Badge on top
  layers.push(...buildBadgeLayers({ ctx }));

  return {
    schema_version: 1,
    width: W,
    height: H,
    background: "#18181B",
    layers,
    source: {
      template_id: `${args.theme.post_type}_square_v2`,
      post_type: args.theme.post_type,
      variant: "v2",
      format: "square_1x1",
      seeded_at: new Date().toISOString(),
    },
  };
}
