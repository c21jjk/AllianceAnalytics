"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import clsx from "clsx";

export type DashboardView = "grouped" | "list";

interface DashboardViewToggleProps {
  value: DashboardView;
}

/**
 * Two-state toggle on the dashboard header: Grouped (campaign cards rolled
 * up across platforms) vs List (one row per post). State lives in the URL
 * (?view=grouped|list); other URL params (range, office, filters) are
 * preserved so changing view doesn't drop the user's filter context.
 */
export default function DashboardViewToggle({ value }: DashboardViewToggleProps) {
  const router = useRouter();
  const search = useSearchParams();
  const pathname = usePathname();

  function setView(next: DashboardView) {
    if (next === value) return;
    const params = new URLSearchParams(search.toString());
    if (next === "grouped") {
      params.delete("view"); // grouped is default — clean URL
    } else {
      params.set("view", next);
    }
    const qs = params.toString();
    // Preserve scroll — view toggles shouldn't snap back to top.
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex rounded-lg bg-neutral-100 p-0.5 ring-1 ring-neutral-200"
    >
      <button
        type="button"
        onClick={() => setView("grouped")}
        className={clsx(
          "px-2.5 py-1 text-xs font-medium rounded-md transition",
          value === "grouped"
            ? "bg-white text-neutral-900 shadow-sm"
            : "text-neutral-600 hover:text-neutral-900",
        )}
        aria-pressed={value === "grouped"}
      >
        <span className="inline-flex items-center gap-1.5">
          <GroupedIcon />
          Grouped
        </span>
      </button>
      <button
        type="button"
        onClick={() => setView("list")}
        className={clsx(
          "px-2.5 py-1 text-xs font-medium rounded-md transition",
          value === "list"
            ? "bg-white text-neutral-900 shadow-sm"
            : "text-neutral-600 hover:text-neutral-900",
        )}
        aria-pressed={value === "list"}
      >
        <span className="inline-flex items-center gap-1.5">
          <ListIcon />
          List
        </span>
      </button>
    </div>
  );
}

function GroupedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4"
        width="18"
        height="6"
        rx="1.5"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <rect
        x="3"
        y="14"
        width="18"
        height="6"
        rx="1.5"
        stroke="currentColor"
        strokeWidth={1.6}
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6h16M4 12h16M4 18h10"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
