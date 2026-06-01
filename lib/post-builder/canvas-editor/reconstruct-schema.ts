"use client";

/**
 * reconstruct-schema — Fabric.js canvas → CanvasTemplateSchema (Save as Template).
 * ---------------------------------------------------------------------------
 *
 * Why this file exists
 *   The previous Save-as-Template flow shipped `canvas.toJSON()` straight into
 *   the `custom_templates.fabric_json` column. That has two fatal flaws:
 *
 *     1. Fabric's default serializer DROPS our custom `data` bag (layerId /
 *        layerKind / displayName / targetBoxWidth / objectFit). Without those
 *        the reload path can't correlate a Fabric object to its schema-side
 *        layer and bound-field metadata is lost on the round-trip.
 *
 *     2. Even WITH `toJSON([...customProps])`, the literal text + image src
 *        on every layer is the HYDRATED value (real address, real photo
 *        URL, real list price). When the template re-renders against a
 *        DIFFERENT listing, the baked-in literals win and the layout shows
 *        the original listing's data instead of the new one's.
 *
 *   The fix is to walk the canvas, find each Fabric object's matching schema
 *   layer (by `data.layerId`), and reconstruct a CanvasTemplateSchema that:
 *
 *     • PRESERVES the original layer's `boundField`, placeholder `text`, null
 *       `src`, and `hideIfEmpty` flag — anything that drives re-hydration.
 *     • COPIES the user's current layout edits (left/top/width/height/angle/
 *       opacity, font tweaks, color tweaks, etc.) onto the new layer.
 *     • PRESERVES factory layer ids so a saved custom template re-opens with
 *       the same panel ordering and selection behavior.
 *
 *   The output is the SAME shape factory templates use, which means:
 *     • Render parity: the headless renderer + the interactive editor consume
 *       the schema through the SAME code path either way.
 *     • Free re-hydration: bound-field resolvers in `fabric-factory.ts` run
 *       on the saved schema with FRESH listing data on each render.
 *
 * Where it's called
 *   `lib/post-builder/canvas-editor/CanvasEditor.tsx` — invoked at submit time
 *   in the SaveAsTemplate modal flow, replacing the prior `canvas.toJSON()`
 *   call. The reconstructed schema is forwarded to
 *   `saveCustomTemplateAction({ schemaJson, … })` and persisted to
 *   `custom_templates.schema_json`.
 *
 * Defensive design
 *   Each Fabric object is processed inside try/catch so a single malformed
 *   object can't kill the entire save. Failures are logged to the console and
 *   skipped — the resulting schema is still valid and saves correctly.
 */

import type { Canvas, FabricObject } from "fabric";

import type {
  CanvasLayer,
  CanvasTemplateSchema,
  ImageLayer,
  ShapeLayer,
  TextLayer,
} from "./types";
import { getLayerData, focalOfImage } from "./fabric-factory";
import { FabricImage } from "fabric";

// ---------------------------------------------------------------------------
// Lightweight Fabric prop accessors
// ---------------------------------------------------------------------------
//
// Fabric typings narrow per subclass (Textbox/FabricImage/Rect/...), but we
// walk the canvas as `FabricObject[]` so the compiler can't tell what's
// underneath. We use small typed accessors that read a property if present
// and fall back to a default — this keeps the type surface honest without
// `any` and lets each layer-kind reconstruction stay tight.

function asNum(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readProp(obj: FabricObject, key: string): unknown {
  return (obj as unknown as Record<string, unknown>)[key];
}

/**
 * The object's TRUE top-left corner in canvas space, regardless of its
 * originX/originY.
 *
 * Why this matters (2026-05-31 save-stick fix): the schema and the hydrators
 * (`createFabricTextbox` / `createFabricImage`) treat `left`/`top` as the
 * TOP-LEFT corner and never set an origin (so Fabric defaults to left/top).
 * BUT inserted placeholders and separators are built with
 * `originX:"center", originY:"center"` (see placeholder-insert.ts) — their raw
 * `left`/`top` is the CENTER. Persisting that raw value verbatim shifted the
 * layer DOWN-RIGHT by half its size on every reload — the "my placeholder
 * jumped / my changes didn't stick" bug. Normalize to top-left here so every
 * layer round-trips at the exact spot the user placed it, no matter which
 * origin it was authored with.
 *
 * Angle is intentionally ignored: inserted placeholders are unrotated, and
 * already-top-left layers (factory + previously-saved) pass through unchanged.
 */
function topLeftOf(
  obj: FabricObject,
  fallbackLeft: number,
  fallbackTop: number,
): { left: number; top: number } {
  const left = asNum(readProp(obj, "left"), fallbackLeft);
  const top = asNum(readProp(obj, "top"), fallbackTop);
  const originX = asStr(readProp(obj, "originX"), "left");
  const originY = asStr(readProp(obj, "originY"), "top");
  const w = asNum(readProp(obj, "width"), 0) * asNum(readProp(obj, "scaleX"), 1);
  const h =
    asNum(readProp(obj, "height"), 0) * asNum(readProp(obj, "scaleY"), 1);
  let l = left;
  let t = top;
  if (originX === "center") l = left - w / 2;
  else if (originX === "right") l = left - w;
  if (originY === "center") t = top - h / 2;
  else if (originY === "bottom") t = top - h;
  return { left: l, top: t };
}

// ---------------------------------------------------------------------------
// Per-kind reconstruction — preserves schema metadata, copies user edits
// ---------------------------------------------------------------------------

/**
 * Reconstruct a TextLayer.
 *
 * Rules:
 *   • boundField — preserved from the original schema layer. If set, the
 *     literal `text` placeholder is kept untouched so re-hydration substitutes
 *     fresh data on next render.
 *   • text — only mirrors the Fabric object's CURRENT text content when the
 *     layer is a LITERAL text layer (no boundField). Otherwise the original
 *     placeholder (e.g., "{open_house_date}") wins.
 *   • effect — preserved from the original schema layer. Fabric doesn't
 *     surface the structured TextEffect back through `shadow`/`stroke`/
 *     `paintFirst` in a lossless way; preserving the original effect avoids
 *     the round-trip degradation.
 *   • All other Fabric-aligned properties (left/top/width/height/angle/
 *     opacity, fontFamily/fontSize/fontWeight/fontStyle, fill, textAlign,
 *     lineHeight, charSpacing, underline, linethrough) are read directly off
 *     the Fabric object.
 */
function reconstructTextLayer(
  obj: FabricObject,
  original: TextLayer,
  zIndex: number,
): TextLayer {
  // why: Fabric Textbox uses scaleX/scaleY on transforms and a fixed `width`
  // for word-wrap. The visible width is `width * scaleX`; persist that as the
  // schema width so the reloaded layer occupies the same canvas footprint. We
  // also reset scale to 1 conceptually — the schema treats width/height as
  // absolute and `createFabricTextbox` rebuilds the Textbox without scale.
  const scaleX = asNum(readProp(obj, "scaleX"), 1);
  const scaleY = asNum(readProp(obj, "scaleY"), 1);
  const rawWidth = asNum(readProp(obj, "width"), original.width);
  const rawHeight = asNum(readProp(obj, "height"), original.height);

  const currentText = asStr(readProp(obj, "text"), original.text);
  const hasBoundField = Boolean(original.boundField);

  return {
    ...original,
    kind: "text",
    id: original.id,
    name: original.name,
    locked: original.locked,
    visible: asBool(readProp(obj, "visible"), original.visible),
    ...topLeftOf(obj, original.left, original.top),
    width: rawWidth * scaleX,
    height: rawHeight * scaleY,
    angle: asNum(readProp(obj, "angle"), original.angle),
    opacity: asNum(readProp(obj, "opacity"), original.opacity),
    z: zIndex,
    // why: bound text layers KEEP their placeholder so the next render
    // re-resolves against current listing data. Literal text layers (no
    // boundField) carry whatever the user typed.
    text: hasBoundField ? original.text : currentText,
    boundField: original.boundField,
    fontFamily: asStr(readProp(obj, "fontFamily"), original.fontFamily),
    fontSize: asNum(readProp(obj, "fontSize"), original.fontSize),
    fontWeight: ((): TextLayer["fontWeight"] => {
      const raw = readProp(obj, "fontWeight");
      const num = typeof raw === "number" ? raw : Number(raw);
      const allowed: TextLayer["fontWeight"][] = [
        100, 200, 300, 400, 500, 600, 700, 800, 900,
      ];
      const match = allowed.find((w) => w === num);
      return match ?? original.fontWeight;
    })(),
    fontStyle: ((): TextLayer["fontStyle"] => {
      const raw = asStr(readProp(obj, "fontStyle"), original.fontStyle);
      return raw === "italic" ? "italic" : "normal";
    })(),
    fill: asStr(readProp(obj, "fill"), original.fill),
    textAlign: ((): TextLayer["textAlign"] => {
      const raw = asStr(readProp(obj, "textAlign"), original.textAlign);
      return raw === "left" || raw === "right" || raw === "center" || raw === "justify"
        ? raw
        : original.textAlign;
    })(),
    lineHeight: asNum(readProp(obj, "lineHeight"), original.lineHeight),
    charSpacing: asNum(readProp(obj, "charSpacing"), original.charSpacing),
    underline: asBool(readProp(obj, "underline"), original.underline),
    linethrough: asBool(readProp(obj, "linethrough"), original.linethrough),
    editable: original.editable,
    maxWidth: original.maxWidth,
    // why: TextEffect doesn't round-trip cleanly through Fabric's shadow +
    // stroke surface (Lift vs Splice vs Shadow look identical at the prop
    // level). Preserve the original effect so a re-save doesn't degrade the
    // structured kind into a flat "shadow".
    effect: original.effect,
  };
}

/**
 * Reconstruct an ImageLayer.
 *
 * Rules:
 *   • boundField — preserved from the original schema layer. If set, `src`
 *     is forced to `null` so re-hydration pulls the bound photo on next
 *     render (the literal hydrated URL is discarded).
 *   • src — only mirrored from the Fabric object when the original layer
 *     was a LITERAL image (no boundField — e.g., the brokerage logo). Even
 *     then, we trust the original `src` because Fabric stores the URL on
 *     `_originalElement.src` and the lookup is brittle. We let factories
 *     reload from the original URL.
 *   • hideIfEmpty — preserved untouched.
 *   • Layout reads come from `data.targetBoxWidth/Height` when present
 *     (the canonical box dims set in `createFabricImage`); fallback to the
 *     image's transform-derived dimensions otherwise.
 */
function reconstructImageLayer(
  obj: FabricObject,
  original: ImageLayer,
  zIndex: number,
): ImageLayer {
  const data = getLayerData(obj);
  const scaleX = asNum(readProp(obj, "scaleX"), 1);
  const scaleY = asNum(readProp(obj, "scaleY"), 1);
  // why: the image's natural × scale gives the rendered footprint, but the
  // CANVAS BOX (what we draw into for object-fit math) is stored separately
  // on the data bag. Prefer the box dims so a Cover-fit user resize correctly
  // round-trips as "the user wanted that BOX dimension" rather than the
  // accidental scale that produced it.
  // why (2026-05-31 native crop): every image (real photo or placeholder
  // frame) now has box == visible frame. The Fabric object's width/height are
  // the cropped region in element px, so width×scaleX is the frame width and
  // left/top is the frame's top-left directly. No clip-reading or box-dim bag
  // gymnastics needed anymore.
  const objWidth = asNum(readProp(obj, "width"), original.width);
  const objHeight = asNum(readProp(obj, "height"), original.height);
  const framePos = topLeftOf(obj, original.left, original.top);
  const frameWidth = objWidth * scaleX;
  const frameHeight = objHeight * scaleY;

  // Persist the focal point (cover framing) so a bound photo re-frames the same
  // way against a different-sized listing photo at render time.
  const focal =
    obj instanceof FabricImage
      ? focalOfImage(obj)
      : { focalX: original.focalX ?? 0.5, focalY: original.focalY ?? 0.5 };

  const hasBoundField = Boolean(original.boundField);

  return {
    ...original,
    kind: "image",
    id: original.id,
    name: original.name,
    locked: original.locked,
    visible: asBool(readProp(obj, "visible"), original.visible),
    ...framePos,
    width: frameWidth,
    height: frameHeight,
    angle: asNum(readProp(obj, "angle"), original.angle),
    opacity: asNum(readProp(obj, "opacity"), original.opacity),
    z: zIndex,
    // why: bound images keep src=null so the editor's re-hydration pass binds
    // to the fresh listing's photo. Literal images preserve their original
    // URL (CDN or brand asset) — we don't pull from Fabric because the URL
    // can be the resolved CORS-proxied path.
    src: hasBoundField ? null : original.src,
    boundField: original.boundField,
    objectFit: data?.objectFit ?? original.objectFit,
    crossOrigin: "anonymous",
    cornerRadius: original.cornerRadius,
    focalX: focal.focalX,
    focalY: focal.focalY,
    // why (2026-05-31): the frame-border color/width are edited live via the
    // floating toolbar, which writes them onto the image's data bag. Read them
    // back from there so a border the author added/changed persists through
    // save; fall back to the original schema values when the bag is empty.
    borderColor:
      typeof data?.borderColor === "string"
        ? data.borderColor
        : original.borderColor,
    borderWidth:
      typeof data?.borderWidth === "number"
        ? data.borderWidth
        : original.borderWidth,
    hideIfEmpty: original.hideIfEmpty,
  };
}

/**
 * Reconstruct a ShapeLayer.
 *
 * Shapes don't bind to data, so EVERY property reflects user intent — copy
 * literally from the Fabric object. `fill` is preserved from the original
 * when the source is a structured GradientFill (Fabric returns a runtime
 * Gradient instance whose internal shape doesn't match our schema) and read
 * from the Fabric object only when the value is a primitive string.
 */
function reconstructShapeLayer(
  obj: FabricObject,
  original: ShapeLayer,
  zIndex: number,
): ShapeLayer {
  const scaleX = asNum(readProp(obj, "scaleX"), 1);
  const scaleY = asNum(readProp(obj, "scaleY"), 1);
  const rawWidth = asNum(readProp(obj, "width"), original.width);
  const rawHeight = asNum(readProp(obj, "height"), original.height);
  // why: a string fill on Fabric is just the hex/rgb value — trust it. A
  // gradient fill, however, has been baked into a Fabric `Gradient` instance
  // and reversing it back to our GradientFill schema is lossy. Preserve the
  // original gradient definition; rebuilding the runtime Gradient is the
  // factory's job on reload.
  const fabricFill = readProp(obj, "fill");
  const nextFill: ShapeLayer["fill"] =
    typeof fabricFill === "string" && fabricFill.length > 0
      ? fabricFill
      : original.fill;

  return {
    ...original,
    kind: "shape",
    id: original.id,
    name: original.name,
    locked: original.locked,
    visible: asBool(readProp(obj, "visible"), original.visible),
    ...topLeftOf(obj, original.left, original.top),
    width: rawWidth * scaleX,
    height: rawHeight * scaleY,
    angle: asNum(readProp(obj, "angle"), original.angle),
    opacity: asNum(readProp(obj, "opacity"), original.opacity),
    z: zIndex,
    shapeType: original.shapeType,
    fill: nextFill,
    stroke: asStr(readProp(obj, "stroke"), original.stroke),
    strokeWidth: asNum(readProp(obj, "strokeWidth"), original.strokeWidth),
    cornerRadius: original.cornerRadius,
    strokeDashArray: original.strokeDashArray,
  };
}

/**
 * Fallback — a Fabric object that has no matching schema layer (the user
 * added it manually via the toolbar after opening Studio). We build a fresh
 * schema entry from the Fabric object's CURRENT state. New layers are
 * treated as literal (no boundField).
 *
 * Returns null when we can't recognize the Fabric object's kind. Callers
 * skip nulls — better to drop the orphan than poison the save.
 */
function reconstructOrphan(
  obj: FabricObject,
  zIndex: number,
): CanvasLayer | null {
  const data = getLayerData(obj);
  const layerId =
    data?.layerId ??
    `orphan_${zIndex}_${Math.random().toString(36).slice(2, 8)}`;
  const layerName = data?.displayName ?? `Layer ${zIndex + 1}`;
  const fabricType = asStr(readProp(obj, "type"), "");

  const baseLayer = {
    id: layerId,
    name: layerName,
    locked: false,
    visible: asBool(readProp(obj, "visible"), true),
    ...topLeftOf(obj, 0, 0),
    angle: asNum(readProp(obj, "angle"), 0),
    opacity: asNum(readProp(obj, "opacity"), 1),
    z: zIndex,
  };
  const scaleX = asNum(readProp(obj, "scaleX"), 1);
  const scaleY = asNum(readProp(obj, "scaleY"), 1);
  const rawWidth = asNum(readProp(obj, "width"), 100);
  const rawHeight = asNum(readProp(obj, "height"), 100);

  // Textbox / Text / IText
  if (data?.layerKind === "text" || fabricType === "textbox" || fabricType === "text" || fabricType === "i-text") {
    // why: a layer inserted/bound as a placeholder in Template Builder stamps
    // its boundField on the data bag. Honor it so a NEW bound text layer
    // round-trips as a real placeholder (the current text becomes its
    // fallback). Literal layers leave this undefined — unchanged behavior.
    const textBound = data?.boundField as TextLayer["boundField"] | undefined;
    return {
      ...baseLayer,
      kind: "text",
      width: rawWidth * scaleX,
      height: rawHeight * scaleY,
      text: asStr(readProp(obj, "text"), ""),
      boundField: textBound,
      fontFamily: asStr(readProp(obj, "fontFamily"), "Arial"),
      fontSize: asNum(readProp(obj, "fontSize"), 32),
      fontWeight: 400,
      fontStyle: "normal",
      fill: asStr(readProp(obj, "fill"), "#000000"),
      textAlign: "left",
      lineHeight: asNum(readProp(obj, "lineHeight"), 1.16),
      charSpacing: asNum(readProp(obj, "charSpacing"), 0),
      underline: asBool(readProp(obj, "underline"), false),
      linethrough: asBool(readProp(obj, "linethrough"), false),
      editable: true,
      effect: { kind: "none" },
    } satisfies TextLayer;
  }
  // FabricImage
  if (data?.layerKind === "image" || fabricType === "image") {
    // why: an image inserted/bound as a placeholder stamps its boundField on
    // the data bag. When bound, force src=null so the next render pulls the
    // live photo (agent headshot, hero, logo) instead of baking in whatever
    // was on the canvas. Literal images keep their URL — unchanged behavior.
    const imageBound = data?.boundField as ImageLayer["boundField"] | undefined;
    const literalSrc = ((): string | null => {
      const el = (
        obj as unknown as { _originalElement?: { src?: string } }
      )._originalElement;
      return typeof el?.src === "string" && el.src.length > 0 ? el.src : null;
    })();
    // why (2026-05-31 fix): same frame-resize issue as reconstructImageLayer.
    // A placeholder FRAME (Rect) carries a stale targetBoxWidth after the author
    // resizes it; only a real loaded photo (type "image") needs the box dims off
    // the data bag. For the frame, the live width×scale is the box drawn.
    const isRealImageOrphan = fabricType === "image";
    return {
      ...baseLayer,
      kind: "image",
      width: isRealImageOrphan
        ? (data?.targetBoxWidth ?? rawWidth * scaleX)
        : rawWidth * scaleX,
      height: isRealImageOrphan
        ? (data?.targetBoxHeight ?? rawHeight * scaleY)
        : rawHeight * scaleY,
      src: imageBound ? null : literalSrc,
      boundField: imageBound,
      hideIfEmpty: data?.hideIfEmpty ?? undefined,
      objectFit: data?.objectFit ?? "cover",
      crossOrigin: "anonymous",
      // why: an inserted image placeholder stamps its intended corner radius
      // (half the box for a circular agent frame). Honor it so the rounding
      // survives save; literal/legacy orphans default to 0 as before.
      cornerRadius: data?.cornerRadius ?? 0,
      borderColor: "",
      borderWidth: 0,
    } satisfies ImageLayer;
  }
  // Shape (Rect, Circle, Ellipse, Line)
  if (
    data?.layerKind === "shape" ||
    fabricType === "rect" ||
    fabricType === "circle" ||
    fabricType === "ellipse" ||
    fabricType === "line"
  ) {
    const shapeType: ShapeLayer["shapeType"] =
      fabricType === "circle"
        ? "circle"
        : fabricType === "ellipse"
          ? "ellipse"
          : fabricType === "line"
            ? "line"
            : "rect";
    const rawFill = readProp(obj, "fill");
    return {
      ...baseLayer,
      kind: "shape",
      width: rawWidth * scaleX,
      height: rawHeight * scaleY,
      shapeType,
      fill: typeof rawFill === "string" ? rawFill : "#000000",
      stroke: asStr(readProp(obj, "stroke"), ""),
      strokeWidth: asNum(readProp(obj, "strokeWidth"), 0),
      cornerRadius: 0,
      strokeDashArray: [],
    } satisfies ShapeLayer;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk a Fabric canvas and reconstruct a CanvasTemplateSchema that preserves
 * the original template's bound-field metadata while overlaying the user's
 * current layout edits.
 *
 * The walk is per-object try/catch so a single malformed Fabric object
 * doesn't fail the whole save — failures are logged and skipped.
 */
export function reconstructSchemaFromCanvas(
  canvas: Canvas,
  originalSchema: CanvasTemplateSchema,
): CanvasTemplateSchema {
  // Index the original layers by id so the per-object lookup is O(1).
  const layerById = new Map<string, CanvasLayer>();
  for (const layer of originalSchema.layers) {
    layerById.set(layer.id, layer);
  }

  const nextLayers: CanvasLayer[] = [];
  const objects = canvas.getObjects();

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    try {
      const data = getLayerData(obj);
      const matchedOriginal = data?.layerId
        ? layerById.get(data.layerId)
        : undefined;

      if (!matchedOriginal) {
        // User-added orphan — build a fresh literal layer entry.
        const built = reconstructOrphan(obj, i);
        if (built) {
          nextLayers.push(built);
        } else {
          console.warn(
            "[reconstructSchemaFromCanvas] skipping unrecognized orphan",
            { fabricType: readProp(obj, "type") },
          );
        }
        continue;
      }

      switch (matchedOriginal.kind) {
        case "text":
          nextLayers.push(reconstructTextLayer(obj, matchedOriginal, i));
          break;
        case "image":
          nextLayers.push(reconstructImageLayer(obj, matchedOriginal, i));
          break;
        case "shape":
          nextLayers.push(reconstructShapeLayer(obj, matchedOriginal, i));
          break;
        case "group":
          // why: groups aren't implemented in Phase 1 of the canvas editor
          // (see types.ts). Pass them through untouched so a future group-
          // aware save doesn't accidentally drop them.
          nextLayers.push({ ...matchedOriginal, z: i });
          break;
        default: {
          const _exhaustive: never = matchedOriginal;
          void _exhaustive;
          break;
        }
      }
    } catch (err) {
      console.warn(
        "[reconstructSchemaFromCanvas] skipping malformed Fabric object",
        {
          index: i,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // why: layers array reflects current z-order (already insertion order in
  // Fabric canvas.getObjects()). The `z` field on each layer mirrors the
  // index so consumers that sort by z get the same order.
  return {
    id: originalSchema.id,
    name: originalSchema.name,
    description: originalSchema.description,
    category: originalSchema.category,
    variant: originalSchema.variant,
    format: originalSchema.format,
    width: originalSchema.width,
    height: originalSchema.height,
    // why (2026-05-31 fix): capture the LIVE canvas background, not the
    // original. Changing the slide background color in the editor updates
    // canvas.backgroundColor; reading originalSchema here silently discarded
    // that edit (John set a tan background, saved, and it reverted to cream).
    // Fall back to the original only when the canvas bg isn't a plain color
    // string (e.g. a pattern/gradient we don't round-trip here).
    backgroundColor:
      typeof canvas.backgroundColor === "string" &&
      canvas.backgroundColor.length > 0
        ? canvas.backgroundColor
        : originalSchema.backgroundColor,
    backgroundImage: originalSchema.backgroundImage,
    layers: nextLayers,
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}
