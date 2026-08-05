"use client";

import clsx from "clsx";
import { useState, useTransition } from "react";
import { setListingPostMarkAction } from "@/app/(app)/listings/actions";

/**
 * Deliberately duplicated from lib/data/listing-post-marks.ts rather than
 * imported: that module is "server-only" and this is a client component, so
 * pulling the type across would drag the server module into the client bundle
 * and fail the build. Keep the two unions in sync.
 */
export type MilestonePostType =
  | "just_listed"
  | "under_contract"
  | "just_sold"
  | "price_reduction"
  | "open_house";

interface PostedCheckboxProps {
  mlsNumber: string;
  postType: MilestonePostType;
  /** Current state — true when a post of this type exists or was ticked. */
  checked: boolean;
  /**
   * True when `checked` came from a published post rather than a manual tick.
   * The control renders locked: you can't untick a post that demonstrably
   * went out, and the tooltip explains why.
   */
  autoDetected?: boolean;
  className?: string;
}

const LABEL: Record<MilestonePostType, string> = {
  just_listed: "Just Listed",
  under_contract: "Under Contract",
  just_sold: "Just Sold",
  price_reduction: "Price Change",
  open_house: "Open House",
};

/**
 * 2026-08-05 (John): "each should have a Build Post tab and a simple checkbox
 * if a post for that property has been created. Just want to simplify the
 * process."
 *
 * One checkbox per milestone row, shared by all four dashboard sections. It
 * replaces the three per-platform chips that used to live only on the Just
 * Listed card — Larissa no longer tracks FB / IG / TT separately here, just
 * "did this property get its post or not".
 *
 * Optimistic: flips locally on click and reconciles when the server action
 * returns, so the row never feels laggy on a slow connection.
 */
export default function PostedCheckbox({
  mlsNumber,
  postType,
  checked,
  autoDetected = false,
  className,
}: PostedCheckboxProps) {
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = optimistic ?? checked;
  const locked = autoDetected;

  function handleToggle() {
    if (locked || isPending) return;
    const next = !value;
    setOptimistic(next);
    setError(null);
    startTransition(async () => {
      const result = await setListingPostMarkAction(mlsNumber, postType, next);
      if (!result.ok) {
        setOptimistic(null);
        setError(result.error ?? "Unable to update.");
      } else {
        // Let the revalidated server value take over on the next render.
        setOptimistic(null);
      }
    });
  }

  const title = locked
    ? `A ${LABEL[postType]} post for this property is already published, so this can't be unchecked.`
    : value
      ? `Marked as posted. Click to clear.`
      : `Tick once a ${LABEL[postType]} post has been made for this property.`;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={value}
      aria-label={`${LABEL[postType]} post made`}
      disabled={locked || isPending}
      onClick={(e) => {
        // Milestone rows sit inside a link to the property; don't navigate.
        e.preventDefault();
        e.stopPropagation();
        handleToggle();
      }}
      title={error ?? title}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors",
        "border",
        value
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
        locked && "cursor-default opacity-90",
        isPending && "opacity-60",
        error && "border-red-300 bg-red-50 text-red-700",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "grid place-items-center w-3.5 h-3.5 rounded-[3px] border shrink-0",
          value
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-neutral-300 bg-white",
        )}
      >
        {value ? <CheckGlyph /> : null}
      </span>
      Posted
      {locked ? (
        <span
          aria-hidden="true"
          className="text-[9px] uppercase tracking-wide text-emerald-600"
        >
          auto
        </span>
      ) : null}
    </button>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={10}
      height={10}
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
