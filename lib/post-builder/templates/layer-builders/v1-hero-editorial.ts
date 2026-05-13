/**
 * v1 · Hero Editorial · Square 1080×1080 (LayerTree builder)
 *
 * Mirrors primitives/v1-hero-editorial.ts. Hero photo full-bleed with a
 * vertical tint, top-left eyebrow, optional badge stamp, and a bottom-anchored
 * content stack: OH strip → gold rule → address → citystate → price → chips
 * → footer.
 */

import type { Layer, LayerTree } from "../../layers/types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "../primitives/_shared";
import {
  buildAddressLayer,
  buildBadgeLayers,
  buildChipsLayers,
  buildCityStateLayer,
  buildEyebrowLayers,
  buildFooterLayers,
  buildGoldRuleLayer,
  buildHeroImage,
  buildHeroTint,
  buildOpenHouseStripLayers,
  buildPriceLayer,
  FOOTER_HEIGHT,
  type BuilderContext,
} from "./_shared";

export function buildV1HeroEditorialSquare(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1080;
  const inset = 56;

  const ctx: BuilderContext = {
    listing: args.listing,
    theme: args.theme,
    canvasWidth: W,
    canvasHeight: H,
    heroImageUrls: args.heroImageUrls,
    inset,
  };

  const layers: Layer[] = [];

  // 1. Hero photo + tint
  layers.push(
    buildHeroImage({ src: args.heroImageUrls[0] ?? "", width: W, height: H }),
  );
  layers.push(buildHeroTint({ width: W, height: H }));

  // 2. Eyebrow (top-left)
  layers.push(...buildEyebrowLayers({ ctx, x: inset, y: inset, font_size: 22 }));

  // 3. Bottom-anchored content stack — compute Y positions bottom-up
  const contentLeft = inset;
  const contentWidth = W - inset * 2;

  // Footer at the very bottom
  const footerY = H - inset - FOOTER_HEIGHT;
  const footerLayers = buildFooterLayers({
    ctx,
    x: contentLeft,
    y: footerY,
    width: contentWidth,
  });

  // Chips (sized to content width). margin-top from price = 24
  // First measure chips height by building them at a temporary y, then re-place.
  const chipsBlock = buildChipsLayers({
    ctx,
    x: contentLeft,
    y: 0,
    width: contentWidth,
  });
  // We'll re-emit chips at the correct y once we know the stack heights.

  // Layout heights (approximate to the source primitive's CSS):
  //   gold-rule:        4px tall + margin-bottom 22 = 26 reserved
  //   address:          font 56 × line-height 1.05 × up to 2 lines = ~118
  //   citystate:        font 26 × ~1.4 (with margin-top 8) = ~36+8 = 44
  //   price:            font 64 × line-height 1 = 64; margin-top 28 = 92
  //   chips block:      chipsBlock.height; margin-top 24 = +24
  //   footer:           FOOTER_HEIGHT (~61); margin-top 32 + padding-top 22 baked in
  //
  // We allocate from the footer up.
  const ADDRESS_FONT = 56;
  const CITYSTATE_FONT = 26;
  const PRICE_FONT = args.theme.price_mode === "label" ? 38 : 64;

  const addressHeight = Math.ceil(ADDRESS_FONT * 1.05 * 2);
  const citystateHeight = Math.ceil(CITYSTATE_FONT * 1.4);
  const priceHeight = Math.ceil(PRICE_FONT * 1.2);

  // Gaps between the bottom-anchored items (CSS margin-tops):
  const GAP_PRICE_TO_CHIPS = 24;
  const GAP_CITYSTATE_TO_PRICE = 28;
  const GAP_ADDRESS_TO_CITYSTATE = 8;
  const GAP_GOLDRULE_TO_ADDRESS = 22;
  const GAP_OH_TO_GOLDRULE = 18;
  const GAP_FOOTER_TOP = 32; // margin-top: 32
  const FOOTER_BORDER_PAD = 0; // border + padding already in FOOTER_HEIGHT

  const chipsTopY = footerY - GAP_FOOTER_TOP - chipsBlock.height;
  const priceY = chipsBlock.height > 0
    ? chipsTopY - GAP_PRICE_TO_CHIPS - priceHeight
    : footerY - GAP_FOOTER_TOP - priceHeight;
  const citystateY = priceY - GAP_CITYSTATE_TO_PRICE - citystateHeight;
  const addressY = citystateY - GAP_ADDRESS_TO_CITYSTATE - addressHeight;
  const goldRuleH = 4;
  const goldRuleY = addressY - GAP_GOLDRULE_TO_ADDRESS - goldRuleH;

  // OH strip (gold pill) — 22px font, +20 horz pad, +10 vert pad = ~51 tall
  const ohLayers = buildOpenHouseStripLayers({
    ctx,
    x: contentLeft,
    y: 0,
    font_size: 22,
  });
  // Estimate strip height by inspecting first layer (rect)
  let ohY = goldRuleY;
  if (ohLayers.length > 0) {
    const ohRect = ohLayers[0];
    const ohHeight = ohRect.h;
    ohY = goldRuleY - GAP_OH_TO_GOLDRULE - ohHeight;
    // Re-emit at correct y
    const placedOH = buildOpenHouseStripLayers({
      ctx,
      x: contentLeft,
      y: ohY,
      font_size: 22,
    });
    layers.push(...placedOH);
  }

  // Gold rule
  layers.push(
    buildGoldRuleLayer({ ctx, x: contentLeft, y: goldRuleY, width: 64 }),
  );

  // Address
  const address = buildAddressLayer({
    ctx,
    x: contentLeft,
    y: addressY,
    width: contentWidth,
    font_size: ADDRESS_FONT,
  });
  if (address) layers.push(address);

  // City / state
  const citystate = buildCityStateLayer({
    ctx,
    x: contentLeft,
    y: citystateY,
    width: contentWidth,
    font_size: CITYSTATE_FONT,
  });
  if (citystate) layers.push(citystate);

  // Price
  const price = buildPriceLayer({
    ctx,
    x: contentLeft,
    y: priceY,
    width: contentWidth,
    font_size: PRICE_FONT,
  });
  if (price) layers.push(price);

  // Chips — re-emit with correct y
  if (chipsBlock.height > 0) {
    const placedChips = buildChipsLayers({
      ctx,
      x: contentLeft,
      y: chipsTopY,
      width: contentWidth,
    });
    layers.push(...placedChips.layers);
  }

  // Footer
  layers.push(...footerLayers);

  // 4. Badge (on top — last so it overlays everything)
  layers.push(...buildBadgeLayers({ ctx }));

  return {
    schema_version: 1,
    width: W,
    height: H,
    background: "#18181B",
    layers,
    source: {
      template_id: `${args.theme.post_type}_square_v1`,
      post_type: args.theme.post_type,
      variant: "v1",
      format: "square_1x1",
      seeded_at: new Date().toISOString(),
    },
  };
}
