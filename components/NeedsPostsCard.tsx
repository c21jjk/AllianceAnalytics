"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  dismissListingPromotionAction,
  unconfirmListingPostsAction,
  undismissListingPromotionAction,
} from "@/app/(app)/listings/actions";
import { formatCurrency } from "@/lib/format";
import PostedCheckbox from "@/components/PostedCheckbox";
import ListingStatusRibbon from "@/components/ListingStatusRibbon";
import type { ListingNeedingPosts } from "@/lib/data/listings-needing-posts";

const REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "low_price", label: "Low price point" },
  { value: "condition", label: "Property condition" },
  { value: "owner_request", label: "Owner request" },
  { value: "other", label: "Other..." },
];

interface NeedsPostsCardProps {
  listing: ListingNeedingPosts;
  className?: string;
}

/**
 * Single per-listing card for the "needs Larissa's attention" strip.
 *
 * Layout (top-to-bottom, fits a 320px column):
 *   - Hero image with the office short_code badge overlay
 *   - Address line + city/state
 *   - List price + listed-X-days-ago pill
 *   - Missing-platform chips (only the gaps — IG/TT/FB present is omitted)
 *   - MLS# copy chip (one-tap copy of `#NJBL...` / `#CMC...` / `#SJSR...`)
 *   - Footer: "Open property" link + "Dismiss ▾" popover
 */
export default function NeedsPostsCard({ listing, className }: NeedsPostsCardProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [otherReason, setOtherReason] = useState("");
  const [showOtherInput, setShowOtherInput] = useState(false);

  const daysAgo = computeDaysAgo(listing.reference_date);
  const referenceLabel = listing.reference_date_kind === "listing_date"
    ? "Listed"
    : "Synced";
  // 2026-07-17 (approved mockup v2) — state dropped: every listing is NJ.
  const cityState = listing.city ?? "";

  function handleCopyMls() {
    void navigator.clipboard
      ?.writeText(listing.mls_hashtag)
      .then(() => {
        setCopyState("copied");
        setTimeout(() => setCopyState("idle"), 1800);
      })
      .catch(() => {
        setCopyState("idle");
      });
  }

  function handleDismiss(reason: string) {
    setError(null);
    setMenuOpen(false);
    setShowOtherInput(false);
    startTransition(async () => {
      const result = await dismissListingPromotionAction(
        listing.mls_number,
        reason,
      );
      if (!result.ok) {
        setError(result.error ?? "Unable to dismiss.");
      }
    });
  }

  function handleReset() {
    setError(null);
    setMenuOpen(false);
    startTransition(async () => {
      // Clear whichever flag applies; idempotent server-side.
      if (listing.promotion_status === "dismissed") {
        const r = await undismissListingPromotionAction(listing.mls_number);
        if (!r.ok) setError(r.error ?? "Unable to reset.");
      } else if (listing.promotion_status === "posted" && listing.posts_confirmed_at) {
        const r = await unconfirmListingPostsAction(listing.mls_number);
        if (!r.ok) setError(r.error ?? "Unable to reset.");
      }
      // If state is "posted" via auto-detected linked posts, no action — those
      // can't be reset from the dashboard (would need to delete the posts).
    });
  }

  const isPosted = listing.promotion_status === "posted";
  const isDismissed = listing.promotion_status === "dismissed";
  const showResetOption =
    isDismissed || (isPosted && !!listing.posts_confirmed_at);

  return (
    <article
      className={clsx(
        "rounded-lg border bg-white shadow-sm flex items-center gap-2.5 px-2.5 py-2",
        isPending && "opacity-70",
        // Subtle row tinting echoes the ribbon — posted/dismissed feel parked
        isPosted
          ? "border-gold-200 bg-gold-50/30"
          : isDismissed
            ? "border-neutral-300 bg-neutral-50/60 opacity-75"
            : "border-neutral-200",
        className,
      )}
    >
      {/* Tiny thumbnail (48x48) — ribbon overlay shows status */}
      <div className="relative w-14 h-14 shrink-0 rounded-md overflow-hidden bg-neutral-100">
        {listing.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.hero_image_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-neutral-400">
            <HouseIcon />
          </div>
        )}
        {listing.office_short_code && !isPosted && !isDismissed ? (
          <span className="absolute bottom-0 left-0 right-0 bg-neutral-900/80 text-[8px] font-semibold uppercase tracking-wide text-white text-center leading-tight py-0.5">
            {listing.office_short_code}
          </span>
        ) : null}
        <ListingStatusRibbon status={listing.promotion_status} size="sm" />
      </div>

      {/* Main info — 2026-07-17 (approved mockup v2): two-line layout
          matching the Open Houses chip. Line 1 = address + town + office;
          line 2 = price · days · FULL agent name (the whole line belongs to
          it, so long names like "LeaRose Mazurie" never truncate the way the
          old single-line flex-wrap did); mini-row 3 = platform coverage +
          hashtag copy chip. */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/properties/${encodeURIComponent(listing.mls_number)}`}
          className="block text-sm font-semibold text-neutral-900 hover:text-neutral-700 truncate"
        >
          {listing.address ?? "Unknown address"}
          {cityState ? (
            // why: town steps down a size + lighter so the street address
            // owns the line — approved mockup v2.
            <span className="text-[11.5px] text-neutral-500 font-normal">
              , {cityState}
            </span>
          ) : null}
          {listing.office_short_code ? (
            <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-gold-700">
              · {listing.office_short_code}
            </span>
          ) : null}
        </Link>

        <div className="mt-0.5 text-[11px] text-neutral-500 truncate">
          <span className="text-neutral-900 font-semibold tabular-nums">
            {listing.list_price ? formatCurrency(listing.list_price) : "—"}
          </span>
          <span className="text-neutral-300"> · </span>
          <span
            title={`${referenceLabel} ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`}
          >
            {daysAgo}d
          </span>
          {listing.agent_name ? (
            <>
              <span className="text-neutral-300"> · </span>
              <span className="text-neutral-700 font-medium">
                {listing.agent_name}
              </span>
            </>
          ) : null}
        </div>

        <div className="mt-1 flex items-center gap-2">
        {/* 2026-08-05 (John) — the three per-platform chips are gone. Every
            milestone section now asks one question: has a post been made for
            this property? The checkbox writes listing_post_marks scoped to
            just_listed, so Under Contract / Just Sold / Price Change track
            separately instead of sharing one property-level flag. */}
        <PostedCheckbox
          mlsNumber={listing.mls_number}
          postType="just_listed"
          checked={listing.post_made}
          autoDetected={listing.post_auto_detected}
        />


        <button
          type="button"
          onClick={handleCopyMls}
          className={clsx(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-mono shrink-0",
            "border border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100",
            "text-neutral-700 transition-colors",
          )}
          title="Copy this hashtag and paste into your IG/TT/FB caption — the auto-linker will pick it up."
        >
          <span className="truncate max-w-[140px]">{listing.mls_hashtag}</span>
          <span className="text-[9px] uppercase tracking-wide font-semibold text-neutral-500">
            {copyState === "copied" ? "✓" : "copy"}
          </span>
        </button>
        </div>
      </div>

      {/* Right-side actions — three distinct outcomes for this row:
            • Open           → property page (review the listing)
            • + Build post   → primary CTA, deep-links into Post Builder with
                               this listing + just_listed pre-selected
            • ⋯ kebab        → secondary menu: Dismiss…, Reset.
              2026-08-05 (John) — "Mark as posted (from phone)" was removed:
              the Posted checkbox on the row does that job now, and having two
              controls for one outcome is exactly the confusion this pass set
              out to remove.
          why this layout: the highest-volume job is "build a post for this"
          — making it the gold primary keeps the click path one-tap. The
          housekeeping actions stay one menu away.
          2026-07-17 (approved mockup v2) — actions now stack VERTICALLY:
          "+ Build post" on top, Open + kebab tucked underneath, mirroring
          the Open Houses chip. Frees the full chip width for the two info
          lines so the agent name never competes with buttons. */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {/* Hide the primary "Build post" CTA once the row is posted or
            dismissed — the headline action no longer applies; the kebab still
            offers Reset if Larissa changes her mind. */}
        {!isPosted && !isDismissed ? (
          <Link
            href={`/post-builder?mls=${encodeURIComponent(listing.mls_number)}&postType=just_listed`}
            className="inline-flex items-center gap-1 rounded-md bg-gold-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-gold-600 transition-colors"
            title="Open the Post Builder with this listing pre-selected"
          >
            <PlusGlyph />
            Build post
          </Link>
        ) : null}
        <div className="flex items-center gap-0.5">
        <Link
          href={`/properties/${encodeURIComponent(listing.mls_number)}`}
          className="text-[11px] font-medium text-neutral-700 hover:text-neutral-900 px-1.5 py-1 rounded hover:bg-neutral-100"
        >
          Open
        </Link>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More actions"
            title="More actions: mark as posted, dismiss, or reset"
          >
            <KebabGlyph />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute top-full right-0 mt-1 w-60 rounded-lg border border-neutral-200 bg-white shadow-lg z-10 p-1"
            >

              {/* Dismiss reasons — shown unless already dismissed */}
              {!isDismissed ? (
                <>
                  <p className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    Dismiss — why skip?
                  </p>
                  {REASON_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (opt.value === "other") {
                          setShowOtherInput(true);
                        } else {
                          handleDismiss(opt.value);
                        }
                      }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-[11px] text-neutral-700 hover:bg-neutral-50"
                    >
                      {opt.label}
                    </button>
                  ))}
                </>
              ) : null}

              {showOtherInput ? (
                <div className="border-t border-neutral-100 p-2">
                  <input
                    type="text"
                    autoFocus
                    value={otherReason}
                    onChange={(e) => setOtherReason(e.target.value)}
                    placeholder="Reason..."
                    className="w-full rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                    maxLength={200}
                  />
                  <div className="mt-1 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowOtherInput(false);
                        setOtherReason("");
                      }}
                      className="text-[10px] text-neutral-500 hover:text-neutral-700 px-1.5 py-0.5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDismiss(otherReason.trim() || "other")
                      }
                      className="text-[10px] font-semibold text-white bg-neutral-900 hover:bg-neutral-800 rounded px-1.5 py-0.5"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              ) : null}

              {showResetOption ? (
                <>
                  <div className="border-t border-neutral-100 my-1" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleReset}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-[11px] text-neutral-600 hover:bg-neutral-50"
                  >
                    ↺ Reset (back to needs post)
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        </div>
      </div>

      {error ? (
        <p className="text-[10px] text-red-700 w-full mt-1 basis-full">{error}</p>
      ) : null}
    </article>
  );
}

function computeDaysAgo(referenceDate: string): number {
  const ref = new Date(referenceDate.length <= 10 ? `${referenceDate}T00:00:00Z` : referenceDate);
  if (Number.isNaN(ref.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - ref.getTime()) / 86400_000));
}

function HouseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" aria-hidden="true">
      <path
        d="M3 11l9-7 9 7M5 9.6V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.6"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusGlyph() {
  // why: thin-stroke "+" sized to sit cleanly next to "Build post" text
  // without over-weighting the gold pill.
  return (
    <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function KebabGlyph() {
  // why: three-dot "more" glyph — standard pattern for secondary action
  // menus. The vertical orientation reads as "in-row context menu" without
  // competing with the gold CTA next to it.
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3.5" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.5" r="1.3" />
    </svg>
  );
}
