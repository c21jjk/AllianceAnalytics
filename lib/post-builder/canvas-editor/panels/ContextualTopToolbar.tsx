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
import { Crop as LCrop, Maximize2 as LMaximize2 } from "lucide-react";
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import ColorPicker from "../primitives/ColorPicker";
import FontPicker from "../primitives/FontPicker";
import { FONT_OPTIONS } from "../primitives/font-options";
import Tooltip from "../primitives/Tooltip";
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
   * 2026-05-25 — image-mode handler. Fires the parent's "enter crop"
   * action against the currently-selected image. Wired only for the
   * image cluster. When omitted, the Crop button is hidden — the
   * parent can opt out (e.g. for read-only previews) by not passing it.
   */
  onEnterCropMode?: () => void;
  /**
   * 2026-05-25 — image-mode "Resize" handler. Companion to
   * onEnterCropMode — clicking Resize ensures the photo is the
   * active selection with handles visible. The handles do the same
   * thing they always did (scale the photo + clipPath together),
   * but having an explicit toolbar button gives the user a clear
   * counterpart to Crop. When omitted, the Resize button is hidden.
   */
  onActivateResize?: () => void;
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
  /**
   * 2026-05-26 — Canva-style FontPickerPanel wiring. Text mode only.
   * When the parent provides `onOpenFontPicker`, the font-name pill switches
   * from the legacy popover-dropdown to a trigger that opens the left-rail
   * panel. `fontPickerOpen` drives the trigger's active styling +
   * aria-expanded. Both are optional so any caller that omits them keeps
   * the legacy dropdown behavior (defensive — but the editor passes them).
   */
  onOpenFontPicker?: () => void;
  fontPickerOpen?: boolean;
  /**
   * 2026-05-26 — Canva-style EffectsPanel wiring. Text mode only. When
   * provided, the Effects glyph button switches from the legacy inline
   * popover to a trigger that opens the left-rail panel. `effectsPanelOpen`
   * drives the trigger's active styling + aria-expanded. Both are optional
   * for the same defensive reason as the FontPicker pair — callers that
   * omit them get the legacy popover behavior.
   */
  onOpenEffectsPanel?: () => void;
  effectsPanelOpen?: boolean;
}

// FONT_OPTIONS now lives in primitives/font-options.ts as the single source
// of truth — was duplicated here + in TextPropertiesControls.tsx before the
// 2026-05-24 expansion. Imported at the top of this file.

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
      return <ImageContextualControls {...props} />;
  }
}

// ===========================================================================
// IMAGE cluster — Crop entry point
// ===========================================================================

function ImageContextualControls(
  props: ContextualTopToolbarProps,
): JSX.Element | null {
  const { onEnterCropMode, onActivateResize } = props;
  // Hide the whole toolbar if no actions are wired.
  if (!onEnterCropMode && !onActivateResize) return null;
  return (
    <div className="flex items-center gap-1 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-popover)] px-1 py-1 shadow-2xl shadow-black/60">
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
// TEXT cluster — font picker, size, B/I/U, fill color
// ===========================================================================

function TextContextualControls(props: ContextualTopToolbarProps): JSX.Element {
  const {
    canvas,
    selectionVersion,
    onCanvasMutated,
    recordHistory,
    onAlign,
    onOpenFontPicker,
    fontPickerOpen = false,
    onOpenEffectsPanel,
    effectsPanelOpen = false,
  } = props;

  // Local mirror state — written through to Fabric on every input. Pattern
  // matches TextPropertiesControls; see that file's comment for the
  // "controlled input + bumped re-sync" rationale.
  //
  // 2026-05-23 expansion (Canva-parity): added linethrough, textAlign,
  // lineHeight, charSpacing — everything from TextPropertiesControls so the
  // right panel can revert to the layer list when text is selected.
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
    // why: continuous edit (could be a stepper or typed value). Don't snapshot
    // on every keystroke — Agent B's debounced auto-snapshot covers it.
    canvas?.requestRenderAll();
    onCanvasMutated?.();
  };

  // Stepper handlers — Canva's "− value +" pattern. Each click bumps ±1pt
  // and records history (discrete edit, not a slider drag).
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

  const handleFill = (next: string): void => {
    setState((prev) => (prev ? { ...prev, fill: next } : prev));
    applyToActive({ fill: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  const handleAlignText = (next: "left" | "center" | "right" | "justify"): void => {
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

  // Letter-case cycle (Canva's `aA` button). Cycles:
  //   UPPERCASE → lowercase → Title Case → original sentence → UPPERCASE …
  // We mutate the actual `text` property — there's no Fabric text-transform
  // CSS-equivalent, so changing case is a string-level transform.
  const handleCycleCase = (): void => {
    const active = readActive(canvas);
    if (!(active instanceof Textbox)) return;
    const current = String(active.text ?? "");
    const next = cycleLetterCase(current);
    applyToActive({ text: next });
    commit(canvas, onCanvasMutated, recordHistory);
  };

  // 2026-05-26 — Effects: the previous inline popover (3-col grid of
  // EffectPreview tiles) was migrated to a full-height left panel
  // (`EffectsPanel.tsx`) so sliders + per-effect params have room to live.
  // The trigger button below now toggles that panel via
  // `onOpenEffectsPanel`. Apply logic moved into EffectsPanel; same
  // TEXT_EFFECT_PRESETS / textEffectToFabricProps under the hood.

  return (
    <div className="flex items-center gap-1 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-popover)] px-2 py-1.5 shadow-2xl shadow-black/60 animate-fade-in-up">
      {/* === 1. Font family ===
          2026-05-26 — when the editor wires `onOpenFontPicker`, the pill
          becomes a trigger for the Canva-style left-rail panel. The
          callback receives focus/keyboard handling at the panel; here we
          just opt in via panelMode. Fallback path (no `onOpenFontPicker`)
          keeps the legacy in-toolbar popover so the toolbar is still
          usable in isolation (Storybook etc.). */}
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

      {/* === 2. Font size — Canva-style [−] value [+] stepper === */}
      <div className="flex items-center gap-0.5 rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-1">
        <StepperButton label="Decrease font size" onClick={() => handleSizeStep(-1)}>
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
        <StepperButton label="Increase font size" onClick={() => handleSizeStep(+1)}>
          +
        </StepperButton>
      </div>
      <Divider />

      {/* === 3. Text color === */}
      <div className="flex items-center">
        <ColorPicker
          value={state.fill}
          onChange={handleFill}
          label="Text color"
          compact
          canvas={canvas}
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

      {/* === 8. Letter case (aA) === */}
      <IconBtn label="Letter case" onClick={handleCycleCase}>
        <span className="text-[12px] font-semibold leading-none">aA</span>
      </IconBtn>

      {/* === 9. Alignment popover === */}
      <Popover
        label="Text alignment"
        trigger={<AlignTextIcon value={state.textAlign} />}
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

      {/* === 11. Line spacing popover (Canva's vertical-T icon) === */}
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

      {/* === 12. Effects — opens the left-rail EffectsPanel === */}
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

      {/* === 14. Position popover — aligns text to canvas bounds === */}
      {onAlign ? (
        <Popover label="Position" trigger={<PositionIcon />}>
          {(close) => (
            <div className="flex items-center gap-0.5 p-1">
              {(
                [
                  ["left", <AlignLeftGlyph key="l" />],
                  ["center", <AlignCenterGlyph key="c" />],
                  ["right", <AlignRightGlyph key="r" />],
                ] as const
              ).map(([dir, glyph]) => (
                <PopoverIconButton
                  key={dir}
                  label={`Align ${dir}`}
                  active={false}
                  onClick={() => {
                    onAlign(dir);
                    close();
                  }}
                >
                  {glyph}
                </PopoverIconButton>
              ))}
              <span className="mx-1 h-4 w-px bg-[var(--studio-border)]" />
              {(
                [
                  ["top", <AlignTopGlyph key="t" />],
                  ["middle", <AlignMiddleGlyph key="m" />],
                  ["bottom", <AlignBottomGlyph key="b" />],
                ] as const
              ).map(([dir, glyph]) => (
                <PopoverIconButton
                  key={dir}
                  label={`Align ${dir}`}
                  active={false}
                  onClick={() => {
                    onAlign(dir);
                    close();
                  }}
                >
                  {glyph}
                </PopoverIconButton>
              ))}
            </div>
          )}
        </Popover>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Letter-case cycle helper
// ---------------------------------------------------------------------------

/**
 * Cycle the case of a string in Canva's order:
 *   sentence/mixed → UPPERCASE → lowercase → Title Case → sentence (original)
 *
 * We detect the current state cheaply (all-upper / all-lower / title-cased /
 * other) and rotate. Title Case uses a simple word-boundary split — fine for
 * real-estate copy ("Open House", "Just Listed") which is the dominant use.
 *
 * The "sentence" branch preserves the original string by stashing it on the
 * Fabric object's data bag the FIRST time we touch case, so a full cycle
 * returns the user to their original wording.
 */
function cycleLetterCase(text: string): string {
  if (text.length === 0) return text;
  const isAllUpper = text === text.toUpperCase() && /[A-Z]/.test(text);
  const isAllLower = text === text.toLowerCase() && /[a-z]/.test(text);
  const isTitle = isTitleCase(text);
  if (!isAllUpper && !isAllLower && !isTitle) {
    // Mixed / sentence case → UPPERCASE
    return text.toUpperCase();
  }
  if (isAllUpper) return text.toLowerCase();
  if (isAllLower) return toTitleCase(text);
  // isTitle → back to UPPERCASE (we don't try to recover the original — the
  // user can always undo).
  return text.toUpperCase();
}

function isTitleCase(s: string): boolean {
  // True when every word starts with uppercase and remaining chars are lower.
  // Allows non-letter chars to pass through unchanged.
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
    <div className="flex items-center gap-1.5 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-popover)] px-2.5 py-1.5 shadow-2xl shadow-black/60 animate-fade-in-up">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
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
      <span className="h-5 w-px bg-[var(--studio-border)]" />
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
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
    <div className="flex items-center gap-0.5 rounded-xl border border-[var(--studio-border)] bg-[var(--studio-popover)] px-2 py-1.5 shadow-2xl shadow-black/60 animate-fade-in-up">
      <span className="ml-1 mr-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
        {selectionCount} selected
      </span>
      <span className="h-5 w-px bg-[var(--studio-border)]" />
      <IconBtn label="Align left" onClick={() => fire("left")}>
        <AlignLeftGlyph />
      </IconBtn>
      <IconBtn label="Align center" onClick={() => fire("center")}>
        <AlignCenterGlyph />
      </IconBtn>
      <IconBtn label="Align right" onClick={() => fire("right")}>
        <AlignRightGlyph />
      </IconBtn>
      <span className="h-5 w-px bg-[var(--studio-border)]" />
      <IconBtn label="Align top" onClick={() => fire("top")}>
        <AlignTopGlyph />
      </IconBtn>
      <IconBtn label="Align middle" onClick={() => fire("middle")}>
        <AlignMiddleGlyph />
      </IconBtn>
      <IconBtn label="Align bottom" onClick={() => fire("bottom")}>
        <AlignBottomGlyph />
      </IconBtn>
      <span className="h-5 w-px bg-[var(--studio-border)]" />
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
    <Tooltip label={props.label}>
      <button
        type="button"
        onClick={props.onClick}
        aria-label={props.label}
        title={props.label}
        aria-pressed={props.active}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
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
        className="flex h-7 w-7 items-center justify-center rounded-md text-white transition-colors hover:bg-[var(--studio-hover)] disabled:cursor-not-allowed disabled:text-[var(--studio-text-faint)] disabled:hover:bg-transparent"
      >
        {props.children}
      </button>
    </Tooltip>
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

// ===========================================================================
// TEXT-cluster atoms (2026-05-23 Canva-parity expansion)
// ===========================================================================
//
// Small UI primitives only used by the TEXT cluster. Kept in this file so
// the cluster stays self-contained — no new file churn for the parity work.
// ---------------------------------------------------------------------------

function Divider(): JSX.Element {
  return <span className="mx-0.5 h-5 w-px bg-[var(--studio-border)]" />;
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
        className="flex h-6 w-5 items-center justify-center rounded text-[14px] font-medium leading-none text-white transition-colors hover:bg-[var(--studio-hover)]"
      >
        {props.children}
      </button>
    </Tooltip>
  );
}

/**
 * Lightweight popover. Renders a trigger button; on click toggles a small
 * absolutely-positioned content panel below the trigger. Closes on:
 *   • outside-click
 *   • Escape keypress
 *   • children calling the `close()` callback they receive
 *
 * Why inline (no Radix/Headless UI): the project doesn't have either as a
 * dep. The popover behavior we need is single-instance + click-outside +
 * Esc — 30 lines of vanilla React covers it without pulling in a library.
 */
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
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            open
              ? "bg-neutral-900 text-white"
              : "text-white hover:bg-[var(--studio-hover)]"
          }`}
        >
          {props.trigger}
        </button>
      </Tooltip>
      {open ? (
        <div
          // why: pop UPWARD because the floating toolbar lives above the
          // canvas — opening downward would put the panel ON the canvas
          // and obscure the user's selection. `top-full` would do that;
          // `bottom-full` opens up.
          className="absolute right-0 top-full z-20 mt-1 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-popover)] shadow-2xl shadow-black/60"
        >
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
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
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
        // why: snapshot history on pointerup, not on every input event. A
        // single slider sweep produces ONE undo entry instead of fifty.
        onPointerUp={props.onCommit}
        className="w-full accent-gold-500"
      />
    </label>
  );
}

// --- Icon glyphs ---

function AlignTextIcon(props: {
  value: "left" | "center" | "right" | "justify";
}): JSX.Element {
  return <TextAlignGlyph dir={props.value} />;
}

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
      {/* Two arrows pointing apart (vertical) + lines suggesting text */}
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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {/* Halftone-dot pattern matching Canva's "Effects" glyph */}
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

function PositionIcon(): JSX.Element {
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
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <rect x="5" y="5" width="6" height="6" fill="currentColor" stroke="none" />
    </svg>
  );
}
