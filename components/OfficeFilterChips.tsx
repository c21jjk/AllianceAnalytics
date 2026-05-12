"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";

export interface OfficeChip {
  short_code: string;
  name: string;
}

interface Props {
  /** All offices available for filtering. */
  options: OfficeChip[];
  /** Currently selected short_code, or null for "All offices". */
  value: string | null;
  className?: string;
}

/**
 * Pill row that updates the homepage's `?office=` query param. Server
 * component above re-renders against the new URL and re-applies the
 * office filter inside getGroupsLastNDays.
 */
export default function OfficeFilterChips({ options, value, className }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setOffice(short_code: string | null) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (short_code) {
      params.set("office", short_code);
    } else {
      params.delete("office");
    }
    const qs = params.toString();
    // Preserve scroll — office filter shouldn't snap back to top.
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  }

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-1.5",
        className,
      )}
      role="group"
      aria-label="Office filter"
    >
      <Pill active={value === null} onClick={() => setOffice(null)}>
        All offices
      </Pill>
      {options.map((opt) => (
        <Pill
          key={opt.short_code}
          active={value === opt.short_code}
          onClick={() => setOffice(opt.short_code)}
        >
          {opt.name}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full px-3 py-1 text-xs font-medium ring-1 transition",
        active
          ? "bg-neutral-900 text-white ring-neutral-900"
          : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
