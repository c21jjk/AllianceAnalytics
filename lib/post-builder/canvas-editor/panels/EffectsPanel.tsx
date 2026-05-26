"use client";

/**
 * EffectsPanel — Canva-style full-height left panel for text effects.
 * ------------------------------------------------------------------------
 *
 * 2026-05-26. Mirrors `FontPickerPanel.tsx`: sits at left:64px (just right of
 * the icon rail), 320px wide, full editor height, z-30 so it covers whichever
 * left tab is currently active. Browsing effect presets, picking one, and
 * tuning per-effect parameters all happen here — the canvas stays visible
 * the whole time so Larissa sees the result live.
 *
 * Why this exists (vs. the legacy inline popover in ContextualTopToolbar):
 *   • The popover is cramped — no room for sliders + color pickers per preset.
 *   • Larissa's muscle memory IS Canva — Canva opens an effects panel here.
 *   • The right-panel "Effects" chips also drove the user to a different
 *     surface than the toolbar; consolidating both into one canonical panel
 *     means there's exactly one place to discover and tune effects.
 *
 * Apply path is unchanged — calls into `TEXT_EFFECT_PRESETS` +
 * `textEffectToFabricProps` exactly like the popover did. This is a UX
 * migration; no new effects, no new params.
 *
 * Behavior matches FontPickerPanel:
 *   • Click preset → applies immediately to the active Textbox.
 *   • Panel stays open so the user can keep tuning.
 *   • Close via X / Escape / click outside / text deselection.
 *   • Mounted only when `open` is true (parent owns the boolean).
 *
 * State strategy: the panel mirrors `TextPropertiesControls`'s local-only
 * `effectKind` pattern — Fabric doesn't round-trip the kind back to the
 * schema yet (Phase 2 TODO), so we hold the picked kind in local state
 * for the active-preset highlight + parameter rendering. Per-effect
 * params are also local; they seed from `TEXT_EFFECT_PRESETS[kind]` and
 * flush to Fabric on every change so the canvas updates live.
 *
 * Selection changes RESET the local kind to "none" — same logic as the
 * right panel, for the same reason: the stored effect could differ from
 * whatever the new selection has on it, and guessing wrong is worse than
 * showing "none" and letting the user re-pick.
 */

import { Textbox } from "fabric";
import type { Canvas } from "fabric";
import { X as LX } from "lucide-react";
import {
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  TEXT_EFFECT_PRESETS,
  textEffectToFabricProps,
} from "../textEffects";
import type { TextEffect } from "../types";

// ===========================================================================
// Preset definitions — UI metadata only. The actual default params live in
// TEXT_EFFECT_PRESETS (textEffects.ts) — single source of truth.
// ===========================================================================

type EffectKind = TextEffect["kind"];

interface PresetMeta {
  kind: EffectKind;
  /** Label rendered under each preset tile. */
  label: string;
  /** Inline CSS approximating the Fabric effect for the tiny "Aa" preview. */
  previewStyle: React.CSSProperties;
}

/**
 * Order matches what the legacy popover surfaced. "Hollow" is the user-
 * facing label for the "outline" effect kind, mirroring the right-panel
 * chip copy (TextPropertiesControls.tsx). The internal kind stays
 * "outline" to keep the apply path identical.
 */
const PRESET_ORDER: ReadonlyArray<PresetMeta> = [
  {
    kind: "none",
    label: "None",
    previewStyle: { color: "#FFFFFF" },
  },
  {
    kind: "shadow",
    label: "Shadow",
    previewStyle: {
      color: "#FFFFFF",
      textShadow: "0 2px 4px rgba(0,0,0,0.6)",
    },
  },
  {
    kind: "lift",
    label: "Lift",
    previewStyle: {
      color: "#FFFFFF",
      textShadow: "0 4px 12px rgba(0,0,0,0.6)",
    },
  },
  {
    kind: "outline",
    label: "Hollow",
    previewStyle: {
      color: "transparent",
      WebkitTextStroke: "1.5px #FFFFFF",
    },
  },
  {
    kind: "splice",
    label: "Splice",
    previewStyle: {
      color: "transparent",
      WebkitTextStroke: "1.5px #FFFFFF",
      textShadow: "3px 3px 0 #C9A84C",
    },
  },
];

// ===========================================================================
// Props
// ===========================================================================

interface EffectsPanelProps {
  /** Drives whether the panel is mounted. Parent flips this. */
  open: boolean;
  /** Close handler — wired to X / Escape / outside-click / text deselect. */
  onClose: () => void;
  /** Fabric canvas — read/write the active Textbox just like the legacy popover. */
  canvas: Canvas | null;
  /**
   * Bumped by the orchestrator on every Fabric mutation; signals a re-read
   * of the active object so the panel highlights the correct preset and
   * parameters reflect the live values.
   */
  selectionVersion: number;
  /** Called after every mutation so the orchestrator can bump layerVersion. */
  onCanvasMutated?: () => void;
  /** Called after non-trivial discrete mutations so undo captures the step. */
  recordHistory?: () => void;
  /**
   * Anchor element of the trigger pill. Focus returns to it on close so
   * keyboard users land back where they started. Optional — if absent the
   * Esc / X handlers still fire close, just without focus restoration.
   */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

// ===========================================================================
// Helpers
// ===========================================================================

/** Read the active Textbox if there is one, otherwise null. */
function readActiveTextbox(canvas: Canvas | null): Textbox | null {
  if (!canvas) return null;
  const active = canvas.getActiveObject();
  if (!(active instanceof Textbox)) return null;
  return active;
}

/** Stash the picked preset on `active.data.effect` — same pattern as the
 *  legacy popover and right-panel chips. */
function stashEffectOnData(active: Textbox, preset: TextEffect): void {
  const dataBag =
    (active as unknown as { data?: Record<string, unknown> }).data ?? {};
  (active as unknown as { data: Record<string, unknown> }).data = {
    ...dataBag,
    effect: preset,
  };
}

// ===========================================================================
// Top-level panel
// ===========================================================================

export default function EffectsPanel(
  props: EffectsPanelProps,
): JSX.Element | null {
  const {
    open,
    onClose,
    canvas,
    selectionVersion,
    onCanvasMutated,
    recordHistory,
    triggerRef,
  } = props;

  const panelRef = useRef<HTMLDivElement | null>(null);

  // why: local mirror of the picked preset. Fabric doesn't round-trip the
  // effect kind back to the schema yet (Phase 2 TODO) so we drive the
  // highlight + parameter section from local state. On every selectionVersion
  // bump we re-read from `active.data.effect` if it was stashed there;
  // otherwise we fall back to "none".
  const [activeKind, setActiveKind] = useState<EffectKind>("none");

  // why: per-effect parameters held locally so sliders / color pickers can
  // drive live updates. Seeded from TEXT_EFFECT_PRESETS when the user picks
  // a preset, then mutated in place as the user drags / types. We
  // intentionally keep the whole `TextEffect` object so the discriminated
  // union narrowing stays clean per kind.
  const [params, setParams] = useState<TextEffect>({ kind: "none" });

  // ----- Re-sync from active object on selection / mutation -----
  useEffect(() => {
    const active = readActiveTextbox(canvas);
    if (!active) {
      // why: no textbox selected — drop highlight back to "none". The panel
      // itself will be closed by the parent's selection effect a tick later.
      setActiveKind("none");
      setParams({ kind: "none" });
      return;
    }
    const stashed = (
      active as unknown as { data?: { effect?: TextEffect } }
    ).data?.effect;
    if (stashed && stashed.kind) {
      setActiveKind(stashed.kind);
      setParams(stashed);
    } else {
      setActiveKind("none");
      setParams({ kind: "none" });
    }
  }, [canvas, selectionVersion]);

  // ----- Apply a preset (clicked tile) -----
  const handlePresetPick = useCallback(
    (kind: EffectKind): void => {
      const active = readActiveTextbox(canvas);
      if (!active) return;
      const preset = TEXT_EFFECT_PRESETS[kind];
      const fp = textEffectToFabricProps(preset);
      active.set({
        shadow: fp.shadow,
        stroke: fp.stroke,
        strokeWidth: fp.strokeWidth,
        paintFirst: fp.paintFirst,
      });
      stashEffectOnData(active, preset);
      setActiveKind(kind);
      setParams(preset);
      canvas?.requestRenderAll();
      onCanvasMutated?.();
      recordHistory?.();
    },
    [canvas, onCanvasMutated, recordHistory],
  );

  // ----- Apply a parameter tweak (slider / color change) -----
  // why: a parameter change is just "re-apply the current kind with a
  // mutated params object." We don't record history on every slider tick
  // because the undo stack auto-snapshots via Agent B's debounce; we DO
  // call onCanvasMutated so layerVersion bumps and downstream subscribers
  // re-read. `commitHistory` is a separate optional path the caller can
  // fire on pointer-up / blur to anchor the discrete change.
  const applyParams = useCallback(
    (next: TextEffect, commitHistory: boolean): void => {
      const active = readActiveTextbox(canvas);
      if (!active) return;
      const fp = textEffectToFabricProps(next);
      active.set({
        shadow: fp.shadow,
        stroke: fp.stroke,
        strokeWidth: fp.strokeWidth,
        paintFirst: fp.paintFirst,
      });
      stashEffectOnData(active, next);
      setParams(next);
      canvas?.requestRenderAll();
      onCanvasMutated?.();
      if (commitHistory) recordHistory?.();
    },
    [canvas, onCanvasMutated, recordHistory],
  );

  // ----- Escape key closes -----
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ----- Outside-click closes -----
  // why: any click outside the panel (canvas, other sidebars, header, etc.)
  // closes so the user can resume working. We exclude the panel itself + the
  // trigger so clicking the trigger doesn't immediately re-close before the
  // trigger's onClick fires. We ALSO exclude any element marked
  // `data-studio-popover` (e.g. ColorPicker's portaled popover) — without
  // this the user opens the panel, clicks a color swatch in the portaled
  // ColorPicker popover, and the panel slams shut because the swatch isn't
  // a descendant of `panelRef`.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      // why: ColorPicker portals its popover to document.body. Treat any
      // ancestor with [data-studio-popover] as "inside the panel" for
      // dismissal purposes.
      if (target instanceof Element) {
        if (target.closest("[data-studio-popover]")) return;
      }
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose, triggerRef]);

  // ----- Return focus to trigger on close -----
  useEffect(() => {
    if (open) return;
    if (triggerRef?.current) {
      triggerRef.current.focus();
    }
  }, [open, triggerRef]);

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      data-studio-panel="effects"
      role="dialog"
      aria-modal="false"
      aria-labelledby="effects-panel-title"
      className="fixed bottom-0 left-16 top-0 z-30 flex w-80 flex-col border-r border-[var(--studio-border)] bg-[var(--studio-panel)] shadow-2xl shadow-black/40"
    >
      {/* ----- Header ----- */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--studio-border)] px-4">
        <h2
          id="effects-panel-title"
          className="text-sm font-medium text-white"
        >
          Effects
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close effects"
          title="Close effects"
          className="focus-ring-dark rounded p-1 text-[var(--studio-text-muted)] transition-colors hover:bg-[var(--studio-hover)] hover:text-white"
        >
          <LX size={16} />
        </button>
      </header>

      {/* ----- Scrollable body ----- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* === Section 1: Style preset grid === */}
        <Eyebrow>Style</Eyebrow>
        <div className="grid grid-cols-3 gap-2 px-4 pb-2">
          {PRESET_ORDER.map((p) => (
            <PresetTile
              key={p.kind}
              meta={p}
              active={p.kind === activeKind}
              onClick={() => handlePresetPick(p.kind)}
            />
          ))}
        </div>

        {/* === Section 2: Per-effect parameter controls === */}
        {activeKind === "none" ? (
          <p className="px-4 pb-4 pt-3 text-xs text-[var(--studio-text-faint)]">
            Select a style to customize it.
          </p>
        ) : (
          <>
            <Eyebrow>Adjust</Eyebrow>
            <div className="space-y-4 px-4 pb-4">
              <EffectParams
                params={params}
                onChange={(next) => applyParams(next, false)}
                onCommit={(next) => applyParams(next, true)}
              />
            </div>
          </>
        )}

        {/* === Section 3: Reset === */}
        {activeKind !== "none" ? (
          <div className="border-t border-[var(--studio-border)] px-4 py-3">
            <button
              type="button"
              onClick={() => handlePresetPick("none")}
              className="focus-ring-dark w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] py-2 text-xs font-medium text-[var(--studio-text-muted)] transition-colors hover:bg-[var(--studio-hover)] hover:text-white"
            >
              Reset to default
            </button>
          </div>
        ) : null}

        {/* why: little tail so the last row doesn't stick to the panel bottom. */}
        <div className="h-3" aria-hidden="true" />
      </div>
    </aside>
  );
}

// ===========================================================================
// Eyebrow label
// ===========================================================================

function Eyebrow(props: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-4 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
      {props.children}
    </div>
  );
}

// ===========================================================================
// PresetTile — Canva-style preview tile
// ===========================================================================

function PresetTile(props: {
  meta: PresetMeta;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const { meta, active, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={meta.label}
      className={`focus-ring-dark group flex flex-col items-center gap-1.5 rounded-md p-1 transition-colors ${
        active ? "" : ""
      }`}
    >
      <div
        className={`flex h-[76px] w-[76px] items-center justify-center rounded-md border bg-[var(--studio-input-bg)] transition-colors ${
          active
            ? "border-gold-500 ring-2 ring-gold-500"
            : "border-[var(--studio-border)] group-hover:border-[var(--studio-text-muted)]"
        }`}
      >
        <span
          className="text-2xl font-semibold leading-none"
          style={meta.previewStyle}
        >
          Aa
        </span>
      </div>
      <span
        className={`text-xs ${
          active
            ? "font-medium text-gold-500"
            : "text-[var(--studio-text-muted)]"
        }`}
      >
        {meta.label}
      </span>
    </button>
  );
}

// ===========================================================================
// EffectParams — per-kind parameter controls
// ===========================================================================

interface EffectParamsProps {
  params: TextEffect;
  /** Fired on every input change — sliders, color picks. No history snapshot. */
  onChange: (next: TextEffect) => void;
  /** Fired on commit (pointer-up / blur) — anchors a history step. */
  onCommit: (next: TextEffect) => void;
}

function EffectParams(props: EffectParamsProps): JSX.Element | null {
  const { params, onChange, onCommit } = props;

  switch (params.kind) {
    case "none":
      return null;

    case "shadow":
      return (
        <>
          <Slider
            label="Offset X"
            min={-30}
            max={30}
            step={1}
            value={params.offsetX}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ ...params, offsetX: v })}
            onCommit={(v) => onCommit({ ...params, offsetX: v })}
          />
          <Slider
            label="Offset Y"
            min={-30}
            max={30}
            step={1}
            value={params.offsetY}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ ...params, offsetY: v })}
            onCommit={(v) => onCommit({ ...params, offsetY: v })}
          />
          <Slider
            label="Blur"
            min={0}
            max={40}
            step={1}
            value={params.blur}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ ...params, blur: v })}
            onCommit={(v) => onCommit({ ...params, blur: v })}
          />
          <ColorRow
            label="Color"
            value={params.color}
            onChange={(c) => onChange({ ...params, color: c })}
            onCommit={(c) => onCommit({ ...params, color: c })}
          />
        </>
      );

    case "outline":
      return (
        <>
          <Slider
            label="Thickness"
            min={1}
            max={20}
            step={1}
            value={params.width}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ ...params, width: v })}
            onCommit={(v) => onCommit({ ...params, width: v })}
          />
          <ColorRow
            label="Color"
            value={params.color}
            onChange={(c) => onChange({ ...params, color: c })}
            onCommit={(c) => onCommit({ ...params, color: c })}
          />
        </>
      );

    case "lift":
      return (
        <Slider
          label="Intensity"
          min={0}
          max={1}
          step={0.05}
          value={params.opacity}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onChange({ ...params, opacity: v })}
          onCommit={(v) => onCommit({ ...params, opacity: v })}
        />
      );

    case "splice":
      return (
        <>
          <Slider
            label="Offset X"
            min={-30}
            max={30}
            step={1}
            value={params.offsetX}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ ...params, offsetX: v })}
            onCommit={(v) => onCommit({ ...params, offsetX: v })}
          />
          <Slider
            label="Offset Y"
            min={-30}
            max={30}
            step={1}
            value={params.offsetY}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ ...params, offsetY: v })}
            onCommit={(v) => onCommit({ ...params, offsetY: v })}
          />
          <Slider
            label="Thickness"
            min={1}
            max={10}
            step={1}
            value={params.outlineWidth}
            format={(v) => `${v}`}
            onChange={(v) => onChange({ ...params, outlineWidth: v })}
            onCommit={(v) => onCommit({ ...params, outlineWidth: v })}
          />
          <ColorRow
            label="Color"
            value={params.outlineColor}
            onChange={(c) => onChange({ ...params, outlineColor: c })}
            onCommit={(c) => onCommit({ ...params, outlineColor: c })}
          />
        </>
      );
  }
}

// ===========================================================================
// Slider — label + range + numeric input row
// ===========================================================================

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Formatter for the read-only display next to the input. Decoupled from
   *  the numeric input so e.g. opacity shows "50%" while the slider tracks 0-1. */
  format: (v: number) => string;
  onChange: (next: number) => void;
  onCommit: (next: number) => void;
}

function Slider(props: SliderProps): JSX.Element {
  const { label, min, max, step, value, format, onChange, onCommit } = props;
  // why: keep the numeric input as a controlled string so the user can clear
  // and type freely — committing the actual numeric value only happens on
  // blur / Enter via parseSafe.
  const [inputText, setInputText] = useState<string>(() => String(value));
  // why: re-sync the input when the upstream value changes (e.g. user
  // picks a different preset, or another control mutated the same param).
  useEffect(() => {
    setInputText(String(value));
  }, [value]);

  const commitFromText = useCallback((): void => {
    const parsed = Number(inputText);
    if (!Number.isFinite(parsed)) {
      setInputText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onCommit(clamped);
    setInputText(String(clamped));
  }, [inputText, min, max, value, onCommit]);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-medium text-white">{label}</label>
        <span className="text-[10px] text-[var(--studio-text-muted)]">
          {format(value)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={() => onCommit(value)}
          onKeyUp={(e) => {
            if (
              e.key === "ArrowLeft" ||
              e.key === "ArrowRight" ||
              e.key === "ArrowUp" ||
              e.key === "ArrowDown"
            ) {
              onCommit(value);
            }
          }}
          aria-label={label}
          className="focus-ring-dark h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--studio-input-bg)] accent-gold-500"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            const parsed = Number(e.target.value);
            if (Number.isFinite(parsed)) {
              const clamped = Math.min(max, Math.max(min, parsed));
              onChange(clamped);
            }
          }}
          onBlur={commitFromText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitFromText();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          aria-label={`${label} value`}
          className="focus-ring-dark w-14 rounded border border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] px-1.5 py-0.5 text-xs text-white [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden"
        />
      </div>
    </div>
  );
}

// ===========================================================================
// ColorRow — label + native color input
// ===========================================================================
//
// why a native <input type="color"> here (vs. opening ColorPickerPanel): the
// EffectsPanel itself is a left-rail panel. Opening ColorPickerPanel would
// kick EffectsPanel closed (they share the same overlay slot + mutual
// exclusivity), so the user loses their effect tuning context. The native
// color input picks any color directly from the OS color picker, which is
// the right affordance for an inline tuning sub-control inside a sibling
// panel. Cmd-click semantics differ from the full ColorPickerPanel but the
// tradeoff is the right one for this surface.

function ColorRow(props: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onCommit: (next: string) => void;
}): JSX.Element {
  const { label, value, onChange, onCommit } = props;
  // why: native color input expects "#RRGGBB" upper or lower case. Coerce
  // anything else to a safe default so the picker shows SOMETHING instead
  // of an undefined browser state.
  const safeValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs font-medium text-white">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={safeValue}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={(e) => onCommit(e.target.value.toUpperCase())}
          aria-label={`${label} color`}
          className="focus-ring-dark h-7 w-7 cursor-pointer rounded-md border border-[var(--studio-border)] bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0"
        />
        <span className="font-mono text-[10px] uppercase text-[var(--studio-text-muted)]">
          {safeValue}
        </span>
      </div>
    </div>
  );
}
