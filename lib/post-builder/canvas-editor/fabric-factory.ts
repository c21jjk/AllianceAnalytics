"use client";

/**
 * Shared Fabric factory module.
 *
 * Single source of truth for converting a `CanvasTemplateSchema` layer into
 * a Fabric.js object. Both consumers — the interactive `CanvasEditor` and
 * the headless `renderSchemaHeadless` render pipeline — import every
 * helper they need from here. That means a visual change applied to a
 * factory automatically affects the editor preview AND the published PNG
 * (no drift).
 *
 * What lives here:
 *   • Bound-field resolvers (`resolveTextBoundField`, `resolveImageBoundField`)
 *     that turn an MLSListingPayload into the formatted string/URL a layer
 *     should display.
 *   • Layer-data metadata helpers (`getLayerData`, `setLayerData`,
 *     `FabricLayerData`) — stamp schema layer ids onto Fabric objects so
 *     the layer panel + serialization can correlate them.
 *   • Factory functions per layer kind (`createFabricTextbox`,
 *     `createFabricImage`, `createFabricShape`) that produce ready-to-add
 *     Fabric objects from a schema layer.
 *   • Format helpers (`formatPriceUSD`, `formatBedsBaths`,
 *     `formatOpenHouseDate`, `formatOpenHouseTimeRange`,
 *     `STATUS_LABEL_MAP`) used inside the resolvers.
 *   • Gradient resolver (`fabricGradientFromFill`) shared by shape +
 *     future image-mask layers.
 *
 * Convention: factories return objects with the editor's interaction
 * defaults baked in — `selectable: !layer.locked`, `evented: !layer.locked`,
 * `editable: layer.editable && !layer.locked` on text. The headless
 * render canvas has `selection: false` at the canvas level so those
 * per-object flags never produce interactive behavior in the screenshot
 * path; no overrides needed downstream.
 *
 * Phase 2D (2026-05-22): extracted from CanvasEditor.tsx + the now-
 * deleted duplicates in headless-render.ts. See docs/adr/0001-template-
 * builder.md for the broader Template Builder design.
 */

import {
  type Canvas,
  Circle,
  Ellipse,
  FabricImage,
  type FabricObject,
  Gradient,
  Line,
  Rect,
  Textbox,
} from "fabric";

import {
  type BoundField,
  type CanvasLayer,
  type GradientFill,
  type ImageBoundField,
  type ImageLayer,
  isGradientFill,
  type MLSListingPayload,
  type ShapeLayer,
  type TextBoundField,
  type TextLayer,
} from "./types";
import { textEffectToFabricProps } from "./textEffects";
import {
  C21_ALLIANCE_WHITE_LOGO,
  EXCELLENCE_COLLECTION_LOGO,
} from "./templates/brand-logos";
import { EXCELLENCE_PRICE_THRESHOLD } from "../excellence-collection";
import { formatPhone } from "@/lib/data/phone-format";
import {
  CANVA_VIOLET,
  createCanvaStyleControls,
} from "./canva-style-controls";

// ===========================================================================
// SECTION 1 — Bound-field formatters
// ===========================================================================
//
// These pure functions take a TextBoundField + MLSListingPayload and return
// the formatted display string. They're file-private (not exported) because
// they're an implementation detail of `resolveTextBoundField` below.
//
// Why split per-field rather than one big switch with formatting inline:
//   • Easier to unit-test each formatter in isolation (Phase 2 will add a
//     /lib/post-builder/canvas-editor/__tests__/ folder).
//   • Some formatters need locale-awareness (currency, dates) and benefit
//     from being named.
//
// All formatters return strings. When the underlying data is null/empty, they
// return an empty string — the caller then falls back to TextLayer.text.
// ---------------------------------------------------------------------------

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatPriceUSD(value: number | null | undefined): string {
  // why: null guard before formatter — Intl will produce "$NaN" on null.
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return USD_FORMATTER.format(value);
}

export function formatBedsBaths(
  beds: number | null,
  bathsFull: number | null,
  bathsHalf: number | null,
): string {
  // why: half-baths count as 0.5. "3 BR / 2.5 BA" is the C21 Alliance standard.
  // If either side is null, show only the populated side rather than "? BR / ? BA".
  const totalBaths =
    (bathsFull ?? 0) + (bathsHalf !== null ? bathsHalf * 0.5 : 0);
  const bedsPart = beds !== null && beds > 0 ? `${beds} BR` : "";
  const bathsPart = totalBaths > 0 ? `${totalBaths} BA` : "";
  if (bedsPart && bathsPart) return `${bedsPart} / ${bathsPart}`;
  return bedsPart || bathsPart;
}

export function formatBedsLabeled(beds: number | null): string {
  // "4 Bedrooms" / "1 Bedroom". Empty when missing so the layer label shows.
  if (beds === null || beds <= 0) return "";
  return `${beds} ${beds === 1 ? "Bedroom" : "Bedrooms"}`;
}

export function formatBathsLabeled(
  bathsFull: number | null,
  bathsHalf: number | null,
): string {
  // "3 Bathrooms" / "2.5 Bathrooms" / "1 Bathroom". Half-baths count as 0.5.
  const total =
    (bathsFull ?? 0) + (bathsHalf !== null ? bathsHalf * 0.5 : 0);
  if (total <= 0) return "";
  return `${total} ${total === 1 ? "Bathroom" : "Bathrooms"}`;
}

export function formatSquareFeet(sqft: number | null): string {
  // "2,144 Sq Ft". Empty when missing/0 so the layer label shows instead.
  if (sqft === null || sqft <= 0 || Number.isNaN(sqft)) return "";
  return `${sqft.toLocaleString("en-US")} Sq Ft`;
}

const OPEN_HOUSE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const OPEN_HOUSE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

export function formatOpenHouseDate(iso: string | null): string {
  // why: ISO might be null on listings without an OH set. Date parsing of an
  // empty string returns Invalid Date — guard explicitly.
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return OPEN_HOUSE_DATE_FORMATTER.format(d);
}

export function formatOpenHouseTimeRange(
  startIso: string | null,
  endIso: string | null,
): string {
  if (!startIso) return "";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "";
  const startStr = OPEN_HOUSE_TIME_FORMATTER.format(start);
  if (!endIso) return startStr;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return startStr;
  // why: en-dash, not hyphen — C21 brand style guide. The non-breaking spaces
  // prevent the range from breaking awkwardly when rendered as a Textbox.
  return `${startStr} – ${OPEN_HOUSE_TIME_FORMATTER.format(end)}`;
}

export const STATUS_LABEL_MAP: Readonly<
  Record<MLSListingPayload["status"], string>
> = {
  active: "JUST LISTED",
  pending: "UNDER CONTRACT",
  sold: "JUST SOLD",
  expired: "OFF MARKET",
  coming_soon: "COMING SOON",
};

// ---------------------------------------------------------------------------
// Text bound-field resolver — central dispatch
// ---------------------------------------------------------------------------

export function resolveTextBoundField(
  field: TextBoundField,
  listing: MLSListingPayload,
): string {
  // why: exhaustive switch with `never` default — TS forces us to handle every
  // new TextBoundField added to the union. Lose this guarantee and adding a
  // bound field silently breaks templates.
  switch (field) {
    case "price":
      return formatPriceUSD(listing.priceList);
    case "close_price":
      return formatPriceUSD(listing.priceClose);
    case "address_line1":
      return listing.addressLine1 ?? "";
    case "city_state_zip": {
      const parts = [
        listing.city,
        listing.state,
        listing.zip,
      ].filter((p): p is string => Boolean(p));
      if (parts.length < 2) return parts.join(" ");
      // "Wildwood, NJ 08260" — comma after city, space between state and zip.
      const [city, state, zip] = parts;
      return zip ? `${city}, ${state} ${zip}` : `${city}, ${state}`;
    }
    case "city":
      return listing.city ?? "";
    case "state":
      return listing.state ?? "";
    case "zip":
      return listing.zip ?? "";
    case "beds":
      return listing.beds !== null ? String(listing.beds) : "";
    case "baths": {
      const total =
        (listing.bathsFull ?? 0) +
        (listing.bathsHalf !== null ? listing.bathsHalf * 0.5 : 0);
      return total > 0 ? String(total) : "";
    }
    case "beds_baths":
      return formatBedsBaths(
        listing.beds,
        listing.bathsFull,
        listing.bathsHalf,
      );
    case "beds_labeled":
      return formatBedsLabeled(listing.beds);
    case "baths_labeled":
      return formatBathsLabeled(listing.bathsFull, listing.bathsHalf);
    case "square_feet":
      return formatSquareFeet(listing.squareFeet);
    case "property_type":
      return listing.propertyType ?? "";
    case "mls_number":
      return listing.mlsNumber || "";
    case "tagline":
      return listing.tagline ?? "";
    case "status_label":
      return STATUS_LABEL_MAP[listing.status] ?? "";
    case "agent_name":
      return listing.agentName ?? "";
    case "agent_phone":
      return listing.agentPhone ?? "";
    case "agent_email":
      return listing.agentEmail ?? "";
    case "agent_title":
      return listing.agentTitle ?? "";
    case "office_name":
      return listing.officeName ?? "";
    case "open_house_date":
      return formatOpenHouseDate(listing.openHouseStartUtc);
    case "open_house_time":
      return formatOpenHouseTimeRange(
        listing.openHouseStartUtc,
        listing.openHouseEndUtc,
      );
    case "hosting_agent_name": {
      // why: the slide's OH host wins; fall back to the listing agent when
      // the wizard didn't override (single-listing OH where host == listing
      // agent). Empty string makes the layer-text fallback fire downstream.
      const host = listing.hosting_agent?.name?.trim();
      if (host) return host;
      return listing.agentName ?? "";
    }
    case "hosting_agent_phone": {
      // why: hosting_agent.phone is already formatted by the multi-OH route
      // (via `formatPhone` in lib/data/alliance-dash-agents.ts). The fallback
      // path runs `formatPhone()` on the listing agent's stored phone so
      // both paths produce the same "NNN-NNN-NNNN" shape.
      //
      // 2026-05-27 — append " (cell)" suffix when the phone is non-empty,
      // matching Larissa's brand reference (pic 1: "609-374-0505 (cell)").
      // Only on the hosting resolver; the generic `agent_phone` field
      // remains unchanged for non-OH templates.
      const hostPhone = listing.hosting_agent?.phone?.trim();
      const resolved = hostPhone || formatPhone(listing.agentPhone) || "";
      return resolved ? `${resolved} (cell)` : "";
    }
    default: {
      // why: exhaustive-check fallback. If a new TextBoundField member is
      // added to the union and this switch isn't updated, `_exhaustive` will
      // fail to type-check — preventing the bug from shipping silently.
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Image bound-field resolver
// ---------------------------------------------------------------------------

export function resolveImageBoundField(
  field: ImageBoundField,
  listing: MLSListingPayload,
): string | null {
  switch (field) {
    case "hero_photo":
      return listing.photos[0] ?? null;
    case "photo_2":
      return listing.photos[1] ?? null;
    case "photo_3":
      return listing.photos[2] ?? null;
    case "photo_4":
      return listing.photos[3] ?? null;
    case "photo_5":
      return listing.photos[4] ?? null;
    case "agent_photo":
      return listing.agentPhotoUrl;
    case "hosting_agent_photo": {
      // why: hosting host's headshot wins on a multi-OH slide; fall back to
      // the listing agent's headshot when the wizard didn't override (single-
      // listing OH where host == listing agent). Same fallback shape as the
      // text resolvers above so the corner block stays consistent.
      const hostPhoto = listing.hosting_agent?.photo_url ?? null;
      if (hostPhoto) return hostPhoto;
      return listing.agentPhotoUrl;
    }
    case "office_logo":
      // why: office_logo falls back to a brand lockup when the listing
      // doesn't carry a per-office override. The brand-logos.ts module
      // is the single source of truth for both factory templates and
      // AI-Design-rewritten schemas. Before 2026-05-24 this returned
      // listing.officeLogoUrl which was almost always null in practice —
      // AI Design output came out logo-less.
      //
      // 2026-05-24 — price-tier branching: listings at-or-above the
      // Excellence Collection threshold ($949k) get the premium
      // Excellence wordmark; everything else gets the standard C21
      // Alliance lockup. Mirrors the same rule applied to
      // brokerage_logo below so both bound fields stay consistent.
      if (listing.officeLogoUrl) return listing.officeLogoUrl;
      if ((listing.priceList ?? 0) >= EXCELLENCE_PRICE_THRESHOLD) {
        return EXCELLENCE_COLLECTION_LOGO;
      }
      return C21_ALLIANCE_WHITE_LOGO;
    case "brokerage_logo":
      // why: brokerage_logo is the canonical Alliance lockup — by
      // default the white-on-dark variant since most templates place
      // it over a dark scrim. Previously this returned
      // "/brand/c21-mark.svg" which doesn't exist as a file, so AI
      // Design output rendered with a broken logo (the bug Larissa
      // flagged on the first real run).
      //
      // 2026-05-24 — price-tier branching: listings priced at-or-above
      // the Excellence Collection threshold ($949k, per
      // EXCELLENCE_PRICE_THRESHOLD) swap to the Excellence Collection
      // wordmark. Below threshold, fall back to the standard C21
      // Alliance lockup. This is a hard brand rule from John: premium
      // listings carry the premium brand mark wherever a brokerage
      // logo appears.
      //
      // 2026-05-30 — when the headless render route resolved this listing's
      // canonical logo from the brand_assets library, it's already on
      // brokerageLogoUrl; use it so re-uploaded logos flow without a code
      // edit. Null in the editor preview → fall through to the frozen
      // tier-based constant below.
      if (listing.brokerageLogoUrl) return listing.brokerageLogoUrl;
      if ((listing.priceList ?? 0) >= EXCELLENCE_PRICE_THRESHOLD) {
        return EXCELLENCE_COLLECTION_LOGO;
      }
      return C21_ALLIANCE_WHITE_LOGO;
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

// ===========================================================================
// SECTION 2 — Fabric object factories
// ===========================================================================
//
// Each `createFabric*` helper takes a hydrated schema layer and returns a
// Fabric object. They're separated by layer kind so each can document its
// edge cases without becoming a 400-line god-function.
//
// All factories set a custom `data` property on the Fabric object containing
// the schema layer id + kind. This lets us:
//   • Correlate Fabric selection events with schema layers in the layer panel.
//   • Serialize back to schema later (Phase 2).
// Fabric preserves the `data` property through clone/duplicate operations.
// ---------------------------------------------------------------------------

export interface FabricLayerData {
  layerId: string;
  layerKind: CanvasLayer["kind"];
  /** Display name for the layer panel. May diverge from layer.name once the user renames. */
  displayName: string;
  /**
   * Image-only: the layer's BOX dimensions in canvas px. Stored separately
   * from the Fabric image's natural × scale display dims so Cover/Contain/
   * Stretch can compute against a stable target instead of a circular
   * "fit to current display" reference (the bug that made those buttons
   * appear to do nothing). Updated on user resize so the box follows the
   * image when handles are dragged.
   *
   * Other layer kinds ignore this field.
   */
  targetBoxWidth?: number;
  targetBoxHeight?: number;
  /**
   * Image-only: the user's chosen object-fit. Mirrors the field we
   * already write via writeObjectFit() in ImagePropertiesControls, but
   * lifted into the canonical FabricLayerData shape so all data-bag
   * fields live in one place.
   */
  objectFit?: "cover" | "contain" | "stretch";
  /**
   * Placeholder binding (text or image). Stamped when a layer is inserted
   * as a placeholder or an existing layer is "bound to a field" in Template
   * Builder. The save path (reconstruct-schema) reads this so a layer added
   * on the canvas — not just one matched to a pre-existing schema layer —
   * round-trips as a real bound placeholder that re-resolves on each post.
   * Absent on literal layers (the common case); behavior is unchanged when
   * unset.
   */
  boundField?: BoundField;
  /**
   * Placeholder-only: when true, the render drops this layer entirely if its
   * bound value resolves empty (e.g., agent photo missing) instead of
   * leaving a hole. Defaults to false (keep the frame / fallback).
   */
  hideIfEmpty?: boolean;
  /**
   * Image-only: corner radius in px the saved ImageLayer should carry. Lets
   * an inserted image placeholder (e.g., a circular agent-photo frame, where
   * this equals half the box size) preserve its rounding through save, since
   * the placeholder is authored as a rounded Rect rather than a real image.
   */
  cornerRadius?: number;
  /**
   * Image-only: a visible frame stroked around the photo's frame (the clip
   * window). Color + width are stamped here so the shared `drawImageBorders`
   * after-render hook can paint them in BOTH the editor and the headless post
   * pipeline, and so reconstruct-schema can persist edits back to the layer.
   * width <= 0 (or no color) = no border.
   */
  borderColor?: string;
  borderWidth?: number;
}

/**
 * Extends FabricObject's `data` with our own metadata. We use a module-augment-
 * style helper rather than the global declare-module pattern to keep the type
 * surface local to this file.
 */
export function getLayerData(obj: FabricObject): FabricLayerData | null {
  // why: Fabric typings type `data` as `any` in some versions; cast through unknown.
  const data = (obj as unknown as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return data as FabricLayerData;
}

export function setLayerData(obj: FabricObject, data: FabricLayerData): void {
  (obj as unknown as { data: FabricLayerData }).data = data;
}

/**
 * Stamp (or clear) the placeholder `boundField` on a Fabric object's data
 * bag without disturbing the rest of its metadata. Pass `null` to unbind
 * (turn a placeholder back into a literal layer). Used by the Template
 * Builder placeholder panel + the "convert selected layer to placeholder"
 * action. No-op when the object has no existing layer-data bag.
 */
export function setLayerBoundField(
  obj: FabricObject,
  boundField: BoundField | null,
  hideIfEmpty?: boolean,
): void {
  const current = getLayerData(obj);
  if (!current) return;
  const next: FabricLayerData = { ...current };
  if (boundField === null) {
    delete next.boundField;
    delete next.hideIfEmpty;
  } else {
    next.boundField = boundField;
    if (hideIfEmpty !== undefined) next.hideIfEmpty = hideIfEmpty;
  }
  setLayerData(obj, next);
}

// ---------------------------------------------------------------------------
// Text layer factory
// ---------------------------------------------------------------------------

export function createFabricTextbox(
  layer: TextLayer,
  resolvedText: string,
): Textbox {
  // why: use Textbox (not Text or IText). Textbox supports word-wrap within
  // a fixed `width` AND in-place editing on double-click — both required by
  // the editor UX. Text doesn't wrap; IText wraps but doesn't enforce width.
  // Phase B.3 — resolve text effect to Fabric props (shadow/stroke/paintFirst)
  // before construction so the effect is visible on first render, not on a
  // later tick.
  const effectProps = textEffectToFabricProps(layer.effect);
  const tb = new Textbox(resolvedText || layer.text, {
    left: layer.left,
    top: layer.top,
    width: layer.maxWidth ?? layer.width,
    angle: layer.angle,
    opacity: layer.opacity,
    fontFamily: layer.fontFamily,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontStyle: layer.fontStyle,
    fill: layer.fill,
    textAlign: layer.textAlign,
    lineHeight: layer.lineHeight,
    charSpacing: layer.charSpacing,
    underline: layer.underline,
    linethrough: layer.linethrough,
    // why: Phase B.3 — text effect translates into shadow/stroke/paintFirst.
    // Effect "none" (default) returns null/empty values, leaving the textbox
    // looking identical to pre-Phase-B builds.
    shadow: effectProps.shadow,
    stroke: effectProps.stroke,
    strokeWidth: effectProps.strokeWidth,
    paintFirst: effectProps.paintFirst,
    editable: layer.editable && !layer.locked,
    selectable: !layer.locked,
    evented: !layer.locked,
    visible: layer.visible,
    // why: hide the default Fabric corner controls until the user actually
    // hovers/selects. Phase 2 will customize these with brand colors.
    // 2026-05-25 — Canva-style selection chrome. Violet borders +
    // pills + larger circles. See canva-style-controls.ts.
    cornerStyle: "circle",
    cornerSize: 16,
    transparentCorners: false,
    borderColor: CANVA_VIOLET,
    cornerColor: CANVA_VIOLET,
    borderScaleFactor: 2,
    padding: 2,
  });
  // why: replace Fabric's default 8-circle control set with pills on
  // the side midpoints + larger circles on the corners. Visual + UX
  // match Canva. textResize=true so side handles change WIDTH (reflow)
  // and top/bottom handles are removed — text never gets stretched.
  (
    tb as unknown as { controls: Record<string, unknown> }
  ).controls = createCanvaStyleControls({ textResize: true });
  setLayerData(tb, {
    layerId: layer.id,
    layerKind: "text",
    displayName: layer.name,
  });
  return tb;
}

// ---------------------------------------------------------------------------
// Image layer factory (async — FabricImage.fromURL returns a Promise)
// ---------------------------------------------------------------------------

interface ImageLoadResult {
  ok: true;
  image: FabricImage;
}
interface ImageLoadFailure {
  ok: false;
  reason: "no_src" | "load_error" | "cors_blocked" | "hidden";
  message: string;
}
export type ImageLoadOutcome = ImageLoadResult | ImageLoadFailure;

// ---------------------------------------------------------------------------
// Native-crop framing (2026-05-31)
// ---------------------------------------------------------------------------
//
// Images are framed with Fabric's NATIVE crop (`cropX`/`cropY` + `width`/
// `height` in element px + uniform `scaleX`/`scaleY`) rather than a
// cover-overflow photo masked by a clipPath. The win: the object's bounding
// box EQUALS the visible frame, so a photo never hangs invisibly over its
// neighbors (you can click the band underneath), the edge handles can TRIM the
// frame (cut off) instead of scaling, and corner handles scale without
// distortion.
//
//   • cover   → crop the photo so the frame is filled edge-to-edge; the focal
//               point (0..1) picks which slice shows.
//   • contain → whole photo fits inside the frame, centered; box = scaled photo.
//   • stretch → fill the frame exactly, distorting aspect; no crop.

export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Read a Fabric image's NATURAL (uncropped) element dimensions. */
export function imageNaturalSize(img: FabricImage): {
  width: number;
  height: number;
} {
  const el = (
    img as unknown as { getElement?: () => unknown }
  ).getElement?.();
  if (el && typeof el === "object") {
    const e = el as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
    const w = e.naturalWidth || e.width || 0;
    const h = e.naturalHeight || e.height || 0;
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  return { width: img.width || 1, height: img.height || 1 };
}

/**
 * Frame a loaded Fabric image into a target rect (canvas px) using native
 * crop. Sets left/top/scaleX/scaleY/cropX/cropY/width/height in place. The
 * resulting object bounding box equals the frame for cover/stretch (and the
 * centered scaled photo for contain). `focalX/focalY` (0..1) only matter for
 * cover.
 */
export function fitImageInFrame(
  img: FabricImage,
  frame: FrameRect,
  fit: "cover" | "contain" | "stretch",
  focalX = 0.5,
  focalY = 0.5,
): void {
  const { width: nW, height: nH } = imageNaturalSize(img);
  const fW = Math.max(1, frame.width);
  const fH = Math.max(1, frame.height);

  if (fit === "stretch") {
    img.set({
      left: frame.left,
      top: frame.top,
      scaleX: fW / nW,
      scaleY: fH / nH,
      cropX: 0,
      cropY: 0,
      width: nW,
      height: nH,
    });
    img.setCoords();
    return;
  }

  if (fit === "contain") {
    const s = Math.min(fW / nW, fH / nH);
    const boxW = nW * s;
    const boxH = nH * s;
    img.set({
      left: frame.left + (fW - boxW) / 2,
      top: frame.top + (fH - boxH) / 2,
      scaleX: s,
      scaleY: s,
      cropX: 0,
      cropY: 0,
      width: nW,
      height: nH,
    });
    img.setCoords();
    return;
  }

  // cover
  const s = Math.max(fW / nW, fH / nH);
  const cropW = Math.min(nW, fW / s);
  const cropH = Math.min(nH, fH / s);
  img.set({
    left: frame.left,
    top: frame.top,
    scaleX: s,
    scaleY: s,
    cropX: (nW - cropW) * clamp01(focalX),
    cropY: (nH - cropH) * clamp01(focalY),
    width: cropW,
    height: cropH,
  });
  img.setCoords();
}

/** The image's current visible frame (bounding box) in canvas px. */
export function frameOfImage(img: FabricImage): FrameRect {
  return {
    left: img.left ?? 0,
    top: img.top ?? 0,
    width: (img.width ?? 0) * (img.scaleX ?? 1),
    height: (img.height ?? 0) * (img.scaleY ?? 1),
  };
}

/**
 * The image's current focal point (0..1) derived from its crop offset — how
 * far into the available overflow the visible slice sits. Used to persist a
 * pan/trim so a bound photo re-frames the same way at render against a
 * different-sized photo.
 */
export function focalOfImage(img: FabricImage): { focalX: number; focalY: number } {
  const { width: nW, height: nH } = imageNaturalSize(img);
  const cw = img.width ?? nW;
  const ch = img.height ?? nH;
  const overflowX = nW - cw;
  const overflowY = nH - ch;
  return {
    focalX: overflowX > 0.5 ? clamp01((img.cropX ?? 0) / overflowX) : 0.5,
    focalY: overflowY > 0.5 ? clamp01((img.cropY ?? 0) / overflowY) : 0.5,
  };
}

export async function createFabricImage(
  layer: ImageLayer,
  resolvedSrc: string | null,
): Promise<ImageLoadOutcome> {
  // why: when a listing has no photo at the bound slot (e.g., photo_5 on a
  // 3-photo listing), we degrade gracefully. The canvas shows a placeholder
  // rect rather than erroring — that's handled by the caller, which falls
  // through to a ShapeLayer-style placeholder when this returns ok:false.
  const src = resolvedSrc || layer.src;
  if (!src) {
    // why: `hideIfEmpty` opts the layer OUT of the placeholder treatment
    // entirely. Surfaces with this flag (the hosting-agent block's photo)
    // prefer to disappear gracefully rather than show a dashed-outline
    // placeholder rect where a missing host headshot would have been.
    // Emit a console warning so a future demo's name-mismatch is visible
    // in Vercel runtime logs without taking the render down.
    if (layer.hideIfEmpty) {
      if (layer.boundField === "hosting_agent_photo") {
        console.warn(
          `[hosting-agent] no headshot for host '${layer.name}' — block degrades to text-only`,
        );
      }
      return { ok: false, reason: "hidden", message: "Hidden (empty src)" };
    }
    return { ok: false, reason: "no_src", message: "No image URL" };
  }

  try {
    // why: `crossOrigin: "anonymous"` is the single most important setting
    // for export-correctness. Without it, any image from a different origin
    // (Supabase Storage, MLS photo CDNs, agent headshot hosts) taints the
    // canvas and toDataURL throws SecurityError. The server hosting the image
    // ALSO needs to send `Access-Control-Allow-Origin: *` (or echo the request
    // origin). Supabase Storage does; some third-party MLS photo CDNs do not.
    // We surface CORS failures distinctly so the parent can show a clear
    // error toast rather than a generic "export failed".
    //
    // 2026-05-23 — added a 15s per-image timeout via Promise.race. Before
    // this, a slow/hung MLS CDN could stall the whole headless renderer
    // (which awaits images sequentially) and surface only as the
    // chromium-wide "30000ms exceeded" timeout. The 15s cap lets the
    // parent caller fall through to the no_src placeholder path while
    // still leaving headroom under the 30s screenshot ceiling.
    //
    // 2026-06-10: the timeout timer is now cleared once the race settles.
    // Before this, every successful image load still left a live 15s timer
    // behind; harmless individually, but a many-image hydration accumulated
    // dozens of pending timers (wasted wakeups, noisy profiles).
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let img: FabricImage;
    try {
      img = await Promise.race<FabricImage>([
        FabricImage.fromURL(src, { crossOrigin: "anonymous" }),
        new Promise<FabricImage>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`image load timeout after 15s: ${src}`)),
            15_000,
          );
        }),
      ]);
    } finally {
      // why: clearTimeout tolerates undefined in both DOM and Node typings,
      // so no narrowing dance is needed here.
      clearTimeout(timeoutHandle);
    }
    // why (2026-05-31): frame via NATIVE crop (see fitImageInFrame). The
    // object's bounding box becomes the visible frame — no cover overflow
    // hanging over neighbors. Default focal: horizontally centered, vertically
    // biased above center for cover (keep roofline, trim foreground) unless the
    // layer carries an authored focal point.
    const frame: FrameRect = {
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
    };
    const focalX = clamp01(layer.focalX ?? 0.5);
    const focalY = clamp01(
      layer.focalY ?? (layer.objectFit === "cover" ? 0.4 : 0.5),
    );

    img.set({
      angle: layer.angle,
      opacity: layer.opacity,
      visible: layer.visible,
      selectable: !layer.locked,
      evented: !layer.locked,
      // 2026-05-25 — Canva-style selection chrome.
      cornerStyle: "circle",
      cornerSize: 16,
      transparentCorners: false,
      borderColor: CANVA_VIOLET,
      cornerColor: CANVA_VIOLET,
      borderScaleFactor: 2,
    });
    fitImageInFrame(img, frame, layer.objectFit, focalX, focalY);
    (
      img as unknown as { controls: Record<string, unknown> }
    ).controls = createCanvaStyleControls({ imageCrop: true });

    // why: with native crop the box already equals the frame, so a clipPath is
    // only needed to ROUND the corners. Attach one at the box dims when a
    // corner radius is set; otherwise leave the image unclipped (simpler, and
    // the box can't overflow). The clip is absolutePositioned at the current
    // box; object:modified keeps it in sync as the frame is trimmed/moved.
    if (layer.cornerRadius && layer.cornerRadius > 0) {
      const box = frameOfImage(img);
      img.clipPath = new Rect({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        rx: layer.cornerRadius,
        ry: layer.cornerRadius,
        originX: "left",
        originY: "top",
        absolutePositioned: true,
      });
    }

    setLayerData(img, {
      layerId: layer.id,
      layerKind: "image",
      displayName: layer.name,
      // why: stamp the box dims at creation so Cover/Contain/Stretch in
      // ImagePropertiesControls.handleFitChange can read a stable target
      // box. Without these, the controls fall back to the displayed
      // dimensions — which is the bug.
      targetBoxWidth: layer.width,
      targetBoxHeight: layer.height,
      objectFit: layer.objectFit,
      // why: carry the frame-border spec on the data bag so drawImageBorders
      // (after:render) can paint it identically in the editor and the headless
      // render, and reconstruct-schema can read it back.
      borderColor: layer.borderColor,
      borderWidth: layer.borderWidth,
    });
    return { ok: true, image: img };
  } catch (err) {
    // why: distinguish CORS failures from generic load failures by sniffing
    // the error message. Fabric/the browser surface CORS as a generic
    // "tainted" or "blocked by CORS" string. Not perfect, but good enough
    // for an error-toast hint.
    const message = err instanceof Error ? err.message : String(err);
    const isCors =
      /cors|tainted|cross-origin/i.test(message) ||
      // why: when the image responds but lacks Access-Control-Allow-Origin,
      // Fabric throws with no message at all in some browsers; treat as CORS.
      message === "";
    return {
      ok: false,
      reason: isCors ? "cors_blocked" : "load_error",
      message: isCors
        ? `Image blocked by CORS: ${src}`
        : `Image failed to load: ${src} — ${message}`,
    };
  }
}

/**
 * Paint frame borders for every image that carries a border spec on its data
 * bag. Designed to run as an `after:render` hook on the SAME canvas the editor
 * and the headless render pipeline use, so a photo's frame looks identical in
 * Studio and in the published PNG.
 *
 * The frame is stroked at the image's CLIP bounds (the visible window), NOT the
 * image's own bounds — a Cover photo overflows its frame, so a stroke on the
 * image itself would be clipped away. We only draw when the image has an
 * absolutePositioned Rect clipPath (every factory-built image does). During
 * crop the clip is temporarily removed, which conveniently suppresses the
 * border until the crop is committed.
 *
 * Drawn on the lower (container) context beneath the selection chrome, so the
 * frame reads as artwork rather than UI, and is captured by both toDataURL and
 * the page screenshot in the render pipeline.
 */
export function drawImageBorders(
  canvas: Canvas,
  targetCtx?: CanvasRenderingContext2D,
): void {
  // why: prefer the context the render pass hands us (the after:render event's
  // ctx). For a normal editor render that's the live lower context; for an
  // export render (toCanvasElement) it's the offscreen context, so the frames
  // land in the exported image too. Fall back to the live context.
  const ctx = targetCtx ?? canvas.getContext();
  if (!ctx) return;
  const vpt = canvas.viewportTransform;
  ctx.save();
  if (vpt && vpt.length === 6) {
    ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
  }
  for (const obj of canvas.getObjects()) {
    if (!(obj instanceof FabricImage)) continue;
    if (obj.visible === false) continue;
    const data = getLayerData(obj);
    const width = Number(data?.borderWidth) || 0;
    const color =
      typeof data?.borderColor === "string" ? data.borderColor : "";
    if (width <= 0 || !color) continue;
    // why: with native crop the object's bounding box IS the visible frame, so
    // the border traces the box directly. Skip rotated images (the simple rect
    // trace would be wrong) — templates don't rotate framed photos.
    if (Math.abs(((obj as { angle?: number }).angle ?? 0) % 360) > 0.01) continue;
    const box = frameOfImage(obj);
    const left = box.left;
    const top = box.top;
    const w = box.width;
    const h = box.height;
    // Corner rounding comes from the (rounding-only) clipPath if one is set.
    const clip = obj.clipPath;
    const rx =
      clip instanceof Rect ? Math.max(0, Number(clip.rx) || 0) : 0;
    ctx.beginPath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineJoin = "miter";
    if (
      rx > 0 &&
      typeof (ctx as { roundRect?: unknown }).roundRect === "function"
    ) {
      ctx.roundRect(left, top, w, h, rx);
    } else {
      ctx.rect(left, top, w, h);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Shape layer factory
// ---------------------------------------------------------------------------

/**
 * Build a Fabric `Gradient` instance from a structured `GradientFill`.
 *
 * Coords are computed in the LAYER's local space (0,0 → width,height) because
 * Fabric draws gradients in the object's own coordinate system by default —
 * we don't set `gradientUnits: "percentage"` so coords are interpreted as
 * pixels inside the shape's bounding box.
 *
 * Why a single helper (not two — one per kind):
 *   The discriminated union narrows inside the switch and the construction
 *   logic for both kinds is small. A single helper keeps the call site in
 *   `createFabricShape` to ONE line and avoids exporting two near-identical
 *   internal functions.
 *
 * Linear-coord math:
 *   `angleDeg` is degrees clockwise from horizontal-right (CSS convention).
 *   Convert to radians, then project a unit vector onto the bounding box
 *   centered at (width/2, height/2). The result is two points (x1,y1) →
 *   (x2,y2) spanning the diagonal of the box in the requested direction.
 *
 * Radial-coord math:
 *   Center at (width/2, height/2). r1 = 0 (inner radius — gradient origin
 *   is a point, not a ring). r2 = max(width, height) * (spread ?? 1) / 2 —
 *   spread is fraction of the LONGER axis, halved because radius is half
 *   the diameter.
 */
export function fabricGradientFromFill(
  gradient: GradientFill,
  bbox: { width: number; height: number },
): Gradient<"linear"> | Gradient<"radial"> {
  // why map readonly stops to a fresh mutable array: Fabric's typedef wants
  // `ColorStop[]` (mutable), and we don't want consumers' readonly arrays
  // accidentally tied to Fabric's internal mutation surface.
  const colorStops = gradient.stops.map((s) => ({
    offset: s.offset,
    color: s.color,
  }));

  if (gradient.kind === "linear") {
    // why CSS-aligned angle math:
    //   CSS linear-gradient(0deg) paints bottom-to-top, but our docblock
    //   says 0° = left-to-right. We use 0° = left-to-right (sin/cos with
    //   angle = 0 → (1, 0)) so authors can think in "where the gradient
    //   points" without inverting Y. Stick with this convention everywhere.
    const angleRad = (gradient.angleDeg * Math.PI) / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    const cx = bbox.width / 2;
    const cy = bbox.height / 2;
    // Project the diagonal half-extent onto the angle vector so the
    // gradient spans the full bounding box in the requested direction.
    const halfExtent = (Math.abs(dx) * bbox.width + Math.abs(dy) * bbox.height) / 2;
    return new Gradient<"linear">({
      type: "linear",
      coords: {
        x1: cx - dx * halfExtent,
        y1: cy - dy * halfExtent,
        x2: cx + dx * halfExtent,
        y2: cy + dy * halfExtent,
      },
      colorStops,
    });
  }

  // Radial branch.
  const spread = gradient.spread ?? 1;
  const cx = bbox.width / 2;
  const cy = bbox.height / 2;
  const radius = (Math.max(bbox.width, bbox.height) * spread) / 2;
  return new Gradient<"radial">({
    type: "radial",
    coords: {
      x1: cx,
      y1: cy,
      r1: 0,
      x2: cx,
      y2: cy,
      r2: radius,
    },
    colorStops,
  });
}

export function createFabricShape(layer: ShapeLayer): FabricObject {
  // why: narrow the fill once, here, so each shape branch below can pass
  // `resolvedFill` directly to its Fabric constructor without re-checking
  // the union. A Gradient | string is what Fabric Rect/Circle/Ellipse all
  // accept on their `fill` property.
  const resolvedFill: Gradient<"linear"> | Gradient<"radial"> | string | undefined =
    isGradientFill(layer.fill)
      ? fabricGradientFromFill(layer.fill, {
          width: layer.width,
          height: layer.height,
        })
      : layer.fill || undefined;

  const common = {
    left: layer.left,
    top: layer.top,
    angle: layer.angle,
    opacity: layer.opacity,
    fill: resolvedFill,
    stroke: layer.stroke || undefined,
    strokeWidth: layer.strokeWidth,
    strokeDashArray: layer.strokeDashArray.length
      ? layer.strokeDashArray
      : undefined,
    visible: layer.visible,
    selectable: !layer.locked,
    evented: !layer.locked,
    // 2026-05-25 — Canva-style selection chrome.
    cornerStyle: "circle" as const,
    cornerSize: 16,
    transparentCorners: false,
    borderColor: CANVA_VIOLET,
    cornerColor: CANVA_VIOLET,
    borderScaleFactor: 2,
  };

  let obj: FabricObject;
  switch (layer.shapeType) {
    case "rect":
      obj = new Rect({
        ...common,
        width: layer.width,
        height: layer.height,
        rx: layer.cornerRadius,
        ry: layer.cornerRadius,
      });
      break;
    case "circle":
      // why: Fabric Circle is defined by radius, not width/height. We choose
      // the smaller of width/height as the diameter so the shape fits within
      // the layer bounds even when width !== height.
      obj = new Circle({
        ...common,
        radius: Math.min(layer.width, layer.height) / 2,
      });
      break;
    case "ellipse":
      obj = new Ellipse({
        ...common,
        rx: layer.width / 2,
        ry: layer.height / 2,
      });
      break;
    case "line":
      // why: Fabric Line takes coordinates as constructor arg [x1, y1, x2, y2].
      // We compute the endpoints from the layer's bounding box + angle so a
      // schema line can be defined the same way as other shapes.
      obj = new Line(
        [layer.left, layer.top, layer.left + layer.width, layer.top],
        {
          ...common,
          // why: lines have no fill — the `stroke` is what's visible. Force
          // strokeWidth >= 1 to avoid an invisible shape.
          strokeWidth: Math.max(layer.strokeWidth, 1),
        },
      );
      break;
    default: {
      const _exhaustive: never = layer.shapeType;
      return _exhaustive;
    }
  }
  // 2026-05-25 — Canva-style controls (pills + larger violet circles).
  (
    obj as unknown as { controls: Record<string, unknown> }
  ).controls = createCanvaStyleControls();
  setLayerData(obj, {
    layerId: layer.id,
    layerKind: "shape",
    displayName: layer.name,
  });
  return obj;
}
