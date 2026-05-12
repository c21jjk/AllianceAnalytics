"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { refreshCoachInsightsAction } from "@/app/(app)/coach/actions";
import { formatRelativeTime } from "@/lib/format";

interface CoachRefreshButtonProps {
  generatedAt: string | null;
  isAdmin: boolean;
  className?: string;
}

/**
 * Admin-only "Refresh insights" button for the /coach page. Triggers a
 * one-shot Claude regeneration of the Spend Recommendations + Per-listing
 * Budgets surfaces, replacing the cached values in coach_insights. Daily
 * pg_cron handles the regular refresh; this is the on-demand path.
 *
 * Non-admins see a passive "Last refreshed" label without the button.
 */
export default function CoachRefreshButton({
  generatedAt,
  isAdmin,
  className,
}: CoachRefreshButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: "idle" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function handleClick() {
    if (isPending) return;
    setFeedback({ kind: "idle" });
    startTransition(async () => {
      const result = await refreshCoachInsightsAction("brand_wide");
      if (result.ok) {
        setFeedback({
          kind: "success",
          message: `Generated ${result.recommendations_count ?? 0} recommendations and ${result.budgets_count ?? 0} budgets.`,
        });
      } else {
        setFeedback({
          kind: "error",
          message: result.error ?? "Refresh failed.",
        });
      }
      setTimeout(() => setFeedback({ kind: "idle" }), 4000);
    });
  }

  const lastLabel = generatedAt
    ? `Last refreshed ${formatRelativeTime(generatedAt)}`
    : "Not refreshed yet";

  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <span className="text-[11px] text-neutral-500">{lastLabel}</span>
      {isAdmin ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          title="Regenerate Spend Recommendations + Per-listing Budgets via Claude"
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-medium transition-colors",
            isPending
              ? "bg-neutral-100 text-neutral-400 cursor-not-allowed"
              : "bg-white text-neutral-700 hover:border-gold-300 hover:text-neutral-900",
          )}
        >
          {isPending ? (
            <Spinner />
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          )}
          {isPending ? "Refreshing…" : "Refresh insights"}
        </button>
      ) : null}
      {feedback.kind === "success" ? (
        <span className="text-[11px] text-emerald-700">{feedback.message}</span>
      ) : null}
      {feedback.kind === "error" ? (
        <span className="text-[11px] text-rose-700">{feedback.message}</span>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3 animate-spin"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={2}
        strokeOpacity={0.25}
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
