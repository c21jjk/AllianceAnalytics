"use client";

/**
 * Headless schema-to-Fabric renderer for DB-defined templates.
 *
 * Walks a `CanvasTemplateSchema`, builds Fabric objects via the SHARED
 * factory module (`./fabric-factory`), binds them to MLS listing data,
 * and renders into the supplied canvas element. A caller then either
 * `toDataURL()`s the canvas (in-browser) or relies on Chromium taking a
 * screenshot of the page (server-side render pipeline at
 * `app/render/template/[token]/page.tsx`).
 *
 * SINGLE SOURCE OF TRUTH:
 *   Every factory and bound-field resolver this module uses comes from
 *   `lib/post-builder/canvas-editor/fabric-factory.ts`. The interactive
 *   editor in `CanvasEditor.tsx` imports the same helpers, so visual
 *   output is identical by construction — no drift risk between what an
 *   author sees in `/admin/templates/[id]/edit` and the final PNG the
 *   render pipeline produces.
 *
 * Why this file is small now (Phase 2D, 2026-05-22):
 *   Earlier in the build (Phase 2C) every factory was duplicated here
 *   with a "keep in sync" warning. Phase 2D extracted the shared module
 *   so this file is purely a render harness — sort layers, dispatch to
 *   the right factory per layer kind, signal done.
 */

import { Canvas } from "fabric";
import {
  isImageLayer,
  isShapeLayer,
  isTextLayer,
  type CanvasTemplateSchema,
  type MLSListingPayload,
} from "./types";
import {
  createFabricImage,
  createFabricShape,
  createFabricTextbox,
  resolveImageBoundField,
  resolveTextBoundField,
} from "./fabric-factory";

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
  //
  // `selection: false` at the canvas level — render-only context. Per-
  // object `selectable: true` flags coming out of the editor-default
  // factories are harmless because no input ever reaches this canvas.
  const canvas = new Canvas(canvasEl, {
    width: schema.width,
    height: schema.height,
    backgroundColor: schema.backgroundColor || "#FFFFFF",
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
