"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  confirmListingPostsAction,
  dismissListingPromotionAction,
  setListingPlatformConfirmedAction,
  unconfirmListingPostsAction,
  undismissListingPromotionAction,
} from "@/app/(app)/listings/actions";
import { formatCurrency } from "@/lib/format";
import PlatformBadge, { platformLabel } from "@/components/PlatformBadge";
import ListingStatusRibbon from "@/components/ListingStatusRibbon";
import type { ListingNeedingPosts } from "@/lib/data/listings-needing-posts";
import type { Database } from "@/lib/supabase/types";

type PostPlatform = Database["public"]["Enums"]["post_platform"];

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
  const cityState = [listing.city, listing.state].filter(Boolean).join(", ");

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

  function handleConfirmPosted() {
    setError(null);
    setMenuOpen(false);
    startTransition(async () => {
      const result = await confirmListingPostsAction(listing.mls_number);
      if (!result.ok) {
        setError(result.error ?? "Unable to mark posted.");
      }
    });
  }

  function handlePlatformToggle(platform: PostPlatform) {
    setError(null);
    // Auto-covered platforms aren't toggleable here — the click target is
    // disabled in the JSX. Only "missing" or "manual ✓" badges call this.
    const isCurrentlyManual =
      listing.manual_confirmed_platforms.includes(platform);
    const nextConfirmed = !isCurrentlyManual;
    startTransition(async () => {
      const result = await setListingPlatformConfirmedAction(
        listing.mls_number,
        platform,
        nextConfirmed,
      );
      if (!result.ok) {
        setError(result.error ?? "Unable to update.");
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
      <div className="relative w-12 h-12 shrink-0 rounded-md overflow-hidden bg-neutral-100">
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

      {/* Main info — single line on desktop, wraps gracefully on mobile */}
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <Link
          href={`/properties/${encodeURIComponent(listing.mls_number)}`}
          className="text-sm font-semibold text-neutral-900 hover:text-neutral-700 truncate min-w-0"
        >
          {listing.address ?? "Unknown address"}
          {cityState ? (
            <span className="text-neutral-500 font-normal">, {cityState}</span>
          ) : null}
          {listing.office_short_code ? (
            <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-gold-700">
              · {listing.office_short_code}
            </span>
          ) : null}
          {listing.agent_name ? (
            <span className="ml-1.5 text-[11px] font-normal text-neutral-500 truncate">
              · {listing.agent_name}
            </span>
          ) : null}
        </Link>

        <span className="text-sm font-semibold text-neutral-900 tabular-nums shrink-0">
          {listing.list_price ? formatCurrency(listing.list_price) : "—"}
        </span>

        <span
          className="text-[11px] text-neutral-500 shrink-0"
          title={`${referenceLabel} ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`}
        >
          {daysAgo}d
        </span>

        <PlatformCoverageBadges
          listing={listing}
          isPending={isPending}
          onToggle={handlePlatformToggle}
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

      {/* Right-side actions */}
      <div className="flex items-center gap-1 shrink-0">
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
            className="inline-flex items-center gap-0.5 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Change status: mark as posted, dismiss, or reset"
          >
            Status
            <ChevronDown />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute top-full right-0 mt-1 w-60 rounded-lg border border-neutral-200 bg-white shadow-lg z-10 p-1"
            >
              {/* Mark as posted — shown unless already in that state */}
              {!isPosted ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleConfirmPosted}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-[11px] text-emerald-700 hover:bg-emerald-50 font-medium"
                >
                  ✓ Mark as posted
                </button>
              ) : null}

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

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ALL_PLATFORMS: PostPlatform[] = ["facebook", "instagram", "tiktok"];

interface PlatformCoverageBadgesProps {
  listing: ListingNeedingPosts;
  isPending: boolean;
  onToggle: (platform: PostPlatform) => void;
}

/**
 * Three-button row showing per-platform coverage state. Always renders all
 * three platforms so the user can see the full picture at a glance:
 *
 *   Auto-covered (linked post exists)        → solid green ✓ FB, NOT clickable
 *   Manual ✓ (in posts_confirmed_platforms)  → green ✓ FB with dotted gold ring, click to un-mark
 *   Missing                                  → dimmed grey FB, click to mark posted manually
 *
 * One click = one server roundtrip = visual state flips. ADHD-friendly: no
 * menu, no confirmation, easy to undo.
 */
function PlatformCoverageBadges({
  listing,
  isPending,
  onToggle,
}: PlatformCoverageBadgesProps) {
  const allMarkedDone = !!listing.posts_confirmed_at;

  return (
    <div className="inline-flex items-center gap-1 shrink-0">
      {ALL_PLATFORMS.map((platform) => {
        const autoCovered = (listing.post_counts[platform] ?? 0) > 0;
        const manualCovered = listing.manual_confirmed_platforms.includes(platform);
        // The "Mark all as posted" shortcut covers everything but isn't
        // toggleable per-platform from here. Surface it as a full ring so
        // user knows it came from the global toggle.
        const fromGlobalShortcut = !autoCovered && !manualCovered && allMarkedDone;
        const covered = autoCovered || manualCovered || fromGlobalShortcut;

        const clickable = !autoCovered && !fromGlobalShortcut;
        const title = autoCovered
          ? `${platformLabel(platform)}: covered by an auto-linked post`
          : fromGlobalShortcut
            ? `${platformLabel(platform)}: covered by "Mark all as posted" — use Status ▾ → Reset to undo`
            : manualCovered
              ? `${platformLabel(platform)}: marked as posted (click to undo)`
              : `${platformLabel(platform)}: missing — click to mark as posted`;

        const visualClass = covered
          ? manualCovered
            ? "ring-2 ring-gold-400 ring-offset-1 ring-offset-white opacity-100"
            : "opacity-100"
          : "opacity-30 grayscale";

        return (
          <button
            key={platform}
            type="button"
            onClick={clickable ? () => onToggle(platform) : undefined}
            disabled={!clickable || isPending}
            title={title}
            aria-pressed={covered}
            className={clsx(
              "relative inline-flex items-center justify-center rounded-md transition",
              clickable
                ? "cursor-pointer hover:scale-110"
                : "cursor-default",
              isPending && clickable && "opacity-60",
              visualClass,
            )}
          >
            <PlatformBadge platform={platform} size="sm" />
            {covered ? (
              <span
                aria-hidden="true"
                className={clsx(
                  "absolute -top-1 -right-1 w-3 h-3 rounded-full text-white text-[8px] font-bold leading-none flex items-center justify-center shadow-sm",
                  manualCovered ? "bg-gold-500" : "bg-emerald-500",
                )}
              >
                ✓
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

