"use client";

/**
 * TextPropertiesControls — Phase 2, Agent A
 * ------------------------------------------
 *
 * Properties panel for an active Fabric Textbox. Reads from
 * `canvas.getActiveObject()` (cast to Textbox) on every selectionVersion
 * change and writes back via `obj.set({ ... })` + `canvas.requestRenderAll()`.
 *
 * Discrete changes (font family pick, alignment click, color pick) call
 * `recordHistory` immediately so undo/redo captures the step. Continuous
 * sliders (font size, opacity, char spacing, line height) rely on Agent B's
 * debounced auto-snapshot — calling recordHistory on every input event would
 * blow out the undo stack with intermediate states.
 *
 * Fabric Textbox property mapping reference:
 *   • fontFamily   string (CSS family stack)
 *   • fontSize     number (logical px)
 *   • fontWeight   number | string (we use number: 100..900)
 *   • fontStyle    "normal" | "italic"
 *   • fill         hex string
 *   • textAlign    "left" | "center" | "right" | "justify"
 *   • lineHeight   number (multiplier, 1.0 = single-line)
 *   • charSpacing  number (1/1000 em — Fabric's native unit)
 *   • underline    boolean
 *   • linethrough  boolean
 */

import { Textbox } from "fabric";
import type { Canvas } from "fabric";
import {
  type ChangeEvent,
  type JSX,
  useCallback,
  useEffect,
  useState,
} from "react";

import ColorPicker from "../../primitives/ColorPicker";
import FontPicker from "../../primitives/FontPicker";
import { ALLIANCE_FONTS } from "../../templates/tokens";
import {
  TEXT_EFFECT_PRESETS,
  textEffectToFabricProps,
} from "../../textEffects";
import type { TextEffect } from "../../types";

interface TextPropertiesControlsProps {
  canvas: Canvas | null;
  selectionVersion: number;
  onCanvasMutated?: () => void;
  recordHistory?: () => void;
}

/**
 * Local mirror of Textbox state that the panel renders from. We don't read
 * directly from Fabric on every render — instead we sync into local state on
 * each selectionVersion change, then write through on input.
 *
 * Why local state at all (rather than always read-on-render):
 *   • Input elements need a controlled `value` that matches what the user is
 *     typing. If we read straight from Fabric, a slider snap-back happens
 *     mid-drag (Fabric rounds, but the slider sub-pixel position drifts).
 *   • selectionVersion bumps are an explicit re-sync signal — the parent
 *     guarantees they fire on Fabric mutations we DIDN'T cause (e.g. another
 *     panel changed the same property).
 */
interface TextState {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  fill: string;
  // why: backgroundColor is a Fabric Textbox property that paints a rect
  // behind the text bounded by the textbox's width × height. Empty string
  // = no background (Fabric treats falsy as transparent). We standardize
  // on "" so the ColorPicker's "transparent" swatch round-trips cleanly.
  backgroundColor: string;
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight: number;
  charSpacing: number;
  underline: boolean;
  linethrough: boolean;
}

// Font catalog moved to primitives/font-options.ts as the single source of
// truth. Was duplicated here + in ContextualTopToolbar.tsx before the
// 2026-05-24 expansion to ~69 fonts.
import { FONT_OPTIONS } from "../../primitives/font-options";

const WEIGHT_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "100 Thin", value: 100 },
  { label: "200 Extra Light", value: 200 },
  { label: "300 Light", value: 300 },
  { label: "400 Regular", value: 400 },
  { label: "500 Medium", value: 500 },
  { label: "600 Semi Bold", value: 600 },
  { label: "700 Bold", value: 700 },
  { label: "800 Extra Bold", value: 800 },
  { label: "900 Black", value: 900 },
];

const ALIGN_OPTIONS: ReadonlyArray<{
  value: "left" | "center" | "right" | "justify";
  label: string;
}> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

/**
 * Coerce Fabric's `fontWeight` (typed `string | number`) into our numeric
 * weight scale. If Fabric returns "bold" or "normal" we map them; otherwise
 * we try parseInt and fall back to 400.
 */
function coerceFontWeight(raw: string | number | undefined): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    if (raw === "bold") return 700;
    if (raw === "normal") return 400;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 400;
  }
  return 400;
}

/**
 * Read the current Textbox state out of Fabric. Returns null when there is no
 * active object or the active object isn't a Textbox.
 */
function readTextState(canvas: Canvas | null): TextState | null {
  if (!canvas) return null;
  const active = canvas.getActiveObject();
  if (!active || !(active instanceof Textbox)) return null;
  // why: Fabric's textAlign is typed as `string`. Narrow to our union with a
  // safe fallback so the <select> always has a valid value.
  const rawAlign = (active.textAlign ?? "left") as string;
  const align: TextState["textAlign"] =
    rawAlign === "center" ||
    rawAlign === "right" ||
    rawAlign === "justify"
      ? rawAlign
      : "left";
  const rawStyle = (active.fontStyle ?? "normal") as string;
  const style: TextState["fontStyle"] =
    rawStyle === "italic" ? "italic" : "normal";
  return {
    fontFamily: active.fontFamily ?? ALLIANCE_FONTS.bodySans,
    fontSize: typeof active.fontSize === "number" ? active.fontSize : 32,
    fontWeight: coerceFontWeight(active.fontWeight),
    fontStyle: style,
    fill: typeof active.fill === "string" ? active.fill : "#000000",
    backgroundColor:
      typeof active.backgroundColor === "string" ? active.backgroundColor : "",
    textAlign: align,
    lineHeight:
      typeof active.lineHeight === "number" ? active.lineHeight : 1.16,
    charSpacing:
      typeof active.charSpacing === "number" ? active.charSpacing : 0,
    underline: active.underline === true,
    linethrough: active.linethrough === true,
  };
}

export default function TextPropertiesControls(
  props: TextPropertiesControlsProps,
): JSX.Element {
  const { canvas, selectionVersion, onCanvasMutated, recordHistory } = props;
  const [state, setState] = useState<TextState | null>(() =>
    readTextState(canvas),
  );

  // Phase B.3 — Effect kind tracked separately from TextState. The schema's
  // `effect` field isn't round-tripped from Fabric yet (Phase 2 TODO), so we
  // store the user's last-picked preset locally and write it through to
  // Fabric's shadow/stroke/paintFirst. On selection change we default to
  // "none" — the textbox's actual rendered effect may still be visible from
  // a prior session, but the UI starts unmarked rather than guessing.
  const [effectKind, setEffectKind] = useState<TextEffect["kind"]>("none");

  // why: re-sync local state from Fabric whenever the parent bumps
  // selectionVersion. This catches both "user picked a different layer" AND
  // "another panel mutated the same property". Includes `canvas` so a swap of
  // the underlying canvas instance also re-syncs.
  useEffect(() => {
    setState(readTextState(canvas));
    // Reset effect chip highlight on selection change — see comment above.
    setEffectKind("none");
  }, [canvas, selectionVersion]);

  /**
   * Mutate the active Textbox via Fabric. Centralized so every control uses
   * the same flow:
   *   1. update local state for instant slider feedback
   *   2. mutate Fabric + request render
   *   3. bump the orchestrator's layerVersion (onCanvasMutated)
   *   4. optionally record an undo entry
   *
   * `shouldRecord` is true for discrete edits (color pick, font family) and
   * false for continuous slider drags — those rely on Agent B's debounced
   * autosnapshot to avoid 100-entry undo stacks per slider sweep.
   */
  const applyMutation = useCallback(
    (partial: Partial<TextState>, shouldRecord: boolean): void => {
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active || !(active instanceof Textbox)) return;

      setState((prev) => (prev ? { ...prev, ...partial } : prev));
      // why: pass through ONLY defined keys to Fabric. Spreading the full
      // local state would overwrite Textbox props the user already edited
      // through Fabric's own input (in-place text editing) with stale values.
      active.set(partial);
      canvas.requestRenderAll();
      onCanvasMutated?.();
      if (shouldRecord) recordHistory?.();
    },
    [canvas, onCanvasMutated, recordHistory],
  );

  // why: handlers split out for readability — each one is trivial but lifting
  // them above the JSX means the render block stays scannable.
  // why: FontPicker emits the value string directly (no event). This is a
  // value-only signature, simpler than the old ChangeEvent<HTMLSelectElement>.
  const handleFontFamilyChange = useCallback(
    (next: string) => {
      applyMutation({ fontFamily: next }, true);
    },
    [applyMutation],
  );

  const handleFontSizeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      applyMutation({ fontSize: next }, false);
    },
    [applyMutation],
  );

  const handleFontSizeCommit = useCallback(() => {
    // why: on blur/keyup-Enter we snapshot history so the size change is
    // captured as a single undo step, not 50 (one per slider tick).
    recordHistory?.();
  }, [recordHistory]);

  const handleFontWeightChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const next = parseInt(e.target.value, 10);
      if (!Number.isFinite(next)) return;
      applyMutation({ fontWeight: next }, true);
    },
    [applyMutation],
  );

  const handleAlignClick = useCallback(
    (next: TextState["textAlign"]) => {
      applyMutation({ textAlign: next }, true);
    },
    [applyMutation],
  );

  const handleFillChange = useCallback(
    (next: string) => {
      applyMutation({ fill: next }, true);
    },
    [applyMutation],
  );

  // why: handleBackgroundChange writes Fabric's Textbox.backgroundColor. The
  // ColorPicker passes "transparent" or "" when the user picks the clear
  // swatch; Fabric treats falsy as no fill — we normalize to "" so the
  // serialized template JSON stays clean (no "transparent" literal stored).
  const handleBackgroundChange = useCallback(
    (next: string) => {
      const normalized = next === "transparent" ? "" : next;
      applyMutation({ backgroundColor: normalized }, true);
    },
    [applyMutation],
  );

  const handleLineHeightChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      applyMutation({ lineHeight: next }, false);
    },
    [applyMutation],
  );

  const handleCharSpacingChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      applyMutation({ charSpacing: next }, false);
    },
    [applyMutation],
  );

  const handleToggleBold = useCallback(() => {
    if (!state) return;
    // why: "bold" is rendered via numeric weight in this editor — toggling
    // bold flips 400 ↔ 700 unless the user has a finer-grained weight set,
    // in which case we snap to 700 for predictability.
    const nextWeight = state.fontWeight >= 600 ? 400 : 700;
    applyMutation({ fontWeight: nextWeight }, true);
  }, [applyMutation, state]);

  const handleToggleItalic = useCallback(() => {
    if (!state) return;
    applyMutation(
      { fontStyle: state.fontStyle === "italic" ? "normal" : "italic" },
      true,
    );
  }, [applyMutation, state]);

  const handleToggleUnderline = useCallback(() => {
    if (!state) return;
    applyMutation({ underline: !state.underline }, true);
  }, [applyMutation, state]);

  const handleToggleLinethrough = useCallback(() => {
    if (!state) return;
    applyMutation({ linethrough: !state.linethrough }, true);
  }, [applyMutation, state]);

  // Phase B.3 — apply a text-effect preset. Resolves the preset's default
  // params → Fabric shadow/stroke/paintFirst props, writes them to the
  // active textbox, and snapshots history so the change is one undo step.
  const handleEffectPicked = useCallback(
    (kind: TextEffect["kind"]): void => {
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active || !(active instanceof Textbox)) return;
      const preset = TEXT_EFFECT_PRESETS[kind];
      const fabricProps = textEffectToFabricProps(preset);
      active.set({
        shadow: fabricProps.shadow,
        stroke: fabricProps.stroke,
        strokeWidth: fabricProps.strokeWidth,
        paintFirst: fabricProps.paintFirst,
      });
      // why: stash the picked effect on the Fabric object's `data` bag so a
      // future schema-round-trip can serialize it back out. The bag is
      // already used by the layer panel for display name; adding a `effect`
      // field is non-invasive.
      const data =
        (active as unknown as { data?: Record<string, unknown> }).data ?? {};
      (active as unknown as { data: Record<string, unknown> }).data = {
        ...data,
        effect: preset,
      };
      setEffectKind(kind);
      canvas.requestRenderAll();
      onCanvasMutated?.();
      recordHistory?.();
    },
    [canvas, onCanvasMutated, recordHistory],
  );

  // why: while waiting for the first selection sync (or if the active object
  // isn't actually a Textbox), render an empty hint instead of crashing.
  if (!state) {
    return (
      <div className="px-4 py-6 text-sm text-neutral-400">
        Select a text layer to edit its properties.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* ===== Font family ===== */}
      {/* why: custom FontPicker primitive replaces the native <select> so
          each option previews in its own typeface (the only way to do this
          consistently across Chrome / Safari / Firefox — native <option>
          doesn't honor font-family in Chrome). */}
      <Section title="Font">
        <FontPicker
          value={state.fontFamily}
          onChange={handleFontFamilyChange}
          options={FONT_OPTIONS}
        />
      </Section>

      {/* ===== Size + weight ===== */}
      <Section title="Size & Weight">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={state.fontSize}
            min={8}
            max={200}
            onChange={handleFontSizeChange}
            onBlur={handleFontSizeCommit}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
          />
          <input
            type="range"
            min={8}
            max={200}
            value={state.fontSize}
            onChange={handleFontSizeChange}
            onMouseUp={handleFontSizeCommit}
            onTouchEnd={handleFontSizeCommit}
            className="flex-1 accent-gold-500"
          />
        </div>
        <select
          value={state.fontWeight}
          onChange={handleFontWeightChange}
          className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
        >
          {WEIGHT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Section>

      {/* ===== Style toggles ===== */}
      <Section title="Style">
        <div className="flex gap-1">
          <StyleToggle
            label="B"
            active={state.fontWeight >= 600}
            onClick={handleToggleBold}
            title="Bold"
            extraClass="font-bold"
          />
          <StyleToggle
            label="I"
            active={state.fontStyle === "italic"}
            onClick={handleToggleItalic}
            title="Italic"
            extraClass="italic"
          />
          <StyleToggle
            label="U"
            active={state.underline}
            onClick={handleToggleUnderline}
            title="Underline"
            extraClass="underline"
          />
          <StyleToggle
            label="S"
            active={state.linethrough}
            onClick={handleToggleLinethrough}
            title="Strikethrough"
            extraClass="line-through"
          />
        </div>
      </Section>

      {/* ===== Alignment ===== */}
      <Section title="Alignment">
        <div className="grid grid-cols-4 gap-1">
          {ALIGN_OPTIONS.map((opt) => {
            const isActive = state.textAlign === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleAlignClick(opt.value)}
                aria-label={opt.label}
                title={opt.label}
                className={`flex items-center justify-center rounded-md border px-2 py-1.5 transition-colors ${
                  isActive
                    ? "border-gold-500 bg-gold-50 text-gold-600"
                    : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                <AlignIcon align={opt.value} />
              </button>
            );
          })}
        </div>
      </Section>

      {/* ===== Color ===== */}
      <Section title="Color">
        <div className="space-y-2">
          {/* Foreground — the text glyph color */}
          <div className="flex items-center gap-2">
            <ColorPicker
              label=""
              value={state.fill}
              onChange={handleFillChange}
              allowTransparent={false}
              canvas={canvas}
            />
            <span className="font-mono text-xs uppercase text-neutral-500">
              Text · {state.fill}
            </span>
          </div>
          {/* Background — Fabric's Textbox.backgroundColor. Paints a rect
              behind the text, bounded by the textbox width × height. Use
              for callout boxes / highlights that offset type from a busy
              photo background. */}
          <div className="flex items-center gap-2">
            <ColorPicker
              label=""
              value={state.backgroundColor || "transparent"}
              onChange={handleBackgroundChange}
              allowTransparent={true}
              canvas={canvas}
            />
            <span className="font-mono text-xs uppercase text-neutral-500">
              Highlight ·{" "}
              {state.backgroundColor ? state.backgroundColor : "none"}
            </span>
          </div>
        </div>
      </Section>

      {/* ===== Line height ===== */}
      <Section title="Line Height">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={state.lineHeight}
            min={0.5}
            max={3}
            step={0.05}
            onChange={handleLineHeightChange}
            onBlur={handleFontSizeCommit}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
          />
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.05}
            value={state.lineHeight}
            onChange={handleLineHeightChange}
            onMouseUp={handleFontSizeCommit}
            onTouchEnd={handleFontSizeCommit}
            className="flex-1 accent-gold-500"
          />
        </div>
      </Section>

      {/* ===== Letter spacing (Fabric charSpacing — 1/1000 em) ===== */}
      <Section title="Letter Spacing">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={state.charSpacing}
            min={-200}
            max={1000}
            step={5}
            onChange={handleCharSpacingChange}
            onBlur={handleFontSizeCommit}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
          />
          <input
            type="range"
            min={-200}
            max={1000}
            step={5}
            value={state.charSpacing}
            onChange={handleCharSpacingChange}
            onMouseUp={handleFontSizeCommit}
            onTouchEnd={handleFontSizeCommit}
            className="flex-1 accent-gold-500"
          />
        </div>
        <p className="mt-1 text-[10px] text-neutral-400">
          Fabric units (1/1000 em). 100 ≈ 0.1em.
        </p>
      </Section>

      {/* ===== Phase B.3 — Text effects ===== */}
      <Section title="Effects">
        <div className="grid grid-cols-5 gap-1">
          <EffectChip
            label="None"
            active={effectKind === "none"}
            onClick={() => handleEffectPicked("none")}
            preview="—"
            previewStyle={undefined}
          />
          <EffectChip
            label="Shadow"
            active={effectKind === "shadow"}
            onClick={() => handleEffectPicked("shadow")}
            preview="Ag"
            previewStyle={{
              color: "#18181B",
              textShadow: "0 2px 4px rgba(0,0,0,0.5)",
            }}
          />
          <EffectChip
            label="Lift"
            active={effectKind === "lift"}
            onClick={() => handleEffectPicked("lift")}
            preview="Ag"
            previewStyle={{
              color: "#18181B",
              textShadow: "0 4px 12px rgba(0,0,0,0.5)",
            }}
          />
          <EffectChip
            label="Hollow"
            active={effectKind === "outline"}
            onClick={() => handleEffectPicked("outline")}
            preview="Ag"
            previewStyle={{
              color: "transparent",
              WebkitTextStroke: "1px #18181B",
            }}
          />
          <EffectChip
            label="Splice"
            active={effectKind === "splice"}
            onClick={() => handleEffectPicked("splice")}
            preview="Ag"
            previewStyle={{
              color: "#18181B",
              textShadow: "3px 3px 0 #C9A84C",
            }}
          />
        </div>
        <p className="mt-1.5 text-[10px] leading-tight text-neutral-400">
          {effectKind === "none"
            ? "No effect — plain text."
            : effectKind === "shadow"
              ? "Soft drop shadow."
              : effectKind === "lift"
                ? "Subtle shadow lifts text off the background."
                : effectKind === "outline"
                  ? "Hollow outline — keeps the fill glyph crisp."
                  : "Splice — outlined text with an offset duplicate."}
        </p>
      </Section>
    </div>
  );
}

// ===========================================================================
// Small subcomponents — Section / StyleToggle / AlignIcon
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

interface StyleToggleProps {
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
  /** Extra Tailwind classes applied to the inner text (e.g. font-bold, italic). */
  extraClass: string;
}

function StyleToggle(props: StyleToggleProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      aria-pressed={props.active}
      className={`flex h-8 w-8 items-center justify-center rounded-md border text-sm transition-colors ${
        props.active
          ? "border-gold-500 bg-gold-50 text-gold-600"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      <span className={props.extraClass}>{props.label}</span>
    </button>
  );
}

interface EffectChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Tiny "Ag" preview rendered in the chip's body. */
  preview: string;
  /** Inline style applied to the preview text so each chip can hint at its
   *  effect (e.g. textShadow for Shadow, WebkitTextStroke for Hollow). */
  previewStyle: React.CSSProperties | undefined;
}

function EffectChip(props: EffectChipProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      title={props.label}
      className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-md border transition-colors ${
        props.active
          ? "border-gold-500 bg-gold-50"
          : "border-neutral-300 bg-white hover:border-gold-300 hover:bg-neutral-50"
      }`}
    >
      <span
        className="text-base font-semibold leading-none"
        style={props.previewStyle}
      >
        {props.preview}
      </span>
      <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-500">
        {props.label}
      </span>
    </button>
  );
}

interface AlignIconProps {
  align: "left" | "center" | "right" | "justify";
}

/**
 * Tiny inline SVG renderer for the four align directions. Inline rather than
 * separate components because each is two/three path lines.
 */
function AlignIcon({ align }: AlignIconProps): JSX.Element {
  const lines: ReadonlyArray<{ x1: number; x2: number }> = (() => {
    switch (align) {
      case "left":
        return [
          { x1: 2, x2: 14 },
          { x1: 2, x2: 10 },
          { x1: 2, x2: 12 },
          { x1: 2, x2: 8 },
        ];
      case "right":
        return [
          { x1: 2, x2: 14 },
          { x1: 6, x2: 14 },
          { x1: 4, x2: 14 },
          { x1: 8, x2: 14 },
        ];
      case "center":
        return [
          { x1: 2, x2: 14 },
          { x1: 4, x2: 12 },
          { x1: 3, x2: 13 },
          { x1: 5, x2: 11 },
        ];
      case "justify":
      default:
        return [
          { x1: 2, x2: 14 },
          { x1: 2, x2: 14 },
          { x1: 2, x2: 14 },
          { x1: 2, x2: 14 },
        ];
    }
  })();
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} x2={l.x2} y1={3 + i * 3} y2={3 + i * 3} />
      ))}
    </svg>
  );
}
