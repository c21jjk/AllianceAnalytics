/**
 * v5 · Three-Photo Grid · Story 9:16 · 1080×1920 (LayerTree builder)
 *
 * Hero 700×1200 left, two stacked thumbnails 376×~598 right (5px gold gap).
 * Light data block fills the bottom region, ending above the bottom safe
 * zone.
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

function ensurePhotos(urls: string[], wanted: number): string[] {
  const source = urls.length > 0 ? urls : [""];
  const out: string[] = [];
  for (let i = 0; i < wanted; i++) {
    out.push(source[Math.min(i, source.length - 1)]);
  }
  return out;
}

export function buildV5ThreePhotoGridStory(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1920;
  const photoHeight = 1200;
  const heroW = 700;
  const seam = 5;
  const thumbW = W - heroW - seam;
  const thumbH = (photoHeight - seam) / 2;
  const dataPadBottom = STORY_SAFE_ZONE.bottom + 30;

  const photos = ensurePhotos(args.heroImageUrls, 3);

  const ctx: BuilderContext = {
    listing: args.listing,
    theme: args.theme,
    canvasWidth: W,
    canvasHeight: H,
    heroImageUrls: args.heroImageUrls,
    inset: 72,
  };

  const layers: Layer[] = [];

  layers.push({
    id: "photo_seam_bg",
    type: "rect",
    name: "Photo seam (gold)",
    x: 0,
    y: 0,
    w: W,
    h: photoHeight,
    fill: args.theme.accent,
  } satisfies RectLayer);

  layers.push(
    buildHeroImage({
      src: photos[0],
      width: heroW,
      height: photoHeight,
      id: "photo_hero",
    }),
  );
  layers.push({
    id: "photo_thumb_1",
    type: "image",
    name: "Thumbnail 1",
    x: heroW + seam,
    y: 0,
    w: thumbW,
    h: thumbH,
    src: photos[1],
    fit: "cover",
  });
  layers.push({
    id: "photo_thumb_2",
    type: "image",
    name: "Thumbnail 2",
    x: heroW + seam,
    y: thumbH + seam,
    w: thumbW,
    h: thumbH,
    src: photos[2],
    fit: "cover",
  });

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
      { offset: 0, color: "#18181B", opacity: 0.50 },
      { offset: 0.16, color: "#18181B", opacity: 0.10 },
      { offset: 0.36, color: "#18181B", opacity: 0 },
      { offset: 1, color: "#18181B", opacity: 0 },
    ],
  } satisfies GradientLayer);

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
  });
  layers.push({
    id: "photo_eyebrow_text",
    type: "text",
    name: "Photo eyebrow",
    x: 72 + 72 + 22,
    y: STORY_SAFE_ZONE.top + 40,
    w: heroW - 72 - 72 - 22 - 24,
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

  layers.push({
    id: "data_row_bg",
    type: "rect",
    name: "Data row background",
    x: 0,
    y: photoHeight,
    w: W,
    h: H - photoHeight,
    fill: "#FCFCFB",
  } satisfies RectLayer);
  layers.push({
    id: "data_row_top_border",
    type: "rect",
    name: "Data row top border",
    x: 0,
    y: photoHeight,
    w: W,
    h: 6,
    fill: args.theme.accent,
  } satisfies RectLayer);

  const dataLeft = 72;
  const dataWidth = W - dataLeft * 2;
  let cursorY = photoHeight + 6 + 60;

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
    cursorY += ohHeight + 16;
  }

  const addressBlockW = Math.floor(dataWidth * 0.55);
  const ADDRESS_FONT = 56;
  const addressText = (args.listing.address ?? "").trim();
  const addressBlockY = cursorY;
  if (addressText) {
    layers.push({
      id: "address",
      type: "text",
      name: "Address",
      x: dataLeft,
      y: addressBlockY,
      w: addressBlockW,
      h: Math.ceil(ADDRESS_FONT * 1.04 * 2),
      text: addressText,
      font: "Inter",
      size: ADDRESS_FONT,
      weight: 700,
      color: "#18181B",
      line_height: 1.04,
      letter_spacing: -0.02,
    } satisfies TextLayer);
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
      y: addressBlockY + Math.ceil(ADDRESS_FONT * 1.04) + 10,
      w: addressBlockW,
      h: Math.ceil(CITYSTATE_FONT * 1.4),
      text: cityState,
      font: "Inter",
      size: CITYSTATE_FONT,
      weight: 500,
      color: "#525250",
      letter_spacing: 0.10,
      uppercase: true,
    } satisfies TextLayer);
  }

  const priceBlockW = dataWidth - addressBlockW - 32;
  const priceBlockX = dataLeft + addressBlockW + 32;
  layers.push({
    id: "price_label",
    type: "text",
    name: "Price label (eyebrow)",
    x: priceBlockX,
    y: addressBlockY,
    w: priceBlockW,
    h: Math.ceil(14 * 1.4),
    text: args.theme.eyebrow,
    font: "Inter",
    size: 14,
    weight: 700,
    color: args.theme.accent_dark,
    letter_spacing: 0.30,
    uppercase: true,
    align: "right",
  } satisfies TextLayer);

  const PRICE_FONT = args.theme.price_mode === "label" ? 42 : 64;
  const priceY = addressBlockY + Math.ceil(14 * 1.4) + 8;
  const price = buildPriceLayer({
    ctx,
    x: priceBlockX,
    y: priceY,
    width: priceBlockW,
    font_size: PRICE_FONT,
  });
  if (price) {
    const p = price as TextLayer;
    p.color = args.theme.accent_dark;
    p.weight = 900;
    p.line_height = 1;
    p.align = "right";
    p.letter_spacing = args.theme.price_mode === "label" ? 0.04 : -0.03;
    p.text_shadow = undefined;
    layers.push(p);
  }

  const chips = buildChips(args.listing);
  if (chips.length > 0) {
    const statsY = priceY + Math.ceil(PRICE_FONT * 1.0) + 14;
    const STAT_FONT = 20;
    const statsText = chips.join("    ");
    layers.push({
      id: "stats_inline",
      type: "text",
      name: "Stats inline",
      x: priceBlockX,
      y: statsY,
      w: priceBlockW,
      h: Math.ceil(STAT_FONT * 1.4),
      text: statsText,
      font: "Inter",
      size: STAT_FONT,
      weight: 600,
      color: "#525250",
      letter_spacing: 0.12,
      uppercase: true,
      align: "right",
    } satisfies TextLayer);
  }

  const footerY = H - dataPadBottom - FOOTER_HEIGHT;
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

  const badge = buildBadgeLayers({ ctx });
  for (const b of badge) {
    if (b.id === "badge_stamp_bg" || b.id === "badge_stamp_text") {
      b.x = b.x - (410 - 56);
      b.y = 480;
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
      template_id: `${args.theme.post_type}_story_v5`,
      post_type: args.theme.post_type,
      variant: "v5",
      format: "story_9x16",
      seeded_at: new Date().toISOString(),
    },
  };
}
