"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";

interface TimeRangeToggleProps {
  /** Current selected range in days. */
  value: number;
  className?: string;
}

const OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
];

/**
 * Three-button segmented toggle that updates the ?range= query param on
 * the homepage. Server component above re-renders on the new URL.
 */
export default function TimeRangeToggle({
  value,
  className,
}: TimeRangeToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setRange(days: number) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("range", String(days));
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
      {OPTIONS.map((opt) => {
        const active = opt.days === value;
        return (
          <button
            key={opt.days}
            type="button"
            onClick={() => setRange(opt.days)}
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
