import clsx from "clsx";
import type { TrendNote } from "@/lib/types/strategy";
import PlatformBadge from "./PlatformBadge";

/**
 * Magnitude in our data is a multiplier:
 *   2.4 → +140% (a 2.4x relationship)
 *   0.69 → -31%
 *   1.0 → flat
 * Render relative-change so the number matches its colored direction icon.
 */
function formatMagnitudeChange(magnitude: number): string {
  if (magnitude >= 1) {
    return `+${Math.round((magnitude - 1) * 100)}%`;
  }
  return `-${Math.round((1 - magnitude) * 100)}%`;
}

interface TrendNoteListProps {
  notes: TrendNote[];
  className?: string;
}

/**
 * Renders an array of TrendNote as a stacked list.
 *
 * Each note shows:
 * - Direction icon (up/down/watch with colored accents)
 * - Headline and detail
 * - Optional platform badges
 * - Optional magnitude badge (e.g. "+40%")
 *
 * Wrapped in a regular card (not AI-tinted) with "Trend watch" title and subtle sparkle.
 */
export default function TrendNoteList({
  notes,
  className,
}: TrendNoteListProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 bg-white",
        "shadow-card",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-5 pt-5 pb-4 border-b border-neutral-200">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-lg bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200">
          <SparkleIcon />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-600">
          Trend watch
        </span>
      </div>

      {/* Notes list */}
      <div className="divide-y divide-neutral-200">
        {notes.map((note, idx) => (
          <div key={note.id} className="p-4 flex gap-3">
            {/* Direction icon */}
            <div className="shrink-0 mt-0.5">
              <DirectionIcon direction={note.direction} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Headline + magnitude */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="font-medium text-neutral-900 leading-snug">
                  {note.headline}
                </h4>
                {note.magnitude !== undefined ? (
                  <span
                    className={clsx(
                      "shrink-0 inline-flex items-center rounded-md ring-1 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-right",
                      note.direction === "up"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                        : note.direction === "down"
                        ? "bg-rose-50 text-rose-700 ring-rose-100"
                        : "bg-amber-50 text-amber-700 ring-amber-100",
                    )}
                  >
                    {formatMagnitudeChange(note.magnitude)}
                  </span>
                ) : null}
              </div>

              {/* Detail */}
              <p className="text-sm text-neutral-600 leading-relaxed mb-2">
                {note.detail}
              </p>

              {/* Platforms and other metadata */}
              {note.platforms && note.platforms.length > 0 ? (
                <div className="flex items-center gap-2 pt-1">
                  {note.platforms.map((platform) => (
                    <PlatformBadge
                      key={platform}
                      platform={platform}
                      size="sm"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {notes.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-neutral-500">
          No trend notes available
        </div>
      ) : null}
    </div>
  );
}

function DirectionIcon({
  direction,
}: {
  direction: "up" | "down" | "watch";
}) {
  const baseClasses = "w-5 h-5";

  switch (direction) {
    case "up":
      return (
        <svg
          viewBox="0 0 24 24"
          className={clsx(baseClasses, "text-emerald-600")}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 13l5-5 5 5M7 6v10a1 1 0 001 1h10a1 1 0 001-1V6"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "down":
      return (
        <svg
          viewBox="0 0 24 24"
          className={clsx(baseClasses, "text-rose-600")}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 11l5 5 5-5M7 18V8a1 1 0 011-1h10a1 1 0 011 1v10"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "watch":
      return (
        <svg
          viewBox="0 0 24 24"
          className={clsx(baseClasses, "text-amber-600")}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
            stroke="currentColor"
            strokeWidth={1.6}
          />
          <circle
            cx="12"
            cy="12"
            r="3"
            stroke="currentColor"
            strokeWidth={1.6}
          />
        </svg>
      );
  }
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" />
      <path
        d="M19 14l.7 1.8L21 16l-1.3.6L19 18l-.7-1.4L17 16l1.3-.5L19 14z"
        opacity="0.6"
      />
    </svg>
  );
}
