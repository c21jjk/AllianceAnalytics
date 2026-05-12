"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface Props {
  /** Distinct normalized office labels (already alpha-sorted by the server). */
  options: string[];
  /** Currently active filter value, or null when "All offices". */
  value: string | null;
}

/**
 * Office filter chip strip on /properties. Same pattern as the dashboard's
 * <OfficeFilterChips />. Respects the `?office=` URL param.
 */
export default function PropertyOfficeFilter({ options, value }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setOffice(next: string | null) {
    const url = new URLSearchParams(params.toString());
    if (next) url.set("office", next);
    else url.delete("office");
    startTransition(() => {
      const qs = url.toString();
      // Preserve scroll so office filter doesn't snap back to top of list.
      router.push(qs ? `/properties?${qs}` : "/properties", {
        scroll: false,
      });
    });
  }

  return (
    <div
      className={clsx(
        "flex items-center gap-1.5 flex-wrap",
        isPending && "opacity-60",
      )}
      aria-label="Filter by listing office"
    >
      <Chip
        label="All offices"
        active={value === null}
        onClick={() => setOffice(null)}
      />
      {options.map((office) => (
        <Chip
          key={office}
          label={office}
          active={value === office}
          onClick={() => setOffice(office)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors",
        active
          ? "bg-neutral-900 text-white ring-neutral-900"
          : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50",
      )}
    >
      {label}
    </button>
  );
}
