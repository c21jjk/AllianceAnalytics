"use client";

/**
 * CarouselPreview — full-screen "swipe through it like the audience will" overlay.
 * --------------------------------------------------------------------------------
 *
 * Where this fits in the Post Builder
 *   Phase 5 of the canvas editor introduces multi-image (carousel) posts. The
 *   `CarouselStrip` under the canvas shows the slides as thumbnails; this
 *   component is what opens when Larissa clicks "▶ Preview". It renders the
 *   carousel exactly as the audience will see it on IG/FB feed: one slide at
 *   a time, at the hero's aspect ratio, with left/right swipe affordances and
 *   the familiar dot pagination.
 *
 * Why a separate overlay instead of inline preview
 *   The strip is built for editing (small, scannable thumbnails). The audience
 *   experience is "one slide fills the viewport". Trying to merge those two
 *   modes into one component would force compromises on both. A dedicated,
 *   full-screen surface lets us prioritize fidelity here — proper aspect-ratio
 *   framing, real swipe behavior, no editing chrome — without disturbing the
 *   strip's compactness.
 *
 * Modal mechanics
 *   Mirror the patterns established in CanvasEditorOverlay.tsx:
 *     • Unmount entirely when `open === false` (internal state resets cleanly).
 *     • Body scroll lock while open (page underneath shouldn't drift).
 *     • ESC closes.
 *     • Backdrop click closes; clicks INSIDE the frame/controls don't.
 *
 * Performance
 *   Only render the current slide's <img>. Eager-loading 10 listing photos as
 *   parallel <img> elements is wasteful — the browser will fetch as the user
 *   navigates, and the cross-fade still feels instant on a decent connection.
 */

import { type JSX, useCallback, useEffect, useRef, useState } from "react";

import type { CarouselPreviewProps } from "../contracts";
import type { PostFormat } from "../types";

/**
 * Aspect-ratio CSS value per format. Drives the preview frame so the user is
 * looking at the post in the exact proportions the audience will see on IG/FB.
 *
 * Why a constant in this file rather than reading from PLATFORM_DIMENSIONS:
 *   PLATFORM_DIMENSIONS encodes pixel sizes for the canvas export pipeline
 *   (1080×1080, 1080×1350, 1080×1920). At the preview surface we only care
 *   about the ratio — keeping it as a plain CSS string avoids a divide-and-
 *   format step at render time and is trivially diffable against the spec.
 */
const ASPECT_RATIO_BY_FORMAT: Readonly<Record<PostFormat, string>> = {
  portrait_4x5: "4 / 5",
  story_9x16: "9 / 16",
} as const;

export default function CarouselPreview(
  props: CarouselPreviewProps,
): JSX.Element | null {
  // -------------------------------------------------------------------------
  // Refs
  // -------------------------------------------------------------------------
  // why: distinguish a click on the backdrop (close) from a click that bubbled
  // up from inside the frame (don't close). Same pattern used in
  // CanvasEditorOverlay — checking e.target against this ref is more robust
  // than stopPropagation on every nested interactive element.
  const backdropRef = useRef<HTMLDivElement | null>(null);

  // -------------------------------------------------------------------------
  // Internal state — which slide is currently showing.
  //   0           → the hero (rendered design out of Studio, or placeholder
  //                 if `heroUrl === null`).
  //   1..N        → props.slides[currentIndex - 1].
  // The total slide count is `1 + slides.length` — the hero always counts as
  // slide 0 even when its URL hasn't been computed yet, because that's how
  // the audience will experience it on IG.
  // -------------------------------------------------------------------------
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  // Convenience derived values. `totalSlides` always includes the hero.
  const totalSlides = 1 + props.slides.length;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < totalSlides - 1;

  // -------------------------------------------------------------------------
  // Navigation handlers — wrapped in useCallback so the keyboard listener
  // effect can depend on them without re-binding on every render.
  // -------------------------------------------------------------------------
  const goPrev = useCallback((): void => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const goNext = useCallback((): void => {
    // why: read latest totalSlides via closure when the setter runs; we cap
    // at totalSlides-1 so a stale render can't push past the end.
    setCurrentIndex((i) => (i < totalSlides - 1 ? i + 1 : i));
  }, [totalSlides]);

  const goTo = useCallback(
    (index: number): void => {
      // why: clamp defensively — the dot row computes indices from
      // totalSlides so this should always be in range, but a future
      // refactor that miscounts won't silently produce a blank frame.
      if (index < 0 || index >= totalSlides) return;
      setCurrentIndex(index);
    },
    [totalSlides],
  );

  // -------------------------------------------------------------------------
  // Reset to slide 0 every time the overlay opens.
  //
  // Why this effect rather than initializing useState with a derived value:
  //   The component unmounts when `open === false` (see the early return at
  //   the bottom of the function), so internal state DOES reset between
  //   sessions. This effect is a safety net for a future change where the
  //   parent might keep the component mounted across open/close cycles —
  //   the contract still promises slide 0 on every fresh open.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (props.open) {
      setCurrentIndex(0);
    }
  }, [props.open]);

  // -------------------------------------------------------------------------
  // Body scroll lock while open. Mirrors CanvasEditorOverlay's pattern:
  // capture the prior overflow value so we restore it exactly on cleanup
  // (some pages may have set overflow: hidden for their own reasons).
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!props.open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [props.open]);

  // -------------------------------------------------------------------------
  // Keyboard handling — ESC closes, Left/Right navigates.
  //
  // why: bind globally rather than relying on focus inside the overlay. The
  // user opens the preview to LOOK at it, not to interact with focusable
  // controls inside it. A focused button would steal the arrow keys
  // (button focus + Enter triggers click) which is the wrong default.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent): void => {
      // why: bail if the user is typing in a form input somewhere — they
      // expect arrow keys to move the caret, not flip slides. Matches the
      // defensive pattern in CanvasEditorOverlay's ESC handler.
      const active = document.activeElement;
      const inFormInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement;
      if (inFormInput) return;

      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose, goPrev, goNext]);

  // -------------------------------------------------------------------------
  // Render — early-unmount when closed so internal state resets next time.
  // -------------------------------------------------------------------------
  if (!props.open) return null;

  // -------------------------------------------------------------------------
  // Resolve what to render for the current slide.
  //
  // Two-flavored:
  //   • Slide 0 (hero) — heroUrl may be null. When null, render a placeholder
  //     inside the frame; the navigation dots + counter still work so the
  //     user can preview the supporting photos even before saving the design.
  //   • Slides 1..N — always have a URL (CarouselSlide.url is non-optional).
  //
  // `currentSrc` is null only when we're on the hero and heroUrl is null.
  // -------------------------------------------------------------------------
  const isHeroSlide = currentIndex === 0;
  const currentSrc: string | null = isHeroSlide
    ? props.heroUrl
    : (props.slides[currentIndex - 1]?.url ?? null);

  // why: aspect ratio drives both the frame size AND the placeholder framing,
  // so we resolve once at the top of render.
  const aspectRatio = ASPECT_RATIO_BY_FORMAT[props.heroFormat];

  // Caption logic — different copy per slide type, surfaced beneath the dots.
  // Hero gets a fixed label so the user knows "this is the designed graphic
  // you built in Studio"; supporting slides explain WHICH listing photo this
  // is, which helps Larissa spot the wrong-photo-order case before publish.
  let caption: string;
  if (isHeroSlide) {
    caption = "Hero · designed in Studio";
  } else {
    const slide = props.slides[currentIndex - 1];
    if (slide && slide.source === "listing" && slide.listingPhotoSequence != null) {
      caption = `Photo ${slide.listingPhotoSequence}`;
    } else if (slide && slide.source === "listing") {
      caption = "Listing photo";
    } else {
      caption = "Custom upload";
    }
  }

  // Counter shown in the top bar — N+1 total because hero is slide 1 of total.
  const counterLabel = `Slide ${currentIndex + 1} of ${totalSlides}`;

  // why: detect the "no hero saved AND no supporting photos" case so we can
  // tailor the placeholder copy. With slides present the user CAN navigate to
  // see them; with nothing at all we point them toward the next action.
  const hasNothingToPreview = props.heroUrl === null && props.slides.length === 0;

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label="Carousel preview"
      onMouseDown={(e) => {
        // why: only close when the mousedown originated ON the backdrop —
        // not when it bubbled up from inside the frame or controls. Mirrors
        // CanvasEditorOverlay's exact pattern.
        if (e.target === backdropRef.current) {
          props.onClose();
        }
      }}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-between bg-neutral-900/95 backdrop-blur-md animate-fade-in-up px-4 py-6"
    >
      {/* ------------------------------------------------------------------ */}
      {/* Top bar — label, slide counter, close button.                       */}
      {/* ------------------------------------------------------------------ */}
      {/* why: stop mousedown propagation so clicks on the top bar's empty   */}
      {/* areas (between label/counter/close) don't dismiss via the backdrop.*/}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full max-w-5xl items-center justify-between gap-4 text-neutral-300"
      >
        <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">
          Carousel preview
        </span>
        <span
          aria-live="polite"
          className="text-sm font-medium tabular-nums text-neutral-200"
        >
          {counterLabel}
        </span>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close preview"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800/80 text-neutral-200 transition hover:bg-neutral-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#C9A84C]"
        >
          {/* why: inline SVG instead of lucide-react — lucide isn't installed
              in this project (see CanvasEditor.tsx comment). */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Center stage — frame + side-arrow buttons.                          */}
      {/* ------------------------------------------------------------------ */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex flex-1 w-full items-center justify-center"
      >
        {/* Left arrow — sits over the frame's left edge.                     */}
        <button
          type="button"
          onClick={goPrev}
          disabled={!canGoPrev}
          aria-label="Previous slide"
          className={`absolute left-2 sm:left-6 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800/80 text-neutral-100 backdrop-blur-sm transition hover:bg-neutral-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#C9A84C] ${
            canGoPrev ? "" : "opacity-40 cursor-not-allowed hover:bg-neutral-800/80"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* The frame itself. Aspect ratio drives shape; we cap height at 70vh */}
        {/* (per spec) and width at 80vw on wider screens so it never feels    */}
        {/* cramped on portrait phones or stretched on ultrawide monitors.    */}
        <div
          // why: explicit aspect-ratio inline style so we don't need a custom
          // Tailwind config entry for 9/16 etc. The browser handles ratio
          // computation natively.
          style={{ aspectRatio, maxHeight: "70vh", maxWidth: "80vw" }}
          className="relative h-full overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-2xl"
        >
          {currentSrc != null ? (
            // why: `key={currentIndex}` forces React to remount the img on
            // navigation, which restarts the opacity transition for the
            // cross-fade. The previous slide unmounts cleanly — no parallel
            // <img> elements (perf goal: one img in the DOM at a time).
            <img
              key={currentIndex}
              src={currentSrc}
              alt={`Slide ${currentIndex + 1} of ${totalSlides}`}
              draggable={false}
              className="h-full w-full object-cover select-none transition-opacity duration-150 opacity-100 animate-fade-in-up"
            />
          ) : (
            // Hero placeholder — shown when slide 0 is active but the user
            // hasn't saved a render yet. We keep navigation enabled when
            // supporting slides exist so the user can still flip through the
            // photos and get a sense of the carousel shape.
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="text-sm font-medium text-neutral-200">
                Save your design first to see it in the preview.
              </span>
              {hasNothingToPreview ? (
                <span className="text-xs text-neutral-400">
                  Save your design and add carousel slides to see the full preview.
                </span>
              ) : (
                <span className="text-xs text-neutral-400">
                  Use the arrows to flip through the supporting photos.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right arrow — mirror of the left.                                 */}
        <button
          type="button"
          onClick={goNext}
          disabled={!canGoNext}
          aria-label="Next slide"
          className={`absolute right-2 sm:right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800/80 text-neutral-100 backdrop-blur-sm transition hover:bg-neutral-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#C9A84C] ${
            canGoNext ? "" : "opacity-40 cursor-not-allowed hover:bg-neutral-800/80"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Bottom — dots + caption.                                            */}
      {/* ------------------------------------------------------------------ */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full flex-col items-center gap-3"
      >
        {/* Dots — one per slide including the hero. Active dot is gold and  */}
        {/* slightly larger so it's unmistakable at a glance.                */}
        <div
          role="tablist"
          aria-label="Carousel slides"
          className="flex items-center gap-4"
        >
          {Array.from({ length: totalSlides }, (_, i) => {
            const isActive = i === currentIndex;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => goTo(i)}
                className={`rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-[#C9A84C] focus:ring-offset-2 focus:ring-offset-neutral-900 ${
                  isActive
                    ? "h-3 w-3 bg-[#C9A84C]"
                    : "h-2 w-2 bg-neutral-500/50 hover:bg-neutral-400"
                }`}
              />
            );
          })}
        </div>

        {/* Caption — small, muted, single line. Helps Larissa spot the      */}
        {/* "Photo 7 came before Photo 4" case before publish without having  */}
        {/* to leave the preview.                                             */}
        <span className="text-xs text-neutral-400">{caption}</span>
      </div>
    </div>
  );
}
