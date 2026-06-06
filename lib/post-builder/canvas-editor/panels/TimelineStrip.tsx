"use client";

/**
 * TimelineStrip — bottom-of-workspace scene timeline for Reel Studio.
 * --------------------------------------------------------------------------
 *
 * Phase 6 of the canvas-editor rebuild. Lays out a horizontal strip of scene
 * blocks with transition glyphs between them, plus a trailing "+ Scene" tile
 * and a header summarising total scenes + duration.
 *
 * Layout (top to bottom):
 *   1. Header row (~24px): "TIMELINE · N scenes · Ts" eyebrow on the left;
 *      "+ Scene" button on the right (disabled at maxScenes cap).
 *   2. Scene blocks row (~64px tall): horizontally scrollable row of scene
 *      blocks. Each block's width is proportional to durationMs. Transition
 *      glyphs sit BETWEEN blocks (none in front of scene 0). Trailing
 *      dashed "+ Scene" tile when not at cap.
 *
 * Interactions (Day 3 MVP — UI only, Day 4 wires playback):
 *   • Click a scene block → selects it (`onSelectScene`).
 *   • Hover a scene block → reveal an X in the top-right (`onRemoveScene`).
 *     When `allowEmpty` is false AND this is the only scene, the X is
 *     disabled with an explanatory tooltip.
 *   • Drag a scene block → reorder. HTML5 drag/drop with a gold drop
 *     indicator on the boundary where the block will land.
 *   • Click a transition glyph → cycles type (cut → fade → dissolve →
 *     slide_left → zoom_blur → cut) via `onCycleTransition(scenes[i].id)`.
 *   • Click "+ Scene" → fires `onAddScene()`.
 *
 * Why mirror CarouselStrip's drag pattern: the editor already has one HTML5
 * drag/drop reorder convention (drop indicator on the boundary, hover-X for
 * remove). Reusing that vocabulary keeps the editor learnable — once
 * Larissa knows how to reorder carousel slides, she knows how to reorder
 * scenes. No new mental model.
 */

import { type JSX, useState } from "react";

import type { TimelineStripProps } from "../contracts";
import type { Scene, TransitionType } from "../../types";
import { REEL_CAPS } from "../../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Vertical size of a scene block in px. Width is computed from durationMs
 * (see PX_PER_MS + MIN/MAX width clamps). Header + transition glyph rows
 * sit at this same height-coordinate so the strip reads as one band.
 */
const BLOCK_HEIGHT_PX = 64 as const;

/**
 * Scale factor: 1 pixel of block width per 50ms of scene duration
 * (== 20 px per second). At this scale a 1s scene is ~20px wide before
 * clamping, so the MIN_WIDTH floor does most of the work for short
 * scenes. A 10s scene clamps at MAX_WIDTH so it can't dominate the row.
 */
const PX_PER_MS = 1 / 50;

/**
 * Minimum scene-block width in px. Why 80: a 1.5s scene at PX_PER_MS would
 * be 30px wide — too narrow to read the duration label inside. 80 keeps
 * even the shortest legal scene (500ms) comfortably clickable on touch.
 */
const MIN_BLOCK_WIDTH_PX = 80 as const;

/**
 * Maximum scene-block width in px. Why 240: a 10s scene at PX_PER_MS would
 * be 200px — already long, but caps gracefully here so a single big scene
 * can't push every other block off the visible strip.
 */
const MAX_BLOCK_WIDTH_PX = 240 as const;

/**
 * Width of the trailing "+ Scene" tile. Fixed (not duration-proportional)
 * so it's recognisable as an add-affordance, not a tiny pretend-scene.
 */
const ADD_TILE_WIDTH_PX = 80 as const;

/**
 * Default scenes cap — taken from REEL_CAPS.maxScenes (8). Surfaced as a
 * constant here so the prop default is statically introspectable.
 */
const DEFAULT_MAX_SCENES = REEL_CAPS.maxScenes;

/**
 * Cycle order for transition-glyph clicks. Click N times to walk around
 * the cycle; we land back on cut after 5 clicks.
 *
 * Why this order: easiest → most aggressive. Cut is the silent default;
 * fade/dissolve are conservative editorial choices; slide_left/zoom_blur
 * read as "I picked this on purpose" energy. Matches the order Larissa
 * encounters them in the ScenePropertiesPanel chip strip.
 */
const TRANSITION_CYCLE: readonly TransitionType[] = [
  "cut",
  "fade",
  "dissolve",
  "slide_left",
  "zoom_blur",
];

/**
 * Human-readable transition labels for tooltips. Kept here (not in
 * types.ts) so the renderer is free to evolve its own naming without
 * touching the editor's UX copy.
 */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format milliseconds as a one-decimal seconds string with an "s" suffix.
 *
 *   formatDuration(500)   === "0.5s"
 *   formatDuration(1500)  === "1.5s"
 *   formatDuration(10000) === "10.0s"
 *
 * Why one decimal always: keeps the visual rhythm consistent across blocks
 * — "1s" next to "1.5s" looks ragged; "1.0s" / "1.5s" reads as a tidy
 * column of numbers in the bottom-of-block duration labels.
 */
function formatDuration(ms: number): string {
  // why: clamp negatives + NaN to 0 so a malformed Scene never crashes the
  // strip. Defensive — Scene.durationMs should always be > 0 per the schema.
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return `${(safe / 1000).toFixed(1)}s`;
}

/**
 * Width in px for a scene block, given its durationMs. Clamped to the
 * MIN/MAX bounds so neither tiny nor giant scenes break the row's flow.
 */
function blockWidthForDuration(durationMs: number): number {
  const raw = Math.round(durationMs * PX_PER_MS * 50); // == durationMs * 1/50 * 50 == durationMs
  // why: the multiplication round-trips back to durationMs as a px value
  // (because 50ms == 1px at our chosen scale). Kept the * 50 form so the
  // PX_PER_MS constant stays meaningful at the call site for future tuning.
  // Actual scale is "1px per 50ms" → durationMs * 1/50.
  const scaled = Math.round(durationMs / 50);
  return Math.min(MAX_BLOCK_WIDTH_PX, Math.max(MIN_BLOCK_WIDTH_PX, scaled));
  // why we ignore `raw`: kept above for readability — the linter would flag
  // it if not referenced, but expressing it both ways made the math explicit
  // during code review. The actual return uses the simpler `scaled` form.
}

/**
 * Sum of all scene durations in ms. Used for the header total.
 *
 * Note: this is the SUM of scene durationMs values, not the post-transition
 * compositional duration (transitions overlap with the END of the previous
 * scene, so the rendered MP4 is slightly shorter). For the strip header
 * we want "how much content is in the timeline?", not "how long will the
 * MP4 be?" — those become noticeably different only with many fades, and
 * the renderer surfaces the precise number elsewhere.
 */
function totalDurationMs(scenes: readonly Scene[]): number {
  let acc = 0;
  for (const s of scenes) acc += s.durationMs;
  return acc;
}

/**
 * Next transition type in the cycle. Wraps cut → fade → dissolve →
 * slide_left → zoom_blur → cut. Exposed as a pure function so the parent
 * can compute the next value when handling onCycleTransition — but the
 * STRIP itself only calls the parent's callback; the parent owns the
 * Scene model. We retain this for tooltip/preview hints below.
 */
function nextTransition(current: TransitionType): TransitionType {
  const idx = TRANSITION_CYCLE.indexOf(current);
  // why: defensive — if a future TransitionType lands and a stale
  // composition has it before the renderer is updated, treat it as if the
  // user was on `cut` so the cycle still works.
  if (idx === -1) return TRANSITION_CYCLE[1] ?? "fade";
  const next = TRANSITION_CYCLE[(idx + 1) % TRANSITION_CYCLE.length];
  return next ?? "cut";
}

// ---------------------------------------------------------------------------
// Drop-target indicator state
// ---------------------------------------------------------------------------

/**
 * Where the active drop indicator should render. `index` is the position
 * the dragged block would land at AFTER the reorder (0..N inclusive).
 */
interface DropTarget {
  index: number;
}

// ===========================================================================
// Component
// ===========================================================================

export default function TimelineStrip(props: TimelineStripProps): JSX.Element {
  const {
    scenes,
    selectedSceneId,
    onSelectScene,
    onReorderScenes,
    onAddScene,
    onRemoveScene,
    onCycleTransition,
    allowEmpty = false,
    maxScenes = DEFAULT_MAX_SCENES,
  } = props;

  // -------------------------------------------------------------------------
  // Drag state — kept local; parent only learns about a completed reorder
  // -------------------------------------------------------------------------
  // why: transient UI affordance only. Same pattern CarouselStrip uses so
  // the two reorderable strips stay structurally consistent.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const sceneCount = scenes.length;
  const atMax = sceneCount >= maxScenes;
  const totalMs = totalDurationMs(scenes);

  // -------------------------------------------------------------------------
  // Drag handlers
  // -------------------------------------------------------------------------

  function handleDragStart(
    e: React.DragEvent<HTMLElement>,
    index: number,
  ): void {
    setDraggingIndex(index);
    setDropTarget(null);
    // why: Firefox requires setData() for drag to actually start. Wrap in
    // try/catch — some browsers throw on repeat sets.
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", String(index));
    } catch {
      // ignore
    }
  }

  function handleBlockDragOver(
    e: React.DragEvent<HTMLElement>,
    index: number,
  ): void {
    if (draggingIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // why: left half → drop BEFORE this block; right half → drop AFTER
    // (i.e., index + 1). Mirrors CarouselStrip's hit-test convention.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isLeftHalf = e.clientX - rect.left < rect.width / 2;
    const targetIndex = isLeftHalf ? index : index + 1;
    setDropTarget((prev) =>
      prev?.index === targetIndex ? prev : { index: targetIndex },
    );
  }

  function handleDrop(e: React.DragEvent<HTMLElement>): void {
    e.preventDefault();
    if (draggingIndex === null || dropTarget === null) {
      resetDragState();
      return;
    }
    commitReorder(draggingIndex, dropTarget.index);
    resetDragState();
  }

  function handleDragEnd(): void {
    resetDragState();
  }

  function resetDragState(): void {
    setDraggingIndex(null);
    setDropTarget(null);
  }

  /**
   * Compute the new ID order after moving the scene at `fromIndex` to
   * land at `toIndex` (the boundary position 0..N), then fire
   * `onReorderScenes` with the result. The parent is the single source of
   * truth for the scenes array — we never mutate `scenes` directly.
   */
  function commitReorder(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= scenes.length) return;
    if (toIndex < 0 || toIndex > scenes.length) return;
    // why: dropping at the boundary just before or after the dragged block
    // is a no-op. Removing first shifts later indices left, so adjust.
    const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
    if (adjustedTo === fromIndex) return;
    const ids = scenes.map((s) => s.id);
    const [moved] = ids.splice(fromIndex, 1);
    if (!moved) return;
    ids.splice(adjustedTo, 0, moved);
    onReorderScenes(ids);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section
      role="region"
      aria-label="Reel timeline"
      className="flex w-full flex-col gap-2 border-t border-[var(--studio-border)] bg-[var(--studio-panel)] px-4 py-2.5"
    >
      {/* Header row: eyebrow summary + Add Scene button */}
      <header className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-text-faint)]">
          {`Timeline · ${sceneCount} scene${sceneCount === 1 ? "" : "s"} · ${formatDuration(totalMs)}`}
        </span>
        <button
          type="button"
          onClick={atMax ? undefined : onAddScene}
          disabled={atMax}
          className={[
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150",
            atMax
              ? "cursor-not-allowed bg-[var(--studio-hover)] text-[var(--studio-text-faint)]"
              : "bg-gold-500 text-neutral-900 hover:bg-gold-400 active:bg-gold-600",
          ].join(" ")}
          aria-label="Add scene"
          title={
            atMax
              ? `Reel is full — remove a scene to add another (max ${maxScenes}).`
              : "Add a new scene to the timeline"
          }
        >
          <PlusIcon />
          Scene
        </button>
      </header>

      {/* Scene blocks row OR empty state */}
      {sceneCount === 0 ? (
        <EmptyState onAddScene={onAddScene} atMax={atMax} />
      ) : (
        <div
          className="flex items-stretch gap-1 overflow-x-auto overflow-y-hidden"
          // why: tiny vertical padding so the focus ring on a block doesn't
          // get clipped by the section's bottom padding.
          style={{ paddingTop: 2, paddingBottom: 2 }}
          onDragOver={(e) => {
            // why: keep the drag event alive when the cursor lands in the
            // gap between blocks — specific block handlers still set the
            // target index; this is a fallback.
            if (draggingIndex !== null) e.preventDefault();
          }}
          onDrop={handleDrop}
        >
          {/* Leading drop indicator (insert before index 0) */}
          <DropIndicator visible={dropTarget?.index === 0} />

          {scenes.map((scene, idx) => {
            const isFirst = idx === 0;
            const isOnlyScene = sceneCount === 1;
            // why: per spec — when allowEmpty is false and only one scene
            // exists, the X is disabled (a composition needs ≥1 scene).
            const removeDisabled = !allowEmpty && isOnlyScene;
            const isSelected = scene.id === selectedSceneId;
            const blockWidth = blockWidthForDuration(scene.durationMs);

            return (
              <div
                key={scene.id}
                className="flex flex-shrink-0 items-stretch"
              >
                {/* Transition glyph between this scene and the previous.
                    Skipped for scene 0 — the timeline just begins there. */}
                {!isFirst ? (
                  <TransitionGlyphButton
                    transition={scene.transitionIn}
                    transitionMs={scene.transitionMs}
                    onClick={() => onCycleTransition(scene.id)}
                  />
                ) : null}

                <SceneBlock
                  scene={scene}
                  sceneNumber={idx + 1}
                  widthPx={blockWidth}
                  heightPx={BLOCK_HEIGHT_PX}
                  isSelected={isSelected}
                  isDragging={draggingIndex === idx}
                  removeDisabled={removeDisabled}
                  onSelect={() => onSelectScene(scene.id)}
                  onRemove={() => onRemoveScene(scene.id)}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleBlockDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop}
                />

                {/* Drop indicator for "drop AFTER this block" boundary */}
                <DropIndicator visible={dropTarget?.index === idx + 1} />
              </div>
            );
          })}

          {/* Trailing "+ Scene" tile */}
          <AddSceneTile
            disabled={atMax}
            onClick={onAddScene}
            heightPx={BLOCK_HEIGHT_PX}
            maxScenes={maxScenes}
          />
        </div>
      )}
    </section>
  );
}

// ===========================================================================
// Subcomponents
// ===========================================================================

// ---------------------------------------------------------------------------
// SceneBlock — the rectangular tile representing one scene
// ---------------------------------------------------------------------------

interface SceneBlockProps {
  scene: Scene;
  /** 1-based display number rendered in the corner badge. */
  sceneNumber: number;
  widthPx: number;
  heightPx: number;
  isSelected: boolean;
  isDragging: boolean;
  /** When true, the hover-X is rendered greyed out with an explanatory tooltip. */
  removeDisabled: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
}

function SceneBlock(props: SceneBlockProps): JSX.Element {
  const {
    scene,
    sceneNumber,
    widthPx,
    heightPx,
    isSelected,
    isDragging,
    removeDisabled,
    onSelect,
    onRemove,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDrop,
  } = props;

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onClick={onSelect}
      aria-current={isSelected ? "true" : undefined}
      aria-label={`Scene ${sceneNumber}, ${formatDuration(scene.durationMs)}${isSelected ? " (selected)" : ""}`}
      aria-grabbed={isDragging || undefined}
      className={[
        // base shape
        "group relative flex flex-shrink-0 flex-col items-center justify-between rounded-md text-left transition-all duration-150",
        // hover/focus affordances
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500",
        // selected vs unselected color treatment
        isSelected
          ? "border-2 border-gold-500 bg-gold-50"
          : "border border-[var(--studio-border)] bg-[var(--studio-hover)] hover:border-gold-400 hover:bg-gold-50/40",
        // dragging fade
        isDragging ? "opacity-50" : "opacity-100",
        "cursor-grab active:cursor-grabbing",
      ].join(" ")}
      style={{ width: widthPx, height: heightPx }}
    >
      {/* Top-left scene-number badge */}
      <span
        className={[
          "absolute left-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded px-1 text-[9px] font-bold uppercase leading-none tabular-nums",
          isSelected
            ? "bg-gold-600 text-white"
            : "bg-neutral-700 text-white",
        ].join(" ")}
        aria-hidden="true"
      >
        {sceneNumber}
      </span>

      {/* Top-right remove X (hover-revealed). Disabled state still renders
          so the user discovers the rule via the tooltip on hover. */}
      <button
        type="button"
        onClick={(e) => {
          // why: stop propagation so the X click doesn't ALSO trigger the
          // SceneBlock's onClick (which would select right after delete).
          e.stopPropagation();
          if (removeDisabled) return;
          onRemove();
        }}
        disabled={removeDisabled}
        className={[
          "absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full opacity-0 shadow transition-all duration-150 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-gold-400",
          removeDisabled
            ? "cursor-not-allowed bg-neutral-300 text-[var(--studio-text-faint)]"
            : "bg-neutral-900/80 text-white hover:bg-neutral-900",
        ].join(" ")}
        aria-label={`Remove scene ${sceneNumber}`}
        title={
          removeDisabled
            ? "A composition needs at least one scene."
            : `Remove scene ${sceneNumber}`
        }
      >
        <XIcon />
      </button>

      {/* Centered scene-kind glyph */}
      <span
        className={[
          "flex flex-1 items-center justify-center pt-3 text-[var(--studio-text-faint)]",
          isSelected ? "text-gold-700" : "group-hover:text-gold-700",
        ].join(" ")}
        aria-hidden="true"
      >
        {sceneIcon(scene)}
      </span>

      {/* Bottom duration label */}
      <span
        className={[
          "mb-1 inline-block w-full truncate px-1 text-center text-[10px] font-medium tabular-nums",
          isSelected ? "text-gold-800" : "text-[var(--studio-text-muted)]",
        ].join(" ")}
        aria-hidden="true"
      >
        {formatDuration(scene.durationMs)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// TransitionGlyphButton — small icon button sitting BETWEEN two scene blocks
// ---------------------------------------------------------------------------

interface TransitionGlyphButtonProps {
  transition: TransitionType;
  transitionMs: number;
  onClick: () => void;
}

function TransitionGlyphButton(
  props: TransitionGlyphButtonProps,
): JSX.Element {
  const { transition, transitionMs, onClick } = props;
  const label = TRANSITION_LABEL[transition];
  const next = nextTransition(transition);
  // why: tooltip surfaces BOTH the current type+duration AND the next
  // value the click will land on. That makes the cycle discoverable — the
  // first click teaches the user the pattern.
  const tooltip = `${label} · ${formatDuration(transitionMs)}. Click to cycle (next: ${TRANSITION_LABEL[next]}).`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "mx-0.5 my-auto inline-flex h-8 w-8 flex-shrink-0 items-center justify-center self-center rounded-md border border-transparent text-[var(--studio-text-faint)] transition-all duration-150",
        "hover:border-gold-300 hover:bg-gold-50/60 hover:text-gold-700",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500",
      ].join(" ")}
      aria-label={`Transition: ${transition}. Click to cycle.`}
      title={tooltip}
    >
      {transitionIcon(transition)}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AddSceneTile — trailing dashed-gold "+ Scene" tile
// ---------------------------------------------------------------------------

interface AddSceneTileProps {
  disabled: boolean;
  onClick: () => void;
  heightPx: number;
  maxScenes: number;
}

function AddSceneTile(props: AddSceneTileProps): JSX.Element {
  const { disabled, onClick, heightPx, maxScenes } = props;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        "ml-1 flex flex-shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed transition-all duration-150",
        disabled
          ? "cursor-not-allowed border-[var(--studio-border)] bg-[var(--studio-hover)] text-[var(--studio-text-faint)]"
          : "border-gold-400 bg-gold-50/30 text-gold-700 hover:border-gold-500 hover:bg-gold-50/60",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500",
      ].join(" ")}
      style={{ width: ADD_TILE_WIDTH_PX, height: heightPx }}
      aria-label="Add scene"
      title={
        disabled
          ? `Reel is full — remove a scene to add another (max ${maxScenes}).`
          : "Add a new scene to the timeline"
      }
    >
      <PlusIcon />
      <span className="text-[10px] font-semibold uppercase tracking-wider">
        Scene
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty state — shown when scenes.length === 0
// ---------------------------------------------------------------------------

function EmptyState(props: {
  onAddScene: () => void;
  atMax: boolean;
}): JSX.Element {
  // why: empty timeline still gets a usable "+ Scene" tile, but the
  // explainer copy nudges Larissa toward the first action. atMax can't
  // realistically be true when sceneCount === 0, but we forward the flag
  // for completeness.
  return (
    <div className="flex items-center gap-3">
      <AddSceneTile
        disabled={props.atMax}
        onClick={props.onAddScene}
        heightPx={BLOCK_HEIGHT_PX}
        maxScenes={DEFAULT_MAX_SCENES}
      />
      <p className="max-w-md text-[11px] leading-snug text-[var(--studio-text-faint)]">
        Empty timeline — click <span className="font-semibold">+ Scene</span>{" "}
        to start. Scenes play in order, left to right.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DropIndicator — 2px gold bar between blocks during a drag-over
// ---------------------------------------------------------------------------

function DropIndicator(props: { visible: boolean }): JSX.Element {
  // why: always render the slot (with 0-width when hidden) so the row's
  // spacing doesn't jump as the cursor crosses boundaries. The parent's
  // gap-1 provides the visual breathing room.
  return (
    <div
      aria-hidden="true"
      className={[
        "flex-shrink-0 self-center rounded-sm transition-all duration-150",
        props.visible ? "w-[2px] bg-gold-500" : "w-0 bg-transparent",
      ].join(" ")}
      style={{ height: BLOCK_HEIGHT_PX }}
    />
  );
}

// ===========================================================================
// Icons — inline SVGs (no library). Matches CarouselStrip's convention.
// ===========================================================================

/**
 * Inline SVG glyph for the scene's content kind. Maps:
 *   - "design"     → layered rectangles (stack)
 *   - "photo"      → photo / landscape with sun
 *   - "video_clip" → film-strip with sprocket holes
 *
 * All glyphs are stroke-based on a 24×24 grid for visual consistency at
 * the ~16px display size used inside the scene block. currentColor lets
 * the parent (selected vs unselected state) drive the tint.
 */
function sceneIcon(scene: Scene): JSX.Element {
  switch (scene.content.kind) {
    case "design":
      return <LayeredRectsIcon />;
    case "photo":
      return <PhotoIcon />;
    case "video_clip":
      return <FilmStripIcon />;
    default: {
      // why: defensive — if a future SceneContent kind lands and a stale
      // editor renders it, fall through to a neutral glyph rather than
      // crashing. The renderer enforces the union at runtime; we just need
      // to not blow up here.
      return <PhotoIcon />;
    }
  }
}

/**
 * Inline SVG glyph for a transition type. Each is a tiny pictogram
 * representing the visual effect: a hard bar for cut, fading rectangle
 * for fade, etc.
 *
 *   "cut"        → vertical bar
 *   "fade"       → rectangle with horizontal alpha gradient
 *   "dissolve"   → two overlapping circles
 *   "slide_left" → leftward arrow
 *   "zoom_blur"  → expanding diagonal lines from center
 *
 * 18×18 grid keeps them readable at the ~14px glyph size inside the
 * 32×32 button.
 */
function transitionIcon(type: TransitionType): JSX.Element {
  switch (type) {
    case "cut":
      return <CutIcon />;
    case "fade":
      return <FadeIcon />;
    case "dissolve":
      return <DissolveIcon />;
    case "slide_left":
      return <SlideLeftIcon />;
    case "zoom_blur":
      return <ZoomBlurIcon />;
    default:
      // why: forward-compat — any future TransitionType added before this
      // file is touched still gets a visible (if generic) glyph.
      return <CutIcon />;
  }
}

// ---------------------------------------------------------------------------
// Scene-kind icons
// ---------------------------------------------------------------------------

function LayeredRectsIcon(): JSX.Element {
  // why: stacked rectangles read as "designed composition / multi-layer
  // canvas" — same metaphor the layer panel uses. 20×20 viewBox + 1.5px
  // stroke matches the Lucide weight used elsewhere in the editor.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="6" width="11" height="9" rx="1" />
      <rect x="6" y="3" width="11" height="9" rx="1" />
    </svg>
  );
}

function PhotoIcon(): JSX.Element {
  // why: classic landscape-with-sun glyph — universally read as "photo".
  // The little sun + the mountain triangle disambiguate it from a generic
  // empty rectangle.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <circle cx="7" cy="8" r="1.25" />
      <path d="M3 14l4-4 3.5 3.5L13 11l4 4" />
    </svg>
  );
}

function FilmStripIcon(): JSX.Element {
  // why: rectangle with sprocket holes on both sides — the most legible
  // "film strip / video clip" pictogram at this size. Reserved for the
  // Phase 7 video_clip kind so the timeline already knows how to render
  // it before the renderer wires it in.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M3 7h14M3 13h14" />
      <path d="M6 3v14M14 3v14" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Transition icons
// ---------------------------------------------------------------------------

function CutIcon(): JSX.Element {
  // why: a single bold vertical bar reads as "hard cut" — the abrupt
  // boundary between two clips. Centered on the 18x18 grid.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M9 3v12" />
    </svg>
  );
}

function FadeIcon(): JSX.Element {
  // why: rectangle with a left-to-right alpha gradient depicting a fade.
  // A unique <linearGradient> id avoids cross-instance collision when
  // multiple FadeIcons live in the same DOM.
  // why no id-collision risk: SVG defs scoped to <defs> are matched by
  // url(#id) inside the same SVG element only, but per-instance unique
  // ids are still safer. We use a fixed id since each icon is its own
  // <svg> wrapper and the gradient ref is scoped to that subtree.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ts-fade-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect
        x="3"
        y="4"
        width="12"
        height="10"
        rx="1"
        fill="url(#ts-fade-grad)"
      />
    </svg>
  );
}

function DissolveIcon(): JSX.Element {
  // why: two overlapping circles depict the alpha crossfade between
  // adjacent scenes. The overlap reads as "blending".
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <circle cx="7" cy="9" r="4" />
      <circle cx="11" cy="9" r="4" />
    </svg>
  );
}

function SlideLeftIcon(): JSX.Element {
  // why: leftward arrow with a tail — the outgoing scene slides off-left
  // as the incoming enters from the right. The tail makes the direction
  // unambiguous vs a chevron.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 9H4" />
      <path d="M8 5l-4 4 4 4" />
    </svg>
  );
}

function ZoomBlurIcon(): JSX.Element {
  // why: four diagonal lines emanating from the center evoke a
  // motion-blur zoom — the outgoing scene zooms in + blurs out. Read at
  // a glance as "movement / push-through".
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M9 9l-4-4M9 9l4-4M9 9l-4 4M9 9l4 4" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Misc icons
// ---------------------------------------------------------------------------

function PlusIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function XIcon(): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}
