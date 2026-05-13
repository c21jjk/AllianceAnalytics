/**
 * v4 · Two-Photo Diptych · Portrait 4:5 · 1080×1350 (LayerTree builder)
 *
 * Photos 537×900 with 5px gold seam between them. Light data block 1080×450
 * below with 5px top accent border.
 */

import type { Layer, LayerTree, RectLayer, TextLayer } from "../../layers/types";
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

function ensurePhotos(urls: string[], wanted: number): string[] {
  const source = urls.length > 0 ? urls : [""];
  const out: string[] = [];
  for (let i = 0; i < wanted; i++) {
    out.push(source[Math.min(i, source.length - 1)]);
  }
  return out;
}

export function buildV4TwoPhotoDiptychPortrait(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1350;
  const photoHeight = 900;
  const seam = 5;
  const photoCellW = (W - seam) / 2;

  const photos = ensurePhotos(args.heroImageUrls, 2);

  const ctx: BuilderContext = {
    listing: args.listing,
    theme: args.theme,
    canvasWidth: W,
    canvasHeight: H,
    heroImageUrls: args.heroImageUrls,
    inset: 60,
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
      width: photoCellW,
      height: photoHeight,
      id: "photo_left",
    }),
  );
  layers.push({
    id: "photo_right",
    type: "image",
    name: "Right photo",
    x: photoCellW + seam,
    y: 0,
    w: photoCellW,
    h: photoHeight,
    src: photos[1],
    fit: "cover",
  });

  layers.push({
    id: "photo_eyebrow_rule",
    type: "gradient",
    name: "Photo eyebrow accent",
    x: 56,
    y: 56 + Math.round(24 / 2) - 1,
    w: 56,
    h: 3,
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
    x: 56 + 56 + 18,
    y: 56,
    w: photoCellW - 56 - 56 - 18 - 24,
    h: Math.ceil(24 * 1.4),
    text: args.theme.eyebrow,
    font: "Inter",
    size: 24,
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
    h: 5,
    fill: args.theme.accent,
  } satisfies RectLayer);

  const dataLeft = 60;
  const dataWidth = W - dataLeft * 2;
  let cursorY = photoHeight + 5 + 52;

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
    cursorY += ohHeight + 14;
  }

  const addressBlockW = Math.floor(dataWidth * 0.55);
  const ADDRESS_FONT = 48;
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
      y: addressBlockY + Math.ceil(ADDRESS_FONT * 1.04) + 8,
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
    h: Math.ceil(12 * 1.4),
    text: args.theme.eyebrow,
    font: "Inter",
    size: 12,
    weight: 700,
    color: args.theme.accent_dark,
    letter_spacing: 0.30,
    uppercase: true,
    align: "right",
  } satisfies TextLayer);

  const PRICE_FONT = args.theme.price_mode === "label" ? 36 : 54;
  const priceY = addressBlockY + Math.ceil(12 * 1.4) + 6;
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
    const statsY = priceY + Math.ceil(PRICE_FONT * 1.0) + 12;
    const STAT_FONT = 18;
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

  const footerY = H - 52 - FOOTER_HEIGHT;
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
      b.x = b.x - 524;
      b.y = 110;
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
      template_id: `${args.theme.post_type}_portrait_v4`,
      post_type: args.theme.post_type,
      variant: "v4",
      format: "portrait_4x5",
      seeded_at: new Date().toISOString(),
    },
  };
}
