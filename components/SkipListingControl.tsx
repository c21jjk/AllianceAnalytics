"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import {
  clearListingSkipAction,
  setListingSkipAction,
} from "@/app/(app)/listings/skip-actions";

/**
 * 2026-08-07 (John): "also add skip control to all statuses (except open
 * houses)."
 *
 * Until now only Recently Listed had a way to say "not worth a post". That
 * became load-bearing the moment the dashboard started PINNING unhandled rows
 * past the 7-day window: without a skip, a listing nobody intends to promote
 * would sit on the card forever. This is the release valve.
 *
 * Open House is deliberately excluded. Those rows expire on their own 6 hours
 * after the event starts, so a skip would be a control with nothing to do.
 *
 * 2026-08-22 (John): "double check the skip this listing functionality to
 * make sure it removed the property once clicked... When I click it, nothing
 * seems to happen." The click used to open a second step — a "Skip because"
 * reason strip — before anything was written, and in a year of the control
 * existing not one skip was ever completed (listing_skip_marks was empty).
 * Skip is now ONE CLICK: the mark is written immediately with no reason,
 * the control flips to "Undo skip", and the row leaves the card per the
 * 7-day rule. The reason column stays in the schema (the settings review
 * page tolerates null) — only the blocking prompt is gone.
 */

export type SkipPostType =
  | "just_listed"
  | "under_contract"
  | "just_sold"
  | "price_reduction";

interface SkipListingControlProps {
  mlsNumber: string;
  postType: SkipPostType;
  /** When set, the listing is already skipped and this control offers undo. */
  skippedAt: string | null;
  className?: string;
}

export default function SkipListingControl({
  mlsNumber,
  postType,
  skippedAt,
  className,
}: SkipListingControlProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic: flip to the skipped state the moment the click lands so the
  // control never looks inert while the server round trip runs. Reconciled
  // by the revalidated server value on the next render.
  const [optimisticSkipped, setOptimisticSkipped] = useState<boolean | null>(
    null,
  );

  const showSkipped = optimisticSkipped ?? skippedAt !== null;

  function handleSkip() {
    setError(null);
    setOptimisticSkipped(true);
    startTransition(async () => {
      const res = await setListingSkipAction(mlsNumber, postType, null);
      if (!res.ok) {
        setOptimisticSkipped(null);
        setError(res.error ?? "Unable to skip.");
      }
    });
  }

  function handleUndo() {
    setError(null);
    setOptimisticSkipped(false);
    startTransition(async () => {
      const res = await clearListingSkipAction(mlsNumber, postType);
      if (!res.ok) {
        setOptimisticSkipped(null);
        setError(res.error ?? "Unable to undo.");
      }
    });
  }

  if (showSkipped) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleUndo();
        }}
        disabled={isPending}
        title={error ?? "This listing was skipped. Click to put it back."}
        className={clsx(
          "text-[10.5px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2 disabled:opacity-50 text-left",
          error && "text-red-700",
          className,
        )}
      >
        Skipped · Undo
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSkip();
      }}
      disabled={isPending}
      title={error ?? "Not worth a post? One click removes it from this card."}
      className={clsx(
        "text-[10.5px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2 disabled:opacity-50 text-left",
        error && "text-red-700",
        className,
      )}
    >
      Skip this listing
    </button>
  );
}
