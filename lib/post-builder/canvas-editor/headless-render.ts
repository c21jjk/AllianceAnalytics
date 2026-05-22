"use client";

/**
 * Headless schema-to-Fabric renderer for DB-defined templates.
 *
 * This is the bridge that makes admin-authored `template_definitions` rows
 * actually render to PNG. It walks a `CanvasTemplateSchema`, builds Fabric
 * objects, binds them to MLS listing data, and returns the canvas — at
 * which point a caller can either `toDataURL()` (in-browser) or rely on
 * Chromium taking a screenshot (server-side render pipeline).
 *
 * INTENTIONAL DUPLICATION:
 *   The factory logic here mirrors helpers in CanvasEditor.tsx
 *   (`createFabricTextbox`, `createFabricImage`, `createFabricShape`,
 *   `resolveTextBoundField`, `resolveImageBoundField`,
 *   `fabricGradientFromFill`). Keeping them separate makes the editor +
 *   the renderer independent — the editor's helpers carry editor-only
 *   concerns (selectable, locked, corner controls) that don't apply to a
 *   StaticCanvas. The downside is visual drift risk if someone changes
 *   one and forgets the other.
 *
 *   How to keep them in sync:
 *     • When you change a Fabric construction property in CanvasEditor's
 *       factories, search for the same prop here and apply the same
 *       change. The factories are intentionally aligned name-for-name.
 *     • If you add a new layer kind to types.ts, add a branch both here
 *       and in CanvasEditor.tsx's hydrateLayers().
 *
 * Why this lives under canvas-editor/ (not under template-builder/):
 *   The renderer must produce visually-identical output to what the
 *   admin sees in the editor. Co-locating both code paths under one
 *   module makes it obvious which files share invariants. A
 *   template-builder layer above this just drives it.
 */

import {
  Canvas,
  Circle,
  Ellipse,
  FabricImage,
  Gradient,
  Line,
  Rect,
  Textbox,
} from "fabric";
import type { FabricObject } from "fabric";
import {
  isImageLayer,
  isShapeLayer,
  isTextLayer,
  type CanvasTemplateSchema,
  type GradientFill,
  type ImageBoundField,
  type ImageLayer,
  type MLSListingPayload,
  type ShapeLayer,
  type TextBoundField,
  type TextLayer,
} from "./types";
import { textEffectToFabricProps } from "./textEffects";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HeadlessRenderOptions {
  /** The schema to hydrate. */
  schema: CanvasTemplateSchema;
  /** Listing payload to resolve bound fields against. */
  listing: MLSListingPayload;
  /** Existing <canvas> element to bind Fabric to. Caller is responsible for
   *  sizing the element to schema.width × schema.height before invoking. */
  canvasEl: HTMLCanvasElement;
}

export interface HeadlessRenderResult {
  /** The hydrated Fabric Canvas. Caller can toDataURL() or screenshot via
   *  the surrounding DOM. */
  canvas: Canvas;
  /** Per-layer load outcomes — failures are not thrown so a single bad
   *  image doesn't block the render. Inspect for diagnostics. */
  warnings: string[];
}

/**
 * Render a schema into a Fabric canvas bound to the supplied element.
 * Resolves once every layer has been added and Fabric has rendered the
 * first frame. Awaits document.fonts.ready up to 5s so custom fonts draw
 * on the first frame (the screenshot pipeline depends on this).
 *
 * Pure side-effect-free API: the caller owns the canvas element and
 * decides what to do with the rendered output.
 */
export async function renderSchemaHeadless(
  opts: HeadlessRenderOptions,
): Promise<HeadlessRenderResult> {
  const { schema, listing, canvasEl } = opts;
  const warnings: string[] = [];

  // Build the Fabric canvas at logical (unmultiplied) dimensions. The
  // screenshot pipeline grabs the page at exactly these dims, so a 1:1
  // mapping keeps the math trivial.
  const canvas = new Canvas(canvasEl, {
    width: schema.width,
    height: schema.height,
    backgroundColor: schema.backgroundColor || "#FFFFFF",
    // Static + non-interactive — this is a render-only canvas. Skips
    // event registration which speeds up cold load.
    selection: false,
    renderOnAddRemove: false,
  });

  // Wait for fonts so the first frame uses the custom typeface. The
  // chromium pipeline ALSO waits for fonts.ready before screenshotting,
  // so this is a belt-and-suspenders gate against text drawing in
  // fallback font.
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("font-timeout")), 5_000),
      ),
    ]);
  } catch {
    warnings.push("font-timeout (drew in fallback font)");
  }

  // Sort layers by z so we add bottom-up — Fabric stacks by add-order on
  // a non-event canvas.
  const sortedLayers = [...schema.layers].sort((a, b) => a.z - b.z);

  for (const layer of sortedLayers) {
    if (layer.kind === "group") {
      // Group is reserved (see types.ts); skip silently.
      warnings.push(`skipped group layer ${layer.id} (not implemented)`);
      continue;
    }
    if (!layer.visible) {
      // why: invisible layers DO get added to the editor's canvas with
      // `visible: false` so toggling them in the layer panel works. For a
      // render-only canvas, skip them entirely.
      continue;
    }

    if (isTextLayer(layer)) {
      const resolved = layer.boundField
        ? resolveTextBoundField(layer.boundField, listing).trim() || layer.text
        : layer.text;
      const tb = createFabricTextbox(layer, resolved);
      canvas.add(tb);
    } else if (isImageLayer(layer)) {
      const resolvedSrc = layer.boundField
        ? resolveImageBoundField(layer.boundField, listing)
        : layer.src;
      const outcome = await createFabricImage(layer, resolvedSrc);
      if (outcome.ok) {
        canvas.add(outcome.image);
      } else {
        warnings.push(`image ${layer.id}: ${outcome.message}`);
        // Drop the layer rather than emit a placeholder — the render path
        // wants a clean output, not an editor-style "missing image" rect.
      }
    } else if (isShapeLayer(layer)) {
      canvas.add(createFabricShape(layer));
    }
  }

  canvas.requestRenderAll();
  // Force a single render tick so toDataURL/screenshot sees the result.
  canvas.renderAll();

  return { canvas, warnings };
}

// ---------------------------------------------------------------------------
// Bound-field resolvers — mirrors CanvasEditor.tsx
// ---------------------------------------------------------------------------

/** Local copy of the editor's status-label map. Keep in sync with
 *  STATUS_LABEL_MAP near the top of CanvasEditor.tsx — same key set,
 *  same labels. */
const STATUS_LABEL_MAP: Record<MLSListingPayload["status"], string> = {
  active: "JUST LISTED",
  pending: "UNDER CONTRACT",
  sold: "JUST SOLD",
  expired: "OFF MARKET",
  coming_soon: "COMING SOON",
};

function formatPriceUSD(price: number | null): string {
  if (price == null || !Number.isFinite(price)) return "";
  return `$${Math.round(price).toLocaleString("en-US")}`;
}

function formatBedsBaths(
  beds: number | null,
  full: number | null,
  half: number | null,
): string {
  const parts: string[] = [];
  if (typeof beds === "number" && beds > 0) parts.push(`${beds} BR`);
  const totalBaths =
    (typeof full === "number" ? full : 0) +
    (typeof half === "number" ? half * 0.5 : 0);
  if (totalBaths > 0) {
    const label = Number.isInteger(totalBaths)
      ? `${totalBaths}`
      : totalBaths.toFixed(1);
    parts.push(`${label} BA`);
  }
  return parts.join(" / ");
}

function formatOpenHouseDate(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
  } catch {
    return "";
  }
}

function formatOpenHouseTimeRange(
  startIso: string | null,
  endIso: string | null,
): string {
  if (!startIso) return "";
  try {
    const start = new Date(startIso);
    const startTime = start.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
    if (!endIso) return startTime;
    const end = new Date(endIso);
    const endTime = end.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
    return `${startTime} – ${endTime}`;
  } catch {
    return "";
  }
}

function resolveTextBoundField(
  field: TextBoundField,
  listing: MLSListingPayload,
): string {
  switch (field) {
    case "price":
      return formatPriceUSD(listing.priceList);
    case "close_price":
      return formatPriceUSD(listing.priceClose);
    case "address_line1":
      return listing.addressLine1 ?? "";
    case "city_state_zip": {
      const parts = [listing.city, listing.state, listing.zip].filter(
        (p): p is string => Boolean(p),
      );
      if (parts.length < 2) return parts.join(" ");
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
      return formatBedsBaths(listing.beds, listing.bathsFull, listing.bathsHalf);
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
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

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
      return "/brand/c21-mark.svg";
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Layer factories — mirrors CanvasEditor.tsx createFabric* functions.
// Text-effect translation is shared via textEffects.ts (imported above) —
// same Fabric Shadow instances the editor uses, so visual parity is
// automatic for that subsystem.
// ---------------------------------------------------------------------------

function createFabricTextbox(layer: TextLayer, resolvedText: string): Textbox {
  const fx = textEffectToFabricProps(layer.effect);
  return new Textbox(resolvedText || layer.text, {
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
    shadow: fx.shadow,
    stroke: fx.stroke,
    strokeWidth: fx.strokeWidth,
    paintFirst: fx.paintFirst,
    // Static canvas: never selectable / editable / evented.
    selectable: false,
    editable: false,
    evented: false,
    visible: layer.visible,
  });
}

interface ImageLoadOk {
  ok: true;
  image: FabricImage;
}
interface ImageLoadErr {
  ok: false;
  reason: "no_src" | "load_error" | "cors_blocked";
  message: string;
}

async function createFabricImage(
  layer: ImageLayer,
  resolvedSrc: string | null,
): Promise<ImageLoadOk | ImageLoadErr> {
  const src = resolvedSrc || layer.src;
  if (!src) return { ok: false, reason: "no_src", message: "no image URL" };

  try {
    const img = await FabricImage.fromURL(src, { crossOrigin: "anonymous" });

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
      selectable: false,
      evented: false,
    });

    if (layer.cornerRadius > 0) {
      img.clipPath = new Rect({
        width: naturalWidth,
        height: naturalHeight,
        rx: layer.cornerRadius / scaleX,
        ry: layer.cornerRadius / scaleY,
        originX: "center",
        originY: "center",
        absolutePositioned: false,
      });
    }

    return { ok: true, image: img };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isCors =
      /cors|tainted|cross-origin/i.test(message) || message === "";
    return {
      ok: false,
      reason: isCors ? "cors_blocked" : "load_error",
      message: isCors
        ? `image blocked by CORS: ${src}`
        : `image failed: ${src} — ${message}`,
    };
  }
}

function isGradientFill(fill: string | GradientFill): fill is GradientFill {
  return typeof fill === "object" && fill !== null && "kind" in fill;
}

function fabricGradientFromFill(
  gradient: GradientFill,
  bbox: { width: number; height: number },
): Gradient<"linear"> | Gradient<"radial"> {
  const colorStops = gradient.stops.map((s) => ({
    offset: s.offset,
    color: s.color,
  }));
  if (gradient.kind === "linear") {
    const angleRad = (gradient.angleDeg * Math.PI) / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    const cx = bbox.width / 2;
    const cy = bbox.height / 2;
    const halfExtent =
      (Math.abs(dx) * bbox.width + Math.abs(dy) * bbox.height) / 2;
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
  const spread = gradient.spread ?? 1;
  const cx = bbox.width / 2;
  const cy = bbox.height / 2;
  const radius = (Math.max(bbox.width, bbox.height) * spread) / 2;
  return new Gradient<"radial">({
    type: "radial",
    coords: { x1: cx, y1: cy, r1: 0, x2: cx, y2: cy, r2: radius },
    colorStops,
  });
}

function createFabricShape(layer: ShapeLayer): FabricObject {
  const resolvedFill =
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
    strokeDashArray:
      layer.strokeDashArray.length > 0 ? [...layer.strokeDashArray] : undefined,
    visible: layer.visible,
    selectable: false,
    evented: false,
  };

  if (layer.shapeType === "rect") {
    return new Rect({
      ...common,
      width: layer.width,
      height: layer.height,
      rx: layer.cornerRadius,
      ry: layer.cornerRadius,
    });
  }
  if (layer.shapeType === "circle") {
    return new Circle({
      ...common,
      radius: Math.min(layer.width, layer.height) / 2,
    });
  }
  if (layer.shapeType === "ellipse") {
    return new Ellipse({
      ...common,
      rx: layer.width / 2,
      ry: layer.height / 2,
    });
  }
  // line
  return new Line(
    [
      0,
      0,
      Math.cos((layer.angle * Math.PI) / 180) * layer.width,
      Math.sin((layer.angle * Math.PI) / 180) * layer.width,
    ],
    {
      ...common,
      angle: 0, // angle is baked into the endpoints above
      stroke: typeof layer.fill === "string" ? layer.fill : layer.stroke,
      strokeWidth: Math.max(1, layer.strokeWidth || layer.height || 2),
    },
  );
}
