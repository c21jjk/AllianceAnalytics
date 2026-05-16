"use client";

/**
 * CarouselSlidePicker — modal grid for adding listing photos as carousel slides.
 * --------------------------------------------------------------------------------
 *
 * Where this fits:
 *   Larissa is in Studio. She has a hero design on the canvas and wants to add
 *   raw listing photos as the swipeable slides 1..N of the IG/FB carousel. She
 *   clicks "+ Add" on the CarouselStrip. The orchestrator opens THIS modal.
 *
 * The most important UX detail:
 *   The ORDER she clicks tiles is the order the slides will appear. Clicking
 *   tile A then B then C → slides come out as [A, B, C]. We surface this by
 *   stamping a big gold badge with the sequential pick number (1, 2, 3) on each
 *   selected tile. Larissa learned this pattern from iOS Photos picker; it's
 *   the gold standard for multi-select-with-order.
 *
 * Behavioral contract (matches CanvasEditorOverlay where applicable):
 *   • Backdrop click closes (onCancel).
 *   • ESC closes (onCancel) — but only when no input is focused, mirroring
 *     CanvasEditorOverlay's keyboard handling.
 *   • Body scroll lock while open.
 *   • Returns null when `open === false` so internal state resets on next open.
 *
 * Why we DON'T close on confirm:
 *   The parent owns `open`. After it processes onAdd, it flips `open` to false
 *   which unmounts us. If we ALSO called onCancel internally, we'd risk a
 *   double-close race (parent calls onAdd → triggers re-render → some other
 *   effect might flip open back to true; if we'd already mutated something it'd
 *   be confusing). Single source of truth: parent.
 */

import {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CarouselSlide } from "../types";
import type { CarouselSlidePickerProps } from "../contracts";

// ===========================================================================
// Component
// ===========================================================================

export default function CarouselSlidePicker(
  props: CarouselSlidePickerProps,
): JSX.Element | null {
  const { open, photos, existingSlides, maxSlides, onAdd, onCancel } = props;

  // -------------------------------------------------------------------------
  // Refs — backdrop + initial-focus target
  // -------------------------------------------------------------------------
  // why: track the backdrop element so we can distinguish a click ON the
  // backdrop (close) from a click that bubbled up from a tile inside. Same
  // pattern as CanvasEditorOverlay.
  const backdropRef = useRef<HTMLDivElement | null>(null);
  // why: focus moves here on open — the X button is the safest initial focus
  // target because it's a clearly-labeled escape hatch. Putting focus on the
  // first photo tile would risk an accidental Space-keypress selection.
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // -------------------------------------------------------------------------
  // Internal selection state — list of listing-photo `sequence` values in pick order
  // -------------------------------------------------------------------------
  // why: we store SEQUENCES (not URLs and not array indices) because:
  //   • sequence is the stable identifier from the listing — survives photo
  //     reordering upstream.
  //   • URLs would let us correlate against existingSlides, but two distinct
  //     listing photos COULD share a CDN URL during a re-sync window. Sequence
  //     uniquely identifies the photo within the listing.
  //   • Storing array indices breaks the moment the parent's `photos` prop
  //     gets re-sorted (which it can, when RETS re-syncs).
  const [selectedSequences, setSelectedSequences] = useState<number[]>([]);

  // -------------------------------------------------------------------------
  // Reset selection whenever the modal opens
  // -------------------------------------------------------------------------
  // why: even though we return null when !open (so the component fully
  // unmounts and remounts), we keep this effect as a belt-and-suspenders
  // safeguard against future refactors that might switch to an always-mounted
  // modal pattern. Mounting cost is zero — same render either way.
  useEffect(() => {
    if (open) {
      setSelectedSequences([]);
    }
  }, [open]);

  // -------------------------------------------------------------------------
  // Body scroll lock — same pattern as CanvasEditorOverlay
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    // why: capture the prior overflow so we restore EXACTLY what was there —
    // CanvasEditorOverlay might also be open (it isn't today, but could be in
    // a stacked-modal future), and we shouldn't paper over its lock with our
    // "auto" default.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // -------------------------------------------------------------------------
  // ESC to close — gated on no-input-focused
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const active = document.activeElement;
      // why: don't close if the user is in a real form input — they likely
      // expect ESC to clear the field. None of our internal UI has inputs
      // today, but future-proofing against a hypothetical filter search.
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        return;
      }
      e.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // -------------------------------------------------------------------------
  // Initial focus on open
  // -------------------------------------------------------------------------
  // why: a11y — focus must land inside the modal so tab cycles within it. We
  // use a microtask delay because the ref attaches on the same paint as `open`
  // flipping true; without the delay, .focus() runs before the element is in
  // the DOM. requestAnimationFrame is the cleanest "next paint" hook.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // -------------------------------------------------------------------------
  // Derived state — sequences already in the carousel + budget math
  // -------------------------------------------------------------------------
  // why: a Set lookup is O(1) inside the render loop. With 50+ listing photos
  // and ~10 existing slides, this matters for tile-by-tile lookup.
  const existingSequenceSet = useMemo<ReadonlySet<number>>(() => {
    const s = new Set<number>();
    for (const slide of existingSlides) {
      if (slide.listingPhotoSequence !== undefined) {
        s.add(slide.listingPhotoSequence);
      }
    }
    return s;
  }, [existingSlides]);

  // why: remaining budget = max - existing - currently-selected. Used both to
  // disable tile selection at the limit AND to render the header subtitle.
  const totalAfterAdd = existingSlides.length + selectedSequences.length;
  const remainingBudget = Math.max(0, maxSlides - existingSlides.length);
  const atMax = totalAfterAdd >= maxSlides;
  const carouselFull = existingSlides.length >= maxSlides;

  // -------------------------------------------------------------------------
  // Toggle selection for a sequence
  // -------------------------------------------------------------------------
  const toggleSequence = useCallback(
    (sequence: number): void => {
      setSelectedSequences((prev) => {
        const idx = prev.indexOf(sequence);
        if (idx >= 0) {
          // why: deselect — splice out and let the remaining sequences renumber
          // automatically (their order in the array IS their pick number).
          return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        }
        // why: gate on the max — defense in depth. The tile is already
        // disabled at the UI level, but a stray keyboard activation
        // shouldn't be able to over-fill.
        if (existingSlides.length + prev.length >= maxSlides) {
          return prev;
        }
        return [...prev, sequence];
      });
    },
    [existingSlides.length, maxSlides],
  );

  // -------------------------------------------------------------------------
  // Confirm — build CarouselSlide[] in pick order, fire onAdd
  // -------------------------------------------------------------------------
  const handleConfirm = useCallback((): void => {
    if (selectedSequences.length === 0) return;

    // why: index photos by sequence for O(1) lookup during slide build.
    const photoBySequence = new Map<number, string>();
    for (const p of photos) {
      photoBySequence.set(p.sequence, p.url);
    }

    const newSlides: CarouselSlide[] = [];
    for (const seq of selectedSequences) {
      const url = photoBySequence.get(seq);
      // why: should never happen (sequences came FROM this same photos list),
      // but if it does (e.g., photos refetched and a sequence vanished), skip
      // silently rather than crashing on undefined.
      if (!url) continue;
      newSlides.push({
        id: crypto.randomUUID(),
        url,
        source: "listing",
        listingPhotoSequence: seq,
      });
    }

    // why: hand the slides UP and stop. We don't call onCancel — the parent
    // is responsible for flipping `open` to false in response to onAdd. This
    // keeps the close decision in one place (the parent's state machine).
    onAdd(newSlides);
  }, [selectedSequences, photos, onAdd]);

  // -------------------------------------------------------------------------
  // Early return — unmount on close so internal state resets cleanly
  // -------------------------------------------------------------------------
  if (!open) return null;

  // -------------------------------------------------------------------------
  // Subtitle copy — branches on photo availability + remaining budget
  // -------------------------------------------------------------------------
  // why: three distinct states, each with its own copy. Larissa needs to know
  // INSTANTLY why she can/can't add more — ADHD-friendly empty-state copy
  // tells the user what to do next, not just what's broken.
  let subtitle: string;
  if (photos.length === 0) {
    subtitle =
      "This listing has no photos yet — try syncing the listing or uploading a custom photo.";
  } else if (carouselFull) {
    subtitle = "Carousel is full — remove a slide before adding more.";
  } else {
    subtitle = `Choose up to ${remainingBudget} more (${existingSlides.length} of ${maxSlides} already added)`;
  }

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label="Add slides from listing photos"
      onMouseDown={(e) => {
        // why: only close when the mousedown was on the backdrop itself —
        // not when it bubbled from inside the modal. Same pattern as
        // CanvasEditorOverlay for consistency.
        if (e.target === backdropRef.current) {
          onCancel();
        }
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/70 backdrop-blur-sm animate-fade-in-up px-4"
    >
      {/* why: stopPropagation on the inner wrapper so a click that happens to
          land on dead space INSIDE the modal doesn't bubble to the backdrop
          close handler. Belt and suspenders with the e.target === ref check. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[70vh] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-elevated"
      >
        {/* ============================================================ */}
        {/* Header — sticky to top                                        */}
        {/* ============================================================ */}
        <header className="flex items-start justify-between border-b border-neutral-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-900">
              Add slides from listing photos
            </h2>
            <p className="mt-0.5 text-xs leading-snug text-neutral-500">
              {subtitle}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onCancel}
            aria-label="Close picker"
            className="ml-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
          >
            <CloseIcon />
          </button>
        </header>

        {/* ============================================================ */}
        {/* Body — scrollable photo grid (or empty state)                */}
        {/* ============================================================ */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-25 px-5 py-4">
          {photos.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {photos.map((photo) => {
                const alreadyAdded = existingSequenceSet.has(photo.sequence);
                const pickIndex = selectedSequences.indexOf(photo.sequence);
                const isSelected = pickIndex >= 0;
                // why: an unselected tile is disabled when EITHER it's already
                // in the carousel OR we're at the max. Selected tiles always
                // stay clickable so the user can deselect to make room.
                const isDisabledByMax = !isSelected && atMax;
                return (
                  <PhotoTile
                    key={`${photo.sequence}-${photo.url}`}
                    url={photo.url}
                    sequence={photo.sequence}
                    isSelected={isSelected}
                    pickOrder={isSelected ? pickIndex + 1 : null}
                    alreadyAdded={alreadyAdded}
                    isDisabledByMax={isDisabledByMax}
                    onToggle={() => toggleSequence(photo.sequence)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* Footer — sticky to bottom                                    */}
        {/* ============================================================ */}
        <footer className="flex items-center justify-between border-t border-neutral-200 bg-white px-5 py-3">
          <span className="text-xs text-neutral-500 tabular-nums">
            {selectedSequences.length} of {remainingBudget} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center justify-center rounded-md border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={
                selectedSequences.length === 0 || photos.length === 0
              }
              className="inline-flex h-9 items-center justify-center rounded-md bg-gold-500 px-4 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-gold-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-300"
            >
              {/* why: button label adapts to count. "Add 1 slide" / "Add 3
                  slides". When zero selected we still render "Add slides"
                  (with the button disabled) so the affordance is visible. */}
              {selectedSequences.length === 0
                ? "Add slides"
                : selectedSequences.length === 1
                  ? "Add 1 slide"
                  : `Add ${selectedSequences.length} slides`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ===========================================================================
// PhotoTile — a single selectable thumbnail
// ===========================================================================

interface PhotoTileProps {
  url: string;
  sequence: number;
  isSelected: boolean;
  /** 1-based pick order to render on the badge. Null when not selected. */
  pickOrder: number | null;
  alreadyAdded: boolean;
  isDisabledByMax: boolean;
  onToggle: () => void;
}

function PhotoTile(props: PhotoTileProps): JSX.Element {
  const {
    url,
    sequence,
    isSelected,
    pickOrder,
    alreadyAdded,
    isDisabledByMax,
    onToggle,
  } = props;

  // why: three mutually-exclusive states for tile chrome:
  //   already-added → static, 50% scrim, "Added" badge, not clickable
  //   selected     → gold ring + corner badge with pick order
  //   default      → neutral border, hover → gold border hint
  // Plus a fourth modifier (disabled-by-max) that DOESN'T change selection
  // visuals but reduces opacity + locks pointer.
  const isDisabled = alreadyAdded || isDisabledByMax;

  // why: tooltip + aria-label vary by state. Larissa relies on aria-labels
  // when she's screen-reader-debugging the UI, and tooltips are how she
  // confirms what a tile WILL do before clicking it.
  const ariaLabel = alreadyAdded
    ? `Photo ${sequence} — already added to carousel`
    : isSelected
      ? `Photo ${sequence} — selected as slide ${pickOrder}. Click to deselect.`
      : isDisabledByMax
        ? `Photo ${sequence} — carousel is full`
        : `Photo ${sequence} — click to add as a carousel slide`;

  const titleAttr = isDisabledByMax && !isSelected ? "Carousel is full." : undefined;

  return (
    <button
      type="button"
      onClick={isDisabled ? undefined : onToggle}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      title={titleAttr}
      className={[
        // base tile chrome — aspect-square, rounded, transitions for ring/border
        "group relative aspect-square overflow-hidden rounded-md border bg-neutral-100 transition-all focus:outline-none",
        // selection styling — gold border + gold ring for high contrast
        isSelected
          ? "border-gold-500 ring-2 ring-gold-300"
          : "border-neutral-200",
        // hover affordance only when the tile is interactive
        isDisabled
          ? "cursor-not-allowed"
          : "hover:border-gold-300 hover:shadow-card focus-visible:ring-2 focus-visible:ring-gold-500",
        // dim already-added tiles to ~60% — they're context, not options
        alreadyAdded ? "opacity-75" : "",
        // dim disabled-by-max tiles to ~40% as spec'd — these are options
        // the user could unlock by deselecting elsewhere, but right now no
        isDisabledByMax && !isSelected ? "opacity-40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Photo — uses native <img> not background-image so screen readers
          have an alt and the browser handles cross-origin headers properly.
          object-cover gives us the same visual as a CSS background-cover. */}
      <img
        src={url}
        alt={`Listing photo ${sequence}`}
        crossOrigin="anonymous"
        loading="lazy"
        draggable={false}
        className="h-full w-full select-none object-cover"
      />

      {/* Top-right: "Photo N" sequence label — small dark pill so Larissa
          can correlate the tile to the listing's photo gallery on the
          listing detail page. Always rendered (not hidden on selection)
          so the user doesn't lose their bearings while picking. */}
      <span
        className="pointer-events-none absolute right-1.5 top-1.5 inline-flex h-5 items-center rounded bg-neutral-900/75 px-1.5 text-[10px] font-medium text-white backdrop-blur-sm"
        aria-hidden="true"
      >
        Photo {sequence}
      </span>

      {/* Top-left: gold-filled pick-order badge — THE key UX element. The
          number tells Larissa what slide # this photo will be in the final
          carousel. Animates in for visual feedback. */}
      {isSelected && pickOrder !== null ? (
        <span
          className="pointer-events-none absolute left-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-gold-500 text-sm font-bold text-neutral-900 shadow-card animate-fade-in-up"
          aria-hidden="true"
        >
          {pickOrder}
        </span>
      ) : null}

      {/* "Added" overlay — centered, scrim behind it so the photo reads
          as "context" rather than "option". Only on already-added tiles. */}
      {alreadyAdded ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-900/50"
          aria-hidden="true"
        >
          <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-900 shadow-card">
            <CheckIcon />
            Added
          </span>
        </div>
      ) : null}
    </button>
  );
}

// ===========================================================================
// EmptyState — shown when the listing has zero photos
// ===========================================================================

function EmptyState(): JSX.Element {
  // why: ADHD-friendly empty state — tells the user WHY (no photos yet) and
  // gives them two concrete next steps (sync RETS, upload custom). The upload
  // path isn't built yet but the copy is here so when it lands we don't have
  // to chase down stale empty-state strings.
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 text-neutral-400">
        <EmptyPhotoIcon />
      </div>
      <p className="text-sm font-semibold text-neutral-800">
        No listing photos available yet
      </p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
        Sync this listing's photos from Paragon, or upload a custom photo
        (coming soon).
      </p>
    </div>
  );
}

// ===========================================================================
// Inline icons — small SVGs, same convention as other panels
// ===========================================================================

function CloseIcon(): JSX.Element {
  // why: inline SVG instead of pulling lucide here — keeps this file's
  // import surface tiny, matches PhotosPanel's pattern.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function EmptyPhotoIcon(): JSX.Element {
  // why: stack-of-photos glyph — reads as "photo library / collection"
  // without confusion. Line-weight matches PhotosPanel's icon.
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
