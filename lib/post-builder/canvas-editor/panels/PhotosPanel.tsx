"use client";

/**
 * PhotosPanel — listing photos sidebar tab
 * -----------------------------------------
 *
 * Third tab in the Studio left sidebar (Brand · Agents · Photos). Renders
 * a 2-col grid of the active listing's photos. Click a thumb → orchestrator
 * adds a new Fabric ImageLayer at canvas center.
 *
 * Why this exists:
 *   With v4/v5 multi-photo templates retired (2026-05-14), this panel is
 *   the new path for users who want a multi-photo composite. They start
 *   with a single-photo design and drop extra photos here when they want
 *   them. Full positioning + sizing control inside Studio, no upfront
 *   "how many photos?" decision in the picker.
 *
 * Visual language matches BrandPanel.tsx exactly so the three tabs read as
 * one toolkit — same aside layout, same header eyebrow, same 80x80 tile
 * size with object-cover. Difference vs Brand: photos are rectangular (no
 * rounded-full agent treatment), and we badge the hero photo as "1" so the
 * user can tell which photo currently sits in the v1 hero slot.
 */

import { type JSX } from "react";

import type { ListingPhoto, PhotosPanelProps } from "../contracts";

// ===========================================================================
// Constants
// ===========================================================================

// Matches BrandPanel/AgentPanel — 80px tile fits 2 cols in the w-72 aside
// with comfortable gaps. Anything smaller and a hero photo's content
// becomes unrecognizable; anything larger and we'd only fit 1 col.
const TILE_PX = 80;

// 6 skeletons fill a 2-col grid with 3 rows during photo fetch.
const SKELETON_COUNT = 6;

// ===========================================================================
// Top-level panel
// ===========================================================================

export default function PhotosPanel(props: PhotosPanelProps): JSX.Element {
  return (
    <aside className="flex h-full min-h-0 w-72 flex-col border-l border-neutral-200 bg-white">
      <header className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Photos
          </h2>
          {!props.isLoading ? (
            <span className="text-xs text-neutral-400">({props.photos.length})</span>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {props.isLoading ? (
          <SkeletonGrid />
        ) : props.photos.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {props.photos.map((p, idx) => (
              <PhotoThumb
                key={`${p.sequence}-${p.url}`}
                photo={p}
                slotNumber={idx + 1}
                isHero={idx === 0}
                onPhotoPicked={props.onPhotoPicked}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

// ===========================================================================
// Thumb tile
// ===========================================================================

interface PhotoThumbProps {
  photo: ListingPhoto;
  slotNumber: number;
  isHero: boolean;
  onPhotoPicked: (photo: ListingPhoto) => void;
}

function PhotoThumb({
  photo,
  slotNumber,
  isHero,
  onPhotoPicked,
}: PhotoThumbProps): JSX.Element {
  // why: object-cover (not contain) — listing photos are photographic and
  // the tile is the visual preview of how the image will look on the canvas
  // when cover-fit. crossOrigin: anonymous prevents canvas-tainting on later
  // drop (Fabric reloads via HTMLImageElement and would re-fetch a tainted
  // version from Chrome's cache otherwise).
  return (
    <button
      type="button"
      onClick={() => onPhotoPicked(photo)}
      className="group flex flex-col items-center gap-1 rounded-md p-1 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
      aria-label={`Insert photo ${slotNumber}${isHero ? " (hero)" : ""}`}
      title={isHero ? "Hero photo · click to add a copy to the canvas" : `Photo ${slotNumber} · click to add to the canvas`}
    >
      <div
        className="relative overflow-hidden rounded-md border border-neutral-200 bg-neutral-100 transition-colors group-hover:border-gold-500"
        style={{ width: TILE_PX, height: TILE_PX }}
      >
        <img
          src={photo.url}
          alt={`Listing photo ${slotNumber}`}
          crossOrigin="anonymous"
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {/* Slot badge bottom-left — tells the user which sequence position
            this photo occupies in the listing's photo array. Hero (slot 1)
            gets a gold badge to set it apart from the rest. */}
        <span
          className={[
            "absolute bottom-0.5 left-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded px-1 text-[9px] font-bold tabular-nums leading-none",
            isHero
              ? "bg-gold-500 text-white"
              : "bg-neutral-900/80 text-white backdrop-blur-sm",
          ].join(" ")}
          aria-hidden="true"
        >
          {slotNumber}
        </span>
      </div>
      <span className="text-[10px] text-neutral-600">
        {isHero ? "Hero" : `Photo ${slotNumber}`}
      </span>
    </button>
  );
}

// ===========================================================================
// Loading + empty states
// ===========================================================================

function SkeletonGrid(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col items-center gap-1 rounded-md p-1"
        >
          <div
            className="animate-pulse rounded-md bg-neutral-200"
            style={{ width: TILE_PX, height: TILE_PX }}
          />
          <div className="h-2 w-12 animate-pulse rounded bg-neutral-200" />
        </div>
      ))}
    </div>
  );
}

function EmptyState(): JSX.Element {
  // why: same gold-dashed treatment as BrandPanel/AgentPanel empty states
  // so the three tabs feel consistent. Copy points at the upstream source
  // (MLS photos) since this isn't something the user fixes inside Studio.
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gold-500/50 bg-gold-50/30 px-3 py-8 text-center">
      <div className="mb-2 text-gold-600">
        <PhotoPlaceholderIcon />
      </div>
      <p className="text-xs font-medium text-neutral-700">No listing photos</p>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">
        This listing has no photos in the MLS feed yet. Check back after the
        next RETS sync, or upload one manually from the property page.
      </p>
    </div>
  );
}

// ===========================================================================
// Inline SVG icon (same convention as BrandPanel/AgentPanel)
// ===========================================================================

function PhotoPlaceholderIcon(): JSX.Element {
  // why: generic photo glyph — landscape silhouette with sun, reads as
  // "image / photograph" without implying any particular kind. Line-art
  // weight matches the other panel icons.
  return (
    <svg
      width="22"
      height="22"
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
