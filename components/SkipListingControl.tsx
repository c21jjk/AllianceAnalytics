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
 * Reasons open INLINE rather than in a floating menu, matching the fix made
 * to the Recently Listed kebab on 2026-08-05: a popover here rendered over the
 * section below it.
 */

export type SkipPostType =
  | "just_listed"
  | "under_contract"
  | "just_sold"
  | "price_reduction";

const REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "low_price", label: "Low price point" },
  { value: "condition", label: "Property condition" },
  { value: "owner_request", label: "Owner request" },
  { value: "other", label: "Other..." },
];

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
  const [open, setOpen] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [otherReason, setOtherReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSkip(reason: string) {
    setError(null);
    setOpen(false);
    setShowOther(false);
    startTransition(async () => {
      const res = await setListingSkipAction(mlsNumber, postType, reason);
      if (!res.ok) setError(res.error ?? "Unable to skip.");
    });
  }

  function handleUndo() {
    setError(null);
    startTransition(async () => {
      const res = await clearListingSkipAction(mlsNumber, postType);
      if (!res.ok) setError(res.error ?? "Unable to undo.");
    });
  }

  if (skippedAt) {
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
        Undo skip
      </button>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        disabled={isPending}
        title={error ?? "Not worth a post? Skip it and say why."}
        className={clsx(
          "text-[10.5px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2 disabled:opacity-50 text-left",
          error && "text-red-700",
        )}
      >
        Skip this listing
      </button>

      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-2">
          <span className="text-[9.5px] font-bold uppercase tracking-wider text-neutral-500">
            Skip because
          </span>
          {REASON_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={isPending}
              onClick={() => {
                if (opt.value === "other") setShowOther(true);
                else handleSkip(opt.value);
              }}
              className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] text-neutral-700 hover:border-neutral-900 hover:bg-neutral-900 hover:text-white transition-colors disabled:opacity-50"
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setShowOther(false);
              setOtherReason("");
            }}
            className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-700"
          >
            Cancel
          </button>
          {showOther ? (
            <div className="mt-1 flex w-full items-center gap-1.5">
              <input
                type="text"
                autoFocus
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                placeholder="Reason..."
                maxLength={200}
                className="flex-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
              />
              <button
                type="button"
                onClick={() => handleSkip(otherReason.trim() || "other")}
                className="rounded bg-neutral-900 px-2 py-1 text-[10px] font-semibold text-white hover:bg-neutral-800"
              >
                Confirm
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
