"use client";

/**
 * ContextualTopToolbar — Phase B.2
 * --------------------------------------------------------------------------
 *
 * Floating bar that sits above the canvas alongside the existing
 * SelectionToolbar. Surfaces the MOST common content-mutation controls
 * inline so Larissa doesn't need to round-trip to the right-side panel
 * for every font/color tweak.
 *
 * Modes:
 *   • text   → font picker, size, B/I/U toggles, fill color
 *   • shape  → fill color, stroke color, stroke width
 *   • multi  → align cluster (6 directions) + distribute (when ≥3)
 *   • image  → renders null (image-specific edits stay in the right
 *              panel — crop/replace/filters aren't well-served by a
 *              one-row floating bar).
 *
 * Why a separate component (vs. extending SelectionToolbar):
 *   SelectionToolbar's contract is "structural ops on a single
 *   unlocked layer" — adding content controls there would conflate
 *   two different concerns (structure vs. content) and balloon the
 *   prop surface. Two narrowly-scoped toolbars stacked vertically
 *   matches Canva's pattern and keeps each one easy to reason about.
 *
 * The toolbar reads + writes directly through Fabric's active object —
 * same pattern TextPropertiesControls/ShapePropertiesControls use in
 * the right panel. selectionVersion bumps trigger a fresh read so the
 * inline controls stay in sync with external mutations.
 */

import { Textbox } from "fabric";
import type { Canvas, FabricObject } from "fabric";
import {
  type JSX,
  useCallback,
  useEffect,
  useState,
} from "react";

import ColorPicker from "../primitives/ColorPicker";
import FontPicker, {
  type FontPickerOption,
} from "../primitives/FontPicker";
import { ALLIANCE_FONTS } from "../templates/tokens";
import { isGradientFill } from "../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ContextualMode = "text" | "image" | "shape" | "multi";

export type ContextualAlignDirection =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "distribute_horizontal"
  | "distribute_vertical";

interface ContextualTopToolbarProps {
  /** Fabric canvas — controls read + write the active object directly. */
  canvas: Canvas | null;
  /** Which mode-specific cluster to render. */
  mode: ContextualMode;
  /** Bumped by the orchestrator on every Fabric mutation; signals a re-read. */
  selectionVersion: number;
  /**
   * Multi-mode only — used to enable Distribute (requires ≥3 objects).
   * Ignored for single-object modes.
   */
  selectionCount?: number;
  /** Called after every mutation so the orchestrator can bump layerVersion. */
  onCanvasMutated?: () => void;
  /** Called after non-trivial discrete mutations so undo captures the step. */
  recordHistory?: () => void;
  /**
   * Multi-mode alignment dispatcher. Mirrors the footer's onAlign — the
   * orchestrator routes both to the same handler.
   */
  onAlign?: (direction: ContextualAlignDirection) => void;
}

// ---------------------------------------------------------------------------
// Shared font option list — mirrors TextPropertiesControls so both surfaces
// pick from the same family roster. Defined here so the toolbar doesn't
// import from a sibling control file.
// ---------------------------------------------------------------------------

const FONT_OPTIONS: ReadonlyArray<FontPickerOption> = [
  { label: "Inter", value: ALLIANCE_FONTS.bodySans, category: "Sans" },
  { label: "Montserrat", value: ALLIANCE_FONTS.montserrat, category: "Sans" },
  { label: "Poppins", value: ALLIANCE_FONTS.poppins, category: "Sans" },
  { label: "Lato", value: ALLIANCE_FONTS.lato, category: "Sans" },
  { label: "Oswald", value: ALLIANCE_FONTS.oswald, category: "Display" },
  { label: "Bebas Neue", value: ALLIANCE_FONTS.bebasNeue, category: "Display" },
  { label: "Georgia", value: ALLIANCE_FONTS.displaySerif, category: "Serif" },
  {
    label: "Playfair Display",
    value: ALLIANCE_FONTS.playfair,
    category: "Serif",
  },
  {
    label: "Cormorant Garamond",
    value: ALLIANCE_FONTS.cormorant,
    category: "Serif",
  },
  { label: "Lora", value: ALLIANCE_FONTS.lora, category: "Serif" },
  { label: "Merriweather", value: ALLIANCE_FONTS.merriweather, category: "Serif" },
  { label: "Pacifico", value: ALLIANCE_FONTS.pacifico, category: "Script" },
  { label: "SF Mono", value: ALLIANCE_FONTS.monoNum, category: "Mono" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the active Fabric object, narrowed for callers that need it. */
function readActive(canvas: Canvas | null): FabricObject | null {
  if (!canvas) return null;
  return canvas.getActiveObject() ?? null;
}

/**
 * Flush a mutation to Fabric: requestRenderAll + bump the parent + (optional)
 * snapshot history. why one helper: keeps the four control clusters from
 * drifting in how they finalize a change.
 */
function commit(
  canvas: Canvas | null,
  onCanvasMutated?: () => void,
  recordHistory?: () => void,
): void {
  canvas?.requestRenderAll();
  onCanvasMutated?.();
  recordHistory?.();
}

// ---------------------------------------------------------------------------
// Top-level component — branches by mode
// ---------------------------------------------------------------------------

export default function ContextualTopToolbar(
  props: ContextualTopToolbarProps,
): JSX.Element | null {
  switch (props.mode) {
    case "text":
      return <TextContextualControls {...props} />;
    case "shape":
      return <ShapeContextualControls {...props} />;
    case "multi":
      return <MultiContextualControls {...props} />;
    case "image":
      // why: image edits (crop, replace, filters) don't fit a one-row bar
      // — they live in the right panel. Returning null keeps the canvas
      // chrome clean when an image is selected.
      return null;
  }
}

// ===========================================================================
// TEXT cluster — font picker, size, B/I/U, fill color
// ===========================================================================

function TextContextualControls(props: ContextualTopToolbarProps): JSX.Element {
  const { canvas, selectionVersion, onCanvasMutated, recordHistory } = props;

  // Local mirror state — written through to Fabric on every input. Pattern
  // matches TextPropertiesControls; see that file's comment for the
  // "controlled input + bumped re-sync" rationale.
  const [state, setState] = useState<{
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    fontStyle: "normal" | "italic";
    underline: boolean;
    fill: string;
  } | null>(null);

  // Re-read on selection change / external mutation.
  useEffect(() => {
    const active = readActive(canvas);
    if (!(active instanceof Textbox)) {
      setState(null);
      return;
    }
    const fillRaw = active.fill;
    const fillHex =
      typeof fillRaw === "string" && fillRaw.length > 0
        ? fillRaw
        : "#000000";
    setState({
      fontFamily: String(active.fontFamily ?? ALLIANCE_FONTS.bodySans),
      fontSize: Number(active.fontSize ?? 48),
      fontWeight: Number(active.fontWeight ?? 400),
      fontStyle: (active.fontStyle === "italic" ? "italic" : "normal") as
        | "normal"
        | "italic",
      underline: Boolean(active.underline),
      fill: fillHex,
    });
  }, [canvas, selectionVersion]);

  const applyToActive = useCallback(
    (
      patch: Partial<{
        fontFamily: string;
        fontSize: number;
        fontWeight: number;
        fontStyle: "normal" | "italic";
        underline: boolean;
        fill: string;
      }>,
    ): void => {
      const active = readActive(canvas);
      if (!(active instanceof Textbox)) return;
      active.set(patch);
    },
    [canvas],
  );

  if (!state) return <span aria-hidden="true" />;

  const handleFontFamily = (next: string): void => {
    setState((prev) => (prev ? { ...prev, fontFamily: next } : prev));
    applyToActive({ fontFamily: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  const handleFontSize = (next: number): void => {
    if (!Number.isFinite(next) || next < 4 || next > 400) return;
    setState((prev) => (prev ? { ...prev, fontSize: next } : prev));
    applyToActive({ fontSize: next });
    // why: continuous edit (could be a stepper or typed value). Don't snapshot
    // on every keystroke — Agent B's debounced auto-snapshot covers it.
    canvas?.requestRenderAll();
    onCanvasMutated?.();
  };

  const handleBold = (): void => {
    const next = state.fontWeight >= 600 ? 400 : 700;
    setState((prev) => (prev ? { ...prev, fontWeight: next } : prev));
    applyToActive({ fontWeight: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  const handleItalic = (): void => {
    const next: "normal" | "italic" =
      state.fontStyle === "italic" ? "normal" : "italic";
    setState((prev) => (prev ? { ...prev, fontStyle: next } : prev));
    applyToActive({ fontStyle: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  const handleUnderline = (): void => {
    const next = !state.underline;
    setState((prev) => (prev ? { ...prev, underline: next } : prev));
    applyToActive({ underline: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  const handleFill = (next: string): void => {
    setState((prev) => (prev ? { ...prev, fill: next } : prev));
    applyToActive({ fill: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  return (
    <div className="flex items-center gap-1 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 shadow-elevated animate-fade-in-up">
      {/* Font family — full picker, compact width. */}
      <div className="w-40">
        <FontPicker
          value={state.fontFamily}
          onChange={handleFontFamily}
          options={FONT_OPTIONS}
        />
      </div>
      <span className="h-5 w-px bg-neutral-200" />
      {/* Font size — numeric stepper. */}
      <input
        type="number"
        min={4}
        max={400}
        step={1}
        value={Math.round(state.fontSize)}
        onChange={(e) => handleFontSize(Number(e.target.value))}
        aria-label="Font size"
        className="h-7 w-14 rounded-md border border-neutral-200 bg-white px-1.5 text-center text-[12px] font-medium text-neutral-800 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-300"
      />
      <span className="h-5 w-px bg-neutral-200" />
      {/* B / I / U toggles. */}
      <ToggleIconButton
        label="Bold"
        active={state.fontWeight >= 600}
        onClick={handleBold}
      >
        <strong className="text-[13px] leading-none">B</strong>
      </ToggleIconButton>
      <ToggleIconButton
        label="Italic"
        active={state.fontStyle === "italic"}
        onClick={handleItalic}
      >
        <em className="text-[13px] leading-none">I</em>
      </ToggleIconButton>
      <ToggleIconButton
        label="Underline"
        active={state.underline}
        onClick={handleUnderline}
      >
        <span className="text-[13px] leading-none underline">U</span>
      </ToggleIconButton>
      <span className="h-5 w-px bg-neutral-200" />
      {/* Fill color — compact swatch trigger. */}
      <div className="flex items-center">
        <ColorPicker
          value={state.fill}
          onChange={handleFill}
          label="Text color"
          compact
          canvas={canvas}
        />
      </div>
    </div>
  );
}

// ===========================================================================
// SHAPE cluster — fill color, stroke color, stroke width
// ===========================================================================

function ShapeContextualControls(
  props: ContextualTopToolbarProps,
): JSX.Element {
  const { canvas, selectionVersion, onCanvasMutated, recordHistory } = props;

  const [state, setState] = useState<{
    fill: string;
    stroke: string;
    strokeWidth: number;
  } | null>(null);

  useEffect(() => {
    const active = readActive(canvas);
    if (!active) {
      setState(null);
      return;
    }
    const fillRaw = active.fill;
    // why: ShapeLayer supports gradient fills (Phase A.3). The contextual
    // bar's swatch only edits flat-color fills; gradient-filled shapes
    // surface a neutral chip and the user opens the right panel to mutate
    // the gradient stops. We detect by either Fabric's Gradient instance
    // or the schema-level isGradientFill helper on the raw value.
    let fillForChip = "#000000";
    if (typeof fillRaw === "string" && fillRaw.length > 0) {
      fillForChip = fillRaw;
    } else if (fillRaw && isGradientFill(fillRaw as unknown)) {
      // Render a neutral chip; the picker click is still wired but applies
      // a solid color, replacing the gradient. User intent on gradient
      // editing is captured in the right panel.
      fillForChip = "#A3A3A3";
    }
    const strokeRaw = active.stroke;
    const strokeHex =
      typeof strokeRaw === "string" && strokeRaw.length > 0
        ? strokeRaw
        : "transparent";
    setState({
      fill: fillForChip,
      stroke: strokeHex,
      strokeWidth: Number(active.strokeWidth ?? 0),
    });
  }, [canvas, selectionVersion]);

  if (!state) return <span aria-hidden="true" />;

  const applyAndCommit = (patch: Record<string, unknown>): void => {
    const active = readActive(canvas);
    if (!active) return;
    active.set(patch);
    commit(canvas, onCanvasMutated, recordHistory);
  };

  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 shadow-elevated animate-fade-in-up">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Fill
        </span>
        <ColorPicker
          value={state.fill}
          onChange={(next) => {
            setState((prev) => (prev ? { ...prev, fill: next } : prev));
            applyAndCommit({ fill: next });
          }}
          label="Fill"
          allowTransparent
          compact
          canvas={canvas}
        />
      </div>
      <span className="h-5 w-px bg-neutral-200" />
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Stroke
        </span>
        <ColorPicker
          value={state.stroke}
          onChange={(next) => {
            setState((prev) => (prev ? { ...prev, stroke: next } : prev));
            applyAndCommit({ stroke: next });
          }}
          label="Stroke"
          allowTransparent
          compact
          canvas={canvas}
        />
      </div>
      <span className="h-5 w-px bg-neutral-200" />
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Width
        </span>
        <input
          type="number"
          min={0}
          max={50}
          step={1}
          value={Math.round(state.strokeWidth)}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next) || next < 0 || next > 50) return;
            setState((prev) => (prev ? { ...prev, strokeWidth: next } : prev));
            const active = readActive(canvas);
            if (!active) return;
            active.set({ strokeWidth: next });
            canvas?.requestRenderAll();
            onCanvasMutated?.();
          }}
          aria-label="Stroke width"
          className="h-7 w-12 rounded-md border border-neutral-200 bg-white px-1.5 text-center text-[12px] font-medium text-neutral-800 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-300"
        />
      </div>
    </div>
  );
}

// ===========================================================================
// MULTI cluster — alignment + distribute (mirrors footer's onAlign)
// ===========================================================================

function MultiContextualControls(
  props: ContextualTopToolbarProps,
): JSX.Element {
  const { onAlign, selectionCount = 0 } = props;
  const canDistribute = selectionCount >= 3;

  const fire = (direction: ContextualAlignDirection): void => {
    onAlign?.(direction);
  };

  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-neutral-200 bg-white px-2 py-1.5 shadow-elevated animate-fade-in-up">
      <span className="ml-1 mr-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {selectionCount} selected
      </span>
      <span className="h-5 w-px bg-neutral-200" />
      <IconBtn label="Align left" onClick={() => fire("left")}>
        <AlignLeftGlyph />
      </IconBtn>
      <IconBtn label="Align center" onClick={() => fire("center")}>
        <AlignCenterGlyph />
      </IconBtn>
      <IconBtn label="Align right" onClick={() => fire("right")}>
        <AlignRightGlyph />
      </IconBtn>
      <span className="h-5 w-px bg-neutral-200" />
      <IconBtn label="Align top" onClick={() => fire("top")}>
        <AlignTopGlyph />
      </IconBtn>
      <IconBtn label="Align middle" onClick={() => fire("middle")}>
        <AlignMiddleGlyph />
      </IconBtn>
      <IconBtn label="Align bottom" onClick={() => fire("bottom")}>
        <AlignBottomGlyph />
      </IconBtn>
      <span className="h-5 w-px bg-neutral-200" />
      <IconBtn
        label={
          canDistribute
            ? "Distribute horizontally"
            : "Distribute horizontally (needs 3+)"
        }
        onClick={() => fire("distribute_horizontal")}
        disabled={!canDistribute}
      >
        <DistributeHorizontalGlyph />
      </IconBtn>
      <IconBtn
        label={
          canDistribute
            ? "Distribute vertically"
            : "Distribute vertically (needs 3+)"
        }
        onClick={() => fire("distribute_vertical")}
        disabled={!canDistribute}
      >
        <DistributeVerticalGlyph />
      </IconBtn>
    </div>
  );
}

// ===========================================================================
// Atoms — toggle button + plain icon button + glyphs
// ===========================================================================

function ToggleIconButton(props: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        props.active
          ? "bg-neutral-900 text-white"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      }`}
    >
      {props.children}
    </button>
  );
}

function IconBtn(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent"
    >
      {props.children}
    </button>
  );
}

// Glyphs mirror those used in the canvas footer — kept self-contained so this
// component doesn't have to reach back into CanvasEditor.tsx for SVGs.
function AlignLeftGlyph(): JSX.Element {
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
      <path d="M2 2v12" />
      <rect x="3" y="4" width="9" height="3" />
      <rect x="3" y="9" width="6" height="3" />
    </svg>
  );
}
function AlignCenterGlyph(): JSX.Element {
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
      <path d="M8 2v12" />
      <rect x="3.5" y="4" width="9" height="3" />
      <rect x="5" y="9" width="6" height="3" />
    </svg>
  );
}
function AlignRightGlyph(): JSX.Element {
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
      <path d="M14 2v12" />
      <rect x="4" y="4" width="9" height="3" />
      <rect x="7" y="9" width="6" height="3" />
    </svg>
  );
}
function AlignTopGlyph(): JSX.Element {
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
      <path d="M2 2h12" />
      <rect x="4" y="3" width="3" height="9" />
      <rect x="9" y="3" width="3" height="6" />
    </svg>
  );
}
function AlignMiddleGlyph(): JSX.Element {
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
      <path d="M2 8h12" />
      <rect x="4" y="3.5" width="3" height="9" />
      <rect x="9" y="5" width="3" height="6" />
    </svg>
  );
}
function AlignBottomGlyph(): JSX.Element {
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
      <path d="M2 14h12" />
      <rect x="4" y="3" width="3" height="9" />
      <rect x="9" y="6" width="3" height="6" />
    </svg>
  );
}
function DistributeHorizontalGlyph(): JSX.Element {
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
      <rect x="1.5" y="4" width="2.5" height="8" />
      <rect x="6.75" y="4" width="2.5" height="8" />
      <rect x="12" y="4" width="2.5" height="8" />
    </svg>
  );
}
function DistributeVerticalGlyph(): JSX.Element {
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
      <rect x="4" y="1.5" width="8" height="2.5" />
      <rect x="4" y="6.75" width="8" height="2.5" />
      <rect x="4" y="12" width="8" height="2.5" />
    </svg>
  );
}

