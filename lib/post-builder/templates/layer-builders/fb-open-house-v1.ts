/**
 * FB Open House · Hero Card v1 · Square 1080×1080 (LayerTree builder)
 *
 * Cream/white "lead" card for a Facebook Open House gallery. Centered
 * composition:
 *   - Day + date + time range banner at top
 *   - "Open House" headline (script + sans hybrid in source — we use Inter
 *     italic + Inter weight 600 here; editor can swap fonts)
 *   - Property photo (rounded, drop shadow)
 *   - Address centered below
 *   - "C21 Alliance" mark at bottom
 *   - Tiny MLS hashtag watermark in the bottom-right
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
  formatOpenHouse,
  type PostBuilderListingWithOH,
} from "../primitives/_shared";

export function buildFBOpenHouseV1(args: {
  listing: PostBuilderListingWithOH;
  heroImageUrls: string[];
}): LayerTree {
  const W = 1080;
  const H = 1080;

  const layers: Layer[] = [];

  // Background
  layers.push({
    id: "frame_bg",
    type: "rect",
    name: "Frame background",
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: "#FBF8F2",
  } satisfies RectLayer);

  // Date/time banner (centered top)
  const dateTimeBanner = formatOHDateTimeBanner(
    args.listing.oh_start_at,
    args.listing.oh_end_at,
  );
  layers.push({
    id: "datetime_banner",
    type: "text",
    name: "Date / time banner",
    x: 0,
    y: 70,
    w: W,
    h: 32,
    text: dateTimeBanner,
    font: "Inter",
    size: 20,
    weight: 600,
    color: "#525250",
    letter_spacing: 0.30,
    uppercase: true,
    align: "center",
  } satisfies TextLayer);

  // "Open House" headline — render as a centered single text since the editor
  // can later swap fonts per-element.
  layers.push({
    id: "title_open",
    type: "text",
    name: "Open (script)",
    x: 0,
    y: 70 + 32 + 12,
    w: W,
    h: 130,
    text: "Open House",
    font: "Inter",
    size: 92,
    weight: 700,
    color: "#18181B",
    letter_spacing: 0.02,
    uppercase: true,
    align: "center",
    line_height: 1.0,
  } satisfies TextLayer);

  // Photo (rounded with shadow approximated via the image radius)
  const PHOTO_W = 720;
  const PHOTO_H = 480;
  const photoX = (W - PHOTO_W) / 2;
  const photoY = 70 + 32 + 12 + 130 + 28;
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
    radius: 16,
  } satisfies ImageLayer);

  // Address (centered below photo)
  const addressLine = (args.listing.address ?? "").trim();
  const cityForCard = (args.listing.city ?? "").trim();
  const addressForCard = [addressLine, cityForCard]
    .filter((s) => s.length > 0)
    .join(", ")
    .toUpperCase();
  if (addressForCard) {
    layers.push({
      id: "address_centered",
      type: "text",
      name: "Address",
      x: 90,
      y: photoY + PHOTO_H + 40,
      w: W - 180,
      h: 32,
      text: addressForCard,
      font: "Inter",
      size: 22,
      weight: 600,
      color: "#525250",
      letter_spacing: 0.20,
      uppercase: true,
      align: "center",
    } satisfies TextLayer);
  }

  // Brand "C21 Alliance" — bottom centered
  // Compose as two text layers next to each other; estimate widths and center.
  const C21_FONT = 44;
  const ALLIANCE_FONT = 36;
  const C21_TEXT = "C21";
  const ALLIANCE_TEXT = "ALLIANCE";
  const c21W = Math.ceil(C21_TEXT.length * C21_FONT * 0.62);
  const allianceW = Math.ceil(ALLIANCE_TEXT.length * ALLIANCE_FONT * 0.62 * 1.20);
  const gap = 12;
  const totalW = c21W + gap + allianceW;
  const brandStartX = (W - totalW) / 2;
  const brandY = H - 110;
  layers.push({
    id: "brand_c21",
    type: "text",
    name: "C21 mark",
    x: brandStartX,
    y: brandY,
    w: c21W,
    h: 56,
    text: C21_TEXT,
    font: "Inter",
    size: C21_FONT,
    weight: 800,
    color: "#C9A961",
    letter_spacing: -0.01,
    align: "left",
    vertical_align: "bottom",
  } satisfies TextLayer);
  layers.push({
    id: "brand_alliance",
    type: "text",
    name: "Alliance wordmark",
    x: brandStartX + c21W + gap,
    y: brandY,
    w: allianceW,
    h: 56,
    text: ALLIANCE_TEXT,
    font: "Inter",
    size: ALLIANCE_FONT,
    weight: 700,
    color: "#18181B",
    letter_spacing: 0.20,
    uppercase: true,
    align: "left",
    vertical_align: "bottom",
  } satisfies TextLayer);

  // MLS watermark
  const mlsHashtag = canonicalMlsHashtag(args.listing.mls_number, args.listing.source_mls);
  layers.push({
    id: "mls_watermark",
    type: "text",
    name: "MLS watermark",
    x: W - 240 - 24,
    y: H - 32,
    w: 240,
    h: 16,
    text: mlsHashtag,
    font: "Inter",
    size: 10,
    weight: 600,
    color: "#A3A3A0",
    letter_spacing: 0.14,
    uppercase: true,
    align: "right",
    opacity: 0.6,
  } as TextLayer);

  return {
    schema_version: 1,
    width: W,
    height: H,
    background: "#FBF8F2",
    layers,
    source: {
      template_id: "fb_open_house_v1",
      post_type: "open_house",
      variant: "v1",
      format: "square_1x1",
      seeded_at: new Date().toISOString(),
    },
  };
}

/**
 * "SATURDAY MAY 16TH 2-5PM" — copied from the source primitive verbatim
 * so the layer-tree output matches the HTML output's banner string.
 */
function formatOHDateTimeBanner(
  start_at: string | null | undefined,
  end_at: string | null | undefined,
): string {
  if (!start_at) return "OPEN HOUSE";
  try {
    const start = new Date(start_at);
    if (Number.isNaN(start.getTime())) return "OPEN HOUSE";

    const tz = "America/New_York";
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: tz,
    })
      .format(start)
      .toUpperCase();
    const month = new Intl.DateTimeFormat("en-US", {
      month: "long",
      timeZone: tz,
    })
      .format(start)
      .toUpperCase();
    const day = parseInt(
      new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: tz }).format(start),
      10,
    );
    const dayWithOrdinal = `${day}${ordinalSuffix(day)}`;

    const startTime = formatHour(start, tz);
    const end = end_at ? new Date(end_at) : null;
    const endTime = end && !Number.isNaN(end.getTime()) ? formatHour(end, tz) : null;

    const timeRange = endTime
      ? `${startTime.replace(/(AM|PM)$/i, "")}-${endTime}`
      : startTime;

    return `${weekday} ${month} ${dayWithOrdinal} ${timeRange}`;
  } catch {
    return formatOpenHouse(start_at, end_at) ?? "OPEN HOUSE";
  }
}

function ordinalSuffix(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "TH";
  switch (n % 10) {
    case 1:
      return "ST";
    case 2:
      return "ND";
    case 3:
      return "RD";
    default:
      return "TH";
  }
}

function formatHour(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: d.getUTCMinutes() === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone: tz,
  });
  return fmt.format(d).replace(/\s/g, "").toUpperCase();
}
