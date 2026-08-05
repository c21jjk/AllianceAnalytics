"use client";

import { useState, useTransition } from "react";
import {
  dismissListingPromotionAction,
  unconfirmListingPostsAction,
  undismissListingPromotionAction,
} from "@/app/(app)/listings/actions";
import MilestoneListingRow from "@/components/MilestoneListingRow";
import ListingStatusRibbon from "@/components/ListingStatusRibbon";
import AutoReelLaunchButton from "@/components/AutoReelPanel";
import type { ListingNeedingPosts } from "@/lib/data/listings-needing-posts";
import type { ListingMilestone } from "@/lib/data/recently-sold";

const REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "low_price", label: "Low price point" },
  { value: "condition", label: "Property condition" },
  { value: "owner_request", label: "Owner request" },
  { value: "other", label: "Other..." },
];

interface NeedsPostsCardProps {
  listing: ListingNeedingPosts;
  /** Whether this is the first row in the list (no top border). */
  isFirst?: boolean;
}

/**
 * Recently Listed row.
 *
 * 2026-08-05 (John): "I want the Recently Listed cards to have the same exact
 * format as the Under Contract and Recently Sold cards. They currently look
 * different."
 *
 * They did: this used to be a self-contained bordered white card with its own
 * layout, tinting and a stacked Build post / Open / kebab column, while the
 * other three sections were flat editorial rows. It is now a thin wrapper
 * around the SAME MilestoneListingRow every other milestone section uses, so
 * all four are one component and can never drift apart again.
 *
 * The two things only this section needs ride in the row's optional slots:
 *   metaSuffix     → the MLS hashtag copy chip (paste into a caption and the
 *                    auto-linker picks the post up)
 *   trailingAction → the dismiss / reset kebab
 *   ribbon         → the posted / dismissed status flag on the thumbnail
 */
export default function NeedsPostsCard({
  listing,
  isFirst = false,
}: NeedsPostsCardProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [otherReason, setOtherReason] = useState("");
  const [showOtherInput, setShowOtherInput] = useState(false);

  const referenceLabel =
    listing.reference_date_kind === "listing_date" ? "Listed" : "Synced";

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
      } else if (
        listing.promotion_status === "posted" &&
        listing.posts_confirmed_at
      ) {
        const r = await unconfirmListingPostsAction(listing.mls_number);
        if (!r.ok) setError(r.error ?? "Unable to reset.");
      }
      // Posted via an auto-detected live post can't be reset from here — that
      // would mean deleting the post itself.
    });
  }

  const isPosted = listing.promotion_status === "posted";
  const isDismissed = listing.promotion_status === "dismissed";
  const showResetOption =
    isDismissed || (isPosted && !!listing.posts_confirmed_at);

  // Map the Recently Listed shape onto the shared milestone row shape. The
  // two fetchers return different interfaces for historical reasons; rather
  // than merge them (and churn four call sites), adapt here at the boundary.
  const milestone: ListingMilestone = {
    id: listing.id,
    mls_number: listing.mls_number,
    source_mls: listing.source_mls,
    status: listing.status,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    list_price: listing.list_price,
    display_price: listing.list_price,
    reference_date: listing.reference_date,
    reference_date_kind:
      listing.reference_date_kind === "listing_date"
        ? "listing_date"
        : "updated_at",
    hero_image_url: listing.hero_image_url,
    agent_name: listing.agent_name,
    office_short_code: listing.office_short_code,
    buyer_agent_name: null,
    alliance_role: "listing",
    first_seen_at: listing.first_seen_at,
    post_made: listing.post_made,
    post_auto_detected: listing.post_auto_detected,
    post_marked_at: listing.post_marked_at,
  };

  return (
    <div className={isPending ? "opacity-70" : undefined}>
      <MilestoneListingRow
        listing={milestone}
        eyebrowPrefix={referenceLabel}
        isFirst={isFirst}
        postType="just_listed"
        dimmed={isDismissed}
        ribbon={<ListingStatusRibbon status={listing.promotion_status} size="sm" />}
        metaSuffix={
          <div style={{ marginTop: 4 }}>
            <button
              type="button"
              onClick={handleCopyMls}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[11px] font-mono text-neutral-700 hover:bg-neutral-100 transition-colors"
              title="Copy this hashtag and paste it into your IG/TT/FB caption — the auto-linker will pick it up."
            >
              <span className="truncate max-w-[140px]">
                {listing.mls_hashtag}
              </span>
              <span className="text-[9px] uppercase tracking-wide font-semibold text-neutral-500">
                {copyState === "copied" ? "✓" : "copy"}
              </span>
            </button>
          </div>
        }
        trailingAction={
          <div className="flex flex-col items-end gap-1">
            {/* AutoReel — the reel path for listings that don't get a live
                video. Opens the prep sheet (copy chips + popup launcher +
                finished-video import). 2026-08-05. */}
            <AutoReelLaunchButton
              variant="row"
              listing={{
                mls_number: listing.mls_number,
                source_mls: listing.source_mls,
                address: listing.address,
                city: listing.city,
                state: listing.state,
                list_price: listing.list_price,
                hero_image_url: listing.hero_image_url,
              }}
            />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More actions"
              title="More actions: dismiss or reset"
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
        }
      />
      {error ? (
        <p className="text-[10px] text-red-700 pb-2">{error}</p>
      ) : null}
    </div>
  );
}

function KebabGlyph() {
  // why: three-dot "more" glyph — standard pattern for secondary action
  // menus. The vertical orientation reads as "in-row context menu" without
  // competing with the gold CTA next to it.
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3.5 h-3.5"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="8" cy="3.5" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.5" r="1.3" />
    </svg>
  );
}
