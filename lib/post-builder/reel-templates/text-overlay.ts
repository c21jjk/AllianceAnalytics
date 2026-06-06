/**
 * Text-overlay presets + factory — the brand "looks" a user picks when adding
 * animated text to a Reel scene. Aligned to Larissa's gold-standard post rules
 * (see the larissa-design-rules memory):
 *   - Obsessed Grey #252526 / Relentless Gold #C9A84C, gold as ACCENT only.
 *   - Script eyebrow (Kaushan Script, the "Just Listed" signature) + clean
 *     sans body (Nunito).
 *   - Address is street + city only (a content rule the caption/overlay text
 *     should follow; not enforced here, surfaced as guidance in the editor).
 *
 * The SPEC (font/size/color/treatment) is shared data; the actual drawing is
 * implemented separately in the canvas preview (ReelPreview) and the worker
 * (Fabric) — both consume this spec so they stay in lockstep. The worker keeps
 * a mirror of these values (it can't import from the app package).
 */

import type {
  TextOverlay,
  TextOverlayPreset,
} from "@/lib/post-builder/types";

export const ALLIANCE_OBSESSED_GREY = "#252526";
export const ALLIANCE_GOLD = "#C9A84C";

/** Optional outline drawn around the glyphs (px at native 1080x1920). */
export interface OverlayOutline {
  color: string;
  width: number;
}
/** Optional rounded background pill behind the text. */
export interface OverlayBackground {
  color: string;
  padX: number;
  padY: number;
  radius: number;
}
/** Optional drop shadow for legibility on photos. */
export interface OverlayShadow {
  color: string;
  blur: number;
  offsetY: number;
}

export interface TextOverlayPresetSpec {
  /** Picker label. */
  label: string;
  /** Default font family (must be loaded in BOTH preview + worker). */
  fontFamily: string;
  /** Font weight. */
  weight: number;
  /** Default font size in px at native 1080x1920. */
  fontSize: number;
  /** Default text color (hex). */
  color: string;
  /** Treatments. */
  outline?: OverlayOutline;
  background?: OverlayBackground;
  shadow?: OverlayShadow;
  /** Default placeholder text when this preset is first added. */
  placeholder: string;
}

export const TEXT_OVERLAY_PRESETS: Readonly<
  Record<TextOverlayPreset, TextOverlayPresetSpec>
> = {
  headline: {
    label: "Script headline",
    fontFamily: "Kaushan Script",
    weight: 400,
    fontSize: 150,
    color: "#FFFFFF",
    shadow: { color: "rgba(0,0,0,0.45)", blur: 28, offsetY: 6 },
    placeholder: "Just Listed",
  },
  gold_bar: {
    label: "Gold pill",
    fontFamily: "Nunito",
    weight: 700,
    fontSize: 52,
    // Dark text on the Relentless Gold pill — gold as accent, per brand.
    color: ALLIANCE_OBSESSED_GREY,
    background: { color: ALLIANCE_GOLD, padX: 36, padY: 18, radius: 999 },
    placeholder: "OPEN SUN 1–3",
  },
  outline: {
    label: "Outline",
    fontFamily: "Nunito",
    weight: 800,
    fontSize: 64,
    color: "#FFFFFF",
    outline: { color: ALLIANCE_OBSESSED_GREY, width: 6 },
    placeholder: "305 Village Road",
  },
  subtle: {
    label: "Subtle",
    fontFamily: "Nunito",
    weight: 600,
    fontSize: 40,
    color: "#FFFFFF",
    shadow: { color: "rgba(0,0,0,0.5)", blur: 14, offsetY: 3 },
    placeholder: "3 Bed · 2 Bath · The Villas",
  },
};

export const TEXT_OVERLAY_PRESET_ORDER: readonly TextOverlayPreset[] = [
  "headline",
  "gold_bar",
  "outline",
  "subtle",
];

/**
 * Build a fresh overlay for a preset, centered, with a sensible entrance.
 * The default vertical position nudges per preset so a headline sits a bit
 * high and a subtle caption sits low (typical listing-reel layout).
 */
/**
 * Branded one-tap stickers/badges. Each builds a pre-styled text overlay, so
 * they reuse the overlay render path entirely (no separate sticker engine).
 * Text is editable after drop. Aligned to Larissa's looks: gold pills for
 * status badges, big outline for SOLD, script for soft announcements.
 */
export interface ReelSticker {
  id: string;
  label: string;
  build: () => TextOverlay;
}

export const REEL_STICKERS: readonly ReelSticker[] = [
  {
    id: "just_listed",
    label: "Just Listed",
    build: () => ({ ...createTextOverlay("headline"), text: "Just Listed", y: 0.22 }),
  },
  {
    id: "open_house",
    label: "Open House",
    build: () => ({ ...createTextOverlay("gold_bar"), text: "OPEN HOUSE", y: 0.14 }),
  },
  {
    id: "sold",
    label: "SOLD",
    build: () => ({
      ...createTextOverlay("outline"),
      text: "SOLD",
      fontSize: 230,
      y: 0.5,
      animation: "pop",
    }),
  },
  {
    id: "price",
    label: "Price",
    build: () => ({ ...createTextOverlay("gold_bar"), text: "$0", y: 0.85 }),
  },
  {
    id: "new_price",
    label: "New Price",
    build: () => ({ ...createTextOverlay("gold_bar"), text: "NEW PRICE", y: 0.14 }),
  },
  {
    id: "coming_soon",
    label: "Coming Soon",
    build: () => ({ ...createTextOverlay("headline"), text: "Coming Soon", y: 0.22 }),
  },
  {
    id: "open_sun",
    label: "Open Sun 1–3",
    build: () => ({ ...createTextOverlay("gold_bar"), text: "OPEN SUN 1–3", y: 0.14 }),
  },
  {
    id: "beds_baths",
    label: "Beds · Baths",
    build: () => ({
      ...createTextOverlay("subtle"),
      text: "3 Bed · 2 Bath",
      y: 0.9,
    }),
  },
];

export function createTextOverlay(
  preset: TextOverlayPreset = "headline",
): TextOverlay {
  const spec = TEXT_OVERLAY_PRESETS[preset];
  const y =
    preset === "headline" ? 0.28 : preset === "subtle" ? 0.8 : 0.5;
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ov_${Math.random().toString(36).slice(2)}`,
    text: spec.placeholder,
    x: 0.5,
    y,
    fontSize: spec.fontSize,
    fontFamily: spec.fontFamily,
    color: spec.color,
    preset,
    align: "center",
    maxWidthPct: 0.86,
    animation: "rise",
    animationMs: 450,
  };
}
