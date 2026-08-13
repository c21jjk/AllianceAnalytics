"use client";

/**
 * ListingPhotoGallery — see every photo on a listing, at a size you can judge.
 * ---------------------------------------------------------------------------
 *
 * 2026-08-08 (John): "On a property's listing page, there's currently no way
 * to see all the pictures associated with that property. I think we need to be
 * able to see them all to help determine whether the pics quality are good
 * enough to have a full post created for it."
 *
 * The photos themselves were never the missing piece — `listing_photos` has
 * had the full set for every listing since the Phase 11 RETS sync, and six
 * places already read it. What was missing was somewhere to LOOK at them:
 *
 *   • Every existing viewer lives inside a post. To see a listing's photos you
 *     had to pick the listing, generate, open Studio and click the Photos tab
 *     — three steps into building the post you were trying to decide about.
 *   • The only grid that existed renders at 80px (Studio's sidebar). You
 *     cannot tell whether a photo is sharp, well lit or badly framed at 80px,
 *     which is the entire question being asked here.
 *
 * So this is a viewer, not a picker. Clicking a photo opens it large; it does
 * not add it to anything. Studio remains the place where photos get used.
 *
 * Visual language (sequence badge bottom-left, gold badge on the hero) is
 * lifted from lib/post-builder/canvas-editor/panels/PhotosPanel.tsx on purpose
 * so "photo 7" means the same thing in both places and staff can say "use 3, 7
 * and 12" across the two screens.
 *
 * Client component because of the lightbox (keyboard nav, scroll lock). The
 * photos arrive as props from the server — no fetch, no spinner, no API route.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X, Images, AlertTriangle } from "lucide-react";

/**
 * Structural shape rather than an import of `ListingPhoto` from
 * lib/post-builder/photos.ts: that module is `import "server-only"`, and
 * pulling it into a client component — even for a type — is a trap waiting for
 * whoever later turns the `import type` into a value import. `ListingPhoto`
 * satisfies this, so the server side passes its rows through unchanged.
 */
export interface GalleryPhoto {
  url: string;
  sequence: number;
  caption: string | null;
}

interface ListingPhotoGalleryProps {
  photos: readonly GalleryPhoto[];
  address: string | null;
}

/**
 * Photos shown before the "Show all" toggle. Two rows at the 4-col desktop
 * breakpoint.
 *
 * why a toggle at all: the average active listing has 25 photos and the
 * biggest has 74. Rendering 74 thumbnails inline would push the entire rest of
 * the page — AutoReel, open houses, created posts, owner report — below two
 * thousand pixels of grid. John's standing preference on these additions is
 * that they not "stand out too much", so the section stays two rows tall until
 * you ask for more.
 */
const COLLAPSED_COUNT = 8;

/**
 * Below this, the photo set is worth a second look before committing to a
 * carousel. It is the only quality signal available without opening anything:
 * Bright rewrites every image URL to the same 2048x1536 delivery size whatever
 * the source resolution was, and the two Paragon feeds put no dimensions in
 * the URL at all, so there is no server-side sharpness signal to be had.
 *
 * 10 flags roughly 17% of active listings today (18 of 104), which is about
 * the right rate for a line that should mean something when it appears.
 */
const THIN_SET_THRESHOLD = 10;

export default function ListingPhotoGallery({
  photos,
  address,
}: ListingPhotoGalleryProps) {
  const [expanded, setExpanded] = useState(false);
  // null = lightbox closed. Otherwise the index into `photos`.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const total = photos.length;
  const visible = expanded ? photos : photos.slice(0, COLLAPSED_COUNT);
  const hiddenCount = total - visible.length;

  const close = useCallback(() => setLightboxIndex(null), []);
  const step = useCallback(
    (delta: number) => {
      setLightboxIndex((current) => {
        if (current === null) return current;
        // Wrap, so holding the arrow key never dead-ends on a 28-photo set.
        return (current + delta + total) % total;
      });
    },
    [total],
  );

  // Esc closes, arrows step. Bound on the document so the keys work without
  // the user first having to click into the lightbox.
  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightboxIndex, close, step]);

  // Lock the page behind the lightbox. Without this, scrolling the overlay
  // scrolls the listing page underneath and you lose your place in the grid.
  useEffect(() => {
    if (lightboxIndex === null) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prior;
    };
  }, [lightboxIndex]);

  // Warm the neighbours so arrow-key browsing doesn't blank between photos.
  // These are full-size MLS images; without the preload each step shows an
  // empty frame for a beat, which reads as "the photo is broken".
  useEffect(() => {
    if (lightboxIndex === null || total < 2) return;
    for (const delta of [1, -1]) {
      const neighbour = photos[(lightboxIndex + delta + total) % total];
      if (neighbour) {
        const img = new Image();
        img.src = neighbour.url;
      }
    }
  }, [lightboxIndex, photos, total]);

  if (total === 0) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-card">
        <SectionHeading count={0} />
        <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 px-4 py-6 text-center">
          <p className="text-sm font-medium text-neutral-800">
            No photos in the MLS feed for this listing.
          </p>
          <p className="mt-1 text-sm text-neutral-600">
            Nothing to build a post from yet. Photos land here automatically
            after the next feed sync.
          </p>
        </div>
      </section>
    );
  }

  const active = lightboxIndex === null ? null : photos[lightboxIndex];

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading count={total} />
        {hiddenCount > 0 || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-sm font-medium text-gold-800 hover:text-gold-900 hover:underline focus-ring rounded"
          >
            {expanded ? "Show fewer" : `Show all ${total} photos`}
          </button>
        ) : null}
      </div>

      {total < THIN_SET_THRESHOLD ? (
        <div className="mt-3 inline-flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            Only {total} photo{total === 1 ? "" : "s"} on file. Thin for a
            carousel — worth a look before building a full post.
          </span>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((photo, idx) => (
          <button
            key={`${photo.sequence}-${photo.url}`}
            type="button"
            onClick={() => setLightboxIndex(idx)}
            className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 transition-colors hover:border-gold-400 focus-ring"
            aria-label={`View photo ${idx + 1} of ${total} full size`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={`Listing photo ${idx + 1}`}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
            {/* Same badge treatment as Studio's Photos tab, so a sequence
                number means the same thing on both screens. */}
            <span
              className={[
                "absolute bottom-1 left-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded px-1.5 text-[10px] font-bold tabular-nums leading-none",
                idx === 0
                  ? "bg-gold-500 text-white"
                  : "bg-neutral-900/75 text-white backdrop-blur-sm",
              ].join(" ")}
              aria-hidden="true"
            >
              {idx + 1}
            </span>
            {idx === 0 ? (
              <span className="absolute top-1 left-1 rounded bg-gold-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                Hero
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {!expanded && hiddenCount > 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          {hiddenCount} more photo{hiddenCount === 1 ? "" : "s"} not shown.
        </p>
      ) : null}

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${(lightboxIndex ?? 0) + 1} of ${total}`}
          className="fixed inset-0 z-[100] flex flex-col bg-neutral-950/95"
          onClick={close}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
            <div className="min-w-0">
              <div className="text-sm font-semibold tabular-nums">
                {(lightboxIndex ?? 0) + 1} of {total}
              </div>
              {address ? (
                <div className="truncate text-xs text-white/60">{address}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-ring"
              aria-label="Close"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          {/* stopPropagation so clicking the photo itself doesn't close the
              overlay — only the surrounding backdrop does. */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            {total > 1 ? (
              <button
                type="button"
                onClick={() => step(-1)}
                className="absolute left-2 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 focus-ring md:left-6"
                aria-label="Previous photo"
              >
                <ChevronLeft size={24} aria-hidden="true" />
              </button>
            ) : null}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={active.url}
              src={active.url}
              alt={`Listing photo ${(lightboxIndex ?? 0) + 1}`}
              className="max-h-full max-w-full object-contain"
            />

            {total > 1 ? (
              <button
                type="button"
                onClick={() => step(1)}
                className="absolute right-2 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 focus-ring md:right-6"
                aria-label="Next photo"
              >
                <ChevronRight size={24} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {/* Caption only when the feed actually supplies one. Bright captions
              about 57% of its photos; the two Paragon feeds caption none, so
              an always-present caption row would be an empty bar on well over
              half of all listings. */}
          {active.caption ? (
            <div
              className="px-4 pb-4 text-center text-sm text-white/80"
              onClick={(e) => e.stopPropagation()}
            >
              {active.caption}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SectionHeading({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2">
      <Images size={16} aria-hidden="true" className="text-neutral-400" />
      <h2 className="text-sm font-semibold text-neutral-900">Photos</h2>
      {count > 0 ? (
        <span className="text-sm text-neutral-500 tabular-nums">({count})</span>
      ) : null}
    </div>
  );
}
