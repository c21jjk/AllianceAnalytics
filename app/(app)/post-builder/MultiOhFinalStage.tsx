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
 *   1. Header band — "Final Review Before Posting" title + property-count
 *      subtitle + lighter hosts line.
 *   2. Carousel preview strip — every per-property slide with an address
 *      caption underneath (hero is NOT published as a slide — event details
 *      live in the caption).
 *   3. Caption panel — per-platform tabs (IG / FB / TT) with body +
 *      hashtags shown together and a character counter.
 *   4. Single primary action — Post Now (opens PostNowModal; user can
 *      switch to that modal's Schedule tab if needed).
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
import { AlertTriangle, CheckCircle2, ChevronRight, RotateCw, XCircle } from "lucide-react";
import type {
  PostBuilderListing,
  PostFormat,
  SchedulablePlatform,
  SlideMetadata,
} from "@/lib/post-builder/types";
import type { CarouselSlide } from "@/lib/post-builder/canvas-editor/types";

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
 * Derive the event subtitle. 2026-05-28 — simplified to the bare property-
 * count framing. The mechanical noise ("slide count," "format," "session
 * date") got demoted out of the header because the carousel strip below
 * already conveys slide count visually, and John's feedback was that the
 * "Hosted by" line should sit alone on its own row instead of being
 * appended after a long middle-dot chain.
 */
function buildEventSubtitle(
  slideMetadata: readonly SlideMetadata[],
): string {
  const count = slideMetadata.length;
  const propertyWord = count === 1 ? "property" : "properties";
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

/**
 * Split a per-platform caption string into prose body + hashtag list.
 *
 * The parent's `editedCaptions[platform]` string is the user's edit-friendly
 * `"body\n\nhashtags"` blob (built by joinCaptionAndTags in
 * PostBuilderClient). When the user clicks Edit Caption they can rearrange
 * freely, so we re-parse by extracting every `#word` token rather than
 * assuming structure. Mirrors `parsePlatformText` in PostBuilderClient —
 * inlined here to avoid plumbing a private helper across the file boundary.
 *
 * 2026-05-28 — added to drive Change 6: the caption preview now explicitly
 * surfaces the synthesized hashtag line below the body with a blank-line
 * gap, so Larissa sees exactly what will publish (prior collapsed-snippet
 * preview was trimming hashtags off entirely).
 */
function splitBodyAndHashtags(text: string): {
  body: string;
  hashtags: string[];
} {
  const tokens = text.match(/#[A-Za-z0-9_]+/g) ?? [];
  let prose = text;
  for (const t of tokens) {
    prose = prose.replace(t, "");
  }
  prose = prose.replace(/\s+$/g, "");
  return { body: prose, hashtags: tokens };
}

/**
 * Build the "what will publish" preview string for a platform: body, a
 * blank-line gap, then the hashtags joined by spaces. Mirrors the exact
 * format the publish path emits (see joinCaptionAndTags in
 * PostBuilderClient).
 */
function buildPreviewString(text: string): string {
  const { body, hashtags } = splitBodyAndHashtags(text);
  if (hashtags.length === 0) return body;
  if (body.length === 0) return hashtags.join(" ");
  return `${body}\n\n${hashtags.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Pre-flight checks (2026-07-24)
// ---------------------------------------------------------------------------
//
// One glance before Post Now: is anything silently wrong? Three checks,
// all pure client-side computation over props already on this screen —
// no extra fetches. Severity model: "fail" would produce a broken or
// embarrassing publish (surface red), "warn" is degraded-but-publishable
// (amber), "ok" is green. Post Now is NOT hard-blocked here — the server
// guards (stale-OH block, IG trim) are the enforcement layer; this panel
// exists so Larissa never has to discover those the hard way.

/** Instagram rejects captions over 2,200 characters outright. */
const IG_CAPTION_HARD_CAP = 2200;
/** TikTok's photo-post caption ceiling (API). */
const TT_CAPTION_HARD_CAP = 4000;
/** Instagram publishes at most 10 carousel images; extras get trimmed. */
const IG_SLIDE_CAP = 10;

interface PreflightCheck {
  key: string;
  status: "ok" | "warn" | "fail";
  label: string;
}

function computePreflightChecks(args: {
  editedCaptions: Record<SchedulablePlatform, string>;
  slideCount: number;
  slideMetadata: readonly SlideMetadata[];
  listingsByMls: ReadonlyMap<string, PostBuilderListing>;
  nowMs: number;
}): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  // ---- captions ---------------------------------------------------------
  const missing: string[] = [];
  const overCap: string[] = [];
  for (const p of CAPTION_PLATFORMS) {
    const text = (args.editedCaptions[p] ?? "").trim();
    if (text.length === 0) {
      missing.push(CAPTION_PLATFORM_LABELS[p]);
      continue;
    }
    if (p === "instagram" && text.length > IG_CAPTION_HARD_CAP) {
      overCap.push(`Instagram (${text.length.toLocaleString()} > ${IG_CAPTION_HARD_CAP.toLocaleString()})`);
    }
    if (p === "tiktok" && text.length > TT_CAPTION_HARD_CAP) {
      overCap.push(`TikTok (${text.length.toLocaleString()} > ${TT_CAPTION_HARD_CAP.toLocaleString()})`);
    }
  }
  if (overCap.length > 0) {
    checks.push({
      key: "captions",
      status: "fail",
      label: `Caption over the platform limit: ${overCap.join(", ")} — that platform will reject the post`,
    });
  } else if (missing.length > 0) {
    checks.push({
      key: "captions",
      status: "warn",
      label: `No caption yet for ${missing.join(", ")}`,
    });
  } else {
    checks.push({
      key: "captions",
      status: "ok",
      label: "Captions present and within platform limits",
    });
  }

  // ---- slide count ------------------------------------------------------
  if (args.slideCount === 0) {
    checks.push({
      key: "slides",
      status: "fail",
      label: "No per-property slides on this post",
    });
  } else if (args.slideCount > IG_SLIDE_CAP) {
    checks.push({
      key: "slides",
      status: "warn",
      label: `${args.slideCount} slides — Instagram will trim to the first ${IG_SLIDE_CAP}`,
    });
  } else {
    checks.push({
      key: "slides",
      status: "ok",
      label: `${args.slideCount} slide${args.slideCount === 1 ? "" : "s"}, within Instagram's ${IG_SLIDE_CAP}-image cap`,
    });
  }

  // ---- open-house windows ----------------------------------------------
  // Uses the listing rows' soonest-upcoming OH window (page-load data).
  // A listing with no window data is skipped rather than flagged — the
  // feed omits windows on some manual rows and a false alarm erodes trust.
  const passedAddresses: string[] = [];
  let checkedCount = 0;
  const seenMls = new Set<string>();
  for (const meta of args.slideMetadata) {
    if (!meta.listing_mls || seenMls.has(meta.listing_mls)) continue;
    seenMls.add(meta.listing_mls);
    const listing = args.listingsByMls.get(meta.listing_mls);
    const endIso = listing?.oh_end_at ?? null;
    if (!endIso) continue;
    const endMs = Date.parse(endIso);
    if (Number.isNaN(endMs)) continue;
    checkedCount += 1;
    if (endMs < args.nowMs) {
      passedAddresses.push(listing?.address ?? meta.listing_mls);
    }
  }
  if (checkedCount > 0) {
    if (passedAddresses.length === checkedCount) {
      checks.push({
        key: "oh",
        status: "fail",
        label: "Every open house in this post has already ended — publishing is blocked until the dates are refreshed",
      });
    } else if (passedAddresses.length > 0) {
      checks.push({
        key: "oh",
        status: "warn",
        label: `Open house already ended for: ${passedAddresses.join(", ")}`,
      });
    } else {
      checks.push({
        key: "oh",
        status: "ok",
        label: "All open-house windows are still upcoming",
      });
    }
  }

  return checks;
}

export default function MultiOhFinalStage({
  heroImageUrl: _heroImageUrl,
  carouselSlides,
  slideMetadata,
  listingsByMls,
  format: _format,
  formatMeta: _formatMeta,
  editedCaptions,
  onEditedCaptionsChange,
  hasCaption,
  busy,
  onPostNow,
  postNowEnabled,
  onRegenerateCaption,
  regeneratingCaption,
}: MultiOhFinalStageProps): JSX.Element {
  // 2026-05-28 — the prior "collapsed snippet + Edit caption toggle" was
  // dropped in favor of an always-visible per-platform caption panel. John's
  // walkthrough with Larissa flagged the collapsed view as a hidden-state
  // trap (Larissa's ADHD memory) — show the real caption + hashtag line at
  // all times so the user sees exactly what will publish.
  const [activeCaptionPlatform, setActiveCaptionPlatform] =
    useState<SchedulablePlatform>("instagram");

  const eventSubtitle = useMemo(
    () => buildEventSubtitle(slideMetadata),
    [slideMetadata],
  );
  const hostingSummary = useMemo(
    () => buildHostingSummary(slideMetadata),
    [slideMetadata],
  );

  // 2026-05-28 — preview string for the active tab is body + blank line +
  // hashtags, exactly mirroring the publish path's joinCaptionAndTags
  // output. Character counter below sums the full string so Larissa can
  // see total length (IG cap = 2200, FB ~63206, TT = 4000 but tag-pruned).
  const captionPreviewString = useMemo(
    () => buildPreviewString(editedCaptions[activeCaptionPlatform] ?? ""),
    [editedCaptions, activeCaptionPlatform],
  );

  // 2026-07-24 — pre-flight checks. nowMs is captured once per mount;
  // minute-level drift while the screen is open doesn't matter for
  // whole-day OH windows.
  const preflightNowMs = useMemo(() => Date.now(), []);
  const preflightChecks = useMemo(
    () =>
      computePreflightChecks({
        editedCaptions,
        slideCount: carouselSlides.length,
        slideMetadata,
        listingsByMls,
        nowMs: preflightNowMs,
      }),
    [editedCaptions, carouselSlides.length, slideMetadata, listingsByMls, preflightNowMs],
  );

  return (
    <div className="space-y-7">
      {/* 1. Header band — title + property-count subtitle + hosts line.
             Compact (~80px), centered, no flair. The "Step 3 of 3" pill
             and Users icon got dropped — John flagged the chrome as
             noise once the parent page chrome is also suppressed. */}
      <div className="text-center pt-2">
        <h1 className="text-2xl font-bold text-neutral-900">
          Final Review Before Posting
        </h1>
        <div className="mt-1.5 text-sm text-neutral-700">{eventSubtitle}</div>
        {hostingSummary ? (
          <div className="mt-1 text-xs text-neutral-500">{hostingSummary}</div>
        ) : null}
      </div>

      {/* 2. Carousel preview — full-width strip of per-property slides.
             No header label (the visual itself is self-explanatory and
             the "Carousel · N slides" eyebrow was redundant noise per
             John's walkthrough). Hero is intentionally NOT shown — it's
             a Studio thumbnail, not a publishable slide; event details
             live in the caption. */}
      <div className="card p-4">
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
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

      {/* 3. Caption panel — per-platform tabs at top, preview box (body +
             hashtags joined the same way the publish path emits), char
             counter below. Always visible — no collapsed snippet. */}
      <div className="card p-4">
        <div
          role="tablist"
          aria-label="Caption platform"
          className="mb-3 flex gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1"
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
        {hasCaption ? (
          <>
            <textarea
              className="input min-h-[200px] font-sans text-sm leading-relaxed resize-y w-full"
              placeholder={`${CAPTION_PLATFORM_LABELS[activeCaptionPlatform]} caption + hashtags…`}
              value={captionPreviewString}
              onChange={(e) => {
                // why: editing rewrites the active platform's raw string.
                // The next render re-derives `captionPreviewString` via
                // buildPreviewString, which normalizes back to
                // "body\n\nhashtags" so a round-trip stays stable.
                onEditedCaptionsChange({
                  ...editedCaptions,
                  [activeCaptionPlatform]: e.target.value,
                });
              }}
              disabled={busy}
            />
            <div className="mt-2 flex items-center justify-between text-xs">
              <div className="text-neutral-500">
                {captionPreviewString.length.toLocaleString()} chars
              </div>
              {onRegenerateCaption ? (
                <button
                  type="button"
                  onClick={onRegenerateCaption}
                  disabled={regeneratingCaption || busy}
                  className="inline-flex items-center gap-1 text-neutral-600 font-medium hover:text-neutral-900 disabled:opacity-50 focus-ring rounded"
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
              ) : null}
            </div>
          </>
        ) : (
          <div className="text-sm text-neutral-500 italic py-6 text-center">
            No caption yet.
          </div>
        )}
      </div>

      {/* 3.5 Pre-flight checks (2026-07-24) — one glance before posting.
             Server-side guards enforce the hard failures; this panel makes
             them visible BEFORE the click instead of as an error after. */}
      <div className="card p-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2">
          Pre-flight checks
        </h2>
        <ul className="space-y-1.5">
          {preflightChecks.map((c) => (
            <li key={c.key} className="flex items-start gap-2 text-sm">
              {c.status === "ok" ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : c.status === "warn" ? (
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              ) : (
                <XCircle size={16} className="mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />
              )}
              <span
                className={
                  c.status === "ok"
                    ? "text-neutral-600"
                    : c.status === "warn"
                      ? "text-amber-800"
                      : "text-rose-800 font-medium"
                }
              >
                {c.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 4. Action row — single primary Post Now button, right-aligned.
             Schedule moved to the PostNowModal's "Schedule" tab; the
             Final Stage page is single-action. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onPostNow}
          disabled={!postNowEnabled || busy}
          className="btn-primary inline-flex items-center justify-center gap-1.5 px-7 py-3 text-base"
          title="Publish this carousel now"
        >
          Post Now
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
