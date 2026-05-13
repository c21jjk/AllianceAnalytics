/**
 * v1 · Hero Editorial · Story 9:16 · 1080×1920 (LayerTree builder)
 *
 * Hero photo full-bleed; eyebrow drops below the top story safe zone, content
 * stack stops above the bottom safe zone. Type sizes scale way up because IG
 * stories are viewed full-screen on phones.
 */

import type { Layer, LayerTree } from "../../layers/types";
import type { PostBuilderListingWithOH, PostTypeTheme } from "../primitives/_shared";
import { STORY_SAFE_ZONE } from "../primitives/_shared";
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

export function buildV1HeroEditorialStory(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1920;
  const inset = 72;

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

  // 2. Eyebrow — sits below top safe zone, with bigger rule + larger text
  layers.push(
    ...buildEyebrowLayers({
      ctx,
      x: inset,
      y: STORY_SAFE_ZONE.top + 40,
      rule_width: 72,
      font_size: 32,
    }),
  );

  // 3. Bottom-anchored content stack — sits above bottom safe zone
  const contentLeft = inset;
  const contentWidth = W - inset * 2;
  const contentBottomY = H - STORY_SAFE_ZONE.bottom - 40;

  const ADDRESS_FONT = 78;
  const CITYSTATE_FONT = 32;
  const PRICE_FONT = args.theme.price_mode === "label" ? 56 : 96;

  const addressHeight = Math.ceil(ADDRESS_FONT * 1.04 * 2);
  const citystateHeight = Math.ceil(CITYSTATE_FONT * 1.4);
  const priceHeight = Math.ceil(PRICE_FONT * 1.2);

  const GAP_PRICE_TO_CHIPS = 32;
  const GAP_CITYSTATE_TO_PRICE = 38;
  const GAP_ADDRESS_TO_CITYSTATE = 12;
  const GAP_GOLDRULE_TO_ADDRESS = 30;
  const GAP_OH_TO_GOLDRULE = 26;
  const GAP_FOOTER_TOP = 42;

  const footerY = contentBottomY - FOOTER_HEIGHT;
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
  const goldRuleH = 5;
  const goldRuleY = addressY - GAP_GOLDRULE_TO_ADDRESS - goldRuleH;

  const ohPlaceholder = buildOpenHouseStripLayers({
    ctx,
    x: contentLeft,
    y: 0,
    font_size: 28,
  });
  if (ohPlaceholder.length > 0) {
    const ohHeight = ohPlaceholder[0].h;
    const ohY = goldRuleY - GAP_OH_TO_GOLDRULE - ohHeight;
    const placedOH = buildOpenHouseStripLayers({
      ctx,
      x: contentLeft,
      y: ohY,
      font_size: 28,
    });
    layers.push(...placedOH);
  }

  layers.push(
    buildGoldRuleLayer({ ctx, x: contentLeft, y: goldRuleY, width: 84 }),
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
      template_id: `${args.theme.post_type}_story_v1`,
      post_type: args.theme.post_type,
      variant: "v1",
      format: "story_9x16",
      seeded_at: new Date().toISOString(),
    },
  };
}
