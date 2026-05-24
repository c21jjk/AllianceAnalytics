"use client";

/**
 * Client-side applier for AI design output.
 *
 * What it does:
 *   Takes a LayoutPlan (from the design pipeline) and applies it to a
 *   live Fabric canvas. Two paths:
 *
 *   • "full_replacement" — the pipeline returned an entire new schema.
 *     We delegate to the editor's existing template-swap path so the
 *     user's hidden-bound-field hydration still runs. This file exposes
 *     just the orchestration; the actual canvas re-init lives in
 *     CanvasEditor.tsx (and we don't want to duplicate it here).
 *
 *   • "mutations" — the pipeline returned a list of targeted patches.
 *     We apply each patch to the matching Fabric object with full
 *     validation. Patches that reference an unknown layer ID are
 *     LOGGED + SKIPPED rather than failing the whole batch, so a
 *     partial-bad output still produces some improvement.
 *
 * Why client-only:
 *   This module touches a live Fabric canvas, which only exists in the
 *   browser. The server pipeline outputs PURE DATA (the LayoutPlan); the
 *   applier here is what makes the canvas show it.
 *
 * Why one undo entry per batch:
 *   A 30-mutation Claude turn shouldn't be 30 undo steps for the user —
 *   a single Cmd+Z should revert the whole "Claude tried something"
 *   moment. The caller wires recordHistory ONCE after the batch.
 */
import type { Canvas, FabricObject, Textbox } from "fabric";
import { FabricImage } from "fabric";

import { setLayerData, type FabricLayerData } from "../fabric-factory";
import type {
  ImageLayerMutationPatch,
  LayerMutation,
  LayoutPlan,
  ShapeLayerMutationPatch,
  TextLayerMutationPatch,
} from "./types";

// ===========================================================================
// Result shape
// ===========================================================================

export interface ApplyResult {
  applied: number;
  skipped: ReadonlyArray<{
    layerId: string;
    reason: string;
  }>;
}

// ===========================================================================
// Per-layer find helper
// ===========================================================================

function findByLayerId(
  canvas: Canvas,
  layerId: string,
): FabricObject | null {
  // why: getLayerData was authored in fabric-factory.ts but importing it
  // here would create a circular import path through types.ts. We
  // duplicate the trivial read here.
  for (const obj of canvas.getObjects()) {
    const data = (obj as unknown as { data?: FabricLayerData }).data;
    if (data?.layerId === layerId) return obj;
  }
  return null;
}

// ===========================================================================
// Per-kind appliers
// ===========================================================================

function applyTextPatch(
  obj: FabricObject,
  patch: TextLayerMutationPatch,
): void {
  // why: cast to the broad Fabric set() input type. Each field has
  // already been narrowed by the server-side schema validator before
  // reaching this point, so we trust the shape here.
  const set: Record<string, unknown> = {};
  if (patch.text !== undefined) set.text = patch.text;
  if (patch.left !== undefined) set.left = patch.left;
  if (patch.top !== undefined) set.top = patch.top;
  if (patch.width !== undefined) set.width = patch.width;
  if (patch.height !== undefined) set.height = patch.height;
  if (patch.angle !== undefined) set.angle = patch.angle;
  if (patch.opacity !== undefined) set.opacity = patch.opacity;
  if (patch.visible !== undefined) set.visible = patch.visible;
  if (patch.fontFamily !== undefined) set.fontFamily = patch.fontFamily;
  if (patch.fontSize !== undefined) set.fontSize = patch.fontSize;
  if (patch.fontWeight !== undefined) set.fontWeight = patch.fontWeight;
  if (patch.fontStyle !== undefined) set.fontStyle = patch.fontStyle;
  if (patch.fill !== undefined) set.fill = patch.fill;
  if (patch.textAlign !== undefined) set.textAlign = patch.textAlign;
  if (patch.lineHeight !== undefined) set.lineHeight = patch.lineHeight;
  if (patch.charSpacing !== undefined) set.charSpacing = patch.charSpacing;
  if (patch.underline !== undefined) set.underline = patch.underline;
  if (patch.linethrough !== undefined) set.linethrough = patch.linethrough;
  if (patch.maxWidth !== undefined) set.width = patch.maxWidth ?? undefined;
  (obj as Textbox).set(set);
  (obj as Textbox).setCoords();
}

function applyImagePatch(
  obj: FabricObject,
  patch: ImageLayerMutationPatch,
): void {
  const set: Record<string, unknown> = {};
  if (patch.left !== undefined) set.left = patch.left;
  if (patch.top !== undefined) set.top = patch.top;
  // Width/height on a FabricImage are derived from natural dimensions ×
  // scale. To "resize the image to width X", we'd need to compute
  // scaleX = X / naturalWidth. That math lives in ImagePropertiesControls
  // (computeFitScale). For the Phase 1 applier we treat width/height
  // patches as a target BOX size and update the data-bag's
  // targetBoxWidth/Height so the next handleFitChange picks them up.
  // The visual scale doesn't change here — user can click Cover to
  // refit. Phase 2 can do the recompute inline if it matters.
  if (patch.width !== undefined || patch.height !== undefined) {
    const bag =
      (obj as unknown as { data?: Record<string, unknown> }).data ?? {};
    (obj as unknown as { data: Record<string, unknown> }).data = {
      ...bag,
      targetBoxWidth:
        patch.width ?? (bag.targetBoxWidth as number | undefined) ?? obj.width,
      targetBoxHeight:
        patch.height ??
        (bag.targetBoxHeight as number | undefined) ??
        obj.height,
    };
  }
  if (patch.angle !== undefined) set.angle = patch.angle;
  if (patch.opacity !== undefined) set.opacity = patch.opacity;
  if (patch.visible !== undefined) set.visible = patch.visible;
  if (patch.objectFit !== undefined) {
    const bag =
      (obj as unknown as { data?: Record<string, unknown> }).data ?? {};
    (obj as unknown as { data: Record<string, unknown> }).data = {
      ...bag,
      objectFit: patch.objectFit,
    };
  }
  // cornerRadius / border patches: store on the data bag for the
  // ImagePropertiesControls to pick up on next selection. Applying them
  // visually requires re-deriving the clipPath, which the controls
  // handle. Phase 1 prefers correctness-via-controls over inlining.
  if (
    patch.cornerRadius !== undefined ||
    patch.borderColor !== undefined ||
    patch.borderWidth !== undefined
  ) {
    const bag =
      (obj as unknown as { data?: Record<string, unknown> }).data ?? {};
    (obj as unknown as { data: Record<string, unknown> }).data = {
      ...bag,
      ...(patch.cornerRadius !== undefined
        ? { aiCornerRadius: patch.cornerRadius }
        : {}),
      ...(patch.borderColor !== undefined
        ? { aiBorderColor: patch.borderColor }
        : {}),
      ...(patch.borderWidth !== undefined
        ? { aiBorderWidth: patch.borderWidth }
        : {}),
    };
  }
  if (Object.keys(set).length > 0) {
    (obj as FabricImage).set(set);
    (obj as FabricImage).setCoords();
  }
}

function applyShapePatch(
  obj: FabricObject,
  patch: ShapeLayerMutationPatch,
): void {
  const set: Record<string, unknown> = {};
  if (patch.left !== undefined) set.left = patch.left;
  if (patch.top !== undefined) set.top = patch.top;
  if (patch.width !== undefined) set.width = patch.width;
  if (patch.height !== undefined) set.height = patch.height;
  if (patch.angle !== undefined) set.angle = patch.angle;
  if (patch.opacity !== undefined) set.opacity = patch.opacity;
  if (patch.visible !== undefined) set.visible = patch.visible;
  if (patch.fill !== undefined) {
    // "transparent" / "" both map to no fill — Fabric prefers an empty
    // string here over the literal "transparent" token.
    set.fill =
      patch.fill === "" || patch.fill === "transparent" ? "" : patch.fill;
  }
  if (patch.stroke !== undefined) {
    set.stroke =
      patch.stroke === "" || patch.stroke === "transparent" ? "" : patch.stroke;
  }
  if (patch.strokeWidth !== undefined) set.strokeWidth = patch.strokeWidth;
  if (patch.cornerRadius !== undefined) {
    // Only rect-like shapes use rx/ry; ignore on other shape types since
    // Fabric drops unknown set() keys silently.
    set.rx = patch.cornerRadius;
    set.ry = patch.cornerRadius;
  }
  if (patch.strokeDashArray !== undefined) {
    set.strokeDashArray =
      patch.strokeDashArray.length > 0 ? patch.strokeDashArray : null;
  }
  obj.set(set);
  obj.setCoords();
}

// ===========================================================================
// Top-level mutation applier
// ===========================================================================

/**
 * Apply a list of mutations to the canvas. Returns a result that lists
 * which layer IDs were skipped + why, so the caller can surface a
 * partial-success toast.
 *
 * History contract:
 *   This function does NOT call recordHistory. The caller takes ONE
 *   history snapshot before invoking, applies the batch, then takes
 *   another snapshot after — that yields a single undo step covering
 *   the whole AI turn.
 */
export function applyMutations(
  canvas: Canvas,
  mutations: ReadonlyArray<LayerMutation>,
): ApplyResult {
  const skipped: { layerId: string; reason: string }[] = [];
  let applied = 0;

  for (const m of mutations) {
    const obj = findByLayerId(canvas, m.layerId);
    if (!obj) {
      skipped.push({ layerId: m.layerId, reason: "layer not found" });
      continue;
    }
    const data = (obj as unknown as { data?: FabricLayerData }).data;
    if (data?.layerKind !== m.kind) {
      skipped.push({
        layerId: m.layerId,
        reason: `layer kind mismatch: expected ${m.kind}, found ${data?.layerKind ?? "unknown"}`,
      });
      continue;
    }
    try {
      switch (m.kind) {
        case "text":
          applyTextPatch(obj, m.patch);
          break;
        case "image":
          applyImagePatch(obj, m.patch);
          break;
        case "shape":
          applyShapePatch(obj, m.patch);
          break;
      }
      applied += 1;
    } catch (e) {
      // why: a single bad patch shouldn't sink the batch. Log + skip.
      const reason = e instanceof Error ? e.message : String(e);
      skipped.push({ layerId: m.layerId, reason: `apply error: ${reason}` });
    }
  }

  canvas.requestRenderAll();
  return { applied, skipped };
}

// ===========================================================================
// LayoutPlan → applyMutations dispatcher
// ===========================================================================

/**
 * Apply a LayoutPlan. Mutations are applied in-place; full_replacement
 * is delegated to the caller because re-initializing the canvas requires
 * the orchestrator's template-load path (font preload, image fetch,
 * undo-history reset, autosave key swap).
 *
 * Why this split: the applier should not know how to reset a canvas;
 * the editor already does that and would have to expose its internals.
 *
 * For full_replacement, the caller looks at the returned `kind` field
 * and calls its own template-switch handler:
 *
 *   const plan = await runPipeline(...);
 *   if (plan.kind === "mutations") applyMutations(canvas, plan.changes);
 *   else                            handleTemplatePicked(plan.schema);
 *
 * This function is a thin convenience for the mutation path; the
 * full_replacement branch returns a sentinel so the caller knows.
 */
export function applyLayoutPlan(
  canvas: Canvas,
  plan: LayoutPlan,
):
  | { kind: "mutations_applied"; result: ApplyResult }
  | { kind: "schema_needs_replacement" } {
  if (plan.kind === "mutations") {
    return { kind: "mutations_applied", result: applyMutations(canvas, plan.changes) };
  }
  return { kind: "schema_needs_replacement" };
}

// ===========================================================================
// Re-export setLayerData for callers that want to stamp AI metadata on
// objects (e.g., "this layer was AI-edited") for diagnostics.
// ===========================================================================

export { setLayerData };
