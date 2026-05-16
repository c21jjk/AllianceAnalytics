"use client";

/**
 * AI Magic Design — review modal.
 *
 * Lifecycle:
 *   - Mounted whenever PostBuilderClient's `magicDesignListing` is non-null.
 *   - On mount, fires `triggerMagicDesignAction` automatically and shows a
 *     "Designing…" spinner while Sonnet thinks (typical 3-5s).
 *   - On success, transitions to the recommendation review surface where
 *     Larissa can edit the caption + hashtags, re-roll, or open Studio.
 *   - On error, surfaces a clear message + a Retry button. The X / Cancel
 *     button is always available.
 *
 * Why a single modal rather than two (loading + review) — keeps state
 * threading simple. The Studio overlay sits at z-50, this modal sits at
 * z-50 too but is dismissed before Studio opens, so the layers don't
 * compete.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  triggerMagicDesignAction,
  type MagicDesignInput,
  type MagicDesignRecommendation,
  type MagicDesignResult,
  type MagicDesignOfficeProfile,
} from "./actions";
import type {
  PostBuilderListing,
  PostFormat,
  PostType,
  PostVariant,
} from "@/lib/post-builder/types";

/**
 * Payload the modal hands BACK to PostBuilderClient when the user clicks
 * "Open in Studio". The parent applies it to local state (post_type,
 * variant, format, selectedPhotoIndex, captionResult) and then opens Studio
 * via the existing openStudioForVariant() flow.
 */
export interface MagicDesignAppliedPayload {
  post_type: PostType;
  variant: PostVariant;
  format: PostFormat;
  hero_photo_index: number;
  caption: string;
  hashtags: string[];
}

interface Props {
  /** The listing the user clicked Magic Design on. */
  listing: PostBuilderListing;
  /** Office profile to pass to Claude. Null when no office is linked. */
  officeProfile: MagicDesignOfficeProfile | null;
  /** Photo URLs in MLS order — Claude picks a hero index from this list. */
  availablePhotos: string[];
  /** Close without applying. Fires on X click, ESC, or backdrop tap. */
  onCancel: () => void;
  /**
   * Apply the recommendation + open Studio. Modal closes immediately on
   * call — the parent handles state syncing + Studio opening.
   */
  onApply: (payload: MagicDesignAppliedPayload) => void;
}

const POST_TYPE_LABEL: Record<PostType, string> = {
  just_listed: "Just Listed",
  just_sold: "Just Sold",
  under_contract: "Under Contract",
  open_house: "Open House",
  price_reduction: "Price Reduced",
};

const VARIANT_LABEL: Record<PostVariant, string> = {
  v1: "Hero Editorial",
  v2: "Bold Stats",
  v3: "Side-by-Side",
  v4: "Diptych",
  v5: "Grid",
  v6: "Magazine Cover",
  v7: "Polaroid",
  v8: "Minimal Frame",
};

const FORMAT_LABEL: Record<PostFormat, string> = {
  square_1x1: "Square 1:1",
  portrait_4x5: "Portrait 4:5",
  story_9x16: "Story 9:16",
};

export default function MagicDesignModal({
  listing,
  officeProfile,
  availablePhotos,
  onCancel,
  onApply,
}: Props) {
  // Loading / result state. `null` recommendation = still loading on first
  // mount; on re-roll we DON'T reset to null so the prior recommendation
  // stays visible underneath the spinner overlay (less jarring than a
  // blank flash).
  const [recommendation, setRecommendation] = useState<MagicDesignRecommendation | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Editable copies of caption + hashtags so Larissa can tweak before
  // applying. Seeded from the recommendation on every re-roll.
  const [editedCaption, setEditedCaption] = useState<string>("");
  const [editedHashtags, setEditedHashtags] = useState<string>("");

  // Stable input object — useCallback below depends on it, and we don't
  // want a fresh reference on every render to re-trigger the design call.
  const designInput = useMemo<MagicDesignInput>(
    () => ({
      listing,
      officeProfile,
      availablePhotos,
    }),
    [listing, officeProfile, availablePhotos],
  );

  const runDesign = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result: MagicDesignResult = await triggerMagicDesignAction(designInput);
      if (result.ok) {
        setRecommendation(result.recommendation);
        setEditedCaption(result.recommendation.caption);
        setEditedHashtags(result.recommendation.hashtags.join(" "));
      } else {
        setError(result.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Magic Design failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [designInput]);

  // Kick off the first design call on mount. We deliberately don't depend
  // on runDesign — that would re-fire on every memoized re-creation.
  useEffect(() => {
    void runDesign();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC closes the modal — matches Studio overlay behavior so the keyboard
  // shortcut feels consistent across the post-builder surface.
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape" && !loading) onCancel();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [loading, onCancel]);

  const heroPhoto = useMemo<string | null>(() => {
    if (!recommendation) return null;
    return availablePhotos[recommendation.hero_photo_index] ?? availablePhotos[0] ?? null;
  }, [recommendation, availablePhotos]);

  function handleApply(): void {
    if (!recommendation) return;
    // why: split editedHashtags on whitespace (with or without "#" prefix)
    // and re-normalize so the saved post hashtag array matches every other
    // entry path (captions.ts, manual edits in the Post Now flow).
    const tags = editedHashtags
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));
    onApply({
      post_type: recommendation.post_type,
      variant: recommendation.variant,
      format: recommendation.format,
      hero_photo_index: recommendation.hero_photo_index,
      caption: editedCaption.trim(),
      hashtags: tags,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="magic-design-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="p-5 border-b border-neutral-200 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="eyebrow text-gold-700 mb-1 flex items-center gap-1.5">
              <SparkleIcon className="w-3.5 h-3.5" />
              <span>AI Magic Design</span>
            </div>
            <h3 id="magic-design-title" className="text-lg font-bold text-neutral-900">
              {listing.address ?? listing.mls_number}
            </h3>
            <div className="text-xs text-neutral-600 truncate">
              {[listing.city, listing.state, listing.zip].filter(Boolean).join(", ")}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-neutral-400 hover:text-neutral-700 text-xl font-light disabled:opacity-40 flex-shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* ---- Loading state (first run only) ---- */}
          {loading && !recommendation ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="relative">
                <SparkleIcon className="w-10 h-10 text-gold-500 animate-pulse" />
              </div>
              <div className="mt-4 text-sm font-medium text-neutral-900">
                Designing your post…
              </div>
              <div className="mt-1 text-xs text-neutral-600 max-w-xs">
                Claude is reading the listing, picking the best format + variant,
                and drafting a caption. Usually 3-5 seconds.
              </div>
            </div>
          ) : null}

          {/* ---- Error state ---- */}
          {error && !loading ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <div className="font-semibold mb-1">Magic Design didn't run</div>
              <div className="text-xs">{error}</div>
              <button
                type="button"
                onClick={() => void runDesign()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-rose-100 px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-200 transition"
              >
                Try again
              </button>
            </div>
          ) : null}

          {/* ---- Recommendation review ---- */}
          {recommendation ? (
            <div className={loading ? "opacity-40 pointer-events-none" : ""}>
              {/* Composition summary — big gold tint pill */}
              <div className="mb-4 rounded-xl bg-gradient-to-br from-gold-50 to-gold-100/60 ring-1 ring-gold-300 p-3.5">
                <div className="eyebrow text-gold-700 mb-1">Recommended</div>
                <div className="text-base font-bold text-gold-900 leading-tight">
                  {POST_TYPE_LABEL[recommendation.post_type]}{" "}
                  <span className="text-gold-600">·</span>{" "}
                  {VARIANT_LABEL[recommendation.variant]}{" "}
                  <span className="text-gold-600">·</span>{" "}
                  {FORMAT_LABEL[recommendation.format]}
                </div>
              </div>

              {/* Caption + hashtags (left) + photo thumbnail (right) */}
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4 mb-4">
                <div className="space-y-3 min-w-0">
                  <div>
                    <label
                      htmlFor="magic-caption"
                      className="block text-xs font-semibold text-neutral-700 mb-1"
                    >
                      Caption
                    </label>
                    <textarea
                      id="magic-caption"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm leading-snug text-neutral-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
                      rows={4}
                      value={editedCaption}
                      onChange={(e) => setEditedCaption(e.target.value)}
                      maxLength={500}
                    />
                    <div className="mt-1 text-[11px] text-neutral-500">
                      {editedCaption.length} chars · IG cuts at ~125
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="magic-hashtags"
                      className="block text-xs font-semibold text-neutral-700 mb-1"
                    >
                      Hashtags
                    </label>
                    <textarea
                      id="magic-hashtags"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-xs leading-snug text-gold-700 font-mono focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
                      rows={2}
                      value={editedHashtags}
                      onChange={(e) => setEditedHashtags(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col items-center">
                  <div className="text-[11px] font-medium text-neutral-600 mb-1.5 uppercase tracking-wide">
                    Hero photo
                  </div>
                  {heroPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={heroPhoto}
                      alt="Recommended hero"
                      className="w-[140px] h-[140px] rounded-md object-cover ring-2 ring-gold-300 bg-neutral-100"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-[140px] h-[140px] rounded-md ring-2 ring-neutral-200 bg-neutral-100 flex items-center justify-center text-neutral-400 text-xs">
                      No photo
                    </div>
                  )}
                  <div className="mt-1.5 text-[11px] text-neutral-500 text-center">
                    #{recommendation.hero_photo_index + 1} of {availablePhotos.length}
                  </div>
                </div>
              </div>

              {/* Rationale */}
              {recommendation.rationale ? (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 mb-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600 mb-1">
                    Why this works
                  </div>
                  <div className="text-xs italic text-neutral-700 leading-relaxed">
                    {recommendation.rationale}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {recommendation ? (
          <div className="p-5 border-t border-neutral-200 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void runDesign()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition disabled:opacity-50"
            >
              <RerollIcon className="w-3.5 h-3.5" />
              Re-roll
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-400 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={loading || editedCaption.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-gold-500 px-4 py-2 text-sm font-bold text-gold-900 hover:bg-gold-400 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                Open in Studio
                <SparkleIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local icons — keep inline so the modal is self-contained without pulling
// in a new dependency. 16-viewbox SVGs at 1.5 stroke match the rest of the
// post-builder iconography (see PageHeader actions in page.tsx).
// ---------------------------------------------------------------------------

function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* why: 4-pointed star with subtle drop-corner sparkles reads as
          "AI magic" without leaning on a wand or emoji. */}
      <path d="M8 1.5l1.6 4.4 4.4 1.6-4.4 1.6L8 13.5l-1.6-4.4L2 7.5l4.4-1.6z" />
      <circle cx="13" cy="3" r="0.8" />
      <circle cx="3" cy="13" r="0.8" />
    </svg>
  );
}

function RerollIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 8a6 6 0 1 1-1.76-4.24" />
      <path d="M14 2v3h-3" />
    </svg>
  );
}
