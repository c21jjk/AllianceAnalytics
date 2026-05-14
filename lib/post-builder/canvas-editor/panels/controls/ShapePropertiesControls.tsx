"use client";

/**
 * ShapePropertiesControls — Phase 2, Agent A
 * --------------------------------------------
 *
 * Properties panel for an active Fabric shape (Rect / Circle / Ellipse /
 * Line). Provides fill + stroke ColorPickers, stroke-width numeric, a corner
 * radius slider that only renders for rectangles, and an opacity slider.
 *
 * Why detect shape kind by `obj.type` rather than the schema's shapeType:
 *   The orchestrator's selection events only hand us the FabricObject. The
 *   schema layer it came from is one layer panel hop away. Reading
 *   `obj.constructor.name` (or `obj.type` in v6) is the path of least
 *   resistance — no extra lookup, no risk of stale layer-id data. Fabric's
 *   `static type` field returns the lowercase class name ("rect", "circle",
 *   "ellipse", "line").
 */

import { Circle, Ellipse, Line, Rect } from "fabric";
import type { Canvas, FabricObject } from "fabric";
import {
  type ChangeEvent,
  type JSX,
  useCallback,
  useEffect,
  useState,
} from "react";

import ColorPicker from "../../primitives/ColorPicker";

interface ShapePropertiesControlsProps {
  canvas: Canvas | null;
  selectionVersion: number;
  onCanvasMutated?: () => void;
  recordHistory?: () => void;
}

/** Narrow ShapeKind that mirrors our schema's shapeType union. */
type ShapeKind = "rect" | "circle" | "ellipse" | "line" | "unknown";

interface ShapeState {
  shapeKind: ShapeKind;
  /** Hex or "transparent" / "". Fabric stores undefined for no-fill; we surface that as "transparent". */
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Only meaningful for rect — ignored for non-rect shapes. */
  cornerRadius: number;
  /** 0..1 Fabric opacity. */
  opacity: number;
}

/**
 * Identify the active shape's kind via instanceof checks. Order matters —
 * Circle extends Ellipse-ish base in some versions, so we check Circle first.
 */
function detectShapeKind(obj: FabricObject): ShapeKind {
  if (obj instanceof Rect) return "rect";
  if (obj instanceof Circle) return "circle";
  if (obj instanceof Ellipse) return "ellipse";
  if (obj instanceof Line) return "line";
  return "unknown";
}

/**
 * Coerce Fabric's `fill`/`stroke` (typed `TFiller | string | null`) to a
 * string our ColorPicker accepts. Gradients/patterns aren't supported in the
 * canvas editor yet — they collapse to an empty string which the picker
 * renders as transparent.
 */
function readColorValue(raw: unknown): string {
  if (typeof raw === "string") return raw;
  // why: null / undefined / gradient / pattern all surface as "no value" in
  // the picker. We don't try to introspect TFiller objects — Phase 3 may add
  // gradient support, at which point we'll widen this.
  return "";
}

function readShapeState(canvas: Canvas | null): ShapeState | null {
  if (!canvas) return null;
  const active = canvas.getActiveObject();
  if (!active) return null;
  const kind = detectShapeKind(active);
  if (kind === "unknown") return null;
  // why: cast to Rect for cornerRadius read. The cast is safe because we only
  // read rx when kind === "rect".
  const rect = active instanceof Rect ? active : null;
  return {
    shapeKind: kind,
    fill: readColorValue(active.fill),
    stroke: readColorValue(active.stroke),
    strokeWidth:
      typeof active.strokeWidth === "number" ? active.strokeWidth : 0,
    cornerRadius: rect ? (rect.rx ?? 0) : 0,
    opacity: typeof active.opacity === "number" ? active.opacity : 1,
  };
}

export default function ShapePropertiesControls(
  props: ShapePropertiesControlsProps,
): JSX.Element {
  const { canvas, selectionVersion, onCanvasMutated, recordHistory } = props;
  const [state, setState] = useState<ShapeState | null>(() =>
    readShapeState(canvas),
  );

  useEffect(() => {
    setState(readShapeState(canvas));
  }, [canvas, selectionVersion]);

  /**
   * Apply a partial mutation to the active shape. Centralizes the
   * read-active → set → render → bump-version pipeline.
   *
   * Why discriminate fill via undefined-when-empty:
   *   Fabric treats `fill: ""` as "an empty string" and renders nothing-
   *   visible-but-still-paints. Setting `fill: undefined` is the correct
   *   "no fill" state. Our ColorPicker uses "transparent" or "" — both
   *   collapse to undefined here.
   */
  const applyMutation = useCallback(
    (partial: Partial<ShapeState>, shouldRecord: boolean): void => {
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active) return;
      const fabricPatch: Record<string, unknown> = {};
      if (partial.fill !== undefined) {
        fabricPatch.fill =
          partial.fill === "" || partial.fill === "transparent"
            ? undefined
            : partial.fill;
      }
      if (partial.stroke !== undefined) {
        fabricPatch.stroke =
          partial.stroke === "" || partial.stroke === "transparent"
            ? undefined
            : partial.stroke;
      }
      if (partial.strokeWidth !== undefined) {
        fabricPatch.strokeWidth = partial.strokeWidth;
      }
      if (partial.opacity !== undefined) {
        fabricPatch.opacity = partial.opacity;
      }
      if (partial.cornerRadius !== undefined && active instanceof Rect) {
        // why: Rect uses rx + ry for corner radius. We set both equally for a
        // uniform rounded rectangle. Non-rect shapes ignore cornerRadius via
        // the conditional render below.
        fabricPatch.rx = partial.cornerRadius;
        fabricPatch.ry = partial.cornerRadius;
      }
      active.set(fabricPatch);
      // why: Fabric caches stroke + fill computations per-render. Force a
      // dirty flag so the next renderAll picks up the new paint correctly.
      active.dirty = true;
      canvas.requestRenderAll();
      setState((prev) => (prev ? { ...prev, ...partial } : prev));
      onCanvasMutated?.();
      if (shouldRecord) recordHistory?.();
    },
    [canvas, onCanvasMutated, recordHistory],
  );

  const handleFillChange = useCallback(
    (next: string) => applyMutation({ fill: next }, true),
    [applyMutation],
  );

  const handleStrokeChange = useCallback(
    (next: string) => applyMutation({ stroke: next }, true),
    [applyMutation],
  );

  const handleStrokeWidthChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      applyMutation({ strokeWidth: next }, false);
    },
    [applyMutation],
  );

  const handleCornerRadiusChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      applyMutation({ cornerRadius: next }, false);
    },
    [applyMutation],
  );

  const handleOpacityChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const pct = Number(e.target.value);
      if (!Number.isFinite(pct)) return;
      applyMutation({ opacity: pct / 100 }, false);
    },
    [applyMutation],
  );

  const handleCommit = useCallback(() => {
    recordHistory?.();
  }, [recordHistory]);

  if (!state) {
    return (
      <div className="px-4 py-6 text-sm text-neutral-400">
        Select a shape layer to edit its properties.
      </div>
    );
  }

  // why: corner radius only makes sense for rectangles. Circle / Ellipse /
  // Line all hide the control. Lines additionally hide fill (lines are
  // stroke-only in Fabric).
  const showCornerRadius = state.shapeKind === "rect";
  const showFill = state.shapeKind !== "line";

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* ===== Fill ===== */}
      {showFill ? (
        <Section title="Fill">
          <div className="flex items-center gap-2">
            <ColorPicker
              label=""
              value={state.fill || "transparent"}
              onChange={handleFillChange}
              allowTransparent
              canvas={canvas}
            />
            <span className="font-mono text-xs uppercase text-neutral-500">
              {state.fill || "transparent"}
            </span>
          </div>
        </Section>
      ) : null}

      {/* ===== Stroke color ===== */}
      <Section title="Stroke">
        <div className="flex items-center gap-2">
          <ColorPicker
            label=""
            value={state.stroke || "transparent"}
            onChange={handleStrokeChange}
            allowTransparent
            canvas={canvas}
          />
          <span className="font-mono text-xs uppercase text-neutral-500">
            {state.stroke || "transparent"}
          </span>
        </div>
      </Section>

      {/* ===== Stroke width ===== */}
      <Section title="Stroke Width">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={state.strokeWidth}
            min={0}
            max={50}
            onChange={handleStrokeWidthChange}
            onBlur={handleCommit}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
          />
          <input
            type="range"
            min={0}
            max={50}
            value={state.strokeWidth}
            onChange={handleStrokeWidthChange}
            onMouseUp={handleCommit}
            onTouchEnd={handleCommit}
            className="flex-1 accent-gold-500"
          />
        </div>
      </Section>

      {/* ===== Corner radius (rect only) ===== */}
      {showCornerRadius ? (
        <Section title="Corner Radius">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={state.cornerRadius}
              min={0}
              max={200}
              onChange={handleCornerRadiusChange}
              onBlur={handleCommit}
              className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
            />
            <input
              type="range"
              min={0}
              max={200}
              value={state.cornerRadius}
              onChange={handleCornerRadiusChange}
              onMouseUp={handleCommit}
              onTouchEnd={handleCommit}
              className="flex-1 accent-gold-500"
            />
          </div>
        </Section>
      ) : null}

      {/* ===== Opacity ===== */}
      <Section title="Opacity">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={Math.round(state.opacity * 100)}
            min={0}
            max={100}
            onChange={handleOpacityChange}
            onBlur={handleCommit}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
          />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(state.opacity * 100)}
            onChange={handleOpacityChange}
            onMouseUp={handleCommit}
            onTouchEnd={handleCommit}
            className="flex-1 accent-gold-500"
          />
          <span className="w-8 text-right text-xs text-neutral-500">
            {Math.round(state.opacity * 100)}%
          </span>
        </div>
      </Section>
    </div>
  );
}

// ===========================================================================
// Section subcomponent — small uppercase eyebrow + child renderer
// ===========================================================================

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section(props: SectionProps): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {props.title}
      </div>
      {props.children}
    </div>
  );
}
