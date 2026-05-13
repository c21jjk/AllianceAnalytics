/**
 * FB New Listing · Hero Card v1 · Square 1080×1080 (LayerTree builder)
 *
 * Cream/white "lead" card for a Facebook multi-photo post. Layout:
 *   - "New Listing" heavy display text top-left
 *   - Address subtitle in uppercase sans below
 *   - "C21 Alliance" black badge top-right
 *   - Property photo center (~952×632, rounded corners)
 *   - Dark bottom strip: BD | BA | CUSTOM_FEATURE
 *   - Tiny MLS hashtag watermark bottom-right
 *
 * Note: source primitive uses Playfair Display + Inter. Per the layer-tree
 * Inter-default policy, we render the title in Inter at weight 800 — the
 * editor can swap to a serif later.
 */

import type {
  ImageLayer,
  Layer,
  LayerTree,
  RectLayer,
  TextLayer,
} from "../../layers/types";
import {
  canonicalMlsHashtag,
  type PostBuilderListingWithOH,
} from "../primitives/_shared";

export function buildFBNewListingV1(args: {
  listing: PostBuilderListingWithOH;
  heroImageUrls: string[];
  customFeature?: string | null;
}): LayerTree {
  const W = 1080;
  const H = 1080;
  const PAD_X = 64;
  const PAD_TOP = 64;

  const layers: Layer[] = [];

  // Background (cream)
  layers.push({
    id: "frame_bg",
    type: "rect",
    name: "Frame background",
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: "#F8F4ED",
  } satisfies RectLayer);

  // Title "New Listing" — heavy Inter as a stand-in for Playfair
  layers.push({
    id: "title_main",
    type: "text",
    name: "New Listing title",
    x: PAD_X,
    y: PAD_TOP,
    w: W - PAD_X * 2 - 220, // leave room for badge
    h: 96,
    text: "New Listing",
    font: "Inter",
    size: 96,
    weight: 800,
    color: "#18181B",
    line_height: 1.0,
    letter_spacing: -0.02,
  } satisfies TextLayer);

  // Address subtitle below title
  const addressLine1 = (args.listing.address ?? "").trim();
  const cityState = [args.listing.city, args.listing.state].filter(Boolean).join(", ").trim();
  const cityStateZip = args.listing.zip ? `${cityState} ${args.listing.zip}` : cityState;
  const subText = cityStateZip
    ? `${addressLine1} · ${cityStateZip}`
    : addressLine1;
  if (subText) {
    layers.push({
      id: "address_sub",
      type: "text",
      name: "Address subtitle",
      x: PAD_X,
      y: PAD_TOP + 96 + 18,
      w: W - PAD_X * 2 - 220,
      h: 30,
      text: subText,
      font: "Inter",
      size: 22,
      weight: 600,
      color: "#525250",
      letter_spacing: 0.16,
      uppercase: true,
    } satisfies TextLayer);
  }

  // Brand badge (top-right, dark)
  const BADGE_W = 200;
  const BADGE_H = 44;
  const badgeX = W - PAD_X - BADGE_W;
  const badgeY = PAD_TOP + 14;
  layers.push({
    id: "brand_badge_bg",
    type: "rect",
    name: "C21 Alliance badge",
    x: badgeX,
    y: badgeY,
    w: BADGE_W,
    h: BADGE_H,
    fill: "#18181B",
    radius: 4,
  } satisfies RectLayer);
  // C21 (gold)
  layers.push({
    id: "brand_badge_c21",
    type: "text",
    name: "C21 mark",
    x: badgeX,
    y: badgeY,
    w: 60,
    h: BADGE_H,
    text: "C21",
    font: "Inter",
    size: 18,
    weight: 700,
    color: "#C9A961",
    letter_spacing: 0.06,
    align: "center",
    vertical_align: "middle",
  } satisfies TextLayer);
  // Alliance (white)
  layers.push({
    id: "brand_badge_alliance",
    type: "text",
    name: "Alliance wordmark",
    x: badgeX + 60,
    y: badgeY,
    w: BADGE_W - 60 - 12,
    h: BADGE_H,
    text: "Alliance",
    font: "Inter",
    size: 14,
    weight: 700,
    color: "#FCFCFB",
    letter_spacing: 0.20,
    uppercase: true,
    align: "left",
    vertical_align: "middle",
  } satisfies TextLayer);

  // Photo (rounded)
  const PHOTO_W = 952;
  const PHOTO_H = 632;
  const photoY = PAD_TOP + 96 + 18 + 30 + 36;
  const photoX = (W - PHOTO_W) / 2;
  layers.push({
    id: "hero_image",
    type: "image",
    name: "Hero photo",
    x: photoX,
    y: photoY,
    w: PHOTO_W,
    h: PHOTO_H,
    src: args.heroImageUrls[0] ?? "",
    fit: "cover",
    radius: 18,
  } satisfies ImageLayer);

  // Stats strip — dark bar across the bottom
  const STRIP_H = 100;
  const stripY = H - STRIP_H;
  layers.push({
    id: "stats_strip_bg",
    type: "rect",
    name: "Stats strip background",
    x: 0,
    y: stripY,
    w: W,
    h: STRIP_H,
    fill: "#18181B",
  } satisfies RectLayer);

  const bdLabel =
    typeof args.listing.bedrooms === "number" && args.listing.bedrooms > 0
      ? `${args.listing.bedrooms} BEDROOM`
      : null;
  const totalBaths =
    (args.listing.bathrooms_full ?? 0) + (args.listing.bathrooms_half ?? 0) * 0.5;
  const baLabel =
    totalBaths > 0
      ? totalBaths % 1 === 0
        ? `${totalBaths.toFixed(0)} BATHROOM`
        : `${totalBaths.toFixed(1)} BATHROOM`
      : null;
  const propTypeLabel = args.listing.property_type
    ? args.listing.property_type.toUpperCase().replace(/_/g, " ")
    : null;
  const featureLabel = args.customFeature?.trim().toUpperCase() || propTypeLabel || "";

  const statItems = [bdLabel, baLabel, featureLabel].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  if (statItems.length > 0) {
    const cellW = (W - PAD_X * 2) / statItems.length;
    for (let i = 0; i < statItems.length; i++) {
      const cellX = PAD_X + cellW * i;
      // Stat text (centered in cell)
      layers.push({
        id: `stat_${i}`,
        type: "text",
        name: `Stat — ${statItems[i]}`,
        x: cellX,
        y: stripY,
        w: cellW,
        h: STRIP_H,
        text: statItems[i],
        font: "Inter",
        size: 24,
        weight: 700,
        color: "#FCFCFB",
        letter_spacing: 0.18,
        uppercase: true,
        align: "center",
        vertical_align: "middle",
      } satisfies TextLayer);
      // Vertical separator on the left edge of every cell except first
      if (i > 0) {
        layers.push({
          id: `stat_sep_${i}`,
          type: "rect",
          name: "Stat separator",
          x: cellX,
          y: stripY + (STRIP_H - 36) / 2,
          w: 1,
          h: 36,
          fill: "rgba(252,252,251,0.30)",
        } satisfies RectLayer);
      }
    }
  }

  // MLS watermark (above strip, right edge)
  const mlsHashtag = canonicalMlsHashtag(args.listing.mls_number, args.listing.source_mls);
  layers.push({
    id: "mls_watermark",
    type: "text",
    name: "MLS watermark",
    x: W - 240 - 28,
    y: H - STRIP_H - 22,
    w: 240,
    h: 18,
    text: mlsHashtag,
    font: "Inter",
    size: 11,
    weight: 600,
    color: "#A3A3A0",
    letter_spacing: 0.14,
    uppercase: true,
    align: "right",
    opacity: 0.7,
  } as TextLayer);

  return {
    schema_version: 1,
    width: W,
    height: H,
    background: "#F8F4ED",
    layers,
    source: {
      template_id: "fb_new_listing_v1",
      post_type: undefined,
      variant: "v1",
      format: "square_1x1",
      seeded_at: new Date().toISOString(),
    },
  };
}
