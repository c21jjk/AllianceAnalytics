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
  drawImageBorders,
  resolveImageBoundField,
  resolveTextBoundField,
  shrinkTextToIntendedLines,
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
  //
  // 2026-05-28 — Bug 2 fix: `document.fonts.ready` alone is not
  // sufficient because Google Fonts loaded with `display=swap` resolve
  // the ready promise the moment a fallback metric is available,
  // BEFORE the real font file finishes downloading. We now ALSO
  // explicitly `await document.fonts.load("16px <family>")` for every
  // font family referenced by the schema's text layers, which forces
  // the browser to actually pull each .woff2 down before we
  // screenshot. (`display=block` in fonts.css makes browsers hide text
  // until the font is in, which closes the same gap on the rendering
  // side.) Timeout bumped from 5s → 8s to absorb cold-start latency on
  // headless Chromium.
  const fontFamilies = collectFontFamilies(schema);
  try {
    await Promise.race([
      Promise.all([
        document.fonts.ready,
        ...fontFamilies.map((family) =>
          document.fonts.load(`16px "${family}"`),
        ),
      ]),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("font-timeout")), 8_000),
      ),
    ]);
  } catch {
    console.warn(
      "[headless-render] font load timed out — drawing in fallback for families:",
      fontFamilies,
    );
    warnings.push(
      `font-timeout (drew in fallback for: ${fontFamilies.join(", ")})`,
    );
  }

  // Sort layers by z so we add bottom-up — Fabric stacks by add-order on
  // a non-event canvas.
  const sortedLayers = [...schema.layers].sort((a, b) => a.z - b.z);

  // --- hide-if-empty (render only) -----------------------------------------
  // A bound text field with no value for THIS listing (e.g. Square Ft on a
  // listing whose feed omits square footage) is DROPPED from the generated
  // post instead of showing its placeholder label ("Square Ft"). Any separator
  // ("|" / "—") left next to a dropped field is dropped too, so the stats line
  // reads cleanly ("3 Bedrooms | 2 Bathrooms" instead of "… | Square Ft" or a
  // trailing bar). This runs on the render path only — the authoring editor
  // still shows every placeholder so the author can position them.
  const SEPARATOR_CHARS = new Set(["—", "|"]);
  const isSeparatorLayer = (l: (typeof schema.layers)[number]): boolean =>
    isTextLayer(l) && !l.boundField && SEPARATOR_CHARS.has((l.text ?? "").trim());
  const centerX = (l: (typeof schema.layers)[number]): number =>
    l.left + (("width" in l ? l.width : 0) ?? 0) / 2;
  const vTop = (l: (typeof schema.layers)[number]): number => l.top;
  const vBottom = (l: (typeof schema.layers)[number]): number =>
    l.top + (("height" in l ? l.height : 0) ?? 0);
  const sameBand = (
    a: (typeof schema.layers)[number],
    b: (typeof schema.layers)[number],
  ): boolean => Math.min(vBottom(a), vBottom(b)) > Math.max(vTop(a), vTop(b));

  const hiddenIds = new Set<string>();
  // 1) Empty bound text fields.
  for (const layer of schema.layers) {
    if (isTextLayer(layer) && layer.boundField) {
      const value = resolveTextBoundField(layer.boundField, listing).trim();
      if (!value) hiddenIds.add(layer.id);
    }
  }
  // 2) Separators whose immediate neighbor (left or right, same horizontal
  //    band) was dropped. Standalone separators with no dropped neighbor stay.
  for (const sep of schema.layers) {
    if (!isSeparatorLayer(sep)) continue;
    const sx = centerX(sep);
    const neighbors = schema.layers.filter(
      (l) =>
        l.id !== sep.id &&
        isTextLayer(l) &&
        !isSeparatorLayer(l) &&
        sameBand(l, sep),
    );
    const left = neighbors
      .filter((l) => centerX(l) < sx)
      .sort((a, b) => centerX(b) - centerX(a))[0];
    const right = neighbors
      .filter((l) => centerX(l) > sx)
      .sort((a, b) => centerX(a) - centerX(b))[0];
    if ((left && hiddenIds.has(left.id)) || (right && hiddenIds.has(right.id))) {
      hiddenIds.add(sep.id);
    }
  }

  for (const layer of sortedLayers) {
    if (hiddenIds.has(layer.id)) {
      // Dropped by hide-if-empty (empty bound field or orphaned separator).
      continue;
    }
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
      // why: bound text layers resolve from live listing data ONLY. A bound
      // layer's `text` is the DESIGN-TIME placeholder token (e.g.
      // "{hosting_agent_name}"), so we must NEVER publish it. `createFabric-
      // Textbox` internally falls back to `layer.text` when handed an empty
      // string, so we CANNOT pass "" for an empty bound field — instead we
      // skip the layer outright. Empty bound fields are also dropped by the
      // hide-if-empty pass above; this is the final guard so the raw token
      // can never ship even if that pass ever misses a layer (this is what
      // published a literal "{hosting_agent_name}" onto the 2026-07-17
      // 71 Palmer OH carousel — a manual listing with no agent name).
      if (layer.boundField) {
        const resolved = resolveTextBoundField(layer.boundField, listing).trim();
        if (!resolved) continue;
        const tb = createFabricTextbox(layer, resolved);
        // 2026-07-17 — shrink-to-fit for bound text. Live data can be longer
        // than the design-time placeholder ("200 W Pittsburgh Avenue" wrapped
        // onto a second line and overlapped the town on Larissa's Jul-17
        // carousel). The layer's authored height tells us how many lines the
        // designer intended; when the resolved text wraps past that, step the
        // font down (to a floor of 55%) until it fits. Free-text layers are
        // untouched — their content is exactly what the designer typed.
        shrinkTextToIntendedLines(tb, layer.fontSize, layer.height, layer.lineHeight);
        canvas.add(tb);
      } else {
        canvas.add(createFabricTextbox(layer, layer.text));
      }
    } else if (isImageLayer(layer)) {
      const resolvedSrc = layer.boundField
        ? resolveImageBoundField(layer.boundField, listing)
        : layer.src;
      const outcome = await createFabricImage(layer, resolvedSrc);
      if (outcome.ok) {
        canvas.add(outcome.image);
      } else if (outcome.reason === "hidden") {
        // why: layer opted out via `hideIfEmpty` — drop without a warning.
        // This is the expected path when the hosting-agent block's
        // photo has no `brand_assets` match; the block degrades to a
        // text-only attribution and the headless render should be quiet
        // about it.
      } else {
        warnings.push(`image ${layer.id}: ${outcome.message}`);
        // Drop the layer rather than emit a placeholder — the render path
        // wants a clean output, not an editor-style "missing image" rect.
      }
    } else if (isShapeLayer(layer)) {
      canvas.add(createFabricShape(layer));
    }
  }

  // why: paint image frame borders on every render tick, the same way the
  // editor does (shared fn), so the published PNG matches Studio exactly. Pass
  // the render pass's target context (the after:render event ctx) so frames
  // land in toDataURL/screenshot output too. Guarded so a draw error can't
  // abort the render.
  canvas.on("after:render", (e) => {
    try {
      drawImageBorders(canvas, (e as { ctx?: CanvasRenderingContext2D }).ctx);
    } catch (err) {
      console.warn("[headless-render] border paint failed:", err);
    }
  });

  canvas.requestRenderAll();
  // Force a single render tick so toDataURL/screenshot sees the result.
  canvas.renderAll();

  return { canvas, warnings };
}

/**
 * Walk a schema's text layers and return the unique set of fontFamily
 * values referenced. Used to drive explicit per-font load awaits in the
 * renderSchemaHeadless prelude — `document.fonts.ready` alone is not
 * enough when fonts are loaded with `display=swap` (resolved before
 * the real file arrives).
 *
 * Skips invisible layers — they don't render so we don't need their
 * font to be ready by the screenshot tick.
 */
function collectFontFamilies(schema: CanvasTemplateSchema): string[] {
  const seen = new Set<string>();
  for (const layer of schema.layers) {
    if (!isTextLayer(layer)) continue;
    if (!layer.visible) continue;
    const family = (layer.fontFamily ?? "").trim();
    if (!family) continue;
    // Strip surrounding quotes if the schema stored a CSS-style
    // quoted family — `document.fonts.load` wants the bare name.
    const unquoted = family.replace(/^['"]|['"]$/g, "");
    seen.add(unquoted);
  }
  return Array.from(seen);
}

// shrinkTextToIntendedLines moved to fabric-factory.ts (2026-07-24) so
// CanvasEditor.tsx (the live Studio editor) can share the same fix — see
// that file for the full doc comment.
