"use client";

/**
 * MultiOhFinalStage — Step 3 of 3 UI for multi-property Open House carousels.
 * ---------------------------------------------------------------------------
 *
 * When the user just generated a multi-OH carousel via the wizard, they land
 * on /post-builder?gp=<id>. The generic Post Builder UI (post-type picker,
 * variant grid, single-listing preview, "Edit in Studio" / "Start a new
 * Multi-OH" / "Saved Post" tabs) is the wrong surface here — every one of
 * those choices was either made in the wizard or doesn't apply to a finished
 * carousel.
 *
 * This component is a focused "final review" screen rendered by
 * PostBuilderClient when `isMultiOHPost === true`. It replaces the entire
 * main grid (banner + post-type tabs + listing picker + preview pane + caption
 * pane) with:
 *
 *   1. Hero header — "Final Review — Schedule or Post" + Step 3 of 3 pill.
 *   2. Carousel preview strip — hero + every per-property slide, each with
 *      an address caption underneath. Hero is labeled "HERO (transforms to
 *      caption)" per John's framing in the multi-OH UX brief.
 *   3. Hosting agents summary line (when slide_metadata.hosting_agent_name
 *      is populated).
 *   4. Caption preview — single-line collapsed view with "see more" toggle +
 *      per-platform tabs matching the existing caption pane.
 *   5. Action buttons — Schedule (secondary) + Post Now (primary gold).
 *
 * Why a separate file:
 *   PostBuilderClient.tsx is already 5600 lines. Inlining ~300 more lines
 *   makes the cognitive load worse. Extracting keeps the multi-OH "final
 *   stage" path discoverable on its own + lets future tweaks to this surface
 *   land without touching the single-listing flow.
 *
 * Why no listing-picker / variant grid / Edit-in-Studio / Start-a-new-MultiOH:
 *   The wizard locked those decisions in. The user can still open Studio from
 *   the carousel strip's per-slide edit affordance (existing flow inside the
 *   PostNowModal preview), but exposing "Edit in Studio" as a tab here would
 *   compete with the Schedule / Post Now action and confuse the linear
 *   "you're at the final stage" framing.
 */

import { useMemo, useState, type JSX } from "react";
import {
  Calendar,
  ChevronRight,
  Edit3,
  RotateCw,
  Users,
} from "lucide-react";
import type {
  PostBuilderListing,
  PostFormat,
  SchedulablePlatform,
  SlideMetadata,
} from "@/lib/post-builder/types";
import type { CarouselSlide } from "@/lib/post-builder/canvas-editor/types";
import Link from "next/link";

interface FormatMeta {
  display_name: string;
  description: string;
  aspect: string;
}

const CAPTION_PLATFORMS: readonly SchedulablePlatform[] = [
  "instagram",
  "facebook",
  "tiktok",
] as const;

const CAPTION_PLATFORM_LABELS: Record<SchedulablePlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export interface MultiOhFinalStageProps {
  /** Hero image URL — slide 0 in the carousel. Null when render hasn't landed. */
  heroImageUrl: string | null;
  /** Per-property carousel slides (slides 1..N). */
  carouselSlides: readonly CarouselSlide[];
  /**
   * Parallel array to carouselSlides. Index N here corresponds to slide N+1
   * in the visible carousel (hero is slide 0). When `listing_mls` is present,
   * we look up the address via `listingsByMls` for the slide caption.
   */
  slideMetadata: readonly SlideMetadata[];
  /**
   * Lookup map for resolving an MLS number → its listing row. Sourced from
   * the parent's `listingsByPostType.open_house` array (and any other
   * post-type buckets we might fold in later). When a slide's MLS isn't in
   * the map (listing dropped from feed since wizard ran), we fall back to
   * "Slide N" labeling without crashing.
   */
  listingsByMls: ReadonlyMap<string, PostBuilderListing>;
  /** Format the carousel renders at — drives thumbnail aspect ratio. */
  format: PostFormat;
  formatMeta: FormatMeta | null;
  /**
   * Per-platform caption editor state, owned by the parent. We expose them
   * read-only here for the preview + provide a callback for inline edits so
   * the caption ring stays the single source of truth.
   */
  editedCaptions: Record<SchedulablePlatform, string>;
  onEditedCaptionsChange: (
    next: Record<SchedulablePlatform, string>,
  ) => void;
  /** True when any of the three platforms has a non-empty caption. */
  hasCaption: boolean;
  /** True when the parent is mid-generate (caption regen, etc.). */
  busy: boolean;
  /** Triggers the parent's Post Now flow — opens the PostNowModal. */
  onPostNow: () => void;
  /** True when Post Now is available (admin + not generating). */
  postNowEnabled: boolean;
  /**
   * Fires the parent's caption regeneration. Optional — when undefined the
   * "Regenerate captions" button hides (e.g., when we don't have enough
   * listing context to ask Claude for a fresh take).
   */
  onRegenerateCaption?: () => void;
  regeneratingCaption: boolean;
}

/**
 * Build a short address label for a per-property slide.
 *
 * Prefers the address row from `listingsByMls`. Falls back to MLS number,
 * then to the generic "Slide N" label. Returns null when no caption should
 * be shown (slide carries no listing_mls — should never happen in practice
 * but we defend against malformed slide_metadata rows).
 */
function addressForSlide(
  meta: SlideMetadata | undefined,
  listingsByMls: ReadonlyMap<string, PostBuilderListing>,
  index: number,
): string {
  if (!meta) return `Slide ${index + 1}`;
  const listing = listingsByMls.get(meta.listing_mls);
  if (listing?.address) {
    // why: street-only label — listingsByMls.address is the formatted
    // "123 Main St" + optional unit suffix. We deliberately don't append
    // city/state because the thumbnail caption is space-constrained and
    // the hero card already carries that info.
    return listing.address;
  }
  if (meta.listing_mls) return `#${meta.listing_mls}`;
  return `Slide ${index + 1}`;
}

/**
 * Build the "Hosted by …" attribution line from every slide's
 * `hosting_agent_name`. Returns null when no slide carries a host name.
 *
 * Dedupes by case-insensitive name match so a multi-OH event with the same
 * agent hosting 3 of 5 properties reads "Hosted by Larissa Stevenson", not
 * "Hosted by Larissa Stevenson, Larissa Stevenson, Larissa Stevenson".
 */
function buildHostingSummary(
  slideMetadata: readonly SlideMetadata[],
): string | null {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const meta of slideMetadata) {
    const raw = meta.hosting_agent_name?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(raw);
  }
  if (names.length === 0) return null;
  if (names.length === 1) return `Hosted by ${names[0]}`;
  if (names.length === 2) return `Hosted by ${names[0]} and ${names[1]}`;
  const head = names.slice(0, -1).join(", ");
  const tail = names[names.length - 1];
  return `Hosted by ${head}, and ${tail}`;
}

/**
 * Derive the event subtitle. We don't persist `event_title` on
 * generated_posts, so we describe the event in terms of property count and
 * the earliest OH session date when present. Falls back to a generic
 * "Open House — Multi-property" when nothing else is available.
 */
function buildEventSubtitle(
  slideMetadata: readonly SlideMetadata[],
  listingsByMls: ReadonlyMap<string, PostBuilderListing>,
): string {
  const count = slideMetadata.length;
  const propertyWord = count === 1 ? "property" : "properties";

  // Try to pull the earliest OH session date from the linked listings.
  let earliest: Date | null = null;
  for (const meta of slideMetadata) {
    const listing = listingsByMls.get(meta.listing_mls);
    const startIso = listing?.oh_start_at;
    if (!startIso) continue;
    const t = new Date(startIso);
    if (Number.isNaN(t.getTime())) continue;
    if (!earliest || t < earliest) earliest = t;
  }

  if (earliest) {
    const dayLabel = earliest.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    });
    return `Open House — ${dayLabel} · ${count} ${propertyWord}`;
  }
  return `Open House — ${count} ${propertyWord}`;
}

/**
 * Thumbnail tile. ~180px square; uses object-cover so portrait + square
 * source renders both crop sensibly. Caption underneath shows the slide
 * label provided by the parent.
 */
function SlideTile({
  imageUrl,
  primaryLabel,
  secondaryLabel,
  isHero,
}: {
  imageUrl: string | null;
  primaryLabel: string;
  secondaryLabel: string;
  isHero: boolean;
}): JSX.Element {
  return (
    <div className="shrink-0 w-[180px]">
      <div
        className={[
          "w-[180px] h-[180px] rounded-xl overflow-hidden bg-neutral-100 ring-1",
          isHero ? "ring-gold-400" : "ring-neutral-200",
        ].join(" ")}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={`${primaryLabel} preview`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400">
            no preview
          </div>
        )}
      </div>
      <div
        className={[
          "mt-1.5 text-[10px] font-bold uppercase tracking-wider",
          isHero ? "text-gold-700" : "text-neutral-500",
        ].join(" ")}
      >
        {primaryLabel}
      </div>
      <div className="mt-0.5 text-xs text-neutral-700 truncate" title={secondaryLabel}>
        {secondaryLabel}
      </div>
    </div>
  );
}

export default function MultiOhFinalStage({
  heroImageUrl,
  carouselSlides,
  slideMetadata,
  listingsByMls,
  format,
  formatMeta,
  editedCaptions,
  onEditedCaptionsChange,
  hasCaption,
  busy,
  onPostNow,
  postNowEnabled,
  onRegenerateCaption,
  regeneratingCaption,
}: MultiOhFinalStageProps): JSX.Element {
  // why: caption preview defaults to collapsed (single line) — the user is
  // here to publish, not edit. Expanding opens the per-platform tab + edit
  // surface inline. Matches the existing /post-builder caption pane shape
  // so the user's mental model carries over.
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [activeCaptionPlatform, setActiveCaptionPlatform] =
    useState<SchedulablePlatform>("instagram");

  const slideCount = 1 + carouselSlides.length;
  const eventSubtitle = useMemo(
    () => buildEventSubtitle(slideMetadata, listingsByMls),
    [slideMetadata, listingsByMls],
  );
  const hostingSummary = useMemo(
    () => buildHostingSummary(slideMetadata),
    [slideMetadata],
  );

  // why: collapsed caption shows ~150 chars from the IG tab (canonical
  // platform), then a "see more" toggle. We use IG because every caption
  // pipeline writes IG first and falls back to it for other platforms.
  const captionForPreview = editedCaptions.instagram || editedCaptions.facebook || editedCaptions.tiktok;
  const COLLAPSED_LEN = 150;
  const captionSnippet =
    captionForPreview.length > COLLAPSED_LEN
      ? captionForPreview.slice(0, COLLAPSED_LEN).trimEnd() + "…"
      : captionForPreview;

  return (
    <div className="space-y-5">
      {/* Hero header — large, centered. Step 3 of 3 pill anchors the
          "you're at the end" framing. */}
      <div className="card p-6 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-gold-100 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gold-800 mb-3">
          Step 3 of 3
        </div>
        <h1 className="text-2xl font-bold text-neutral-900">
          Final Review — Schedule or Post
        </h1>
        <div className="mt-1.5 text-sm text-neutral-600">{eventSubtitle}</div>
        <div className="mt-1 text-xs text-neutral-500">
          {slideCount} slide{slideCount === 1 ? "" : "s"} ·{" "}
          {formatMeta?.display_name ?? format}
        </div>
        {hostingSummary ? (
          <div className="mt-3 inline-flex items-center gap-1.5 text-sm text-neutral-700">
            <Users size={14} aria-hidden="true" className="text-gold-600" />
            <span>{hostingSummary}</span>
          </div>
        ) : (
          // why: hosting_agents_by_index isn't wired yet (multi-OH route
          // writes a single hosting_agent_name per slide; per-slide hosts
          // already come through above). If a future migration adds a
          // top-level event-host list, render it here instead.
          // TODO(hosting_agents_by_index): replace fallback once available.
          null
        )}
      </div>

      {/* Carousel preview strip. Hero first, per-property slides after.
          Horizontally scrollable when the row overflows. */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">Carousel preview</div>
          <div className="text-xs text-neutral-500">
            {slideCount} slide{slideCount === 1 ? "" : "s"} publish in order
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          <SlideTile
            imageUrl={heroImageUrl}
            primaryLabel="HERO (transforms to caption)"
            secondaryLabel="Event overview"
            isHero
          />
          {carouselSlides.map((slide, i) => {
            const meta = slideMetadata[i];
            const address = addressForSlide(meta, listingsByMls, i);
            return (
              <SlideTile
                key={slide.id}
                imageUrl={slide.url}
                primaryLabel={`Slide ${i + 1}`}
                secondaryLabel={address}
                isHero={false}
              />
            );
          })}
        </div>
        {carouselSlides.length === 0 ? (
          <div className="mt-2 text-xs text-rose-700">
            No per-property slides found on this post. Re-run the wizard if
            this looks wrong.
          </div>
        ) : null}
      </div>

      {/* Caption preview — collapsed by default. "See more" toggles the
          full edit surface (per-platform tabs + textarea). */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow">Caption</div>
          {hasCaption ? (
            <button
              type="button"
              onClick={() => setCaptionExpanded((v) => !v)}
              className="text-xs font-medium text-gold-700 hover:text-gold-800 focus-ring rounded"
            >
              {captionExpanded ? "Collapse" : "Edit caption"}
            </button>
          ) : null}
        </div>

        {!captionExpanded ? (
          <div className="text-sm text-neutral-800 leading-relaxed">
            {hasCaption ? (
              <>
                {captionSnippet}
                {captionForPreview.length > COLLAPSED_LEN ? (
                  <button
                    type="button"
                    onClick={() => setCaptionExpanded(true)}
                    className="ml-1 text-xs font-medium text-gold-700 hover:text-gold-800 focus-ring rounded"
                  >
                    see more
                  </button>
                ) : null}
              </>
            ) : (
              <span className="text-neutral-500 italic">
                No caption yet. Click "Edit caption" to add one.
              </span>
            )}
          </div>
        ) : (
          <div>
            <div
              role="tablist"
              aria-label="Caption platform"
              className="mb-2 flex gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1"
            >
              {CAPTION_PLATFORMS.map((p) => {
                const active = activeCaptionPlatform === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveCaptionPlatform(p)}
                    className={`flex-1 rounded text-xs font-semibold uppercase tracking-wider transition-colors py-1.5 ${
                      active
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-800"
                    }`}
                  >
                    {CAPTION_PLATFORM_LABELS[p]}
                  </button>
                );
              })}
            </div>
            <textarea
              className="input min-h-[180px] font-sans text-sm leading-relaxed resize-y w-full"
              placeholder={`${CAPTION_PLATFORM_LABELS[activeCaptionPlatform]} caption + hashtags…`}
              value={editedCaptions[activeCaptionPlatform]}
              onChange={(e) =>
                onEditedCaptionsChange({
                  ...editedCaptions,
                  [activeCaptionPlatform]: e.target.value,
                })
              }
              disabled={busy}
            />
            {onRegenerateCaption ? (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onRegenerateCaption}
                  disabled={regeneratingCaption || busy}
                  className="inline-flex items-center gap-1 text-xs text-neutral-600 font-medium hover:text-neutral-900 disabled:opacity-50 focus-ring rounded"
                >
                  {regeneratingCaption ? (
                    "Rewriting…"
                  ) : (
                    <>
                      <RotateCw size={12} aria-hidden="true" />
                      Regenerate all
                    </>
                  )}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Action buttons — Schedule (secondary) + Post Now (primary).
          Schedule uses the same PostNowModal's Schedule tab so we route
          through onPostNow; users land on the modal and switch the tab.
          A future tweak could pass a `defaultTab` to onPostNow so this
          jumps straight to Schedule, but that's a deeper modal refactor. */}
      <div className="flex flex-wrap gap-3 justify-end">
        <button
          type="button"
          onClick={onPostNow}
          disabled={!postNowEnabled || busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border-2 border-gold-500 bg-white px-5 py-2.5 text-sm font-semibold text-gold-800 transition-colors hover:bg-gold-50 disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
          title="Open the Schedule + Post Now panel"
        >
          <Calendar size={14} aria-hidden="true" />
          Schedule
        </button>
        <button
          type="button"
          onClick={onPostNow}
          disabled={!postNowEnabled || busy}
          className="btn-primary inline-flex items-center justify-center gap-1.5 px-6"
          title="Publish this carousel now"
        >
          Post Now
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>

      {/* Escape hatch — if Larissa needs to re-do the carousel entirely,
          we keep the wizard link discoverable but demoted. NOT a tab. */}
      <div className="text-center">
        <Link
          href="/post-builder/multi-oh"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 focus-ring rounded"
        >
          <Edit3 size={11} aria-hidden="true" />
          Start over with a different set of properties
        </Link>
      </div>
    </div>
  );
}
