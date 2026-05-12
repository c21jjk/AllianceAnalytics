"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { PropertySortKey } from "@/lib/data/properties-db";

const OPTIONS: Array<{ value: PropertySortKey; label: string }> = [
  { value: "newest", label: "Newest listed" },
  { value: "oldest", label: "Oldest listed" },
  { value: "price_desc", label: "Price (high → low)" },
  { value: "price_asc", label: "Price (low → high)" },
  { value: "office_asc", label: "Office (A → Z)" },
  { value: "dom_desc", label: "Days on market (longest first)" },
];

interface Props {
  value: PropertySortKey;
}

/**
 * Sort dropdown for /properties. Drives the `?sort=` URL param so the
 * preference survives reload, sharing, and back-button navigation.
 */
export default function PropertySortDropdown({ value }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(next: string) {
    const url = new URLSearchParams(params.toString());
    if (next === "newest") url.delete("sort");
    else url.set("sort", next);
    startTransition(() => {
      const qs = url.toString();
      // Preserve scroll so sort changes don't jump back to top of list.
      router.push(qs ? `/properties?${qs}` : "/properties", {
        scroll: false,
      });
    });
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-neutral-600">
      <span className="font-medium uppercase tracking-wide text-neutral-500">
        Sort
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={isPending}
        className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-800 focus:outline-none focus:ring-2 focus:ring-gold-500/40 disabled:opacity-50"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
