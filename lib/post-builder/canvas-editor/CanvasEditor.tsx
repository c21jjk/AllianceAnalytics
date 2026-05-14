"use client";

/**
 * CanvasEditor — Phase 1 foundation (Step 1 of the Canva-clone rebuild)
 * ----------------------------------------------------------------------
 *
 * Renders a single Fabric.js v6 canvas inside a Tailwind-styled overlay shell.
 * Consumes a CanvasTemplateSchema + MLSListingPayload, hydrates bound fields
 * into Fabric objects, lets the user select / move / resize / reorder / lock /
 * delete those objects, and exports the final canvas as a PNG File via onSave.
 *
 * Scope discipline (read this before extending):
 *   • Phase 1 = foundation. Add NEW layers? Not yet. Brand panel? Not yet.
 *     Color picker? Not yet. This file handles existing layers from a template
 *     and the basic selection + layer-panel + export loop. Phases 2–5 plug in
 *     additional panels (Brand / Templates / Uploads / Photos / Elements)
 *     around the existing shell — don't bake them into this file.
 *   • V1 (the Path-A headless-Chromium pipeline) is LOCKED. Nothing in this
 *     file imports from `lib/post-builder/render.ts` or `chromium.ts`, and
 *     nothing in V1 imports from here. The two systems coexist until V2.
 *
 * Fabric.js v6 API notes for future maintainers:
 *   • Use `FabricImage` (not `Image`) — v6 renamed it to avoid colliding with
 *     the DOM `Image` global.
 *   • `FabricImage.fromURL(url, options)` is now a Promise (v5 was callback).
 *   • `canvas.dispose()` is async in v6, returning Promise<boolean>. We
 *     fire-and-forget in the React cleanup (React's cleanup is sync). Safe
 *     because no further code touches the canvas after cleanup.
 *   • Fabric uses `angle` in degrees, `left`/`top` for position, `charSpacing`
 *     in 1/1000 em units. The schema mirrors these names exactly so we can
 *     spread schema layer fields straight into Fabric constructors.
 */

import {
  Canvas,
  Circle,
  Ellipse,
  FabricImage,
  type FabricObject,
  Line,
  Rect,
  Textbox,
} from "fabric";
import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  type CanvasEditorProps,
  type CanvasExportResult,
  type CanvasLayer,
  EXPORT_RESOLUTION_MULTIPLIER,
  type ImageBoundField,
  type ImageLayer,
  isImageLayer,
  isShapeLayer,
  isTextLayer,
  type MLSListingPayload,
  PLATFORM_DIMENSIONS,
  type ShapeLayer,
  type TextBoundField,
  type TextLayer,
} from "./types";

// === Phase 2 panel integrations ===
// why: imported here at the orchestrator so the integration surface is
// reviewable in one place. Each agent's component is consumed by name; the
// contracts.ts file is the shared interface they were all written against.
import type { SelectionMode } from "./contracts";
import { handlePhase2KeyDown } from "./history/keyboard-shortcuts";
import { useUndoRedoHistory } from "./history/useUndoRedoHistory";
import AddLayerToolbar from "./panels/AddLayerToolbar";
import LayerListPanel from "./panels/LayerListPanel";
import SelectionPropertiesPanel from "./panels/SelectionPropertiesPanel";

// why: fonts.css contains Google Fonts @import statements for the 9 fonts
// that aren't already loaded at the app level. Importing the CSS here (not
// in app/globals.css) scopes the network cost to ONLY when the editor
// actually mounts — no font fetch on the dashboard, listings page, etc.
// Next.js's CSS chunking handles the per-route loading automatically.
import "./fonts.css";

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

function formatPriceUSD(value: number | null | undefined): string {
  // why: null guard before formatter — Intl will produce "$NaN" on null.
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return USD_FORMATTER.format(value);
}

function formatBedsBaths(
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

function formatOpenHouseDate(iso: string | null): string {
  // why: ISO might be null on listings without an OH set. Date parsing of an
  // empty string returns Invalid Date — guard explicitly.
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return OPEN_HOUSE_DATE_FORMATTER.format(d);
}

function formatOpenHouseTimeRange(
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
  return `${startStr} – ${OPEN_HOUSE_TIME_FORMATTER.format(end)}`;
}

const STATUS_LABEL_MAP: Readonly<
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

function resolveTextBoundField(
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

function resolveImageBoundField(
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
      return listing.officeLogoUrl;
    case "brokerage_logo":
      // why: brokerage_logo is a static C21 mark. For now we point at a public
      // asset; later this becomes per-office configurable.
      return "/brand/c21-mark.svg";
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

interface FabricLayerData {
  layerId: string;
  layerKind: CanvasLayer["kind"];
  /** Display name for the layer panel. May diverge from layer.name once the user renames. */
  displayName: string;
}

/**
 * Extends FabricObject's `data` with our own metadata. We use a module-augment-
 * style helper rather than the global declare-module pattern to keep the type
 * surface local to this file.
 */
function getLayerData(obj: FabricObject): FabricLayerData | null {
  // why: Fabric typings type `data` as `any` in some versions; cast through unknown.
  const data = (obj as unknown as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return data as FabricLayerData;
}

function setLayerData(obj: FabricObject, data: FabricLayerData): void {
  (obj as unknown as { data: FabricLayerData }).data = data;
}

/**
 * Convert a hex color "#RRGGBB" to "rgba(r, g, b, a)" so we can apply per-layer
 * opacity without disturbing Fabric's `opacity` (which affects ALL child props
 * including stroke). For now we don't actually need this — Fabric.opacity
 * handles the simple case fine. Reserved for Phase 3 color picker.
 */

// ---------------------------------------------------------------------------
// Text layer factory
// ---------------------------------------------------------------------------

function createFabricTextbox(
  layer: TextLayer,
  resolvedText: string,
): Textbox {
  // why: use Textbox (not Text or IText). Textbox supports word-wrap within
  // a fixed `width` AND in-place editing on double-click — both required by
  // the editor UX. Text doesn't wrap; IText wraps but doesn't enforce width.
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
type ImageLoadOutcome = ImageLoadResult | ImageLoadFailure;

async function createFabricImage(
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
    const img = await FabricImage.fromURL(src, {
      crossOrigin: "anonymous",
    });
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

    // why: cornerRadius via clipPath. Fabric doesn't have native rounded-image
    // support, so we attach a Rect clipPath with rx/ry. The clipPath is
    // positioned in the image's local coordinate space (centered at origin
    // when `absolutePositioned: false`), so we use the natural image size
    // for the clip rect dimensions.
    if (layer.cornerRadius > 0) {
      const clip = new Rect({
        width: naturalWidth,
        height: naturalHeight,
        rx: layer.cornerRadius / scaleX,
        ry: layer.cornerRadius / scaleY,
        originX: "center",
        originY: "center",
        absolutePositioned: false,
      });
      img.clipPath = clip;
    }

    setLayerData(img, {
      layerId: layer.id,
      layerKind: "image",
      displayName: layer.name,
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

function createFabricShape(layer: ShapeLayer): FabricObject {
  const common = {
    left: layer.left,
    top: layer.top,
    angle: layer.angle,
    opacity: layer.opacity,
    fill: layer.fill || undefined,
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

// ===========================================================================
// SECTION 3 — CanvasEditor component
// ===========================================================================

interface SelectionState {
  layerId: string | null;
  /** When true, the selection covers multiple objects (Phase 2+ — not selectable in Phase 1 by default). */
  isMulti: boolean;
}

interface LayerEntry {
  id: string;
  name: string;
  kind: CanvasLayer["kind"];
  visible: boolean;
  locked: boolean;
}

interface EditorError {
  kind: "image_load" | "export" | "init";
  message: string;
}

export default function CanvasEditor(props: CanvasEditorProps): JSX.Element {
  const { template, listing, onSave, onClose, saveLabel, isSaving } = props;

  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  // why: separate refs for the DOM <canvas> element and the Fabric Canvas
  // instance. The DOM ref is set by React on mount; the Fabric ref is set
  // inside useEffect once Fabric initializes. Splitting them avoids
  // initialization-order races.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  // why: track export-in-progress separately from React state so the export
  // handler can early-return without a stale-closure issue.
  const isExportingRef = useRef<boolean>(false);

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [selection, setSelection] = useState<SelectionState>({
    layerId: null,
    isMulti: false,
  });
  // why: a version counter that increments whenever Fabric's object list
  // mutates. The layer panel reads from Fabric's getObjects() inside a
  // useMemo keyed off this counter, so the panel re-renders on layer
  // add/remove/visibility-toggle without us managing a parallel state mirror.
  const [layerVersion, setLayerVersion] = useState<number>(0);
  const [editorError, setEditorError] = useState<EditorError | null>(null);
  const [isLocalSaving, setIsLocalSaving] = useState<boolean>(false);

  // -------------------------------------------------------------------------
  // Phase 2 — undo/redo history hook
  // -------------------------------------------------------------------------
  // why: installed at top-level so the hook sees the same fabricRef the
  // canvas init effect populates. The hook auto-attaches Fabric event
  // listeners but stays inert until `history.start()` is called (see init
  // effect below) — that prevents the burst of object:added events during
  // initial template hydration from creating spurious undo entries.
  const history = useUndoRedoHistory(fabricRef);

  // -------------------------------------------------------------------------
  // Schema validation (memo — runs once per template change)
  // -------------------------------------------------------------------------
  // why: invariant check from types.ts — canvas dimensions MUST match the
  // platform's fixed defaults. If a template was authored against the wrong
  // dimensions, we surface the error UP-FRONT rather than letting the user
  // edit on a misshapen canvas and have the export not match social specs.
  const dimensionWarning = useMemo<string | null>(() => {
    const expected = PLATFORM_DIMENSIONS[template.format];
    if (
      template.width !== expected.width ||
      template.height !== expected.height
    ) {
      return `Template "${template.name}" has dimensions ${template.width}×${template.height}, expected ${expected.width}×${expected.height} for ${template.format}.`;
    }
    return null;
  }, [template.format, template.height, template.name, template.width]);

  // -------------------------------------------------------------------------
  // Canvas init effect — runs on mount + when template/listing identity changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    // why: `cancelled` flag protects against late-arriving async work (font
    // loading, image fetches) when the effect has been cleaned up. Without it,
    // we'd be calling .add() on a disposed canvas if the user navigates away
    // mid-load.
    let cancelled = false;

    // why: create the Fabric Canvas synchronously so the dispose cleanup can
    // always find it. Hydration of layers happens in the async IIFE below.
    const fabricCanvas = new Canvas(canvasEl, {
      width: template.width,
      height: template.height,
      backgroundColor:
        template.backgroundColor === "transparent"
          ? undefined
          : template.backgroundColor,
      preserveObjectStacking: true, // why: when an object is selected, don't auto-raise it above others — keeps schema z-order stable.
      selection: true,
      enableRetinaScaling: true, // why: Fabric handles hi-DPI rendering for us at the display layer; export uses our own multiplier.
      controlsAboveOverlay: true,
    });
    fabricRef.current = fabricCanvas;

    // why: wire selection events FIRST so they're armed before any object
    // gets added (in case a template defaults to having an object pre-selected
    // in some future Phase 2 enhancement).
    fabricCanvas.on("selection:created", (e) => {
      const target = e.selected?.[0];
      if (!target) {
        setSelection({ layerId: null, isMulti: false });
        return;
      }
      const data = getLayerData(target);
      setSelection({
        layerId: data?.layerId ?? null,
        isMulti: (e.selected?.length ?? 0) > 1,
      });
    });
    fabricCanvas.on("selection:updated", (e) => {
      const target = e.selected?.[0];
      const data = target ? getLayerData(target) : null;
      setSelection({
        layerId: data?.layerId ?? null,
        isMulti: (e.selected?.length ?? 0) > 1,
      });
    });
    fabricCanvas.on("selection:cleared", () => {
      setSelection({ layerId: null, isMulti: false });
    });

    // why: bump layer version on any object set mutation so the layer panel
    // refreshes. We listen to the broadest set of events that affect layer
    // visibility / ordering / membership.
    const bumpVersion = () => {
      if (cancelled) return;
      setLayerVersion((v) => v + 1);
    };
    fabricCanvas.on("object:added", bumpVersion);
    fabricCanvas.on("object:removed", bumpVersion);
    fabricCanvas.on("object:modified", bumpVersion);

    // why: optional background image. Drawn UNDERNEATH all layers, not in the
    // layer panel (the user can't move/delete the bg from the editor). Loaded
    // with crossOrigin: "anonymous" same as any other image.
    const loadBackground = async (): Promise<void> => {
      if (!template.backgroundImage) return;
      try {
        const bg = await FabricImage.fromURL(template.backgroundImage, {
          crossOrigin: "anonymous",
        });
        if (cancelled || !fabricRef.current) return;
        // why: scale background to cover the canvas regardless of natural size.
        const scaleX = template.width / (bg.width || 1);
        const scaleY = template.height / (bg.height || 1);
        const scale = Math.max(scaleX, scaleY);
        bg.set({
          left: 0,
          top: 0,
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
        });
        // why: Fabric v6 deprecated `setBackgroundImage` in favor of
        // setting backgroundImage directly + calling renderAll.
        fabricRef.current.backgroundImage = bg;
        fabricRef.current.requestRenderAll();
      } catch (err) {
        if (cancelled) return;
        setEditorError({
          kind: "image_load",
          message: `Background image failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    };

    // why: hydrate layers in the order they appear in the schema, then
    // re-sort by z. We can't just push them in z-order because async image
    // loads complete out of order. Two-pass approach: add as they arrive,
    // then call canvas.sendObjectToBack/bringObjectToFront to enforce z.
    const hydrateLayers = async (): Promise<void> => {
      // why: wait for fonts to be ready before drawing text. Otherwise the
      // first frame uses the fallback font and looks wrong until the custom
      // font loads + a re-render is triggered. document.fonts.ready resolves
      // when ALL @font-face declarations have loaded or failed.
      try {
        await document.fonts.ready;
      } catch {
        // why: document.fonts.ready is widely supported but we don't want to
        // block hydration on a browser that doesn't expose it. Worst case:
        // text draws in fallback font once, then re-renders.
      }

      const sortedLayers = [...template.layers].sort((a, b) => a.z - b.z);

      for (const layer of sortedLayers) {
        if (cancelled || !fabricRef.current) return;

        if (isTextLayer(layer)) {
          const resolved = layer.boundField
            ? resolveTextBoundField(layer.boundField, listing)
            : layer.text;
          // why: if the bound field resolves to empty, fall back to the
          // template's literal `text` value so the canvas still shows
          // something sensible. The user can edit/delete after.
          const tb = createFabricTextbox(
            layer,
            resolved.trim() || layer.text,
          );
          fabricRef.current.add(tb);
        } else if (isImageLayer(layer)) {
          const resolved = layer.boundField
            ? resolveImageBoundField(layer.boundField, listing)
            : layer.src;
          const outcome = await createFabricImage(layer, resolved);
          if (cancelled || !fabricRef.current) return;
          if (outcome.ok) {
            fabricRef.current.add(outcome.image);
          } else {
            // why: image load failed — add a placeholder Rect with a dashed
            // outline at the layer's intended position, so the user sees
            // there WAS supposed to be an image here and can swap it in
            // Phase 4 (uploads/photos panels). Better UX than silently
            // dropping the layer.
            const placeholder = new Rect({
              left: layer.left,
              top: layer.top,
              width: layer.width,
              height: layer.height,
              fill: "rgba(201, 169, 97, 0.08)", // gold-500 at 8% alpha
              stroke: "#C9A961",
              strokeWidth: 2,
              strokeDashArray: [8, 6],
              rx: layer.cornerRadius,
              ry: layer.cornerRadius,
              selectable: !layer.locked,
              cornerStyle: "circle",
              cornerSize: 10,
              transparentCorners: false,
              borderColor: "#C9A961",
              cornerColor: "#C9A961",
            });
            setLayerData(placeholder, {
              layerId: layer.id,
              layerKind: "image",
              displayName: `${layer.name} (no image)`,
            });
            fabricRef.current.add(placeholder);
            // why: only surface CORS errors. Missing-photo (no_src) is a
            // normal data state, not an error. Generic load_error is shown
            // as a non-blocking warning.
            if (outcome.reason === "cors_blocked") {
              setEditorError({
                kind: "image_load",
                message: outcome.message,
              });
            }
          }
        } else if (isShapeLayer(layer)) {
          const shape = createFabricShape(layer);
          fabricRef.current.add(shape);
        }
        // why: GroupLayer is reserved — skip silently in Phase 1. Schema
        // validation upstream (Phase 2 templates panel) prevents authored
        // templates from including groups until the implementation lands.
      }

      if (cancelled || !fabricRef.current) return;
      fabricRef.current.requestRenderAll();
      // why: prime the layer panel with the freshly added objects.
      setLayerVersion((v) => v + 1);
      // why: Phase 2 — activate the undo/redo auto-snapshot now that the
      // canvas holds its hydrated baseline. Before this call, the history
      // hook ignores Fabric events; after this call, every debounced
      // mutation becomes a real undo step. Idempotent — extra calls no-op.
      history.start();
    };

    void loadBackground();
    void hydrateLayers();

    return () => {
      cancelled = true;
      // why: Fabric v6 dispose() returns Promise<boolean>. React effect
      // cleanup is sync, so we kick it off and ignore the result. Safe
      // because no subsequent code references the canvas after this point —
      // the ref is nulled below before any new effect can touch it.
      const dyingCanvas = fabricRef.current;
      fabricRef.current = null;
      if (dyingCanvas) {
        // why: remove our listeners before dispose to avoid any final-frame
        // bumpVersion calls into a stale React tree.
        dyingCanvas.off();
        // why: dispose returns a promise; we don't await but we DO catch
        // the rejection to keep dev consoles clean. A failed dispose is
        // not actionable in user-space.
        dyingCanvas.dispose().catch(() => {});
      }
    };
    // why: include only identity fields in deps. Including the full template
    // object would re-init the canvas on every parent re-render (since most
    // parents pass a new object reference each render). The id pair is
    // sufficient for "should we recreate the canvas".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, listing.id]);

  // -------------------------------------------------------------------------
  // Layer panel data — derived from Fabric on each layerVersion bump
  // -------------------------------------------------------------------------
  const layerEntries = useMemo<LayerEntry[]>(() => {
    const canvas = fabricRef.current;
    if (!canvas) return [];
    // why: getObjects returns in stacking order (bottom to top). The layer
    // panel convention is "top of list = top of stack" (Photoshop / Canva
    // standard), so we reverse.
    return canvas
      .getObjects()
      .slice()
      .reverse()
      .map((obj): LayerEntry | null => {
        const data = getLayerData(obj);
        if (!data) return null;
        return {
          id: data.layerId,
          name: data.displayName,
          kind: data.layerKind,
          visible: obj.visible !== false,
          locked: obj.selectable === false,
        };
      })
      .filter((entry): entry is LayerEntry => entry !== null);
    // why: layerVersion in deps — getObjects() output isn't itself reactive;
    // we re-derive whenever Fabric emits an add/remove/modify event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerVersion]);

  // -------------------------------------------------------------------------
  // Selection-driven action handlers
  // -------------------------------------------------------------------------
  const getObjectByLayerId = useCallback(
    (layerId: string | null): FabricObject | null => {
      if (!layerId || !fabricRef.current) return null;
      const match = fabricRef.current
        .getObjects()
        .find((obj) => getLayerData(obj)?.layerId === layerId);
      return match ?? null;
    },
    [],
  );

  const handleDeleteSelection = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;
    active.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, []);

  const handleBringForward = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    // why: Fabric v6 method names. bringObjectForward moves one step toward
    // the top; bringObjectToFront jumps to the very top. We bind the toolbar
    // button to one-step-forward to match Canva's behavior.
    canvas.bringObjectForward(active);
    canvas.requestRenderAll();
    setLayerVersion((v) => v + 1);
  }, []);

  const handleSendBackward = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    canvas.sendObjectBackwards(active);
    canvas.requestRenderAll();
    setLayerVersion((v) => v + 1);
  }, []);

  const handleToggleLock = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    const newLocked = active.selectable !== false; // currently selectable → going to lock
    active.set({
      selectable: !newLocked,
      evented: !newLocked,
      lockMovementX: newLocked,
      lockMovementY: newLocked,
      lockScalingX: newLocked,
      lockScalingY: newLocked,
      lockRotation: newLocked,
    });
    // why: discard selection if we just locked the active object, so the user
    // can't keep editing through the lock state. They click again to re-select
    // (which is still possible if evented stays true, but we've turned that
    // off above). To re-edit, they unlock via the layer panel.
    if (newLocked) canvas.discardActiveObject();
    canvas.requestRenderAll();
    setLayerVersion((v) => v + 1);
  }, []);

  const handleDuplicateSelection = useCallback(async (): Promise<void> => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    // why: Fabric v6 clone is async (returns Promise) for Image and Group
    // because they may need to re-fetch source data. Use it for everything
    // for consistency.
    const cloned = await active.clone(["data"]);
    cloned.set({
      left: (active.left ?? 0) + 20,
      top: (active.top ?? 0) + 20,
    });
    // why: regenerate layer id on the clone so the layer panel treats it as a
    // distinct entry. The displayName gets a "(copy)" suffix for clarity.
    const data = getLayerData(active);
    if (data) {
      setLayerData(cloned, {
        layerId: `${data.layerId}_copy_${Date.now()}`,
        layerKind: data.layerKind,
        displayName: `${data.displayName} (copy)`,
      });
    }
    canvas.add(cloned);
    canvas.setActiveObject(cloned);
    canvas.requestRenderAll();
  }, []);

  // -------------------------------------------------------------------------
  // Layer panel handlers
  // -------------------------------------------------------------------------
  const handleSelectLayer = useCallback(
    (layerId: string): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const obj = getObjectByLayerId(layerId);
      if (!obj) return;
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
    },
    [getObjectByLayerId],
  );

  const handleToggleLayerVisibility = useCallback(
    (layerId: string): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const obj = getObjectByLayerId(layerId);
      if (!obj) return;
      obj.visible = obj.visible === false ? true : false;
      canvas.requestRenderAll();
      setLayerVersion((v) => v + 1);
    },
    [getObjectByLayerId],
  );

  const handleDeleteLayer = useCallback(
    (layerId: string): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const obj = getObjectByLayerId(layerId);
      if (!obj) return;
      canvas.remove(obj);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    },
    [getObjectByLayerId],
  );

  // -------------------------------------------------------------------------
  // Phase 2 — handlers for the new panels (LayerListPanel, AddLayerToolbar,
  // SelectionPropertiesPanel)
  // -------------------------------------------------------------------------

  // why: receives the new top-of-stack-first ID order from LayerListPanel and
  // applies it to Fabric by moving each object to its target stacking index.
  // We reverse first because Fabric's stacking is bottom-first whereas the
  // panel reports top-first (Photoshop convention). moveObjectTo is the v6
  // API for absolute repositioning.
  const handleReorderLayers = useCallback(
    (topFirstIds: string[]): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const bottomFirst = [...topFirstIds].reverse();
      bottomFirst.forEach((id, targetIndex) => {
        const obj = canvas
          .getObjects()
          .find((o) => getLayerData(o)?.layerId === id);
        if (obj) canvas.moveObjectTo(obj, targetIndex);
      });
      canvas.requestRenderAll();
      setLayerVersion((v) => v + 1);
      history.record();
    },
    [history],
  );

  // why: AddLayerToolbar fires this after it adds a new object. We bump the
  // layer panel and select the new layer so the user lands directly in
  // "edit this fresh layer" mode.
  const handleLayerAdded = useCallback(
    (newObj: FabricObject): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.setActiveObject(newObj);
      canvas.requestRenderAll();
      setLayerVersion((v) => v + 1);
    },
    [],
  );

  // why: SelectionPropertiesPanel's "Back to layers" button calls this so the
  // orchestrator can swap the right-side panel back to LayerListPanel.
  const handleClearSelection = useCallback((): void => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setSelection({ layerId: null, isMulti: false });
  }, []);

  // -------------------------------------------------------------------------
  // Export handler — the whole point of Phase 1
  // -------------------------------------------------------------------------
  const handleExport = useCallback(async (): Promise<void> => {
    if (isExportingRef.current) return;
    const canvas = fabricRef.current;
    if (!canvas) return;

    isExportingRef.current = true;
    setIsLocalSaving(true);
    setEditorError(null);
    try {
      // why: discard the active selection BEFORE export so the selection
      // bounding-box artwork (corners, dashed border) doesn't bleed into the
      // PNG. We restore selection state implicitly — the user can re-select
      // after a successful save.
      canvas.discardActiveObject();
      canvas.requestRenderAll();

      // why: toDataURL with multiplier:2 produces a retina-quality PNG at
      // double the canvas's display resolution (2160×2160 from a 1080×1080
      // logical canvas). Social platforms re-compress on upload so this
      // gives them maximum headroom.
      let dataUrl: string;
      try {
        dataUrl = canvas.toDataURL({
          format: "png",
          multiplier: EXPORT_RESOLUTION_MULTIPLIER,
          enableRetinaScaling: false, // why: we control retina via multiplier — don't double-up.
        });
      } catch (err) {
        // why: tainted canvas surfaces as SecurityError on toDataURL. This is
        // the failure mode we MUST handle explicitly because it means a
        // third-party image (likely a non-CORS MLS photo host) tainted the
        // canvas at load time. The fix is server-side (proxy through our own
        // CORS-correct endpoint), not client-side.
        const message =
          err instanceof Error ? err.message : String(err);
        const isSecurityError =
          err instanceof Error && err.name === "SecurityError";
        throw new Error(
          isSecurityError
            ? `Export blocked: a layer image is not CORS-safe and tainted the canvas. Re-upload through Supabase Storage or use a CORS-enabled proxy. (${message})`
            : `Export failed: ${message}`,
        );
      }

      // why: dataURL → Blob → File. We can't use the Canvas.toBlob() API
      // because Fabric's toDataURL gives us the multiplier-aware bytes, but
      // converting via fetch(dataUrl).then(r=>r.blob()) is the cleanest path
      // that respects the multiplier we just applied.
      const blob = await (await fetch(dataUrl)).blob();
      const filename = `${template.id}_${Date.now()}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      const exportResult: CanvasExportResult = {
        file,
        dataUrl,
        // why: in Phase 1 we return the ORIGINAL hydrated schema, not the
        // user's edits. The Fabric→schema serializer lands in Phase 2 so the
        // parent can persist the editable source. For now, the rendered PNG
        // is the artifact of record.
        // TODO(phase-2): serialize current Fabric state back to schema here.
        schema: template,
        width: template.width * EXPORT_RESOLUTION_MULTIPLIER,
        height: template.height * EXPORT_RESOLUTION_MULTIPLIER,
        mimeType: "image/png",
      };

      // why: await the parent's onSave so we can surface upload failures.
      // If onSave is sync (returns void, not Promise), `await` is a no-op.
      await Promise.resolve(onSave(exportResult));
    } catch (err) {
      setEditorError({
        kind: "export",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      isExportingRef.current = false;
      setIsLocalSaving(false);
    }
  }, [onSave, template]);

  // -------------------------------------------------------------------------
  // Display-scale calculation for the canvas viewport
  // -------------------------------------------------------------------------
  // why: the canvas is 1080×1080 (or larger) logical pixels — way too big for
  // a typical viewport. We scale the WRAPPER via CSS transform, not Fabric's
  // internal zoom, so toDataURL still emits at full logical resolution.
  // Computed from the canvas's intrinsic dimensions vs an assumed available
  // viewport. Phase 2 will replace this with a ResizeObserver-driven fit.
  const displayScale = useMemo<number>(() => {
    // why: target a 720px max display height (leaves room for top header +
    // bottom controls in a ~1080px viewport). Width is bounded by the right
    // layer panel + future left toolbar, so we use 880px max display width.
    const maxDisplayWidth = 880;
    const maxDisplayHeight = 720;
    const scaleW = maxDisplayWidth / template.width;
    const scaleH = maxDisplayHeight / template.height;
    return Math.min(scaleW, scaleH, 1);
  }, [template.width, template.height]);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts — Delete, Backspace, Cmd+D
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      // why: if the user is editing text inside a Textbox (Fabric's IText
      // editing mode), the keystrokes belong to the text input, not our
      // shortcut handler. Bail out.
      const active = canvas.getActiveObject();
      if (active && (active as { isEditing?: boolean }).isEditing) return;

      // why: ignore shortcuts while focus is in a real form input — the layer
      // panel will eventually have a rename input.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (canvas.getActiveObjects().length > 0) {
          e.preventDefault();
          handleDeleteSelection();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        if (canvas.getActiveObject()) {
          e.preventDefault();
          void handleDuplicateSelection();
        }
      } else {
        // why: Phase 2 — delegate Cmd+Z/Cmd+Shift+Z (undo/redo) and arrow-key
        // nudging to Agent B's handler. It returns true if it consumed the
        // event (the helper internally calls e.preventDefault when needed).
        handlePhase2KeyDown(e, {
          canvas,
          history,
          onCanvasMutated: () => setLayerVersion((v) => v + 1),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleDeleteSelection, handleDuplicateSelection, history]);

  // -------------------------------------------------------------------------
  // Selected-layer-derived computed values for the toolbar
  // -------------------------------------------------------------------------
  const selectedEntry = useMemo<LayerEntry | null>(() => {
    if (!selection.layerId) return null;
    return layerEntries.find((l) => l.id === selection.layerId) ?? null;
  }, [layerEntries, selection.layerId]);

  // why: Phase 2 — derive SelectionMode from selection + entry kind. Drives
  // which panel renders on the right side: "none" → LayerListPanel,
  // "text"/"image"/"shape" → SelectionPropertiesPanel with that mode,
  // "multi" → SelectionPropertiesPanel with multi stub.
  const selectionMode = useMemo<SelectionMode>(() => {
    if (selection.isMulti) return "multi";
    if (!selectedEntry) return "none";
    if (selectedEntry.kind === "text") return "text";
    if (selectedEntry.kind === "image") return "image";
    if (selectedEntry.kind === "shape") return "shape";
    return "none";
  }, [selection.isMulti, selectedEntry]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const effectiveSaving = isSaving || isLocalSaving;

  return (
    <div className="flex h-full w-full flex-col bg-neutral-50">
      {/* ----- Header ----- */}
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3 shadow-card">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-neutral-900">
            {template.name}
          </span>
          <span className="truncate text-xs text-neutral-500">
            {listing.addressLine1 ?? listing.mlsNumber} · {template.width}×
            {template.height}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={effectiveSaving || dimensionWarning !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white shadow-card transition-colors hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {effectiveSaving ? (
              <span className="flex items-center gap-2">
                <SpinnerIcon />
                Saving…
              </span>
            ) : (
              <>
                <SaveIcon />
                {saveLabel ?? "Save Post"}
              </>
            )}
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close editor"
              className="rounded-lg border border-neutral-200 bg-white p-2 text-neutral-600 hover:bg-neutral-50"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </header>

      {/* ----- Body ----- */}
      <div className="flex min-h-0 flex-1">
        {/* Canvas area */}
        <div className="relative flex flex-1 flex-col items-center justify-center overflow-auto bg-neutral-100 p-6">
          {/* Phase 2 — Add Layer Toolbar (always visible, top of canvas area).
              why: primary creation affordance — adding text/shape layers is
              one of the top-3 things Larissa will do once Phase 2 ships. */}
          <div className="mb-4 flex w-full justify-center">
            <AddLayerToolbar
              canvas={fabricRef.current}
              listing={listing}
              onLayerAdded={handleLayerAdded}
              recordHistory={history.record}
            />
          </div>
          {/* Selection toolbar — floats above the canvas when something is selected */}
          {selectedEntry && !selectedEntry.locked ? (
            <SelectionToolbar
              onDelete={handleDeleteSelection}
              onBringForward={handleBringForward}
              onSendBackward={handleSendBackward}
              onToggleLock={handleToggleLock}
              onDuplicate={() => void handleDuplicateSelection()}
              layerName={selectedEntry.name}
              layerKind={selectedEntry.kind}
              canvas={fabricRef.current}
              selectionVersion={layerVersion}
              onOpacityCommit={history.record}
              onCanvasMutated={() => setLayerVersion((v) => v + 1)}
            />
          ) : null}

          {/* Dimension warning — blocks export when template is malformed */}
          {dimensionWarning ? (
            <div className="absolute left-1/2 top-6 z-20 -translate-x-1/2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 shadow-card">
              {dimensionWarning}
            </div>
          ) : null}

          {/* Non-blocking error toast */}
          {editorError ? (
            <div className="absolute bottom-6 left-1/2 z-20 max-w-[80%] -translate-x-1/2 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-700 shadow-elevated">
              <div className="flex items-start gap-3">
                <span className="font-semibold uppercase tracking-wide">
                  {editorError.kind === "export" ? "Export" : "Warning"}
                </span>
                <span className="flex-1">{editorError.message}</span>
                <button
                  type="button"
                  onClick={() => setEditorError(null)}
                  aria-label="Dismiss error"
                  className="text-neutral-400 hover:text-neutral-700"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
          ) : null}

          {/* The actual canvas, scaled via CSS transform */}
          <div
            className="relative bg-white shadow-elevated"
            style={{
              width: template.width * displayScale,
              height: template.height * displayScale,
            }}
          >
            <div
              style={{
                width: template.width,
                height: template.height,
                transform: `scale(${displayScale})`,
                transformOrigin: "top left",
                position: "absolute",
                top: 0,
                left: 0,
              }}
            >
              <canvas ref={canvasRef} />
            </div>
          </div>
        </div>

        {/* Right-side panel — mode-switches between selection properties and
            the layer list. Phase 2 split: when something is selected, show
            Agent A's SelectionPropertiesPanel; otherwise show Agent C's
            drag-reorderable LayerListPanel. */}
        {selectionMode === "none" ? (
          <LayerListPanel
            entries={layerEntries}
            selectedLayerId={selection.layerId}
            onSelect={handleSelectLayer}
            onToggleVisibility={handleToggleLayerVisibility}
            onDelete={handleDeleteLayer}
            onReorder={handleReorderLayers}
          />
        ) : (
          <SelectionPropertiesPanel
            mode={selectionMode}
            canvas={fabricRef.current}
            listing={listing}
            selectionVersion={layerVersion}
            onCanvasMutated={() => setLayerVersion((v) => v + 1)}
            onClearSelection={handleClearSelection}
            recordHistory={history.record}
          />
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// SECTION 4 — Subcomponents
// ===========================================================================

interface SelectionToolbarProps {
  onDelete: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  layerName: string;
  layerKind: CanvasLayer["kind"];
  /** Canvas instance — used by the Transparency popover to read/write opacity. */
  canvas: Canvas | null;
  /** Forces the transparency popover to re-read opacity when the parent's selection state changes. */
  selectionVersion: number;
  /** Called once after the user releases the opacity slider so the undo stack captures one entry instead of dozens. */
  onOpacityCommit?: () => void;
  /** Called whenever opacity mutates so the layer panel / version counter refresh. */
  onCanvasMutated?: () => void;
}

function SelectionToolbar(props: SelectionToolbarProps): JSX.Element {
  return (
    <div className="absolute top-6 z-10 flex items-center gap-1 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 shadow-elevated animate-fade-in-up">
      <span className="ml-2 mr-3 truncate text-xs font-medium text-neutral-600">
        {props.layerName}
      </span>
      <span className="h-5 w-px bg-neutral-200" />
      <IconButton label="Bring forward" onClick={props.onBringForward}>
        <BringForwardIcon />
      </IconButton>
      <IconButton label="Send backward" onClick={props.onSendBackward}>
        <SendBackwardIcon />
      </IconButton>
      <span className="h-5 w-px bg-neutral-200" />
      <IconButton label="Duplicate" onClick={props.onDuplicate}>
        <DuplicateIcon />
      </IconButton>
      {/* === Transparency — opens a portaled popover with an opacity slider.
          why: matches Canva's selection-toolbar pattern; quick access without
          having to navigate into the right-side properties panel. */}
      <TransparencyButton
        canvas={props.canvas}
        selectionVersion={props.selectionVersion}
        onCanvasMutated={props.onCanvasMutated}
        onCommit={props.onOpacityCommit}
      />
      <IconButton label="Lock" onClick={props.onToggleLock}>
        <LockIcon />
      </IconButton>
      <span className="h-5 w-px bg-neutral-200" />
      <IconButton label="Delete" onClick={props.onDelete} variant="danger">
        <TrashIcon />
      </IconButton>
    </div>
  );
}

// ===========================================================================
// TransparencyButton — toolbar trigger + portaled popover with opacity slider
// ===========================================================================
//
// Why a separate subcomponent rather than inline:
//   • Owns the open/close state + the popover's getBoundingClientRect math
//     locally; SelectionToolbar stays presentational.
//   • Uses the same Portal + position:fixed pattern as the ColorPicker —
//     escapes the canvas's transform-stacking context so the popover paints
//     above the canvas instead of behind it.
//
// Fabric's opacity is a 0..1 float. The UI works in 0..100 (percent) because
// that's how Canva does it and how the user thinks about it.

interface TransparencyButtonProps {
  canvas: Canvas | null;
  selectionVersion: number;
  onCanvasMutated?: () => void;
  onCommit?: () => void;
}

function TransparencyButton(
  props: TransparencyButtonProps,
): JSX.Element {
  const { canvas, selectionVersion, onCanvasMutated, onCommit } = props;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // why: read the active object's opacity each time the selection or version
  // changes. If the user changes selection while the popover is open, the
  // slider snaps to the new layer's value instead of stale state.
  const initialOpacity = useMemo<number>(() => {
    if (!canvas) return 100;
    const active = canvas.getActiveObject();
    if (!active) return 100;
    const raw = active.opacity;
    if (typeof raw !== "number") return 100;
    return Math.round(raw * 100);
  }, [canvas, selectionVersion, open]);

  const [opacityPct, setOpacityPct] = useState<number>(initialOpacity);
  useEffect(() => {
    setOpacityPct(initialOpacity);
  }, [initialOpacity]);

  // Position popover under the trigger button — viewport-clamped.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPopoverPos(null);
      return;
    }
    const POPOVER_WIDTH = 240;
    const GAP = 8;
    const rect = triggerRef.current.getBoundingClientRect();
    const top = rect.bottom + GAP;
    // Center the popover horizontally on the trigger button.
    let left =
      rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
    if (left < GAP) left = GAP;
    const maxLeft = window.innerWidth - POPOVER_WIDTH - GAP;
    if (left > maxLeft) left = maxLeft;
    setPopoverPos({ top, left });
  }, [open]);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const pct = Number(e.target.value);
    if (!Number.isFinite(pct)) return;
    setOpacityPct(pct);
    const active = canvas?.getActiveObject();
    if (!active) return;
    // why: write through directly on every tick for live preview. The
    // history snapshot fires onMouseUp via onCommit — keeps undo stack
    // clean (one entry per gesture, not 100 per slider drag).
    active.set({ opacity: pct / 100 });
    canvas?.requestRenderAll();
    onCanvasMutated?.();
  };

  const handleSliderCommit = (): void => {
    onCommit?.();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Transparency"
        title="Transparency"
        className={`rounded-md p-1.5 transition-colors ${
          open
            ? "bg-gold-50 text-gold-700"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        }`}
      >
        <TransparencyIcon />
      </button>
      {open && popoverPos
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                top: popoverPos.top,
                left: popoverPos.left,
                width: 240,
              }}
              className="z-[100] rounded-xl border border-neutral-200 bg-white p-3 shadow-elevated animate-fade-in-up"
              role="dialog"
              aria-label="Transparency"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Transparency
                </span>
                <span className="font-mono text-xs text-neutral-700">
                  {opacityPct}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={opacityPct}
                onChange={handleSliderChange}
                onMouseUp={handleSliderCommit}
                onTouchEnd={handleSliderCommit}
                onKeyUp={handleSliderCommit}
                className="w-full accent-gold-500"
                aria-label="Opacity 0 to 100 percent"
              />
              <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function TransparencyIcon(): JSX.Element {
  // why: classic checkerboard pattern signifying "transparency" — same
  // visual language as Canva, Figma, Photoshop's transparency indicator.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <rect x="3" y="3" width="2.5" height="2.5" fill="currentColor" />
      <rect x="8" y="3" width="2.5" height="2.5" fill="currentColor" />
      <rect x="5.5" y="5.5" width="2.5" height="2.5" fill="currentColor" />
      <rect x="10.5" y="5.5" width="2.5" height="2.5" fill="currentColor" />
      <rect x="3" y="8" width="2.5" height="2.5" fill="currentColor" />
      <rect x="8" y="8" width="2.5" height="2.5" fill="currentColor" />
      <rect x="5.5" y="10.5" width="2.5" height="2.5" fill="currentColor" />
      <rect x="10.5" y="10.5" width="2.5" height="2.5" fill="currentColor" />
    </svg>
  );
}

// why: the inline LayerPanel was removed in Phase 2 — replaced by
// ./panels/LayerListPanel.tsx (Agent C) which adds drag-to-reorder via
// @dnd-kit/sortable while preserving all the original row interactions.

interface IconButtonProps {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  children: React.ReactNode;
}

function IconButton(props: IconButtonProps): JSX.Element {
  const danger = props.variant === "danger";
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
      className={`rounded-md p-1.5 transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-50"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      }`}
    >
      {props.children}
    </button>
  );
}

function LayerKindIcon({ kind }: { kind: CanvasLayer["kind"] }): JSX.Element {
  // why: visual cue in the layer panel so the user can scan kind at a glance.
  // Tiny 14px SVGs match the panel's row height without adding visual noise.
  switch (kind) {
    case "text":
      return <TextIcon />;
    case "image":
      return <ImageIcon />;
    case "shape":
      return <ShapeIcon />;
    case "group":
      return <GroupIcon />;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// ===========================================================================
// SECTION 5 — Inline SVG icons
// ===========================================================================
//
// Why inline SVG instead of a lib like lucide:
//   • lucide-react isn't installed in this project (verified at build time).
//   • Adding a 50KB icon dependency just for Phase 1 isn't justified — Phase 4
//     (Brand panel + Uploads panel) is where icon variety actually matters.
//     If/when we add lucide, replace these. The interfaces won't change.
//   • These icons use currentColor so they inherit text color from Tailwind
//     classes on the parent — no per-icon color prop needed.
//
// All icons follow the Heroicons-mini conventions: 16×16 viewBox, 1.5 stroke.
// ---------------------------------------------------------------------------

function CloseIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

function SaveIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3h7l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M5 3v4h5V3" />
      <path d="M5 11h6" />
    </svg>
  );
}

function SpinnerIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.25"
        fill="none"
      />
      <path
        d="M14 8a6 6 0 0 1-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1L11 4" />
    </svg>
  );
}

function BringForwardIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="5" y="2" width="9" height="9" rx="1" />
      <rect
        x="2"
        y="5"
        width="9"
        height="9"
        rx="1"
        fill="white"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendBackwardIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="9" height="9" rx="1" />
      <rect
        x="5"
        y="2"
        width="9"
        height="9"
        rx="1"
        fill="white"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DuplicateIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="5" y="2" width="9" height="9" rx="1" />
      <path d="M3 5v8a1 1 0 0 0 1 1h7" />
    </svg>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function EyeIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5S1 8 1 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeOffIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 2l12 12" />
      <path d="M6.5 6.5A2 2 0 0 0 8 10a2 2 0 0 0 1.5-.6" />
      <path d="M3 8s1-2 3-3.5M13 8s-1 2-3 3.5M1 8s2.5-5 7-5c1 0 1.9.2 2.7.5" />
    </svg>
  );
}

function TextIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 4V3h10v1M8 3v10M6 13h4" />
    </svg>
  );
}

function ImageIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="6" cy="7" r="1" />
      <path d="M3 12l3-3 2 2 3-4 4 5" />
    </svg>
  );
}

function ShapeIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" />
      <circle cx="11" cy="11" r="3" />
    </svg>
  );
}

function GroupIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <rect x="6" y="6" width="8" height="8" rx="1" />
    </svg>
  );
}
