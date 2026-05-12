"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";

interface ListingsFilterChipsProps {
  current: "needs_only" | "all";
}

/**
 * Two-button chip selector for the Recent Listings strip on the dashboard:
 * "Needs attention" (default) | "All".
 *
 * Updates ?listings= while preserving every other URL param the user is
 * already on (range, office, view). Empty token == default == drop the
 * param entirely so the URL stays clean.
 */
export default function ListingsFilterChips({
  current,
}: ListingsFilterChipsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setFilter(token: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (token) {
      params.set("listings", token);
    } else {
      params.delete("listings");
    }
    const qs = params.toString();
    // Preserve scroll — chip switches shouldn't snap to top.
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  }

  return (
    <div
      role="group"
      aria-label="Listings filter"
      className="inline-flex items-center rounded-md bg-white p-0.5 ring-1 ring-neutral-200"
    >
      <Chip
        active={current === "needs_only"}
        onClick={() => setFilter("")}
        label="Needs attention"
      />
      <Chip
        active={current === "all"}
        onClick={() => setFilter("all")}
        label="All"
      />
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 text-[11px] font-medium rounded transition",
        active
          ? "bg-neutral-900 text-white"
          : "text-neutral-600 hover:text-neutral-900",
      )}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
