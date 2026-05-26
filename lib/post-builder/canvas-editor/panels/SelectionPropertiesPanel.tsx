"use client";

/**
 * SelectionPropertiesPanel — Phase 2, Agent A
 * --------------------------------------------
 *
 * Right-side panel that replaces the LayerListPanel when a layer (or multi-
 * selection) is active on the canvas. Dispatches to mode-specific controls
 * based on `props.mode` and provides the universal "← Back to layers" header.
 *
 * The panel is 288px wide (matches the layer panel) and lives in the same
 * `<aside>` slot in CanvasEditor.tsx. Agent C's LayerListPanel and this
 * component are mutually exclusive — the orchestrator decides which to render
 * based on the active selection.
 *
 * Why mode-switch instead of "render every control conditionally":
 *   Each control file holds layer-kind-specific imports and helpers (Textbox,
 *   FabricImage, etc.). Splitting by mode keeps each control file small and
 *   focused, easier to reason about and to test independently.
 */

import { type JSX } from "react";

import type { SelectionPropertiesPanelProps } from "../contracts";

import ImagePropertiesControls from "./controls/ImagePropertiesControls";
import MultiSelectionControls from "./controls/MultiSelectionControls";
import ShapePropertiesControls from "./controls/ShapePropertiesControls";
import TextPropertiesControls from "./controls/TextPropertiesControls";

/**
 * Resolve the active layer's display name from the canvas. Reads Fabric's
 * active object's `data` metadata (set by CanvasEditor's setLayerData helper).
 * Returns a sensible fallback when the panel renders mid-transition.
 */
function getActiveLayerName(props: SelectionPropertiesPanelProps): string {
  const canvas = props.canvas;
  if (!canvas) return "";
  if (props.mode === "multi") {
    // why: header shows "X layers selected" via the multi controls instead —
    // we return an empty string and let the multi sub-component own the copy.
    return "";
  }
  const active = canvas.getActiveObject();
  if (!active) return "";
  // why: Fabric typings type `data` as `any` on some builds. Narrow through unknown.
  const data = (active as unknown as { data?: { displayName?: string } }).data;
  return data?.displayName ?? "";
}

/**
 * Header eyebrow label per mode. Capitalized for the panel header chip.
 */
function getModeLabel(mode: SelectionPropertiesPanelProps["mode"]): string {
  switch (mode) {
    case "text":
      return "Text";
    case "image":
      return "Image";
    case "shape":
      return "Shape";
    case "multi":
      return "Multiple";
    case "none":
      return "";
    default: {
      // why: exhaustive check — adding a new SelectionMode that isn't handled
      // will fail to type-check, surfacing the missing case here.
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export default function SelectionPropertiesPanel(
  props: SelectionPropertiesPanelProps,
): JSX.Element {
  const layerName = getActiveLayerName(props);
  const modeLabel = getModeLabel(props.mode);

  return (
    <aside className="flex w-72 flex-col border-l border-[var(--studio-border)] bg-[var(--studio-panel)]">
      {/* ----- Header with Back button + selected-layer name ----- */}
      <header className="border-b border-[var(--studio-border)] px-3 py-3">
        <button
          type="button"
          onClick={props.onClearSelection}
          className="mb-2 inline-flex items-center gap-1 rounded text-xs font-medium text-[var(--studio-text-muted)] hover:text-white"
        >
          {/* why: inline SVG arrow — see CanvasEditor.tsx note on no lucide-react. */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 4L6 8l4 4" />
          </svg>
          Back to layers
        </button>
        <div className="flex items-center gap-2">
          {modeLabel ? (
            <span className="inline-flex items-center rounded bg-[var(--studio-hover)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
              {modeLabel}
            </span>
          ) : null}
          {layerName ? (
            <span className="truncate text-sm font-semibold text-white">
              {layerName}
            </span>
          ) : null}
        </div>
      </header>

      {/* ----- Mode-specific controls ----- */}
      <div className="flex-1 overflow-y-auto">
        {props.mode === "text" ? (
          <TextPropertiesControls
            canvas={props.canvas}
            selectionVersion={props.selectionVersion}
            onCanvasMutated={props.onCanvasMutated}
            recordHistory={props.recordHistory}
            onOpenFontPicker={props.onOpenFontPicker}
            fontPickerOpen={props.fontPickerOpen}
            onOpenEffectsPanel={props.onOpenEffectsPanel}
            effectsPanelOpen={props.effectsPanelOpen}
          />
        ) : null}
        {props.mode === "image" ? (
          <ImagePropertiesControls
            canvas={props.canvas}
            listing={props.listing}
            selectionVersion={props.selectionVersion}
            onCanvasMutated={props.onCanvasMutated}
            recordHistory={props.recordHistory}
          />
        ) : null}
        {props.mode === "shape" ? (
          <ShapePropertiesControls
            canvas={props.canvas}
            selectionVersion={props.selectionVersion}
            onCanvasMutated={props.onCanvasMutated}
            recordHistory={props.recordHistory}
          />
        ) : null}
        {props.mode === "multi" ? (
          <MultiSelectionControls
            canvas={props.canvas}
            selectionVersion={props.selectionVersion}
            onCanvasMutated={props.onCanvasMutated}
            recordHistory={props.recordHistory}
          />
        ) : null}
        {props.mode === "none" ? (
          // why: "none" should never reach this panel — orchestrator renders
          // LayerListPanel instead. Keep an empty fallback for safety.
          <div className="px-4 py-6 text-center text-sm text-[var(--studio-text-muted)]">
            No selection
          </div>
        ) : null}
      </div>
    </aside>
  );
}
