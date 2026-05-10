"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";

interface TimeRangeToggleProps {
  /** Current selected range in days. */
  value: number;
  className?: string;
}

interface RangeOption {
  /** Token written to ?range= — number string, or "ytd". */
  token: string;
  /** Length of the window in days, used by parent component for queries. */
  days: number;
  /** Visible label. */
  label: string;
}

/** Days from Jan 1 of the current calendar year through today, inclusive. */
function ytdDays(now: Date = new Date()): number {
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const diffMs = now.getTime() - startOfYear.getTime();
  return Math.max(1, Math.ceil(diffMs / 86_400_000));
}

const FIXED_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

/**
 * Segmented toggle that updates the ?range= query param. Tokens written to
 * the URL are either the day count ("7", "30", "90") or "ytd". The parent
 * server component is responsible for parsing the token back into a day
 * count. The active button is highlighted by matching numeric `value` —
 * YTD is matched when value equals the computed YTD day count.
 */
export default function TimeRangeToggle({
  value,
  className,
}: TimeRangeToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const ytd = ytdDays();
  const options: RangeOption[] = [
    ...FIXED_OPTIONS.map((o) => ({ token: String(o.days), ...o })),
    { token: "ytd", days: ytd, label: "YTD" },
  ];

  function setRange(token: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("range", token);
    router.push(`/?${params.toString()}`);
  }

  return (
    <div
      className={clsx(
        "inline-flex items-center rounded-lg bg-neutral-100 p-0.5 ring-1 ring-neutral-200",
        className,
      )}
      role="group"
      aria-label="Time range"
    >
      {options.map((opt) => {
        const active = opt.days === value;
        return (
          <button
            key={opt.token}
            type="button"
            onClick={() => setRange(opt.token)}
            className={clsx(
              "px-3 py-1 text-xs font-medium rounded-md transition",
              active
                ? "bg-white text-neutral-900 shadow-card"
                : "text-neutral-600 hover:text-neutral-900",
            )}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
