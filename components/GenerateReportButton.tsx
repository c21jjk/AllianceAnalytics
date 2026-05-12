"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { generateReportAction } from "@/app/(app)/properties/[mls]/actions";

interface GenerateReportButtonProps {
  mls: string;
  /**
   * Number of days since the newest post in the group. The button disables
   * itself when this is < 7. Pass null when the count is unknown (e.g., no posts).
   */
  newestPostAgeDays: number | null;
  /** Min age in days before the button enables. Defaults to 7. */
  minAgeDays?: number;
  /**
   * Visual size. "hero" is the unmissable pre-generation CTA inside the Owner
   * Report panel; "default" is the compact post-generation Regenerate.
   */
  size?: "default" | "hero";
  /** Override the visible label (e.g., "Regenerate report"). */
  label?: string;
  className?: string;
}

const DEFAULT_MIN_AGE = 7;

/**
 * Server-action-driven button. Runs generateReportAction, opens the resulting
 * flyer URL in a new tab, and copies the public link to the clipboard with a
 * brief "Link copied!" indicator.
 */
export default function GenerateReportButton({
  mls,
  newestPostAgeDays,
  minAgeDays = DEFAULT_MIN_AGE,
  size = "default",
  label,
  className,
}: GenerateReportButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: "idle" }
    | { kind: "copied" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const ageOk =
    newestPostAgeDays !== null && newestPostAgeDays >= minAgeDays;
  const noPosts = newestPostAgeDays === null;
  const disabled = isPending || !ageOk;

  const tooltip = noPosts
    ? "No posts attached to this property yet."
    : ageOk
      ? "Generate a fresh marketing report for the seller."
      : `Posts must be at least ${minAgeDays} days old (newest is ${newestPostAgeDays} ${newestPostAgeDays === 1 ? "day" : "days"} old).`;

  function clearFeedbackSoon() {
    setTimeout(() => setFeedback({ kind: "idle" }), 2400);
  }

  function handleClick() {
    if (disabled) return;
    setFeedback({ kind: "idle" });
    startTransition(async () => {
      try {
        const result = await generateReportAction(mls);
        if (!result.ok) {
          setFeedback({
            kind: "error",
            message: result.error ?? "Something went wrong.",
          });
          clearFeedbackSoon();
          return;
        }
        const flyerUrl = result.flyer_url ?? "";
        // Best-effort clipboard write — origin needed for a usable share link
        try {
          const fullUrl =
            typeof window !== "undefined"
              ? new URL(flyerUrl, window.location.origin).toString()
              : flyerUrl;
          await navigator.clipboard?.writeText(fullUrl);
          setFeedback({ kind: "copied" });
        } catch {
          setFeedback({ kind: "copied" });
        }
        // Open in a new tab so the admin can preview before sending
        if (typeof window !== "undefined" && flyerUrl) {
          window.open(flyerUrl, "_blank", "noopener,noreferrer");
        }
        clearFeedbackSoon();
      } catch (e) {
        setFeedback({
          kind: "error",
          message: e instanceof Error ? e.message : "Unexpected error.",
        });
        clearFeedbackSoon();
      }
    });
  }

  const isHero = size === "hero";
  const buttonLabel =
    label ?? (isHero ? "Generate Seller Report" : "Generate seller report");
  const feedbackTextClass = isHero ? "text-sm" : "text-[11px]";

  return (
    <div className={clsx("flex flex-col items-stretch gap-2", className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={tooltip}
        className={clsx(
          "inline-flex items-center justify-center gap-2 rounded-md transition-colors",
          isHero
            ? "px-6 py-4 text-base md:text-lg font-semibold shadow-md hover:shadow-lg"
            : "px-3 py-1.5 text-xs font-medium",
          disabled
            ? "bg-neutral-100 text-neutral-400 cursor-not-allowed"
            : "bg-gold-500 text-white hover:bg-gold-600",
        )}
        aria-busy={isPending || undefined}
      >
        {isPending ? <Spinner hero={isHero} /> : <SparkIcon hero={isHero} />}
        {isPending ? "Generating..." : buttonLabel}
      </button>
      {feedback.kind === "copied" ? (
        <span className={clsx("text-emerald-700", feedbackTextClass)}>
          Link copied to clipboard.
        </span>
      ) : null}
      {feedback.kind === "error" ? (
        <span className={clsx("text-red-700", feedbackTextClass)}>
          {feedback.message}
        </span>
      ) : null}
      {feedback.kind === "idle" && !ageOk && !noPosts ? (
        <span className={clsx("text-neutral-500", feedbackTextClass)}>
          Available in {minAgeDays - (newestPostAgeDays ?? 0)}{" "}
          {minAgeDays - (newestPostAgeDays ?? 0) === 1 ? "day" : "days"} —
          posts must be at least {minAgeDays} days old before generating.
        </span>
      ) : null}
      {feedback.kind === "idle" && noPosts ? (
        <span className={clsx("text-neutral-500", feedbackTextClass)}>
          No social posts linked to this listing yet — once a post syncs,
          this button will activate.
        </span>
      ) : null}
    </div>
  );
}

function SparkIcon({ hero = false }: { hero?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={hero ? "w-5 h-5" : "w-3.5 h-3.5"}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function Spinner({ hero = false }: { hero?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={clsx("animate-spin", hero ? "w-5 h-5" : "w-3.5 h-3.5")}
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
