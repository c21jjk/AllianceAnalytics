/**
 * v3 · Side-by-Side · Square 1080×1080 (LayerTree builder)
 *
 * Asymmetric 55/45 split. Photo left (594px), data column right (486px) on a
 * light cream surface. Vertical gold accent rule on the photo/data divider.
 * Stats render as bordered "label / value" rows (a magazine-table feel).
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

const PHOTO_W = 594;
const DATA_W = 486;

export function buildV3SideBySideSquare(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1080;
  const dataLeft = PHOTO_W + 4 + 48; // photo + gold rule + left padding (48)
  const dataPadRight = 56;
  const dataWidth = W - dataLeft - dataPadRight;

  const ctx: BuilderContext = {
    listing: args.listing,
    theme: args.theme,
    canvasWidth: W,
    canvasHeight: H,
    heroImageUrls: args.heroImageUrls,
    inset: 56,
  };

  const layers: Layer[] = [];

  // 1. Photo (left column)
  layers.push(
    buildHeroImage({
      src: args.heroImageUrls[0] ?? "",
      width: PHOTO_W,
      height: H,
    }),
  );
  // Light tint at top + bottom of photo
  layers.push({
    id: "photo_tint",
    type: "gradient",
    name: "Photo tint",
    x: 0,
    y: 0,
    w: PHOTO_W,
    h: H,
    variant: "linear",
    angle: 0,
    stops: [
      { offset: 0, color: "#18181B", opacity: 0.35 },
      { offset: 0.22, color: "#18181B", opacity: 0 },
      { offset: 0.8, color: "#18181B", opacity: 0 },
      { offset: 1, color: "#18181B", opacity: 0.25 },
    ],
  } satisfies GradientLayer);

  // 2. Data column background (light) — covers full data area
  layers.push({
    id: "data_col_bg",
    type: "rect",
    name: "Data column background",
    x: PHOTO_W,
    y: 0,
    w: W - PHOTO_W,
    h: H,
    fill: "#FCFCFB",
  } satisfies RectLayer);

  // 3. Vertical gold accent rule between photo and data
  layers.push({
    id: "vertical_accent",
    type: "rect",
    name: "Vertical accent rule",
    x: PHOTO_W,
    y: 0,
    w: 4,
    h: H,
    fill: args.theme.accent,
  } satisfies RectLayer);

  // 4. Photo eyebrow (top-left of photo, white-on-photo)
  // We don't use buildEyebrowLayers here because eyebrow text uses different
  // sizing/colors and a smaller rule.
  layers.push({
    id: "photo_eyebrow_rule",
    type: "gradient",
    name: "Photo eyebrow accent",
    x: 48,
    y: 56 + Math.round(20 / 2) - 1,
    w: 50,
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
    x: 48 + 50 + 16,
    y: 56,
    w: PHOTO_W - 48 - 50 - 16 - 24,
    h: Math.ceil(20 * 1.4),
    text: args.theme.eyebrow,
    font: "Inter",
    size: 20,
    weight: 700,
    color: "#FBF7EE",
    letter_spacing: 0.30,
    uppercase: true,
    text_shadow: "0 2px 8px rgba(0,0,0,0.4)",
  } satisfies TextLayer);

  // 5. Data column content — top-down
  let cursorY = 84; // padding-top: 84

  // Optional OH strip
  const ohPlaceholder = buildOpenHouseStripLayers({
    ctx,
    x: dataLeft,
    y: 0,
    font_size: 19,
  });
  if (ohPlaceholder.length > 0) {
    const ohHeight = ohPlaceholder[0].h;
    layers.push(
      ...buildOpenHouseStripLayers({
        ctx,
        x: dataLeft,
        y: cursorY,
        font_size: 19,
      }),
    );
    cursorY += ohHeight + 18;
  }

  // Data eyebrow — small uppercase gold-dark
  layers.push({
    id: "data_eyebrow",
    type: "text",
    name: "Data column eyebrow",
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
  cursorY += Math.ceil(14 * 1.4) + 16;

  // Address (dark on light)
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
      color: "#18181B",
      line_height: 1.05,
      letter_spacing: -0.02,
    } satisfies TextLayer);
    cursorY += Math.ceil(ADDRESS_FONT * 1.05) + 8;
  }

  // City / state (muted)
  const CITYSTATE_FONT = 18;
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
      letter_spacing: 0.10,
      uppercase: true,
    } satisfies TextLayer);
    cursorY += Math.ceil(CITYSTATE_FONT * 1.4) + 30;
  }

  // Gold rule (horizontal — short)
  layers.push({
    id: "gold_rule",
    type: "gradient",
    name: "Gold rule",
    x: dataLeft,
    y: cursorY,
    w: 64,
    h: 3,
    variant: "linear",
    angle: 90,
    stops: [
      { offset: 0, color: args.theme.accent },
      { offset: 1, color: args.theme.accent_dark },
    ],
    radius: 2,
  } satisfies GradientLayer);
  cursorY += 3 + 30;

  // Price (uses theme.accent_dark on light surface)
  const PRICE_FONT = args.theme.price_mode === "label" ? 36 : 56;
  const price = buildPriceLayer({
    ctx,
    x: dataLeft,
    y: cursorY,
    width: dataWidth,
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
    cursorY += Math.ceil(PRICE_FONT * 1.0) + 26;
  }

  // Stat rows — each chip becomes "LABEL  |  VALUE" with bottom border
  const chips = buildChips(args.listing);
  if (chips.length > 0) {
    const STAT_LABEL_FONT = 12;
    const STAT_VALUE_FONT = 22;
    const ROW_GAP = 14;
    const ROW_PAD_BOTTOM = 12;
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      const [value, ...labelParts] = chip.split(/\s+/);
      const label = labelParts.join(" ") || chip;

      const rowH = Math.max(
        Math.ceil(STAT_LABEL_FONT * 1.4),
        Math.ceil(STAT_VALUE_FONT * 1.2),
      );
      // Label (left)
      layers.push({
        id: `stat_label_${i}`,
        type: "text",
        name: `Stat label — ${label}`,
        x: dataLeft,
        y: cursorY,
        w: Math.floor(dataWidth * 0.6),
        h: rowH,
        text: label,
        font: "Inter",
        size: STAT_LABEL_FONT,
        weight: 700,
        color: "#737370",
        letter_spacing: 0.20,
        uppercase: true,
        vertical_align: "middle",
      } satisfies TextLayer);
      // Value (right)
      layers.push({
        id: `stat_value_${i}`,
        type: "text",
        name: `Stat value — ${value}`,
        x: dataLeft,
        y: cursorY,
        w: dataWidth,
        h: rowH,
        text: value,
        font: "Inter",
        size: STAT_VALUE_FONT,
        weight: 700,
        color: "#18181B",
        letter_spacing: -0.01,
        align: "right",
        vertical_align: "middle",
      } satisfies TextLayer);
      cursorY += rowH + ROW_PAD_BOTTOM;

      // Divider (1px) — except after last row
      if (i < chips.length - 1) {
        layers.push({
          id: `stat_divider_${i}`,
          type: "rect",
          name: "Stat row divider",
          x: dataLeft,
          y: cursorY,
          w: dataWidth,
          h: 1,
          fill: "#E5E5E2",
        } satisfies RectLayer);
        cursorY += 1 + ROW_GAP;
      }
    }
  }

  // Footer pinned to bottom of data column
  const footerY = H - 56 - FOOTER_HEIGHT;
  const footerLayers = buildFooterLayers({
    ctx,
    x: dataLeft,
    y: footerY,
    width: dataWidth,
    text_color: "#18181B",
    border_color: "#E5E5E2",
  });
  // Override mls hashtag color since shared helper preserves dark variant.
  for (const layer of footerLayers) {
    if (layer.id === "footer_mls_tag" && layer.type === "text") {
      (layer as TextLayer).color = "#737370";
    }
  }
  layers.push(...footerLayers);

  // Badge — overrides default top-right anchor: stamp lands on left photo edge.
  // We let the shared buildBadgeLayers compute, then translate left.
  const badge = buildBadgeLayers({ ctx });
  for (const b of badge) {
    if (b.id === "badge_stamp_bg" || b.id === "badge_stamp_text") {
      // Move stamp into the photo column (right ~540 from canvas right)
      b.x = b.x - 540 + 56; // canvas right - 540 (= photo column right area)
      b.y = 90;
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
      template_id: `${args.theme.post_type}_square_v3`,
      post_type: args.theme.post_type,
      variant: "v3",
      format: "square_1x1",
      seeded_at: new Date().toISOString(),
    },
  };
}
