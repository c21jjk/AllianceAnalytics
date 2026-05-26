"use client";

/**
 * FloatingToolbar — unified floating pill above the canvas
 * --------------------------------------------------------------------------
 *
 * Replaces the previous two-pill setup (ContextualTopToolbar +
 * SelectionToolbar). One single horizontal pill that adapts its left-most
 * group based on the active selection's kind, then always shows alignment
 * + layer actions on the right.
 *
 *   [type-specific controls]  |  [alignment]  |  [layer actions]
 *
 * Modes (drives Group 1 only):
 *   • text   → font / size / color / B/I/U/S / case / align / spacing / effects
 *   • shape  → fill / stroke / width
 *   • image  → resize / crop
 *   • multi  → Group 1 is suppressed (alignment + layer actions cover it)
 *
 * Group 2 (alignment) is always rendered when any selection exists.
 * Group 3 (layer actions) is rendered only for single-object selections
 * (multi-selection layer-ops are deliberately scoped to per-object work).
 *
 * Lives inside the same wrapper the old two-pill stack used — the parent
 * still owns positioning. This component is otherwise self-contained and
 * absorbs all the controls that used to live in ContextualTopToolbar +
 * SelectionToolbar + TransparencyButton.
 */

import { Textbox } from "fabric";
import type { Canvas, FabricObject } from "fabric";
import {
  AlignCenter as LAlignCenter,
  AlignLeft as LAlignLeft,
  AlignRight as LAlignRight,
  AlignVerticalJustifyCenter as LAlignMiddle,
  AlignVerticalJustifyEnd as LAlignBottom,
  AlignVerticalJustifyStart as LAlignTop,
  ArrowDown as LArrowDown,
  ArrowUp as LArrowUp,
  Copy as LCopy,
  Crop as LCrop,
  Lock as LLock,
  Maximize2 as LMaximize2,
  Trash2 as LTrash2,
} from "lucide-react";
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { ColorTarget } from "./ColorPickerPanel";
import ColorPicker from "../primitives/ColorPicker";
import FontPicker from "../primitives/FontPicker";
import { FONT_OPTIONS } from "../primitives/font-options";
import Tooltip from "../primitives/Tooltip";
import { ALLIANCE_FONTS } from "../templates/tokens";
import { isGradientFill } from "../types";
import type { CanvasLayer } from "../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FloatingToolbarMode = "text" | "image" | "shape" | "multi";

export type FloatingAlignDirection =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";

interface FloatingToolbarProps {
  /** Fabric canvas — type-specific controls read + write the active object directly. */
  canvas: Canvas | null;
  /** Which mode-specific cluster to render in Group 1. */
  mode: FloatingToolbarMode;
  /** Bumped by the orchestrator on every Fabric mutation; signals a re-read. */
  selectionVersion: number;
  /** Multi-mode only — disables/enables UI affordances that depend on N selected. */
  selectionCount?: number;
  /** Layer-actions group — only rendered when this is non-null (single selection). */
  selectedEntry?: {
    kind: CanvasLayer["kind"];
    locked: boolean;
  } | null;
  /** Called after every mutation so the orchestrator can bump layerVersion. */
  onCanvasMutated?: () => void;
  /** Called after non-trivial discrete mutations so undo captures the step. */
  recordHistory?: () => void;
  /**
   * Alignment dispatcher. Fires for both single-object (align to canvas) and
   * multi (align within bounding box). Distribute is intentionally not
   * exposed here — it was removed during the 2026-05-26 consolidation.
   */
  onAlign?: (direction: FloatingAlignDirection) => void;
  // ---- Image-mode handlers ----
  onEnterCropMode?: () => void;
  onActivateResize?: () => void;
  // ---- Text-mode panel-trigger wiring ----
  onOpenFontPicker?: () => void;
  fontPickerOpen?: boolean;
  onOpenEffectsPanel?: () => void;
  effectsPanelOpen?: boolean;
  // ---- Color-picker wiring (text / shape modes) ----
  onOpenColorPicker?: (target: ColorTarget, currentValue: string) => void;
  colorPickerOpenTarget?: ColorTarget | null;
  // ---- Layer actions (Group 3) ----
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onDuplicate?: () => void;
  onToggleLock?: () => void;
  onDelete?: () => void;
  /** Optional callback after the opacity slider releases so undo captures it. */
  onOpacityCommit?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readActive(canvas: Canvas | null): FabricObject | null {
  if (!canvas) return null;
  return canvas.getActiveObject() ?? null;
}

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
// Top-level component
// ---------------------------------------------------------------------------

export default function FloatingToolbar(
  props: FloatingToolbarProps,
): JSX.Element | null {
  const {
    mode,
    selectedEntry,
    onAlign,
    onBringForward,
    onSendBackward,
    onDuplicate,
    onToggleLock,
    onDelete,
    canvas,
    selectionVersion,
    onCanvasMutated,
    onOpacityCommit,
  } = props;


  // Show layer actions for any non-locked single selection.
  const showLayerActions =
    selectedEntry !== undefined &&
    selectedEntry !== null &&
    !selectedEntry.locked &&
    Boolean(
      onBringForward ?? onSendBackward ?? onDuplicate ?? onToggleLock ?? onDelete,
    );

  // Type-specific group is suppressed in multi-mode by design.
  const showTypeGroup = mode !== "multi";
  const showAlignment = Boolean(onAlign);

  // Nothing to show? Render nothing — matches old behavior of hiding the
  // pill entirely when there's no selection.
  if (!showTypeGroup && !showAlignment && !showLayerActions) return null;

  return (
    <div
      className="flex max-w-[95vw] flex-wrap items-center gap-1 rounded-full border border-[var(--studio-border)] bg-[var(--studio-popover)] px-2 py-1.5 text-white shadow-2xl shadow-black/40 animate-fade-in-up"
      role="toolbar"
      aria-label="Selection toolbar"
    >
      {showTypeGroup ? <TypeSpecificGroup {...props} /> : null}
      {showTypeGroup && showAlignment ? <GroupDivider /> : null}
      {showAlignment ? <AlignmentGroup onAlign={onAlign} /> : null}
      {(showTypeGroup || showAlignment) && showLayerActions ? (
        <GroupDivider />
      ) : null}
      {showLayerActions ? (
        <LayerActionsGroup
          canvas={canvas}
          selectionVersion={selectionVersion}
          onBringForward={onBringForward}
          onSendBackward={onSendBackward}
          onDuplicate={onDuplicate}
          onToggleLock={onToggleLock}
          onDelete={onDelete}
          onCanvasMutated={onCanvasMutated}
          onOpacityCommit={onOpacityCommit}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group 1 — type-specific controls (dispatcher)
// ---------------------------------------------------------------------------

function TypeSpecificGroup(props: FloatingToolbarProps): JSX.Element | null {
  switch (props.mode) {
    case "text":
      return <TextControls {...props} />;
    case "shape":
      return <ShapeControls {...props} />;
    case "image":
      return <ImageControls {...props} />;
    case "multi":
      return null;
  }
}

// ===========================================================================
// IMAGE controls — Crop + Resize
// ===========================================================================

function ImageControls(props: FloatingToolbarProps): JSX.Element | null {
  const { onEnterCropMode, onActivateResize } = props;
  if (!onEnterCropMode && !onActivateResize) return null;
  return (
    <div className="flex items-center gap-1">
      {onActivateResize ? (
        <Tooltip label="Resize photo — drag handles to scale">
          <button
            type="button"
            onClick={onActivateResize}
            className="focus-ring-dark inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-white hover:bg-[var(--studio-hover)]"
          >
            <LMaximize2 size={14} />
            <span>Resize</span>
          </button>
        </Tooltip>
      ) : null}
      {onEnterCropMode ? (
        <Tooltip label="Crop / reposition photo">
          <button
            type="button"
            onClick={onEnterCropMode}
            className="focus-ring-dark inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-white hover:bg-[var(--studio-hover)]"
          >
            <LCrop size={14} />
            <span>Crop</span>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ===========================================================================
// TEXT controls — font / size / color / B/I/U/S / case / align / spacing / effects
// ===========================================================================

function TextControls(props: FloatingToolbarProps): JSX.Element {
  const {
    canvas,
    selectionVersion,
    onCanvasMutated,
    recordHistory,
    onOpenFontPicker,
    fontPickerOpen = false,
    onOpenEffectsPanel,
    effectsPanelOpen = false,
    onOpenColorPicker,
    colorPickerOpenTarget = null,
  } = props;

  const [state, setState] = useState<{
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    fontStyle: "normal" | "italic";
    underline: boolean;
    linethrough: boolean;
    fill: string;
    textAlign: "left" | "center" | "right" | "justify";
    lineHeight: number;
    charSpacing: number;
  } | null>(null);

  useEffect(() => {
    const active = readActive(canvas);
    if (!(active instanceof Textbox)) {
      setState(null);
      return;
    }
    const fillRaw = active.fill;
    const fillHex =
      typeof fillRaw === "string" && fillRaw.length > 0 ? fillRaw : "#000000";
    const rawAlign = (active.textAlign ?? "left") as string;
    const align: "left" | "center" | "right" | "justify" =
      rawAlign === "center" ||
      rawAlign === "right" ||
      rawAlign === "justify"
        ? rawAlign
        : "left";
    setState({
      fontFamily: String(active.fontFamily ?? ALLIANCE_FONTS.bodySans),
      fontSize: Number(active.fontSize ?? 48),
      fontWeight: Number(active.fontWeight ?? 400),
      fontStyle: (active.fontStyle === "italic" ? "italic" : "normal") as
        | "normal"
        | "italic",
      underline: Boolean(active.underline),
      linethrough: Boolean(active.linethrough),
      fill: fillHex,
      textAlign: align,
      lineHeight:
        typeof active.lineHeight === "number" ? active.lineHeight : 1.16,
      charSpacing:
        typeof active.charSpacing === "number" ? active.charSpacing : 0,
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
        linethrough: boolean;
        fill: string;
        textAlign: "left" | "center" | "right" | "justify";
        lineHeight: number;
        charSpacing: number;
        text: string;
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
    canvas?.requestRenderAll();
    onCanvasMutated?.();
  };

  const handleSizeStep = (delta: number): void => {
    const next = Math.max(4, Math.min(400, Math.round(state.fontSize + delta)));
    setState((prev) => (prev ? { ...prev, fontSize: next } : prev));
    applyToActive({ fontSize: next });
    commit(canvas, onCanvasMutated, recordHistory);
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

  const handleStrikethrough = (): void => {
    const next = !state.linethrough;
    setState((prev) => (prev ? { ...prev, linethrough: next } : prev));
    applyToActive({ linethrough: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  const handleAlignText = (
    next: "left" | "center" | "right" | "justify",
  ): void => {
    setState((prev) => (prev ? { ...prev, textAlign: next } : prev));
    applyToActive({ textAlign: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  const handleLineHeight = (next: number): void => {
    if (!Number.isFinite(next) || next < 0.5 || next > 3) return;
    setState((prev) => (prev ? { ...prev, lineHeight: next } : prev));
    applyToActive({ lineHeight: next });
    canvas?.requestRenderAll();
    onCanvasMutated?.();
  };

  const handleCharSpacing = (next: number): void => {
    if (!Number.isFinite(next) || next < -200 || next > 1000) return;
    setState((prev) => (prev ? { ...prev, charSpacing: next } : prev));
    applyToActive({ charSpacing: next });
    canvas?.requestRenderAll();
    onCanvasMutated?.();
  };

  const handleCycleCase = (): void => {
    const active = readActive(canvas);
    if (!(active instanceof Textbox)) return;
    const current = String(active.text ?? "");
    const next = cycleLetterCase(current);
    applyToActive({ text: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  // why: text-mode "Position" popover lets the user dispatch single-axis
  // canvas alignment from the text controls themselves — matches the old
  // ContextualTopToolbar behavior. The dedicated alignment group (Group 2)
  // already covers this, but the inline popover is kept for muscle memory.

  return (
    <div className="flex items-center gap-1">
      {/* === 1. Font family === */}
      <div className="w-36">
        <FontPicker
          value={state.fontFamily}
          onChange={handleFontFamily}
          options={FONT_OPTIONS}
          panelMode={Boolean(onOpenFontPicker)}
          onOpenPanel={onOpenFontPicker}
          panelOpen={fontPickerOpen}
        />
      </div>
      <Divider />

      {/* === 2. Font size stepper === */}
      <div className="flex items-center gap-0.5 rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-1">
        <StepperButton
          label="Decrease font size"
          onClick={() => handleSizeStep(-1)}
        >
          −
        </StepperButton>
        <input
          type="number"
          min={4}
          max={400}
          step={1}
          value={Math.round(state.fontSize)}
          onChange={(e) => handleFontSize(Number(e.target.value))}
          aria-label="Font size"
          className="h-6 w-10 border-0 bg-transparent p-0 text-center text-[12px] font-medium text-white focus:outline-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
        />
        <StepperButton
          label="Increase font size"
          onClick={() => handleSizeStep(+1)}
        >
          +
        </StepperButton>
      </div>
      <Divider />

      {/* === 3. Text color === */}
      <div className="flex items-center">
        <ColorPicker
          value={state.fill}
          target="text"
          onOpenPanel={(t, v) => onOpenColorPicker?.(t, v)}
          label="Text color"
          compact
          panelOpen={colorPickerOpenTarget === "text"}
        />
      </div>
      <Divider />

      {/* === 4-7. B / I / U / S === */}
      <ToggleIconButton
        label="Bold (B)"
        active={state.fontWeight >= 600}
        onClick={handleBold}
      >
        <strong className="text-[13px] leading-none">B</strong>
      </ToggleIconButton>
      <ToggleIconButton
        label="Italic (I)"
        active={state.fontStyle === "italic"}
        onClick={handleItalic}
      >
        <em className="text-[13px] leading-none">I</em>
      </ToggleIconButton>
      <ToggleIconButton
        label="Underline (U)"
        active={state.underline}
        onClick={handleUnderline}
      >
        <span className="text-[13px] leading-none underline">U</span>
      </ToggleIconButton>
      <ToggleIconButton
        label="Strikethrough"
        active={state.linethrough}
        onClick={handleStrikethrough}
      >
        <span className="text-[13px] leading-none line-through">S</span>
      </ToggleIconButton>
      <Divider />

      {/* === 8. Letter case === */}
      <IconBtn label="Letter case" onClick={handleCycleCase}>
        <span className="text-[12px] font-semibold leading-none">aA</span>
      </IconBtn>

      {/* === 9. Text alignment popover === */}
      <Popover
        label="Text alignment"
        trigger={<TextAlignGlyph dir={state.textAlign} />}
      >
        {(close) => (
          <div className="flex items-center gap-0.5 p-1">
            {(["left", "center", "right", "justify"] as const).map((dir) => (
              <PopoverIconButton
                key={dir}
                label={`Align ${dir}`}
                active={state.textAlign === dir}
                onClick={() => {
                  handleAlignText(dir);
                  close();
                }}
              >
                <TextAlignGlyph dir={dir} />
              </PopoverIconButton>
            ))}
          </div>
        )}
      </Popover>

      {/* === 10. Spacing popover === */}
      <Popover label="Spacing" trigger={<LineSpacingIcon />}>
        {() => (
          <div className="w-56 space-y-3 p-3">
            <SpacingSlider
              label="Line spacing"
              min={0.5}
              max={3}
              step={0.05}
              value={state.lineHeight}
              format={(v) => v.toFixed(2)}
              onChange={handleLineHeight}
              onCommit={() => recordHistory?.()}
            />
            <SpacingSlider
              label="Letter spacing"
              min={-100}
              max={500}
              step={5}
              value={state.charSpacing}
              format={(v) => `${Math.round(v)}`}
              onChange={handleCharSpacing}
              onCommit={() => recordHistory?.()}
            />
          </div>
        )}
      </Popover>

      {/* === 11. Effects — opens left-rail EffectsPanel === */}
      <Tooltip label="Effects">
        <button
          type="button"
          onClick={() => onOpenEffectsPanel?.()}
          aria-haspopup="dialog"
          aria-expanded={effectsPanelOpen}
          aria-label="Effects"
          className={`focus-ring-dark inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${
            effectsPanelOpen
              ? "bg-gold-500/15 text-gold-300"
              : "text-white hover:bg-[var(--studio-hover)]"
          }`}
        >
          <EffectsIcon />
        </button>
      </Tooltip>

      {/* why: the legacy "Position" popover (canvas-alignment from inside
          text mode) was removed during the 2026-05-26 consolidation — the
          dedicated Alignment group (Group 2) is now visible at all times so
          we no longer need an in-line popover restating the same six
          directions. `onAlign` is consumed by the parent's Group 2. */}
    </div>
  );
}

// ===========================================================================
// SHAPE controls — fill / stroke / width
// ===========================================================================

function ShapeControls(props: FloatingToolbarProps): JSX.Element {
  const {
    canvas,
    selectionVersion,
    onCanvasMutated,
    recordHistory,
    onOpenColorPicker,
    colorPickerOpenTarget = null,
  } = props;

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
    let fillForChip = "#000000";
    if (typeof fillRaw === "string" && fillRaw.length > 0) {
      fillForChip = fillRaw;
    } else if (fillRaw && isGradientFill(fillRaw as unknown)) {
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
  // why: recordHistory accepted for parity with TextControls; live shape
  // editing recordings happen inside ColorPickerPanel / strokeWidth blur
  // path. Touched so unused-arg lint doesn't fire.
  void recordHistory;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
          Fill
        </span>
        <ColorPicker
          value={state.fill}
          target="shape_fill"
          onOpenPanel={(t, v) => onOpenColorPicker?.(t, v)}
          label="Fill"
          compact
          panelOpen={colorPickerOpenTarget === "shape_fill"}
        />
      </div>
      <span className="h-5 w-px bg-[var(--studio-border)]" />
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
          Stroke
        </span>
        <ColorPicker
          value={state.stroke}
          target="shape_stroke"
          onOpenPanel={(t, v) => onOpenColorPicker?.(t, v)}
          label="Stroke"
          compact
          panelOpen={colorPickerOpenTarget === "shape_stroke"}
        />
      </div>
      <span className="h-5 w-px bg-[var(--studio-border)]" />
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
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
          className="h-7 w-12 rounded-md border border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] px-1.5 text-center text-[12px] font-medium text-white focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400/40"
        />
      </div>
    </div>
  );
}

// ===========================================================================
// Group 2 — Alignment (6 buttons)
// ===========================================================================

function AlignmentGroup(props: {
  onAlign?: (direction: FloatingAlignDirection) => void;
}): JSX.Element {
  const fire = (direction: FloatingAlignDirection): void => {
    props.onAlign?.(direction);
  };
  return (
    <div className="flex items-center gap-0.5">
      <IconBtn label="Align left" onClick={() => fire("left")}>
        <LAlignLeft size={14} />
      </IconBtn>
      <IconBtn label="Align center" onClick={() => fire("center")}>
        <LAlignCenter size={14} />
      </IconBtn>
      <IconBtn label="Align right" onClick={() => fire("right")}>
        <LAlignRight size={14} />
      </IconBtn>
      <span className="mx-0.5 h-4 w-px bg-[var(--studio-border)]" />
      <IconBtn label="Align top" onClick={() => fire("top")}>
        <LAlignTop size={14} />
      </IconBtn>
      <IconBtn label="Align middle" onClick={() => fire("middle")}>
        <LAlignMiddle size={14} />
      </IconBtn>
      <IconBtn label="Align bottom" onClick={() => fire("bottom")}>
        <LAlignBottom size={14} />
      </IconBtn>
    </div>
  );
}

// ===========================================================================
// Group 3 — Layer actions (forward / back / duplicate / transparency / lock / delete)
// ===========================================================================

function LayerActionsGroup(props: {
  canvas: Canvas | null;
  selectionVersion: number;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onDuplicate?: () => void;
  onToggleLock?: () => void;
  onDelete?: () => void;
  onCanvasMutated?: () => void;
  onOpacityCommit?: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-0.5">
      {props.onBringForward ? (
        <IconBtn label="Bring forward" onClick={props.onBringForward}>
          <LArrowUp size={14} />
        </IconBtn>
      ) : null}
      {props.onSendBackward ? (
        <IconBtn label="Send backward" onClick={props.onSendBackward}>
          <LArrowDown size={14} />
        </IconBtn>
      ) : null}
      {props.onDuplicate ? (
        <IconBtn label="Duplicate" onClick={props.onDuplicate}>
          <LCopy size={14} />
        </IconBtn>
      ) : null}
      <TransparencyButton
        canvas={props.canvas}
        selectionVersion={props.selectionVersion}
        onCanvasMutated={props.onCanvasMutated}
        onCommit={props.onOpacityCommit}
      />
      {props.onToggleLock ? (
        <IconBtn label="Lock" onClick={props.onToggleLock}>
          <LLock size={14} />
        </IconBtn>
      ) : null}
      {props.onDelete ? (
        <Tooltip label="Delete">
          <button
            type="button"
            onClick={props.onDelete}
            aria-label="Delete"
            title="Delete"
            className="focus-ring-dark flex h-7 w-7 items-center justify-center rounded-md text-rose-300 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
          >
            <LTrash2 size={14} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ===========================================================================
// TransparencyButton — toolbar trigger + portaled popover with opacity slider
// ===========================================================================
//
// Moved here from CanvasEditor.tsx during the 2026-05-26 floating-toolbar
// consolidation. Uses the same Portal + position:fixed pattern as the
// ColorPicker so the popover escapes the canvas's transform-stacking context.

interface TransparencyButtonProps {
  canvas: Canvas | null;
  selectionVersion: number;
  onCanvasMutated?: () => void;
  onCommit?: () => void;
}

function TransparencyButton(props: TransparencyButtonProps): JSX.Element {
  const { canvas, selectionVersion, onCanvasMutated, onCommit } = props;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

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

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPopoverPos(null);
      return;
    }
    const POPOVER_WIDTH = 240;
    const GAP = 8;
    const rect = triggerRef.current.getBoundingClientRect();
    const top = rect.bottom + GAP;
    let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
    if (left < GAP) left = GAP;
    const maxLeft = window.innerWidth - POPOVER_WIDTH - GAP;
    if (left > maxLeft) left = maxLeft;
    setPopoverPos({ top, left });
  }, [open]);

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

  const handleSliderChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const pct = Number(e.target.value);
    if (!Number.isFinite(pct)) return;
    setOpacityPct(pct);
    const active = canvas?.getActiveObject();
    if (!active) return;
    active.set({ opacity: pct / 100 });
    canvas?.requestRenderAll();
    onCanvasMutated?.();
  };

  const handleSliderCommit = (): void => {
    onCommit?.();
  };

  return (
    <>
      <Tooltip label="Transparency">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Transparency"
          title="Transparency"
          className={`focus-ring-dark flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            open
              ? "bg-[var(--studio-hover)] text-gold-400"
              : "text-white hover:bg-[var(--studio-hover)]"
          }`}
        >
          <TransparencyIcon />
        </button>
      </Tooltip>
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
              className="z-[100] rounded-xl border border-[var(--studio-border)] bg-[var(--studio-popover)] p-3 text-white shadow-2xl shadow-black/60 animate-fade-in-up"
              role="dialog"
              aria-label="Transparency"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                  Transparency
                </span>
                <span className="font-mono text-xs text-white">
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
              <div className="mt-1 flex justify-between text-[10px] text-[var(--studio-text-faint)]">
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
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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

// ===========================================================================
// Letter-case cycle helper
// ===========================================================================

function cycleLetterCase(text: string): string {
  if (text.length === 0) return text;
  const isAllUpper = text === text.toUpperCase() && /[A-Z]/.test(text);
  const isAllLower = text === text.toLowerCase() && /[a-z]/.test(text);
  const isTitle = isTitleCase(text);
  if (!isAllUpper && !isAllLower && !isTitle) {
    return text.toUpperCase();
  }
  if (isAllUpper) return text.toLowerCase();
  if (isAllLower) return toTitleCase(text);
  return text.toUpperCase();
}

function isTitleCase(s: string): boolean {
  return s
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .every((w) => {
      const first = w[0] ?? "";
      const rest = w.slice(1);
      return (
        first === first.toUpperCase() &&
        (rest === "" || rest === rest.toLowerCase())
      );
    });
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) =>
    w.charAt(0).toUpperCase() + w.substring(1).toLowerCase(),
  );
}

// ===========================================================================
// Atoms
// ===========================================================================

function GroupDivider(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-5 w-px bg-[var(--studio-border)]"
    />
  );
}

function Divider(): JSX.Element {
  return <span className="mx-0.5 h-5 w-px bg-[var(--studio-border)]" />;
}

function ToggleIconButton(props: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Tooltip label={props.label}>
      <button
        type="button"
        onClick={props.onClick}
        aria-label={props.label}
        title={props.label}
        aria-pressed={props.active}
        className={`focus-ring-dark flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
          props.active
            ? "bg-neutral-900 text-white"
            : "text-white hover:bg-[var(--studio-hover)]"
        }`}
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

function IconBtn(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Tooltip label={props.label}>
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label={props.label}
        title={props.label}
        className="focus-ring-dark flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors hover:bg-[var(--studio-hover)] disabled:cursor-not-allowed disabled:text-[var(--studio-text-faint)] disabled:hover:bg-transparent"
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

function StepperButton(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Tooltip label={props.label}>
      <button
        type="button"
        onClick={props.onClick}
        aria-label={props.label}
        title={props.label}
        className="focus-ring-dark flex h-6 w-5 items-center justify-center rounded text-[14px] font-medium leading-none text-white transition-colors hover:bg-[var(--studio-hover)]"
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

function Popover(props: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <Tooltip label={props.label}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={props.label}
          aria-expanded={open}
          title={props.label}
          className={`focus-ring-dark flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            open
              ? "bg-neutral-900 text-white"
              : "text-white hover:bg-[var(--studio-hover)]"
          }`}
        >
          {props.trigger}
        </button>
      </Tooltip>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-popover)] shadow-2xl shadow-black/60">
          {props.children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function PopoverIconButton(props: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Tooltip label={props.label}>
      <button
        type="button"
        onClick={props.onClick}
        aria-label={props.label}
        title={props.label}
        aria-pressed={props.active}
        className={`focus-ring-dark flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
          props.active
            ? "bg-neutral-900 text-white"
            : "text-white hover:bg-[var(--studio-hover)]"
        }`}
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

function SpacingSlider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (next: number) => void;
  onCommit: () => void;
}): JSX.Element {
  return (
    <label className="block text-[11px] font-medium text-white">
      <div className="mb-0.5 flex items-center justify-between">
        <span>{props.label}</span>
        <span className="tabular-nums text-[var(--studio-text-muted)]">
          {props.format(props.value)}
        </span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onPointerUp={props.onCommit}
        className="w-full accent-gold-500"
      />
    </label>
  );
}

// --- Icon glyphs (text-cluster bespoke icons that don't map cleanly to Lucide) ---

function TextAlignGlyph(props: {
  dir: "left" | "center" | "right" | "justify";
}): JSX.Element {
  const lines: Record<typeof props.dir, string[]> = {
    left: ["M2 4 H14", "M2 8 H10", "M2 12 H14", "M2 16 H8"],
    center: ["M2 4 H14", "M4 8 H12", "M2 12 H14", "M5 16 H11"],
    right: ["M2 4 H14", "M6 8 H14", "M2 12 H14", "M8 16 H14"],
    justify: ["M2 4 H14", "M2 8 H14", "M2 12 H14", "M2 16 H14"],
  };
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
      {lines[props.dir].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

function LineSpacingIcon(): JSX.Element {
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
      <path d="M3 4 L3 12" />
      <path d="M1.5 5.5 L3 4 L4.5 5.5" />
      <path d="M1.5 10.5 L3 12 L4.5 10.5" />
      <path d="M7 5 H14" />
      <path d="M7 11 H14" />
    </svg>
  );
}

function EffectsIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3" cy="3" r="1.1" />
      <circle cx="8" cy="3" r="1.1" />
      <circle cx="13" cy="3" r="1.1" />
      <circle cx="3" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="13" cy="8" r="1.1" />
      <circle cx="3" cy="13" r="1.1" />
      <circle cx="8" cy="13" r="1.1" />
      <circle cx="13" cy="13" r="1.1" />
    </svg>
  );
}
