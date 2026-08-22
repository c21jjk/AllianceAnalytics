"use client";

import { useState, useTransition } from "react";
import { unconfirmListingPostsAction } from "@/app/(app)/listings/actions";
import {
  clearListingSkipAction,
  setListingSkipAction,
} from "@/app/(app)/listings/skip-actions";
import MilestoneListingRow from "@/components/MilestoneListingRow";
import ListingStatusRibbon from "@/components/ListingStatusRibbon";
import type { ListingNeedingPosts } from "@/lib/data/listings-needing-posts";
import type { ListingMilestone } from "@/lib/data/recently-sold";

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

  // 2026-08-22 (John) — "make sure it removed the property once clicked...
  // nothing seems to happen." Skip used to open a second step (a "Skip
  // because" reason strip) before anything was written, and no skip was
  // ever completed. It is now ONE CLICK: write the just_listed skip mark
  // immediately (same per-milestone model every other card uses), no
  // reason prompt. The row leaves the Needs-attention tab on the resulting
  // revalidation; the All tab shows it with the dismissed ribbon + Undo.
  function handleSkip() {
    setError(null);
    startTransition(async () => {
      const result = await setListingSkipAction(
        listing.mls_number,
        "just_listed",
        null,
      );
      if (!result.ok) {
        setError(result.error ?? "Unable to skip.");
      }
    });
  }

  function handleReset() {
    setError(null);
    startTransition(async () => {
      // Clear whichever flag applies; idempotent server-side.
      if (listing.promotion_status === "dismissed") {
        // clearListingSkipAction removes the just_listed skip mark AND the
        // legacy property-wide dismissal, so it undoes both the new
        // one-click skips and anything dismissed under the old flow.
        const r = await clearListingSkipAction(
          listing.mls_number,
          "just_listed",
        );
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
    post_posted_at: listing.post_posted_at,
    post_posted_by: listing.post_posted_by,
    post_created_by: listing.post_created_by,
    post_marked_by: listing.post_marked_by,
    // 2026-08-07 — must be carried across explicitly: this adapter is written
    // by hand, so a new ListingMilestone field silently arrives as undefined
    // unless it's listed here.
    notes: listing.notes,
    skipped_at: listing.skipped_at,
    skip_reason: listing.skip_reason,
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
          <>
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

            {/* 2026-08-22 — the inline "Skip because" reason strip that
                rendered here is gone; skip is one click now (see handleSkip). */}
          </>
        }
        trailingAction={
          showResetOption ? (
            <button
              type="button"
              onClick={handleReset}
              disabled={isPending}
              className="text-[10.5px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2 disabled:opacity-50 text-left"
            >
              Undo
            </button>
          ) : !isDismissed ? (
            <button
              type="button"
              onClick={handleSkip}
              disabled={isPending}
              className="text-[10.5px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2 disabled:opacity-50 text-left"
              title="Not worth a post? One click removes it from this card."
            >
              Skip this listing
            </button>
          ) : null
        }
      />
      {error ? (
        <p className="text-[10px] text-red-700 pb-2">{error}</p>
      ) : null}
    </div>
  );
}
