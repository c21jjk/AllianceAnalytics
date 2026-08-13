"use client";

/**
 * FinalReviewStage — the "Final Review Before Posting" screen, shared by
 * EVERY post type.
 * ---------------------------------------------------------------------------
 *
 * 2026-08-08 (John): "I want the final Posting screen to look exactly the way
 * it does for the Multi-Property Open House final posting screen... I need all
 * processes to be consistent."
 *
 * This started life as MultiOhFinalStage, used only by multi-property Open
 * House carousels. Every other post type published from a "Post Now" button
 * sitting in the build screen's preview cluster — a button that rendered as a
 * quiet outline until you had been into Studio, which is exactly why John
 * missed it and thought the other four types had one step fewer.
 *
 * The fix was NOT a second component that looks like this one. Two lookalike
 * screens drift the moment somebody tweaks one and forgets the other, and
 * consistency is the thing that was actually asked for. So this component now
 * serves both flows, and the five places that genuinely differ branch on
 * `mode`:
 *
 *   1. subtitle line      property count      vs  post type + address
 *   2. third line         hosts               vs  milestone detail
 *   3. preview            slides only (the    vs  hero IS the post, shown
 *                         hero is a Studio        large, extra slides below
 *                         thumbnail, never
 *                         published)
 *   4. pre-flight checks  open-house windows  vs  hold flag + test mode
 *   5. empty-slides error carousel only       vs  n/a
 *
 * Everything else — header band, caption panel with its platform tabs,
 * pre-flight layout, action row, and the PostNowModal the parent opens — is
 * shared CODE rather than shared design. It cannot drift.
 *
 * Consequence worth knowing: a change to this screen now lands on both flows
 * at once. That is the point, but multi-OH is no longer free to diverge
 * without a deliberate decision.
 *
 * Structure (identical in both modes):
 *
 *   1. Header band — "Final Review Before Posting" + subtitle + detail line.
 *   2. Preview — the slides that will publish.
 *   3. Caption panel — per-platform tabs (IG / FB / TT) with body +
 *      hashtags shown together and a character counter.
 *   4. Pre-flight checks — one glance before publishing.
 *   5. Single primary action — Post Now, which opens PostNowModal. Per-
 *      platform scheduling already lives in that modal's Schedule tab, so
 *      both flows get it for free and identically.
 *
 * Why a separate file:
 *   PostBuilderClient.tsx is already 5600 lines. Inlining ~400 more makes the
 *   cognitive load worse.
 *
 * Why no listing-picker / variant grid / Edit-in-Studio here:
 *   Those decisions are made on the build screen (or, for multi-OH, in the
 *   wizard). Exposing them again would compete with the single Post Now
 *   action and blur the linear "you are at the final stage" framing. Single
 *   mode offers "Back to editing" instead, which returns to the build screen
 *   with everything intact.
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

/**
 * Which flow is being reviewed.
 *
 *   "multi_oh" — a multi-property Open House carousel from the wizard.
 *   "single"   — Just Listed / Under Contract / Just Sold / Price Reduction,
 *                and single-property Open House.
 */
export type FinalReviewMode = "multi_oh" | "single";

export interface FinalReviewStageProps {
  mode: FinalReviewMode;
  /**
   * Hero image URL.
   *
   * multi_oh: slide 0, a Studio thumbnail that is deliberately NOT published,
   *           so it is not shown on this screen.
   * single:   the post itself. Shown large.
   */
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
  /**
   * 2026-08-08 — which caption tab is showing. Optional so this component
   * still works uncontrolled, but the Post Builder passes its own state down
   * because the publish dialog's caption snippet reads from there. When the
   * two were separate you could be editing TikTok's caption and be shown
   * Instagram's in the dialog that publishes.
   */
  activeCaptionPlatform?: SchedulablePlatform;
  onActiveCaptionPlatformChange?: (next: SchedulablePlatform) => void;

  /* ---- single mode only ------------------------------------------------ */

  /** Subtitle line, e.g. "Price Reduction · 513 E 17th Avenue, North Wildwood". */
  singleSubtitle?: string | null;
  /**
   * The lighter third line, carrying whatever actually matters for THIS
   * milestone: the drop and old price for a reduction, close price and date
   * for a sale. Occupies the slot the hosts line uses in multi-OH mode.
   */
  singleDetailLine?: string | null;
  /** Canonical MLS hashtag, checked in pre-flight so attribution can't be lost. */
  mlsHashtag?: string | null;
  /**
   * Set when a teammate put this listing on hold from the dashboard notes
   * panel. Surfaced as an amber pre-flight row, directly above the button
   * that would publish it. See components/ListingNote.tsx.
   */
  holdNotice?: { by: string; body: string | null } | null;
  /** True when this post publishes to drafts only. Called out in pre-flight. */
  testMode?: boolean;
  /** Returns to the build screen with all state intact. */
  onBackToEditing?: () => void;
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

/**
 * Caption checks, shared by both modes. Extracted 2026-08-08 when this screen
 * became the single final-review surface: caption limits are a platform fact,
 * not a flow-specific one, and duplicating them was how the two screens would
 * have started drifting.
 */
function captionChecks(
  editedCaptions: Record<SchedulablePlatform, string>,
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const missing: string[] = [];
  const overCap: string[] = [];
  for (const p of CAPTION_PLATFORMS) {
    const text = (editedCaptions[p] ?? "").trim();
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
  return checks;
}

/** Multi-property Open House pre-flight: captions, slide count, OH windows. */
function computeMultiOhPreflight(args: {
  editedCaptions: Record<SchedulablePlatform, string>;
  slideCount: number;
  slideMetadata: readonly SlideMetadata[];
  listingsByMls: ReadonlyMap<string, PostBuilderListing>;
  nowMs: number;
}): PreflightCheck[] {
  const checks: PreflightCheck[] = captionChecks(args.editedCaptions);

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

/**
 * Single-listing pre-flight: captions, render landed, carousel size, MLS
 * attribution, hold flag, publish mode.
 *
 * The hold and test-mode rows are the two that pay for this panel's existence
 * in single mode. Both were previously only discoverable after opening the
 * publish modal, or in the hold's case from a strip at the top of the build
 * screen two clicks back.
 */
function computeSinglePreflight(args: {
  editedCaptions: Record<SchedulablePlatform, string>;
  heroImageUrl: string | null;
  slideCount: number;
  mlsHashtag: string | null;
  holdNotice: { by: string; body: string | null } | null;
  testMode: boolean;
}): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  // ---- render -----------------------------------------------------------
  checks.push(
    args.heroImageUrl
      ? { key: "render", status: "ok", label: "Image rendered and ready" }
      : {
          key: "render",
          status: "fail",
          label: "No rendered image on this post — go back and hit Generate",
        },
  );

  checks.push(...captionChecks(args.editedCaptions));

  // ---- carousel size ----------------------------------------------------
  // Only worth a row when there ARE extra slides. A single-image post saying
  // "1 slide, within Instagram's cap" is noise.
  const totalSlides = args.slideCount + (args.heroImageUrl ? 1 : 0);
  if (args.slideCount > 0) {
    checks.push(
      totalSlides > IG_SLIDE_CAP
        ? {
            key: "slides",
            status: "warn",
            label: `${totalSlides} slides — Instagram will trim to the first ${IG_SLIDE_CAP}`,
          }
        : {
            key: "slides",
            status: "ok",
            label: `${totalSlides} slides, within Instagram's ${IG_SLIDE_CAP}-image cap`,
          },
    );
  }

  // ---- MLS attribution --------------------------------------------------
  // The canonical hashtag is what ties a published post back to its listing
  // in /posts and on the Owner Story. Losing it doesn't break the post, it
  // breaks the reporting, silently and only weeks later.
  //
  // 2026-08-08 — check the caption that WILL publish, not the hashtag the
  // generator produced. The textarea on this screen is editable and
  // splitBodyAndHashtags re-parses every #token from it, so deleting the MLS
  // tag there used to leave this row green while attribution was already
  // gone. Every platform that has a caption has to carry the tag: losing it
  // on Facebook only is still a hole in the reporting.
  const canonicalTag = (args.mlsHashtag ?? "").trim();
  const writtenCaptions = Object.values(args.editedCaptions).filter(
    (c) => c.trim().length > 0,
  );
  const tagPresent =
    canonicalTag.length > 0 &&
    writtenCaptions.length > 0 &&
    writtenCaptions.every((c) =>
      c.toLowerCase().includes(canonicalTag.toLowerCase()),
    );
  checks.push(
    tagPresent
      ? {
          key: "mls",
          status: "ok",
          label: `MLS hashtag ${canonicalTag} included, so the post links back to the listing`,
        }
      : {
          key: "mls",
          status: "warn",
          label: canonicalTag
            ? `MLS hashtag ${canonicalTag} is missing from the caption — this post won't link back to the listing in reporting`
            : "No MLS hashtag in the caption — this post won't link back to the listing in reporting",
        },
  );

  // ---- hold -------------------------------------------------------------
  if (args.holdNotice) {
    checks.push({
      key: "hold",
      status: "warn",
      label: args.holdNotice.body
        ? `${args.holdNotice.by} put this listing on hold: "${args.holdNotice.body}"`
        : `${args.holdNotice.by} put this listing on hold`,
    });
  }

  // ---- publish mode -----------------------------------------------------
  checks.push(
    args.testMode
      ? {
          key: "mode",
          status: "warn",
          label:
            "Publish mode is Test — this goes to platform drafts only, nothing public",
        }
      : {
          key: "mode",
          status: "ok",
          label: "Publish mode is Live",
        },
  );

  return checks;
}

export default function FinalReviewStage({
  mode,
  heroImageUrl,
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
  activeCaptionPlatform: controlledCaptionPlatform,
  onActiveCaptionPlatformChange,
  singleSubtitle = null,
  singleDetailLine = null,
  mlsHashtag = null,
  holdNotice = null,
  testMode = false,
  onBackToEditing,
}: FinalReviewStageProps): JSX.Element {
  const isSingle = mode === "single";
  // 2026-05-28 — the prior "collapsed snippet + Edit caption toggle" was
  // dropped in favor of an always-visible per-platform caption panel. John's
  // walkthrough with Larissa flagged the collapsed view as a hidden-state
  // trap (Larissa's ADHD memory) — show the real caption + hashtag line at
  // all times so the user sees exactly what will publish.
  // Uncontrolled fallback. When the parent passes its own tab down (the Post
  // Builder always does) that wins, so the screen and the publish dialog can
  // never disagree about which caption you are looking at.
  const [localCaptionPlatform, setLocalCaptionPlatform] =
    useState<SchedulablePlatform>("instagram");
  const activeCaptionPlatform =
    controlledCaptionPlatform ?? localCaptionPlatform;
  const setActiveCaptionPlatform =
    onActiveCaptionPlatformChange ?? setLocalCaptionPlatform;

  // Branch 1 + 2: the two lines under the title. Multi-OH describes the
  // event; single mode names the post and the listing, then whatever detail
  // matters for that milestone.
  const subtitle = useMemo(
    () => (isSingle ? singleSubtitle : buildEventSubtitle(slideMetadata)),
    [isSingle, singleSubtitle, slideMetadata],
  );
  const detailLine = useMemo(
    () => (isSingle ? singleDetailLine : buildHostingSummary(slideMetadata)),
    [isSingle, singleDetailLine, slideMetadata],
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
  // Branch 4: different questions worth asking per flow.
  const preflightChecks = useMemo(
    () =>
      isSingle
        ? computeSinglePreflight({
            editedCaptions,
            heroImageUrl,
            slideCount: carouselSlides.length,
            mlsHashtag,
            holdNotice,
            testMode,
          })
        : computeMultiOhPreflight({
            editedCaptions,
            slideCount: carouselSlides.length,
            slideMetadata,
            listingsByMls,
            nowMs: preflightNowMs,
          }),
    [
      isSingle,
      editedCaptions,
      heroImageUrl,
      carouselSlides.length,
      mlsHashtag,
      holdNotice,
      testMode,
      slideMetadata,
      listingsByMls,
      preflightNowMs,
    ],
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
        {subtitle ? (
          <div className="mt-1.5 text-sm text-neutral-700">{subtitle}</div>
        ) : null}
        {detailLine ? (
          <div className="mt-1 text-xs text-neutral-500">{detailLine}</div>
        ) : null}
      </div>

      {/* 2. Carousel preview — full-width strip of per-property slides.
             No header label (the visual itself is self-explanatory and
             the "Carousel · N slides" eyebrow was redundant noise per
             John's walkthrough). Hero is intentionally NOT shown — it's
             a Studio thumbnail, not a publishable slide; event details
             live in the caption. */}
      {/* Branch 3. In multi-OH the hero is a Studio thumbnail that never
          publishes, so only the per-property slides are shown. In single mode
          the hero IS the post: shown large, with any extra carousel slides in
          a strip underneath in publish order. */}
      <div className="card p-4">
        {isSingle ? (
          <>
            <div className="flex justify-center">
              <div className="w-full max-w-sm rounded-xl overflow-hidden bg-neutral-100 ring-1 ring-neutral-200">
                {heroImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={heroImageUrl}
                    alt="Post preview"
                    className="w-full h-auto block"
                  />
                ) : (
                  <div className="aspect-square flex items-center justify-center text-sm text-neutral-500">
                    No render yet
                  </div>
                )}
              </div>
            </div>
            {carouselSlides.length > 0 ? (
              <>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 mt-4">
                  <SlideTile
                    imageUrl={heroImageUrl}
                    primaryLabel="Slide 1"
                    secondaryLabel="Main image"
                    isHero
                  />
                  {carouselSlides.map((slide, i) => (
                    <SlideTile
                      key={slide.id}
                      imageUrl={slide.url}
                      primaryLabel={`Slide ${i + 2}`}
                      secondaryLabel=""
                      isHero={false}
                    />
                  ))}
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {carouselSlides.length + 1} slides will publish in this order.
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
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
            {/* Branch 5: only a carousel can be missing its slides. */}
            {carouselSlides.length === 0 ? (
              <div className="mt-2 text-xs text-rose-700">
                No per-property slides found on this post. Re-run the wizard if
                this looks wrong.
              </div>
            ) : null}
          </>
        )}
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
      {/* 2026-08-08 — "Back to editing" only exists in single mode. Multi-OH
          has no build screen to return to; its decisions were made in the
          wizard. Kept as a quiet text link so it never competes with Post
          Now. */}
      <div className="flex items-center justify-between gap-3">
        {isSingle && onBackToEditing ? (
          <button
            type="button"
            onClick={onBackToEditing}
            disabled={busy}
            className="text-sm text-neutral-500 hover:text-neutral-800 underline underline-offset-4 disabled:opacity-50"
          >
            &larr; Back to editing
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onPostNow}
          disabled={!postNowEnabled || busy}
          className="btn-primary inline-flex items-center justify-center gap-1.5 px-7 py-3 text-base"
          title="Choose platforms, then publish now or schedule"
        >
          Post Now
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
