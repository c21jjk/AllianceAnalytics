"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState, useTransition } from "react";
import { dismissListingPromotionAction } from "@/app/(app)/listings/actions";
import { formatCurrency, formatShortDate } from "@/lib/format";
import PlatformBadge, { platformLabel } from "@/components/PlatformBadge";
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
      // On success the parent server component will revalidate and the card
      // will be removed from the DOM.
    });
  }

  return (
    <article
      className={clsx(
        "h-full rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden flex flex-col",
        isPending && "opacity-70",
        className,
      )}
    >
      <div className="relative aspect-[16/9] bg-neutral-100">
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
        {listing.office_short_code ? (
          <span className="absolute top-2 left-2 inline-flex items-center rounded-md bg-neutral-900/85 backdrop-blur px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {listing.office_short_code}
          </span>
        ) : null}
        <span className="absolute top-2 right-2 inline-flex items-center rounded-md bg-white/90 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700">
          {referenceLabel} {daysAgo}d ago
        </span>
      </div>

      <div className="flex-1 flex flex-col gap-2 p-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-neutral-900 truncate">
            {listing.address ?? "Unknown address"}
          </h3>
          {cityState ? (
            <p className="text-[11px] text-neutral-500 truncate">{cityState}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-neutral-900 tabular-nums">
            {listing.list_price ? formatCurrency(listing.list_price) : "—"}
          </span>
          {listing.agent_name ? (
            <span className="text-[11px] text-neutral-500 truncate max-w-[140px]">
              {listing.agent_name}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
            Need:
          </span>
          {listing.missing_platforms.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700"
            >
              <PlatformBadge platform={p} size="sm" />
              {platformLabel(p)}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={handleCopyMls}
          className={clsx(
            "inline-flex items-center justify-between gap-1.5 rounded-md px-2 py-1 text-[11px] font-mono",
            "border border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100",
            "text-neutral-700 transition-colors",
          )}
          title="Copy this hashtag and paste into your IG/TT/FB caption — the auto-linker will pick it up."
        >
          <span className="truncate">{listing.mls_hashtag}</span>
          <span className="text-[10px] uppercase tracking-wide font-semibold text-neutral-500">
            {copyState === "copied" ? "Copied" : "Copy"}
          </span>
        </button>

        <div className="mt-auto pt-2 border-t border-neutral-100 flex items-center justify-between gap-2">
          <Link
            href={`/properties/${encodeURIComponent(listing.mls_number)}`}
            className="text-[11px] font-medium text-neutral-700 hover:text-neutral-900 underline-offset-2 hover:underline"
          >
            Open property
          </Link>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              Dismiss
              <ChevronDown />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute bottom-full right-0 mb-1 w-56 rounded-lg border border-neutral-200 bg-white shadow-lg z-10 p-1"
              >
                <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                  Why skip?
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
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="text-[10px] text-red-700">{error}</p>
        ) : null}
      </div>
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

// formatShortDate is imported above to satisfy types — keep it referenced so
// future callers can use it without re-importing.
void formatShortDate;
