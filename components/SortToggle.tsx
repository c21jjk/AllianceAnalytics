"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import clsx from "clsx";

export type SortMode = "recent" | "activity";

interface SortToggleProps {
  value: SortMode;
}

/**
 * Tab-style sort selector that sits directly above the post stream, with a
 * baseline rule that the active tab's gold underline interrupts. The whole
 * section is separated from the Listings strip above by a top divider — so
 * the dashboard reads as two distinct zones: "Listings to action" up top,
 * "Posts to review" below.
 *
 * - "recent"   — posted_date DESC, id tie-break
 * - "activity" — total reach DESC, posted_date tie-break
 *
 * State persists in the URL (`?sort=activity`) so deep-links keep the
 * user's chosen order. `recent` is stripped from the URL for cleanliness,
 * matching the DashboardViewToggle convention.
 */
export default function SortToggle({ value }: SortToggleProps) {
  const router = useRouter();
  const search = useSearchParams();
  const pathname = usePathname();

  function setSort(next: SortMode) {
    if (next === value) return;
    const params = new URLSearchParams(search.toString());
    if (next === "recent") {
      params.delete("sort");
    } else {
      params.set("sort", next);
    }
    const qs = params.toString();
    // scroll: false — preserve the user's scroll position so toggling
    // sort doesn't snap back to the top of the dashboard.
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
      role="tablist"
      aria-label="Sort order"
      className="flex items-center gap-0 border-b border-neutral-200"
    >
      <TabButton
        active={value === "recent"}
        onClick={() => setSort("recent")}
        icon={<ClockIcon />}
        label="Most recent"
      />
      <TabButton
        active={value === "activity"}
        onClick={() => setSort("activity")}
        icon={<ReachIcon />}
        label="Most activity"
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        "relative inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors",
        active
          ? "border-gold-500 text-neutral-900"
          : "border-transparent text-neutral-500 hover:text-neutral-800",
      )}
    >
      <span className={active ? "text-gold-600" : "text-neutral-400"}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <path
        d="M12 7.5v5l3 2"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReachIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 18l5-7 4 4 7-9"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 6h6v6"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
