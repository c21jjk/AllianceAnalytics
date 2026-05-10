"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { Platform } from "@/lib/types/post";
import type { PlatformPosting } from "@/lib/types/group";
import { platformLabel } from "./PlatformBadge";

interface InlineVideoModalProps {
  open: boolean;
  onClose: () => void;
  postings: PlatformPosting[];
  /** Platform tab to open by default. Falls back to first available. */
  defaultPlatform?: Platform;
}

/**
 * Modal that plays the original media from any of the post's platforms via
 * the platform's embed iframe. Tabs at the top let the user switch platforms
 * if multiple postings exist.
 *
 * Closes on Esc or backdrop click.
 */
export default function InlineVideoModal({
  open,
  onClose,
  postings,
  defaultPlatform,
}: InlineVideoModalProps) {
  const initial = useMemo(() => {
    if (defaultPlatform && postings.some((p) => p.platform === defaultPlatform)) {
      return defaultPlatform;
    }
    return postings[0]?.platform;
  }, [defaultPlatform, postings]);

  const [active, setActive] = useState<Platform | undefined>(initial);

  useEffect(() => {
    if (open) setActive(initial);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !active) return null;

  const activePosting = postings.find((p) => p.platform === active);
  const embedUrl = activePosting ? buildEmbedUrl(activePosting) : undefined;
  // Portrait aspect for vertical video (Reels/TT/FB Reels). Square-ish
  // aspect for static image posts so they don't get letterboxed inside a
  // tall frame.
  const isVerticalVideo = !!activePosting?.is_video;

  return (
    <div
      // pointer-events-auto is required because this modal is rendered as a
      // descendant of GroupCard's <div pointer-events-none> stretched-link
      // wrapper. Without it, all clicks (close, tabs, backdrop) silently pass
      // through to the card's <Link> and trigger post-detail navigation
      // instead of modal interaction.
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto animate-fade-in-up"
      role="dialog"
      aria-modal="true"
      aria-label="Inline post preview"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="relative z-10 w-full max-w-md bg-white rounded-xl shadow-elevated overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-200">
          <div className="flex items-center gap-1">
            {postings.map((p) => (
              <button
                key={p.platform}
                type="button"
                onClick={() => setActive(p.platform)}
                className={clsx(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition",
                  active === p.platform
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200",
                )}
              >
                {platformLabel(p.platform)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>
        <div
          className={clsx(
            "bg-black",
            isVerticalVideo ? "aspect-[9/16]" : "aspect-square",
          )}
        >
          {embedUrl ? (
            <iframe
              src={embedUrl}
              className="w-full h-full"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              title={`${platformLabel(active)} embed`}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-300 text-sm">
              No embed available
            </div>
          )}
        </div>
        {activePosting ? (
          <div className="px-3 py-2 text-xs">
            <a
              href={activePosting.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold-700 hover:text-gold-800 font-medium inline-flex items-center gap-1"
            >
              Open on {platformLabel(active)}
              <ArrowUpRight />
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildEmbedUrl(p: PlatformPosting): string | undefined {
  if (p.platform === "instagram") {
    // IG /p/{shortcode}/embed/ works for IMAGE, VIDEO, REEL, and CAROUSEL.
    const code = p.shortcode ?? extractIgShortcode(p.permalink);
    if (!code) return undefined;
    return `https://www.instagram.com/p/${code}/embed/`;
  }
  if (p.platform === "tiktok") {
    const id = p.shortcode ?? extractTtVideoId(p.permalink);
    if (!id) return undefined;
    return `https://www.tiktok.com/embed/v2/${id}`;
  }
  if (p.platform === "facebook") {
    if (!p.permalink) return undefined;
    // FB has two distinct embed plugins. video.php only renders for actual
    // video posts; for image / link / text posts it returns "Video
    // Unavailable" even when the post is fully public. plugins/post.php
    // handles every post type including videos, so we use it as the
    // universal default and only fall back to video.php for posts the API
    // told us are videos (which are slightly nicer in video.php's player).
    if (p.is_video) {
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
        p.permalink,
      )}&show_text=false&width=560`;
    }
    return `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(
      p.permalink,
    )}&show_text=true&width=560`;
  }
  return undefined;
}

function extractIgShortcode(permalink: string): string | undefined {
  const m = permalink.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return m ? m[1] : undefined;
}

function extractTtVideoId(permalink: string): string | undefined {
  const m = permalink.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  return m ? m[1] : undefined;
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 6l12 12M18 6l-12 12"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M7 17L17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
