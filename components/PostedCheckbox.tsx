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
  /** When the manual tick happened, so the row can say "Posted Aug 5". */
  markedAt?: string | null;
  /**
   * 2026-08-19 (John) — "show who created and posted the post and when".
   * For auto-detected posts: publish timestamp + display names of who built
   * and who published (from generated_posts). For manual ticks: who ticked.
   * All optional — a post detected only from the synced feed has a date but
   * no names, and older marks predate the attribution columns.
   */
  postedAt?: string | null;
  postedBy?: string | null;
  createdBy?: string | null;
  markedBy?: string | null;
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
  markedAt = null,
  postedAt = null,
  postedBy = null,
  createdBy = null,
  markedBy = null,
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

  // 2026-08-19 — the locked tooltip carries the full story (builder,
  // publisher, exact time); the row itself stays a short one-liner.
  const title = locked
    ? `${describePublished(postType, postedAt, postedBy, createdBy)} This can't be unchecked.`
    : value
      ? markedBy
        ? `Marked as posted by ${markedBy}. Click to clear.`
        : `Marked as posted. Click to clear.`
      : `Tick once a ${LABEL[postType]} post has been made for this property.`;

  // 2026-08-05 (John): this used to render as an outlined "Posted" button,
  // which made it read as a third action sitting under the two Build buttons.
  // It is STATUS, not an action, so it is now a quiet inline line: an empty
  // box + "Not posted yet", flipping to a green check + "Posted Aug 5". Same
  // single click, far less visual weight.
  //
  // 2026-08-19 (John) — "show who created and posted the post and when".
  // The line now reads "Posted Aug 19 · Cheryl": date from the publish (or
  // the manual tick), name of whoever published (or ticked). Full detail —
  // builder vs publisher, exact time — lives in the tooltip.
  const stampDate = locked ? postedAt : markedAt;
  const stampName = locked ? postedBy : markedBy;
  const label = value
    ? `Posted${stampDate ? ` ${formatMarkDate(stampDate)}` : ""}${
        stampName ? ` · ${stampName}` : ""
      }`
    : "Not posted yet";

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
        "inline-flex items-center gap-1.5 py-0.5 text-[11px] font-medium transition-colors text-left",
        value ? "text-emerald-700" : "text-neutral-500 hover:text-neutral-800",
        locked && "cursor-default",
        isPending && "opacity-60",
        error && "text-red-700",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "grid place-items-center w-3.5 h-3.5 rounded-[3px] border shrink-0",
          value
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-neutral-300 bg-white",
        )}
      >
        {value ? <CheckGlyph /> : null}
      </span>
      {label}
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

/** "Aug 5" — pinned to Eastern per the standing render-path timezone rule. */
function formatMarkDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/** "Aug 19, 9:16 AM" — Eastern, for the locked tooltip's full detail. */
function formatMarkDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/**
 * Full attribution sentence for the locked tooltip:
 *   "Built by Larissa, published by Cheryl on Aug 19, 9:16 AM."
 * Collapses gracefully when names match or are unknown (feed-detected posts
 * have a date but no names; older rows may have neither).
 */
function describePublished(
  postType: MilestonePostType,
  postedAt: string | null,
  postedBy: string | null,
  createdBy: string | null,
): string {
  const when = postedAt ? ` on ${formatMarkDateTime(postedAt)}` : "";
  if (postedBy && createdBy && createdBy !== postedBy) {
    return `Built by ${createdBy}, published by ${postedBy}${when}.`;
  }
  if (postedBy) {
    return `${LABEL[postType]} post published by ${postedBy}${when}.`;
  }
  return `A ${LABEL[postType]} post for this property is already published${when}.`;
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
