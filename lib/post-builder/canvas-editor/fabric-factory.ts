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
import { C21_ALLIANCE_WHITE_LOGO } from "./templates/brand-logos";

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
    case "office_logo":
      // why: office_logo falls back to the canonical C21 Alliance white
      // lockup when the listing doesn't carry a per-office override. The
      // brand-logos.ts module is the single source of truth for both
      // factory templates and AI-Design-rewritten schemas. Before
      // 2026-05-24 this returned listing.officeLogoUrl which was almost
      // always null in practice — AI Design output came out logo-less.
      return listing.officeLogoUrl ?? C21_ALLIANCE_WHITE_LOGO;
    case "brokerage_logo":
      // why: brokerage_logo is the canonical Alliance lockup — always
      // the white-on-dark variant since most templates place it over a
      // dark scrim. Previously this returned "/brand/c21-mark.svg" which
      // doesn't exist as a file, so AI Design output rendered with a
      // broken logo (the bug Larissa flagged on the first real run).
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
    cornerStyle: "circle",
    cornerSize: 10,
    transparentCorners: false,
    borderColor: "#C9A961", // gold-500
    cornerColor: "#C9A961",
    padding: 2,
  });
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
  reason: "no_src" | "load_error" | "cors_blocked";
  message: string;
}
export type ImageLoadOutcome = ImageLoadResult | ImageLoadFailure;

export async function createFabricImage(
  layer: ImageLayer,
  resolvedSrc: string | null,
): Promise<ImageLoadOutcome> {
  // why: when a listing has no photo at the bound slot (e.g., photo_5 on a
  // 3-photo listing), we degrade gracefully. The canvas shows a placeholder
  // rect rather than erroring — that's handled by the caller, which falls
  // through to a ShapeLayer-style placeholder when this returns ok:false.
  const src = resolvedSrc || layer.src;
  if (!src) return { ok: false, reason: "no_src", message: "No image URL" };

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
    const img = await Promise.race<FabricImage>([
      FabricImage.fromURL(src, { crossOrigin: "anonymous" }),
      new Promise<FabricImage>((_, reject) =>
        setTimeout(
          () => reject(new Error(`image load timeout after 15s: ${src}`)),
          15_000,
        ),
      ),
    ]);
    // why: object-fit math. Fabric scales uniformly via scaleX/scaleY based on
    // the image's natural element dimensions. We compute the scale that makes
    // the image fit the layer's width × height per the chosen objectFit.
    const naturalWidth = img.width || 1;
    const naturalHeight = img.height || 1;
    const targetWidth = layer.width;
    const targetHeight = layer.height;

    const scaleCover = Math.max(
      targetWidth / naturalWidth,
      targetHeight / naturalHeight,
    );
    const scaleContain = Math.min(
      targetWidth / naturalWidth,
      targetHeight / naturalHeight,
    );
    const scaleX =
      layer.objectFit === "stretch"
        ? targetWidth / naturalWidth
        : layer.objectFit === "contain"
          ? scaleContain
          : scaleCover;
    const scaleY =
      layer.objectFit === "stretch"
        ? targetHeight / naturalHeight
        : layer.objectFit === "contain"
          ? scaleContain
          : scaleCover;

    img.set({
      left: layer.left,
      top: layer.top,
      angle: layer.angle,
      opacity: layer.opacity,
      scaleX,
      scaleY,
      visible: layer.visible,
      selectable: !layer.locked,
      evented: !layer.locked,
      // why: clip to the layer rect for "cover" mode so the overflow doesn't
      // bleed past the intended frame. Without this, a cover-fit photo
      // extends beyond its layer box. Implemented as a clipPath rect aligned
      // to the layer dimensions, positioned relative to the image's origin.
      cornerStyle: "circle",
      cornerSize: 10,
      transparentCorners: false,
      borderColor: "#C9A961",
      cornerColor: "#C9A961",
    });

    // why (2026-05-23 — Cover/Contain/Stretch bug fix): ALWAYS attach a
    // clipPath at the BOX dimensions (layer.width × layer.height),
    // independent of corner radius. The clipPath uses
    // `absolutePositioned: true` so it stays at the layer's intended
    // canvas position regardless of how the image's scaleX/scaleY drift
    // after Cover/Contain/Stretch. Without this clip, Cover overflow
    // bleeds onto neighboring layers and the user can't tell the fit
    // even changed. cornerRadius (if any) is baked into the same clip
    // rect so we only ever have ONE clipPath per image.
    const clip = new Rect({
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      rx: layer.cornerRadius,
      ry: layer.cornerRadius,
      originX: "left",
      originY: "top",
      absolutePositioned: true,
    });
    img.clipPath = clip;

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
    cornerStyle: "circle" as const,
    cornerSize: 10,
    transparentCorners: false,
    borderColor: "#C9A961",
    cornerColor: "#C9A961",
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
  setLayerData(obj, {
    layerId: layer.id,
    layerKind: "shape",
    displayName: layer.name,
  });
  return obj;
}
