/**
 * v1 · Hero Editorial · Portrait 4:5 · 1080×1350 (LayerTree builder)
 *
 * Same composition as the square hero editorial scaled up for portrait —
 * 60px inset, slightly larger eyebrow / address / price / chips.
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

export function buildV1HeroEditorialPortrait(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1350;
  const inset = 60;

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
  layers.push(...buildEyebrowLayers({ ctx, x: inset, y: inset, font_size: 24 }));

  // 3. Bottom-anchored content stack — compute Y positions bottom-up
  const contentLeft = inset;
  const contentWidth = W - inset * 2;

  const ADDRESS_FONT = 64;
  const CITYSTATE_FONT = 28;
  const PRICE_FONT = args.theme.price_mode === "label" ? 44 : 72;

  const addressHeight = Math.ceil(ADDRESS_FONT * 1.05 * 2);
  const citystateHeight = Math.ceil(CITYSTATE_FONT * 1.4);
  const priceHeight = Math.ceil(PRICE_FONT * 1.2);

  const GAP_PRICE_TO_CHIPS = 28;
  const GAP_CITYSTATE_TO_PRICE = 32;
  const GAP_ADDRESS_TO_CITYSTATE = 10;
  const GAP_GOLDRULE_TO_ADDRESS = 26;
  const GAP_OH_TO_GOLDRULE = 20;
  const GAP_FOOTER_TOP = 36;

  const footerY = H - inset - FOOTER_HEIGHT;
  const footerLayers = buildFooterLayers({
    ctx,
    x: contentLeft,
    y: footerY,
    width: contentWidth,
  });

  const chipsBlock = buildChipsLayers({
    ctx,
    x: contentLeft,
    y: 0,
    width: contentWidth,
  });

  const chipsTopY = footerY - GAP_FOOTER_TOP - chipsBlock.height;
  const priceY = chipsBlock.height > 0
    ? chipsTopY - GAP_PRICE_TO_CHIPS - priceHeight
    : footerY - GAP_FOOTER_TOP - priceHeight;
  const citystateY = priceY - GAP_CITYSTATE_TO_PRICE - citystateHeight;
  const addressY = citystateY - GAP_ADDRESS_TO_CITYSTATE - addressHeight;
  const goldRuleH = 4;
  const goldRuleY = addressY - GAP_GOLDRULE_TO_ADDRESS - goldRuleH;

  const ohPlaceholder = buildOpenHouseStripLayers({
    ctx,
    x: contentLeft,
    y: 0,
    font_size: 24,
  });
  if (ohPlaceholder.length > 0) {
    const ohHeight = ohPlaceholder[0].h;
    const ohY = goldRuleY - GAP_OH_TO_GOLDRULE - ohHeight;
    const placedOH = buildOpenHouseStripLayers({
      ctx,
      x: contentLeft,
      y: ohY,
      font_size: 24,
    });
    layers.push(...placedOH);
  }

  layers.push(
    buildGoldRuleLayer({ ctx, x: contentLeft, y: goldRuleY, width: 72 }),
  );

  const address = buildAddressLayer({
    ctx,
    x: contentLeft,
    y: addressY,
    width: contentWidth,
    font_size: ADDRESS_FONT,
  });
  if (address) layers.push(address);

  const citystate = buildCityStateLayer({
    ctx,
    x: contentLeft,
    y: citystateY,
    width: contentWidth,
    font_size: CITYSTATE_FONT,
  });
  if (citystate) layers.push(citystate);

  const price = buildPriceLayer({
    ctx,
    x: contentLeft,
    y: priceY,
    width: contentWidth,
    font_size: PRICE_FONT,
  });
  if (price) layers.push(price);

  if (chipsBlock.height > 0) {
    const placedChips = buildChipsLayers({
      ctx,
      x: contentLeft,
      y: chipsTopY,
      width: contentWidth,
    });
    layers.push(...placedChips.layers);
  }

  layers.push(...footerLayers);

  layers.push(...buildBadgeLayers({ ctx }));

  return {
    schema_version: 1,
    width: W,
    height: H,
    background: "#18181B",
    layers,
    source: {
      template_id: `${args.theme.post_type}_portrait_v1`,
      post_type: args.theme.post_type,
      variant: "v1",
      format: "portrait_4x5",
      seeded_at: new Date().toISOString(),
    },
  };
}
