"use client";

/**
 * CarouselStrip — supporting-slides strip rendered under the hero canvas.
 * --------------------------------------------------------------------------
 *
 * Phase 5 of the canvas-editor rebuild. Slide 0 is the hero (the designed
 * graphic on the canvas) — it is intentionally NOT shown in this strip. The
 * strip is for slides 1..N, the supporting photos that an audience swipes
 * through after the hero on IG / FB / TikTok.
 *
 * Layout (top to bottom):
 *   1. Header row (~32px): "Carousel" eyebrow + count badge on the left;
 *      Preview + Add-slide buttons on the right.
 *   2. Thumbnails row (~78px): horizontally scrollable strip of slide
 *      thumbnails, each at the hero's aspect ratio. Trailing "+ Add" tile
 *      when not at max. Empty state collapses to one large dashed tile +
 *      explainer text.
 *
 * Interactions:
 *   • Hover a thumbnail → reveal the X (remove).
 *   • HTML5 drag-and-drop reorders. Drop indicator is a 2px gold bar on the
 *     boundary where the slide will land.
 *   • Click "+ Add slide" tile or header button → fires onAddSlideClick.
 *   • Click "Preview" → fires onPreviewClick (disabled when 0 slides).
 *   • Keyboard: focused thumbnail responds to Delete/Backspace by removing
 *     itself. Tab order walks the thumbnails left to right.
 *
 * Why no story-format hide here:
 *   The parent owns the "should the strip render?" decision (via
 *   CanvasEditorCarouselProps.enabledOnStory + heroFormat). By the time the
 *   parent rendered us, it already decided we belong on screen. We render
 *   whatever heroFormat we receive — defensive returns inside the strip would
 *   only mask parent-state bugs.
 */

import { type JSX, useState } from "react";

import type { CarouselSlide, PostFormat } from "../types";
import type { CarouselStripProps } from "../contracts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * IG carousel max — single source of truth for the default cap. Caller can
 * override via the optional `maxSlides` prop (e.g., 35 for a TikTok-only
 * publish flow).
 */
const DEFAULT_MAX_SLIDES = 10 as const;

/**
 * Fixed thumbnail height in px. Width is computed from heroFormat's aspect
 * ratio so portrait/story thumbnails are tall-narrow and squares are…square.
 *
 * Why a fixed height (not width): the strip's vertical rhythm is the priority
 * — keeping all thumbnails at the same height means the row reads as one
 * coherent band regardless of which format the user is editing.
 */
const THUMB_HEIGHT_PX = 70 as const;

/**
 * Maps PostFormat → aspect ratio (width / height). Drives thumbnail sizing
 * so the strip reflects the post's visual identity at a glance — "the tall
 * skinny thumbs mean I'm editing a Story".
 */
const FORMAT_ASPECT: Readonly<Record<PostFormat, number>> = {
  square_1x1: 1, // 1:1
  portrait_4x5: 4 / 5, // 0.8
  story_9x16: 9 / 16, // 0.5625
} as const;

// ---------------------------------------------------------------------------
// Drop-target indicator state
// ---------------------------------------------------------------------------

/**
 * Where the active drop indicator should render. `index` is the position the
 * dragged slide would land at AFTER the reorder (0..N inclusive).
 *
 * Why a separate state value: rendering the gold drop bar by reading
 * `dragOverIndex` lets us avoid re-rendering EVERY thumbnail on each
 * dragOver — only the one new boundary changes.
 */
interface DropTarget {
  index: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CarouselStrip(props: CarouselStripProps): JSX.Element {
  const {
    slides,
    heroFormat,
    onSlidesChanged,
    onAddSlideClick,
    onPreviewClick,
    maxSlides = DEFAULT_MAX_SLIDES,
    onSlideEditClick,
  } = props;

  // -------------------------------------------------------------------------
  // Drag state — kept local; no parent involvement until drop
  // -------------------------------------------------------------------------
  // why: keep drag indices in component state because they're purely a
  // transient UI affordance. The parent only learns about the reorder when
  // the user actually completes the drop and we call onSlidesChanged.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const aspect = FORMAT_ASPECT[heroFormat];
  const thumbWidthPx = Math.round(THUMB_HEIGHT_PX * aspect);

  const slideCount = slides.length;
  const atMax = slideCount >= maxSlides;
  // why: 80% of cap is the warning threshold — gives Larissa a heads-up that
  // she's nearly out of slots before the disabled state surprises her.
  const nearMax = slideCount >= Math.floor(maxSlides * 0.8) && slideCount > 0;

  // -------------------------------------------------------------------------
  // Mutation helpers — always produce NEW arrays (never mutate `slides`)
  // -------------------------------------------------------------------------

  function removeAt(index: number): void {
    if (index < 0 || index >= slides.length) return;
    const next = slides.slice();
    next.splice(index, 1);
    onSlidesChanged(next);
  }

  function moveSlide(fromIndex: number, toIndex: number): void {
    // why: clamp + early-out on no-op to satisfy the spec's "drop onto same
    // slide => no fire" rule. Also collapses adjacent-boundary drops (drop at
    // position N when dragging from N or N-1 is a no-op).
    if (fromIndex < 0 || fromIndex >= slides.length) return;
    if (toIndex < 0 || toIndex > slides.length) return;
    // Adjust target when removing from earlier in the array shifts everything left.
    const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
    if (adjustedTo === fromIndex) return;
    const next = slides.slice();
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return; // defensive — slice guarantees presence but TS doesn't know
    next.splice(adjustedTo, 0, moved);
    onSlidesChanged(next);
  }

  // -------------------------------------------------------------------------
  // Drag handlers
  // -------------------------------------------------------------------------

  function handleDragStart(
    e: React.DragEvent<HTMLDivElement>,
    index: number,
  ): void {
    setDraggingIndex(index);
    setDropTarget(null);
    // why: setting dataTransfer + effectAllowed makes Firefox actually fire
    // drag events. Without setData(), some browsers refuse to start the drag.
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", String(index));
    } catch {
      // Some browsers throw if setData is called twice — safe to swallow.
    }
  }

  function handleThumbDragOver(
    e: React.DragEvent<HTMLDivElement>,
    index: number,
  ): void {
    if (draggingIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // why: split each thumbnail's hit area into a left half (drop BEFORE this
    // index) and a right half (drop AFTER, i.e., at index + 1). Matches the
    // Canva / Figma layer reordering convention.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isLeftHalf = e.clientX - rect.left < rect.width / 2;
    const targetIndex = isLeftHalf ? index : index + 1;
    setDropTarget((prev) =>
      prev?.index === targetIndex ? prev : { index: targetIndex },
    );
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    if (draggingIndex === null || dropTarget === null) {
      resetDragState();
      return;
    }
    moveSlide(draggingIndex, dropTarget.index);
    resetDragState();
  }

  function handleDragEnd(): void {
    resetDragState();
  }

  function resetDragState(): void {
    setDraggingIndex(null);
    setDropTarget(null);
  }

  // -------------------------------------------------------------------------
  // Keyboard handler — Delete/Backspace removes a focused thumbnail
  // -------------------------------------------------------------------------

  function handleThumbKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    index: number,
  ): void {
    if (e.key === "Delete" || e.key === "Backspace") {
      // why: preventDefault stops the browser's "back" gesture on Backspace
      // when the thumbnail is focused outside of an input.
      e.preventDefault();
      removeAt(index);
    }
  }

  // -------------------------------------------------------------------------
  // Render — header row
  // -------------------------------------------------------------------------

  const previewDisabled = slideCount === 0;
  const addDisabled = atMax;

  return (
    <section
      role="region"
      aria-label="Carousel slides"
      className="flex w-full flex-col gap-2 border-t border-neutral-200 bg-white px-4 py-2.5"
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Carousel
          </span>
          <CountBadge
            count={slideCount}
            max={maxSlides}
            nearMax={nearMax}
            atMax={atMax}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={previewDisabled ? undefined : onPreviewClick}
            disabled={previewDisabled}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150",
              previewDisabled
                ? "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400"
                : "border-neutral-200 bg-white text-neutral-700 hover:border-gold-300 hover:bg-gold-50/40 hover:text-gold-800",
            ].join(" ")}
            title={
              previewDisabled
                ? "Add at least one slide to preview."
                : "Preview the full carousel as your audience will see it"
            }
            aria-label="Preview carousel"
          >
            <PreviewIcon />
            Preview
          </button>
          <button
            type="button"
            onClick={addDisabled ? undefined : onAddSlideClick}
            disabled={addDisabled}
            className={[
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150",
              addDisabled
                ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
                : "bg-gold-500 text-neutral-900 hover:bg-gold-400 active:bg-gold-600",
            ].join(" ")}
            title={
              addDisabled
                ? "Carousel is full — remove a slide to add another."
                : "Add a supporting photo to the carousel"
            }
            aria-label="Add slide"
          >
            <PlusIcon />
            Add slide
          </button>
        </div>
      </header>

      {/* Thumbnails row */}
      {slideCount === 0 ? (
        <EmptyState
          onAddSlideClick={onAddSlideClick}
          thumbWidthPx={thumbWidthPx}
          thumbHeightPx={THUMB_HEIGHT_PX}
        />
      ) : (
        <div
          className="flex items-center gap-1 overflow-x-auto overflow-y-hidden"
          // why: a tiny vertical padding so the focus ring on a thumbnail
          // doesn't get clipped by the section's bottom padding.
          style={{ paddingTop: 2, paddingBottom: 2 }}
          onDragOver={(e) => {
            // why: allow drops anywhere along the row's bare strip
            // (between thumbs/after the last one). The thumb handlers set a
            // specific index; this fallback keeps the drop event alive when
            // the cursor briefly lands in the gap.
            if (draggingIndex !== null) e.preventDefault();
          }}
          onDrop={handleDrop}
        >
          {/* Leading drop indicator (insert before index 0) */}
          <DropIndicator visible={dropTarget?.index === 0} />

          {slides.map((slide, idx) => (
            <div key={slide.id} className="flex items-center">
              <SlideThumb
                slide={slide}
                index={idx}
                isDragging={draggingIndex === idx}
                widthPx={thumbWidthPx}
                heightPx={THUMB_HEIGHT_PX}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleThumbDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                onRemove={() => removeAt(idx)}
                onKeyDown={(e) => handleThumbKeyDown(e, idx)}
                // why: forward the parent's per-slide edit hook (only when
                // provided). The thumb conditionally renders the pencil
                // affordance based on this prop being defined.
                onEdit={
                  onSlideEditClick ? () => onSlideEditClick(idx) : undefined
                }
              />
              {/* Indicator for "drop AFTER this thumb" boundary */}
              <DropIndicator visible={dropTarget?.index === idx + 1} />
            </div>
          ))}

          {/* Trailing "+ Add" tile — same shape as a thumbnail, dashed border.
              Not draggable, not a drop target. */}
          {!atMax ? (
            <button
              type="button"
              onClick={onAddSlideClick}
              className="ml-1 flex flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50 text-neutral-500 transition-all duration-150 hover:border-gold-400 hover:bg-gold-50/50 hover:text-gold-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
              style={{ width: thumbWidthPx, height: THUMB_HEIGHT_PX }}
              aria-label="Add slide"
              title="Add a supporting photo to the carousel"
            >
              <PlusIcon />
              <span className="text-[9px] font-semibold uppercase tracking-wider">
                Add
              </span>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

// ===========================================================================
// Subcomponents
// ===========================================================================

// ---------------------------------------------------------------------------
// Count badge — "3 of 10 slides" / "No slides yet". Amber when near/at max.
// ---------------------------------------------------------------------------

function CountBadge(props: {
  count: number;
  max: number;
  nearMax: boolean;
  atMax: boolean;
}): JSX.Element {
  const { count, max, nearMax, atMax } = props;
  // why: distinct copy for the empty state vs counted state — "No slides yet"
  // is a friendlier nudge than "0 of 10 slides" which reads like an error.
  const label =
    count === 0 ? "No slides yet" : `${count} of ${max} slides`;

  return (
    <span
      className={[
        "rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums transition-colors",
        atMax
          ? "bg-amber-100 text-amber-800"
          : nearMax
            ? "bg-amber-50 text-amber-700"
            : "bg-neutral-100 text-neutral-600",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Drop indicator — 2px gold bar between thumbnails
// ---------------------------------------------------------------------------

function DropIndicator(props: { visible: boolean }): JSX.Element {
  // why: render the slot regardless of `visible` so the row's spacing doesn't
  // jump when the indicator appears/disappears. Width is 2px when visible,
  // 0 when not — the parent's `gap-1` provides the visual gap between thumbs.
  return (
    <div
      aria-hidden="true"
      className={[
        "h-[70px] flex-shrink-0 rounded-sm transition-all duration-150",
        props.visible ? "w-[2px] bg-gold-500" : "w-0 bg-transparent",
      ].join(" ")}
    />
  );
}

// ---------------------------------------------------------------------------
// SlideThumb — the actual thumbnail tile
// ---------------------------------------------------------------------------

interface SlideThumbProps {
  slide: CarouselSlide;
  index: number;
  isDragging: boolean;
  widthPx: number;
  heightPx: number;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onRemove: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /**
   * Phase 5 — Multi-OH per-slide edit. When defined, the thumbnail renders
   * a pencil-icon Edit button next to the X (hover-revealed). When
   * undefined, no Edit affordance shows (matches the prior contract for
   * non-editable user-photo carousels).
   */
  onEdit?: () => void;
}

function SlideThumb(props: SlideThumbProps): JSX.Element {
  const {
    slide,
    index,
    isDragging,
    widthPx,
    heightPx,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDrop,
    onRemove,
    onKeyDown,
    onEdit,
  } = props;

  // why: visual numbering uses "Slide N+2" — slide 0 is the hero (which the
  // audience sees first), so the first thumbnail in this strip is the SECOND
  // thing a viewer swipes to, hence "Slide 2". Matches the swipe-counter the
  // user will see when previewing or scrolling IG. We deliberately don't
  // expose the array index (which is `slides[0] === "Slide 2"`) — the off-by-
  // one would confuse Larissa during demos.
  const visibleSlideNumber = index + 2;
  // 2026-05-22 — aria-label gains "Click to edit" copy when the parent
  // wired up onEdit (multi-OH carousels). Discoverability fix — the
  // pencil-on-hover affordance was too subtle and Larissa kept missing it.
  const ariaLabel = onEdit
    ? `Slide ${visibleSlideNumber}. Click to edit in Studio. Press Delete to remove. Drag to reorder.`
    : `Slide ${visibleSlideNumber}. Press Delete to remove. Drag to reorder.`;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      // 2026-05-22 — clicking the thumbnail body now opens per-slide edit
      // (when the parent supplied onEdit — i.e. multi-OH carousels). The
      // pencil icon below stays as a visible affordance hint; this just
      // expands the click target so the whole card is editable.
      onClick={onEdit ? () => onEdit() : undefined}
      aria-label={ariaLabel}
      title={onEdit ? `Edit slide ${visibleSlideNumber} in Studio` : undefined}
      className={[
        "group relative flex-shrink-0 overflow-hidden rounded-md border border-neutral-200 bg-neutral-100 transition-all duration-150",
        "hover:border-gold-400 hover:shadow-sm",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500",
        isDragging ? "opacity-50" : "opacity-100",
        // Click-to-edit slides use pointer cursor as the primary affordance;
        // non-editable slides keep the grab cursor since reorder is all
        // that's available there.
        onEdit ? "cursor-pointer active:cursor-grabbing" : "cursor-grab active:cursor-grabbing",
      ].join(" ")}
      style={{
        width: widthPx,
        height: heightPx,
        backgroundImage: `url(${JSON.stringify(slide.url)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Top-left slide number badge */}
      <span
        className="absolute left-1 top-1 inline-flex h-4 items-center rounded bg-neutral-900/80 px-1 text-[9px] font-bold uppercase tracking-wider leading-none text-white backdrop-blur-sm"
        aria-hidden="true"
      >
        {visibleSlideNumber}
      </span>

      {/* Top-right action cluster — Edit (when supported) + Remove. Both
          hover-revealed; both stopPropagation so the thumbnail's role=button
          activation paths don't fire alongside the action. */}
      {onEdit ? (
        <button
          type="button"
          onClick={(e) => {
            // why: stopPropagation so the click doesn't bubble to the
            // thumbnail's role=button activation (which would re-open the
            // standalone preview / fire focus side-effects).
            e.stopPropagation();
            onEdit();
          }}
          // why: positioned to the LEFT of the X — width 5 (20px) + gap 1
          // (4px) = 24px offset. Uses the gold accent so it reads as
          // "primary" action ("edit this slide") vs the X's destructive
          // role. 2026-05-22 — pencil is now ALWAYS visible (not just on
          // hover) when the thumbnail is editable; the prior hover-reveal
          // pattern was undiscoverable and people thought slides weren't
          // editable at all. The X stays hover-reveal because removal is
          // destructive and shouldn't compete for attention.
          className="absolute right-7 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gold-500 text-neutral-900 shadow transition-colors duration-150 hover:bg-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-300"
          aria-label={`Edit slide ${visibleSlideNumber} in Studio`}
          title={`Edit slide ${visibleSlideNumber} in Studio`}
        >
          <PencilIcon />
        </button>
      ) : null}

      {/* Top-right remove button — hover/focus reveal */}
      <button
        type="button"
        onClick={(e) => {
          // why: stopPropagation so clicking X doesn't ALSO trigger the
          // thumbnail's keyboard-button focus + role=button activation paths.
          e.stopPropagation();
          onRemove();
        }}
        // why: pointer-events on the button itself stay enabled (so hover
        // reveals work and clicks land); only the visual state changes.
        className="absolute right-1 top-1 inline-flex h-5 w-5 translate-y-[-2px] items-center justify-center rounded-full bg-neutral-900/80 text-white opacity-0 shadow transition-all duration-150 hover:bg-neutral-900 group-hover:translate-y-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-gold-400"
        aria-label={`Remove slide ${visibleSlideNumber}`}
        title={`Remove slide ${visibleSlideNumber}`}
      >
        <XIcon />
      </button>

      {/* Bottom overlay: original listing photo sequence, when sourced from listing */}
      {slide.source === "listing" && slide.listingPhotoSequence != null ? (
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-0.5 text-[9px] font-medium text-white/90">
          Photo {slide.listingPhotoSequence}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — single dashed tile + helper copy
// ---------------------------------------------------------------------------

function EmptyState(props: {
  onAddSlideClick: () => void;
  thumbWidthPx: number;
  thumbHeightPx: number;
}): JSX.Element {
  // why: empty-state tile is a touch larger than a regular thumbnail so it
  // feels like a deliberate "first action" surface rather than a placeholder.
  // 160×160 is the spec floor; we cap at 160 wide so portrait formats don't
  // produce an awkwardly tall placeholder when the strip is empty.
  const tileWidth = 160;
  const tileHeight = Math.min(160, Math.max(props.thumbHeightPx, 96));

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={props.onAddSlideClick}
        className="flex flex-shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50 px-3 text-neutral-600 transition-all duration-150 hover:border-gold-400 hover:bg-gold-50/50 hover:text-gold-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        style={{ width: tileWidth, height: tileHeight }}
        aria-label="Add your first slide"
      >
        <PlusIcon />
        <span className="text-[11px] font-semibold">Add your first slide</span>
      </button>
      <p className="max-w-md text-[11px] leading-snug text-neutral-500">
        Add up to 9 more photos for an Instagram carousel. Photos appear in
        order — viewers swipe through left to right.
      </p>
    </div>
  );
}

// ===========================================================================
// Icons — kept inline so the strip is one file (mirrors ResizeMenu convention)
// ===========================================================================

function PreviewIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* why: filled play triangle reads as "preview / play" at small sizes
          better than an outlined glyph. */}
      <path d="M5 3.5v9l8-4.5-8-4.5z" />
    </svg>
  );
}

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

function PencilIcon(): JSX.Element {
  // why: 12×12 viewBox to match the X size — visually balanced when the
  // two buttons sit next to each other. Stroke-based glyph reads cleanly
  // at small sizes; the Lucide-style pencil shape is the project norm
  // (per memory: project uses Lucide for icons).
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 1.5l1.5 1.5-7 7H2v-1.5l7-7z" />
      <path d="M7.5 3L9 4.5" />
    </svg>
  );
}
