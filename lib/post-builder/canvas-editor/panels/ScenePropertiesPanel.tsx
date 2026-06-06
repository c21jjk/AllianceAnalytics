"use client";

/**
 * ScenePropertiesPanel — Phase 6 (Reel Studio), Day 3 MVP
 * --------------------------------------------------------
 *
 * Right-side panel that surfaces the SELECTED scene's editable properties:
 *   • Motion preset (photo scenes only — design scenes are static frames in MVP)
 *   • Duration (500ms..10000ms slider + quick-pick chips)
 *   • Transition in (cut / fade / dissolve / slide_left / zoom_blur)
 *   • Transition length (100ms..1000ms slider — hidden when transition is "cut")
 *
 * Mirrors SelectionPropertiesPanel's vertical rhythm, header chip styling, and
 * 11px uppercase section-header convention. Lives in the same right-side slot
 * in ReelStudioClient (the orchestrator). All edits flow through the contract
 * callback `onSceneChanged(sceneId, patch)` — the parent reducer translates
 * `motionPreset` patches into MotionPath rect math via MOTION_PRESETS[name].
 *
 * Why this panel is "dumb":
 *   The parent owns the composition state (scenes + reducer). This panel just
 *   reads the selected scene and emits typed patches. That keeps the parent as
 *   the single source of truth for scene math (totalDurationMs recalcs,
 *   transition-overlap accounting, etc.) and keeps the panel re-renderable
 *   from any source — keyboard shortcuts, direct prop writes, etc. — without
 *   local state drift.
 */

import { type JSX, type ReactNode } from "react";

import type { ScenePropertiesPanelProps } from "../contracts";
import {
  MOTION_PRESETS,
  REEL_CAPS,
  type MotionPath,
  type TextOverlay,
  type TextOverlayAnimation,
  type TransitionType,
} from "../../types";
import {
  TEXT_OVERLAY_PRESETS,
  TEXT_OVERLAY_PRESET_ORDER,
  createTextOverlay,
} from "../../reel-templates/text-overlay";

const OVERLAY_ANIM_ORDER: readonly TextOverlayAnimation[] = [
  "none",
  "fade",
  "pop",
  "rise",
  "typewriter",
];
const OVERLAY_ANIM_LABEL: Readonly<Record<TextOverlayAnimation, string>> = {
  none: "None",
  fade: "Fade",
  pop: "Pop",
  rise: "Rise",
  typewriter: "Type",
};

// ---------------------------------------------------------------------------
// Local types + constants
// ---------------------------------------------------------------------------

/**
 * Names of presets in MOTION_PRESETS that the panel surfaces as buttons. Kept
 * as a typed tuple so the iteration order is deterministic AND the values are
 * narrowed to keys of MOTION_PRESETS (catches typos at compile time).
 */
const MOTION_PRESET_ORDER = [
  "static",
  "zoom_in",
  "zoom_out",
  "pan_left",
  "pan_right",
] as const satisfies ReadonlyArray<keyof typeof MOTION_PRESETS>;

type MotionPresetName = (typeof MOTION_PRESET_ORDER)[number];

/** Human-readable label per preset. */
const MOTION_PRESET_LABEL: Readonly<Record<MotionPresetName, string>> = {
  static: "Static",
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  pan_left: "Pan left",
  pan_right: "Pan right",
};

/**
 * Transitions surfaced as buttons, in display order. "cut" first because that
 * matches the "no transition / hard cut" mental model users reach for first.
 */
const TRANSITION_ORDER = [
  "cut",
  "fade",
  "dissolve",
  "fade_white",
  "slide_left",
  "slide_right",
  "slide_up",
  "slide_down",
  "wipe_left",
  "smooth_left",
  "smooth_right",
  "circle_open",
  "zoom_blur",
] as const satisfies ReadonlyArray<TransitionType>;

const TRANSITION_LABEL: Readonly<Record<TransitionType, string>> = {
  cut: "Cut",
  fade: "Crossfade",
  dissolve: "Dip to black",
  fade_white: "Dip to white",
  slide_left: "Slide left",
  slide_right: "Slide right",
  slide_up: "Slide up",
  slide_down: "Slide down",
  wipe_left: "Wipe",
  smooth_left: "Whip left",
  smooth_right: "Whip right",
  circle_open: "Circle",
  zoom_blur: "Zoom blur",
};

/** Duration quick-pick chips, in ms. */
const DURATION_QUICK_PICKS_MS = [500, 1000, 1500, 2000, 3000] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format milliseconds as a decimal-second string, e.g. 1500 → "1.5s", 500 →
 * "0.5s", 1000 → "1.0s". One decimal place — matches the precision the
 * duration slider's 100ms step exposes.
 */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Compare two MotionRect-ish bags for exact equality. Used by detectMotionPreset
 * to identify which preset (if any) the current scene's motion matches.
 */
function rectEquals(a: MotionPath["startRect"], b: MotionPath["startRect"]): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Identify which named preset a MotionPath corresponds to, or null if it's a
 * custom motion that doesn't match any preset. Compares start + end rects
 * structurally — easing isn't part of the match because the editor doesn't
 * surface easing yet (Day 3 MVP).
 *
 * Why this exists: Scene.content.kind === "photo" stores motion as a full
 * MotionPath (start + end rect + easing). There's no `motionPreset` field on
 * the schema — preset is a UI convenience that the editor/reducer expand into
 * a path. So the panel has to derive which preset is "active" by reverse-
 * matching the path against MOTION_PRESETS.
 */
function detectMotionPreset(motion: MotionPath): MotionPresetName | null {
  for (const name of MOTION_PRESET_ORDER) {
    const preset = MOTION_PRESETS[name];
    // why: defensive — MOTION_PRESETS is typed Record<string, MotionPath> so
    // TypeScript can't statically guarantee a value for our preset keys. In
    // practice every key in MOTION_PRESET_ORDER is present in MOTION_PRESETS,
    // but a missing entry would otherwise crash at runtime here.
    if (!preset) continue;
    if (
      rectEquals(motion.startRect, preset.startRect) &&
      rectEquals(motion.endRect, preset.endRect)
    ) {
      return name;
    }
  }
  return null;
}

/**
 * Inline SVG glyph for a motion preset. Small (16×16) so it fits inside the
 * 2-column grid buttons alongside a label. All glyphs use currentColor so
 * the gold/dark "active" state inherits naturally.
 */
function presetIcon(preset: MotionPresetName): JSX.Element {
  switch (preset) {
    case "static":
      // why: filled dot — visually communicates "no movement / fixed point".
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="3" />
        </svg>
      );
    case "zoom_in":
      // why: square with outward arrows — outline shrinking outward = zoom in.
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
          <path d="M5.5 5.5L8 8M10.5 5.5L8 8M5.5 10.5L8 8M10.5 10.5L8 8" />
        </svg>
      );
    case "zoom_out":
      // why: square with inward arrows — outline expanding inward = zoom out.
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
          <path d="M8 8L5.5 5.5M8 8L10.5 5.5M8 8L5.5 10.5M8 8L10.5 10.5" />
        </svg>
      );
    case "pan_left":
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 8H4M7 5L4 8l3 3" />
        </svg>
      );
    case "pan_right":
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 8h7M9 5l3 3-3 3" />
        </svg>
      );
    default: {
      // why: exhaustive — adding a preset to MOTION_PRESET_ORDER without an
      // icon here is a compile error rather than a silent missing-icon bug.
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}

/**
 * Inline SVG glyph for a transition type. Shares visual language with
 * TimelineStrip's between-scene glyphs (sibling agent's file) so the icon
 * vocabulary stays consistent: cut = vertical bar, fade = circle to dot,
 * dissolve = two overlapping squares, slide = right-arrow, zoom_blur = curved.
 */
function transitionIconSmall(type: TransitionType): JSX.Element {
  switch (type) {
    case "cut":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M8 3v10" />
        </svg>
      );
    case "fade":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="5" cy="8" r="3" opacity="0.35" />
          <circle cx="11" cy="8" r="3" />
        </svg>
      );
    case "dissolve":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="2.5" y="4" width="7" height="7" opacity="0.5" />
          <rect x="6.5" y="6" width="7" height="7" />
        </svg>
      );
    case "slide_left":
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
          <path d="M3 8h9M9 5l3 3-3 3" />
        </svg>
      );
    case "zoom_blur":
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
          <circle cx="8" cy="8" r="2" />
          <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" />
        </svg>
      );
    default:
      // Generic "transition" glyph (two overlapping panels with an arrow) for
      // the expanded set (slides/wipe/whip/circle/dip-to-white). The label
      // below the icon disambiguates; a bespoke glyph per preset isn't worth
      // the SVG churn. `type` is intentionally not exhaustively checked here so
      // adding a TransitionType doesn't require a new icon.
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
          <rect x="2" y="4" width="7" height="8" rx="1" opacity="0.5" />
          <rect x="7" y="4" width="7" height="8" rx="1" />
        </svg>
      );
  }
}

/**
 * Pretty label for the scene's content kind. The header subline shows
 * "Photo · 1.5s" or "Design · 1.0s", matching the timeline strip's
 * mental model. video_clip is reserved (Phase 7) but kept in the union for
 * future-proofing the type narrowing.
 */
function getKindLabel(kind: "design" | "photo" | "video_clip"): string {
  switch (kind) {
    case "design":
      return "Design";
    case "photo":
      return "Photo";
    case "video_clip":
      return "Video clip";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Section primitives — keep the JSX inside each render branch readable
// ---------------------------------------------------------------------------

interface SectionProps {
  /** Section header text. Rendered uppercase via CSS — pass natural case. */
  title: string;
  /** Optional right-aligned eyebrow (e.g. a "Custom" badge for motion). */
  rightSlot?: JSX.Element | null;
  children: ReactNode;
}

/**
 * Standard section wrapper. Matches SelectionPropertiesPanel's rhythm: a
 * neutral-100 top divider (skipped on the first section via :first-child via
 * the column-level `divide` utility) + a tight uppercase 11px header.
 */
function Section({ title, rightSlot, children }: SectionProps): JSX.Element {
  return (
    <section className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
          {title}
        </h3>
        {rightSlot ?? null}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ScenePropertiesPanel — the Reel-Studio counterpart to
 * SelectionPropertiesPanel. Renders the selected scene's editable props, or
 * an empty-state nudge when nothing is selected.
 *
 * See the contract in ../contracts.ts ("Phase 6 — Reel Studio") for the
 * authoritative prop shape.
 */
export default function ScenePropertiesPanel(
  props: ScenePropertiesPanelProps,
): JSX.Element {
  const { scene, onSceneChanged } = props;

  // ----- Empty state ------------------------------------------------------
  if (scene === null) {
    return (
      <aside
        className="flex w-72 flex-col border-l border-[var(--studio-border)] bg-[var(--studio-panel)]"
        aria-label="Scene properties"
      >
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          {/* why: chevron-down — points toward the timeline strip below, where
              the user picks a scene. Visual nudge instead of long copy. */}
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="mb-3 text-[var(--studio-text-faint)]"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <p className="text-sm text-[var(--studio-text-muted)]">
            Pick a scene on the timeline to edit it.
          </p>
        </div>
      </aside>
    );
  }

  // ----- A scene is selected ---------------------------------------------
  const sceneKind = scene.content.kind;
  const kindLabel = getKindLabel(sceneKind);
  const isPhoto = sceneKind === "photo";

  // why: derive the active motion preset for photo scenes by reverse-matching
  // the stored MotionPath against MOTION_PRESETS. null when it's a custom path
  // (post-Day-3 feature) — we surface that as a "Custom" badge so the user
  // knows a preset button won't be highlighted.
  //
  // We re-narrow via scene.content.kind here instead of relying on the `isPhoto`
  // boolean — TypeScript's control-flow analysis only narrows discriminated
  // unions when the discriminant is checked on the value directly, not via an
  // intermediate alias.
  const activePreset: MotionPresetName | null =
    scene.content.kind === "photo"
      ? detectMotionPreset(scene.content.motion)
      : null;

  /**
   * Index-of for the header subline. We can't trust scene.startMs for "scene
   * N of M" because that's a time offset, not a position. The parent passes
   * us a single scene — to display "Scene 2 of 5" we'd need the full list.
   * Day-3 scope keeps this honest: show the scene's stable id as a fallback
   * via the kind+duration eyebrow only.
   *
   * Phase 6 day-4+ TODO: extend the contract with `{ index, total }` if the
   * parent ever surfaces the position info naturally.
   */
  const headerSubline = `${kindLabel} · ${formatSeconds(scene.durationMs)}`;

  return (
    <aside
      className="flex w-72 flex-col border-l border-[var(--studio-border)] bg-[var(--studio-panel)]"
      aria-label="Scene properties"
    >
      {/* ----- Header --------------------------------------------------- */}
      <header className="border-b border-[var(--studio-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--studio-text)]">
          Scene properties
        </h2>
        <p className="mt-0.5 text-xs text-[var(--studio-text-muted)]">{headerSubline}</p>
      </header>

      {/* ----- Sections (scrollable) ----------------------------------- */}
      <div className="flex-1 divide-y divide-neutral-100 overflow-y-auto">
        {/* MOTION — photo scenes only. Design scenes are static frames in MVP. */}
        {isPhoto ? (
          <Section
            title="Motion"
            rightSlot={
              activePreset === null ? (
                <span className="inline-flex items-center rounded bg-[var(--studio-hover)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                  Custom
                </span>
              ) : null
            }
          >
            <div
              className="grid grid-cols-2 gap-1.5"
              role="radiogroup"
              aria-label="Motion preset"
            >
              {MOTION_PRESET_ORDER.map((preset) => {
                const isActive = activePreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() =>
                      onSceneChanged(scene.id, { motionPreset: preset })
                    }
                    className={[
                      "flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "border-gold-500 bg-gold-500 text-white"
                        : "border-[var(--studio-border)] bg-[var(--studio-input-bg)] text-[var(--studio-text)] hover:bg-[var(--studio-hover)] hover:border-gold-400",
                    ].join(" ")}
                  >
                    {presetIcon(preset)}
                    <span className="truncate">
                      {MOTION_PRESET_LABEL[preset]}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        ) : null}

        {/* DURATION — always renders. */}
        <Section title="Duration">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={REEL_CAPS.minSceneDurationMs}
              max={REEL_CAPS.maxSceneDurationMs}
              step={100}
              value={scene.durationMs}
              onChange={(e) =>
                onSceneChanged(scene.id, {
                  durationMs: Number(e.currentTarget.value),
                })
              }
              aria-label="Scene duration"
              aria-valuetext={formatSeconds(scene.durationMs)}
              className="flex-1 accent-gold-500"
            />
            <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--studio-text)]">
              {formatSeconds(scene.durationMs)}
            </span>
          </div>
          {/* Quick-pick chips. Selected chip gets gold background. */}
          <div className="mt-2 flex flex-wrap gap-1">
            {DURATION_QUICK_PICKS_MS.map((ms) => {
              const isActive = scene.durationMs === ms;
              return (
                <button
                  key={ms}
                  type="button"
                  onClick={() =>
                    onSceneChanged(scene.id, { durationMs: ms })
                  }
                  className={[
                    "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                    isActive
                      ? "bg-gold-500 text-white"
                      : "bg-[var(--studio-hover)] text-[var(--studio-text-muted)] hover:bg-[var(--studio-active)] hover:text-[var(--studio-text)]",
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  {formatSeconds(ms)}
                </button>
              );
            })}
          </div>
        </Section>

        {/* TRANSITION IN — always renders. Scene 0 is implicitly cut in the
            timeline, but the panel still surfaces the control so the user can
            decide; the strip handles the visual side. */}
        <Section title="Transition in">
          <div
            className="flex flex-wrap gap-1"
            role="radiogroup"
            aria-label="Transition in"
          >
            {TRANSITION_ORDER.map((t) => {
              const isActive = scene.transitionIn === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() =>
                    onSceneChanged(scene.id, { transitionIn: t })
                  }
                  className={[
                    "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors",
                    isActive
                      ? "border-gold-500 bg-gold-500 text-white"
                      : "border-[var(--studio-border)] bg-[var(--studio-input-bg)] text-[var(--studio-text)] hover:bg-[var(--studio-hover)] hover:border-gold-400",
                  ].join(" ")}
                >
                  {transitionIconSmall(t)}
                  <span>{TRANSITION_LABEL[t]}</span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* TRANSITION LENGTH — only meaningful when there's an actual
            transition (cut = 0ms overlap = nothing to tune). */}
        {scene.transitionIn !== "cut" ? (
          <Section title="Transition length">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={100}
                max={1000}
                step={100}
                value={scene.transitionMs}
                onChange={(e) =>
                  onSceneChanged(scene.id, {
                    transitionMs: Number(e.currentTarget.value),
                  })
                }
                aria-label="Transition length"
                aria-valuetext={formatSeconds(scene.transitionMs)}
                className="flex-1 accent-gold-500"
              />
              <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--studio-text)]">
                {formatSeconds(scene.transitionMs)}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-[var(--studio-text-muted)]">
              Most reels use 0.2-0.4s for natural pacing.
            </p>
          </Section>
        ) : null}

        {/* 2026-06-05 — Animated text overlays (CapCut-style). Add headline /
            address (street + city) / open-house time / price as text that
            animates in. Per Larissa's rules: street + city only, no agent
            name on Just Listed/Sold, no emojis in the image text. */}
        <Section title="Text">
          {(scene.textOverlays ?? []).length === 0 ? (
            <p className="mb-2 text-[11px] leading-snug text-[var(--studio-text-muted)]">
              Add animated text — headline, address (street + city), open-house
              time, price.
            </p>
          ) : null}
          <div className="space-y-3">
            {(scene.textOverlays ?? []).map((ov, i) => {
              const overlays = scene.textOverlays ?? [];
              const update = (patch: Partial<TextOverlay>): void =>
                onSceneChanged(scene.id, {
                  textOverlays: overlays.map((o, idx) =>
                    idx === i ? { ...o, ...patch } : o,
                  ),
                });
              const remove = (): void =>
                onSceneChanged(scene.id, {
                  textOverlays: overlays.filter((_, idx) => idx !== i),
                });
              const chip = (active: boolean): string =>
                [
                  "rounded border px-2 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "border-gold-500 bg-gold-500 text-white"
                    : "border-[var(--studio-border)] bg-[var(--studio-input-bg)] text-[var(--studio-text)] hover:bg-[var(--studio-hover)] hover:border-gold-400",
                ].join(" ");
              return (
                <div
                  key={ov.id}
                  className="space-y-2 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-input-bg)] p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <textarea
                      value={ov.text}
                      onChange={(e) => update({ text: e.currentTarget.value })}
                      rows={2}
                      placeholder="Your text"
                      className="flex-1 resize-none rounded border border-[var(--studio-border)] bg-[var(--studio-bg)] px-2 py-1 text-xs text-[var(--studio-text)] placeholder:text-[var(--studio-text-faint)]"
                    />
                    <button
                      type="button"
                      onClick={remove}
                      aria-label="Remove text overlay"
                      className="shrink-0 rounded p-1 text-[var(--studio-text-muted)] transition-colors hover:bg-[var(--studio-hover)] hover:text-[var(--studio-text)]"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {TEXT_OVERLAY_PRESET_ORDER.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          const spec = TEXT_OVERLAY_PRESETS[p];
                          update({
                            preset: p,
                            fontFamily: spec.fontFamily,
                            color: spec.color,
                            fontSize: spec.fontSize,
                          });
                        }}
                        className={chip(ov.preset === p)}
                      >
                        {TEXT_OVERLAY_PRESETS[p].label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {OVERLAY_ANIM_ORDER.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => update({ animation: a })}
                        className={chip(ov.animation === a)}
                      >
                        {OVERLAY_ANIM_LABEL[a]}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-faint)]">
                        Pos
                      </span>
                      {(
                        [
                          ["Top", 0.2],
                          ["Mid", 0.5],
                          ["Bot", 0.8],
                        ] as const
                      ).map(([lbl, yv]) => (
                        <button
                          key={lbl}
                          type="button"
                          onClick={() => update({ y: yv })}
                          className={chip(Math.abs(ov.y - yv) < 0.06)}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-faint)]">
                        Size
                      </span>
                      {(
                        [
                          ["S", 0.7],
                          ["M", 1],
                          ["L", 1.4],
                        ] as const
                      ).map(([lbl, mult]) => {
                        const base = TEXT_OVERLAY_PRESETS[ov.preset].fontSize;
                        const target = Math.round(base * mult);
                        return (
                          <button
                            key={lbl}
                            type="button"
                            onClick={() => update({ fontSize: target })}
                            className={chip(ov.fontSize === target)}
                          >
                            {lbl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() =>
              onSceneChanged(scene.id, {
                textOverlays: [
                  ...(scene.textOverlays ?? []),
                  createTextOverlay(),
                ],
              })
            }
            className="mt-2 inline-flex items-center gap-1 rounded border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--studio-text)] transition-colors hover:border-gold-400 hover:bg-[var(--studio-hover)]"
          >
            + Add text
          </button>
        </Section>
      </div>
    </aside>
  );
}
