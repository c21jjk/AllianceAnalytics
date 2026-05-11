"use client";

import { useState } from "react";
import clsx from "clsx";
import type { PlatformPosting } from "@/lib/types/group";
import InlineVideoModal from "./InlineVideoModal";

interface GroupCardActionsProps {
  postings: PlatformPosting[];
  thumbnailUrl?: string;
  /** Caption used as alt text. */
  caption: string;
  /** True when at least one posting is video — show play overlay. */
  isVideo: boolean;
  className?: string;
}

/**
 * Client wrapper around the hero thumbnail. Clicking the hero opens the
 * InlineVideoModal where users can preview the original media on any of
 * the platforms the post went out on.
 *
 * Pure visual — no analytics tracking yet.
 */
export default function GroupCardActions({
  postings,
  thumbnailUrl,
  caption,
  isVideo,
  className,
}: GroupCardActionsProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Play preview"
        className={clsx(
          "relative shrink-0 block aspect-square w-48 rounded-lg overflow-hidden",
          "ring-1 ring-neutral-200 bg-neutral-100",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40",
          "group/hero",
          className,
        )}
      >
        {thumbnailUrl ? (
          <>
            {/* Blurred backdrop fills the gaps that object-contain leaves
                when the source aspect doesn't match the square frame —
                portrait reels and flyers preserve their full content
                instead of getting top/bottom-cropped. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailUrl}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-55 text-transparent"
            />
            {/* Foreground — full image, never cropped. text-transparent hides
                the long alt-text fallback when the CDN URL expires (common
                for IG/TT signed URLs) so the broken state looks like a
                neutral gray box instead of a wall of caption text. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailUrl}
              alt={caption.slice(0, 80)}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-contain transition-transform duration-300 group-hover/hero:scale-[1.03] text-transparent"
            />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-300">
            <PhotoIcon />
          </div>
        )}
        {isVideo ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-black/55 text-white shadow-elevated">
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 ml-0.5"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        ) : null}
      </button>
      <InlineVideoModal
        open={open}
        onClose={() => setOpen(false)}
        postings={postings}
      />
    </>
  );
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <circle cx="9" cy="11" r="1.5" fill="currentColor" />
      <path
        d="M21 17l-5-5-9 9"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
