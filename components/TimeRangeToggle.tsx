"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface TimeRangeToggleProps {
  /** Current selected range in days. */
  value: number;
  className?: string;
}

interface RangeOption {
  /** Token written to ?range= — number string, "1y", or "ytd". */
  token: string;
  /** Length of the window in days, used by parent component for queries. */
  days: number;
  /** Visible label inside the dropdown. */
  label: string;
  /** Short label shown on the closed button. */
  shortLabel: string;
}

/** Days from Jan 1 of the current calendar year through today, inclusive. */
function ytdDays(now: Date = new Date()): number {
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const diffMs = now.getTime() - startOfYear.getTime();
  return Math.max(1, Math.ceil(diffMs / 86_400_000));
}

const FIXED_OPTIONS: Array<{
  days: number;
  label: string;
  shortLabel: string;
}> = [
  { days: 7, label: "Last 7 days", shortLabel: "7d" },
  { days: 14, label: "Last 14 days", shortLabel: "14d" },
  { days: 30, label: "Last 30 days", shortLabel: "30d" },
  { days: 90, label: "Last 90 days", shortLabel: "90d" },
  { days: 365, label: "Last 12 months", shortLabel: "12mo" },
];

/**
 * Time-range selector for the dashboard. Renders as a single dropdown button
 * (replaced the segmented chip in May 2026 to make room for the 12-month
 * window without crowding the header on tablet widths).
 *
 * Tokens written to ?range= are:
 *   - "7" | "14" | "30" | "90"  — fixed rolling windows
 *   - "1y"                       — rolling 365 days
 *   - "ytd"                      — Jan 1 of the current year through today
 *
 * The active token is matched on numeric `value`: YTD wins when value
 * equals the computed YTD day count, otherwise the matching fixed window.
 * Parent server component is responsible for parsing the token (see
 * parseRange in app/(app)/page.tsx).
 */
export default function TimeRangeToggle({
  value,
  className,
}: TimeRangeToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const ytd = ytdDays();
  const options: RangeOption[] = [
    ...FIXED_OPTIONS.map((o) => ({
      token: o.days === 365 ? "1y" : String(o.days),
      ...o,
    })),
    { token: "ytd", days: ytd, label: "Year to date", shortLabel: "YTD" },
  ];

  // Determine which option is active. YTD is preferred when its day count
  // matches `value`, since 365 and YTD might collide on Dec 31 of leap years.
  const active = (() => {
    if (value === ytd) {
      const ytdMatch = options.find((o) => o.token === "ytd");
      if (ytdMatch) return ytdMatch;
    }
    return options.find((o) => o.days === value) ?? options[2]; // fall back to 30d
  })();

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Outside-click + ESC close.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function setRange(token: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("range", token);
    // Preserve scroll so time-range changes don't snap back to top.
    router.push(`/?${params.toString()}`, { scroll: false });
    setOpen(false);
  }

  return (
    <div className={clsx("relative inline-block", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5",
          "text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 shadow-card",
          "hover:ring-neutral-300 hover:text-neutral-900 transition",
          "focus:outline-none focus:ring-2 focus:ring-gold-500",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Time range"
      >
        <svg
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-neutral-500"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span>{active.label}</span>
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={clsx("transition-transform", open && "rotate-180")}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Select time range"
          className={clsx(
            "absolute right-0 mt-1.5 z-30 w-44 rounded-lg bg-white py-1",
            "ring-1 ring-neutral-200 shadow-elevated",
            "animate-fade-in-up",
          )}
        >
          {options.map((opt) => {
            const isActive = opt.token === active.token;
            return (
              <button
                key={opt.token}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => setRange(opt.token)}
                className={clsx(
                  "w-full flex items-center justify-between gap-2 px-3 py-1.5",
                  "text-xs text-left transition",
                  isActive
                    ? "bg-gold-50 text-neutral-900 font-medium"
                    : "text-neutral-700 hover:bg-neutral-50",
                )}
              >
                <span>{opt.label}</span>
                <span className="text-[10px] tabular-nums text-neutral-400">
                  {opt.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
