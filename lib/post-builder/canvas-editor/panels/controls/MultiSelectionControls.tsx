"use client";

/**
 * MultiSelectionControls — Phase 2, Agent A
 * ------------------------------------------
 *
 * Minimal stub rendered when the user has multiple layers selected. Real
 * multi-edit (align, distribute, batch font-change, etc.) lands in Phase 3.
 *
 * What this stub provides today:
 *   • A header showing the selected-object count
 *   • A "Delete all" button that removes every active object
 *   • A disabled "Group" button (Phase 3 feature) with a tooltip
 *   • A short hint pointing at single-select for the full editor surface
 */

import type { Canvas } from "fabric";
import { type JSX, useCallback, useEffect, useState } from "react";

interface MultiSelectionControlsProps {
  canvas: Canvas | null;
  selectionVersion: number;
  onCanvasMutated?: () => void;
  recordHistory?: () => void;
}

/**
 * Read the current multi-selection count. Returns 0 when no canvas / no
 * active selection. We use `getActiveObjects()` rather than `getActiveObject()
 * .size()` because Fabric's getActiveObjects always returns a flat list,
 * regardless of whether the active selection is an ActiveSelection group or a
 * single object. Cleaner.
 */
function readSelectionCount(canvas: Canvas | null): number {
  if (!canvas) return 0;
  return canvas.getActiveObjects().length;
}

export default function MultiSelectionControls(
  props: MultiSelectionControlsProps,
): JSX.Element {
  const { canvas, selectionVersion, onCanvasMutated, recordHistory } = props;
  const [count, setCount] = useState<number>(() => readSelectionCount(canvas));

  // why: re-read the count on every selectionVersion bump. Multi-select count
  // can change without a fresh "selection:created" event when the user
  // shift-clicks an additional layer (Fabric fires selection:updated).
  useEffect(() => {
    setCount(readSelectionCount(canvas));
  }, [canvas, selectionVersion]);

  /**
   * Delete every currently-selected object. Drops the active selection
   * afterwards so the canvas falls back to the layer-list panel.
   */
  const handleDeleteAll = useCallback((): void => {
    if (!canvas) return;
    const objects = canvas.getActiveObjects();
    if (objects.length === 0) return;
    // why: copy the array — canvas.remove mutates Fabric's internal object
    // list, which would shift indices mid-iteration otherwise.
    const copy = objects.slice();
    copy.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    onCanvasMutated?.();
    recordHistory?.();
  }, [canvas, onCanvasMutated, recordHistory]);

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <div className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-3 py-2.5">
        <div className="text-sm font-semibold text-white">
          {count} {count === 1 ? "layer" : "layers"} selected
        </div>
        <p className="mt-0.5 text-xs text-[var(--studio-text-muted)]">
          Multi-edit ships in Phase 3. For now, you can delete all or group
          them once that lands.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleDeleteAll}
          disabled={count === 0}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-rose-500/40 bg-transparent px-3 py-2 text-sm font-medium text-rose-300 transition-colors hover:bg-rose-500/20 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* why: inline trash SVG — mirrors CanvasEditor.tsx's TrashIcon for visual consistency. */}
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
          Delete all
        </button>

        <button
          type="button"
          disabled
          title="Coming in Phase 3"
          aria-label="Group (coming in Phase 3)"
          className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-3 py-2 text-sm font-medium text-[var(--studio-text-faint)]"
        >
          {/* why: inline group SVG — two overlapping squares hints at the group concept. */}
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
          Group
          <span className="ml-1 rounded bg-[var(--studio-hover)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--studio-text-muted)]">
            Phase 3
          </span>
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--studio-text-muted)]">
        Tip: click an empty area of the canvas to clear the selection, then
        click a single layer to access full type, color, and image controls.
      </p>
    </div>
  );
}
