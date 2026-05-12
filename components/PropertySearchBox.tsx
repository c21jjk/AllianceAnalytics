"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * URL-backed search box for the /properties index. Filters in-memory on
 * MLS / address / city / agent. ~21 listings today so client-side debounced
 * URL updates are fine; if inventory grows past ~500 we'll move filtering
 * to the data fetcher.
 *
 * - Debounce: 250ms keystroke → URL update
 * - scroll: false keeps the user anchored to whatever row they were near
 * - "recent" / empty value strips the param for clean URLs
 * - Esc clears the field and the URL param
 */
export default function PropertySearchBox({
  initialValue = "",
}: {
  initialValue?: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const pathname = usePathname();

  const [value, setValue] = useState(initialValue);
  const lastPushed = useRef<string>(initialValue);
  const timer = useRef<number | null>(null);

  // Keep the input in sync if the URL is mutated elsewhere (back/forward, etc.)
  useEffect(() => {
    const next = search.get("q") ?? "";
    if (next !== value && next !== lastPushed.current) {
      setValue(next);
      lastPushed.current = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function pushNow(next: string) {
    if (next === lastPushed.current) return;
    lastPushed.current = next;
    const params = new URLSearchParams(search.toString());
    if (next.trim().length === 0) {
      params.delete("q");
    } else {
      params.set("q", next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function handleChange(next: string) {
    setValue(next);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => pushNow(next), 250);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (timer.current !== null) window.clearTimeout(timer.current);
      setValue("");
      pushNow("");
    }
  }

  return (
    <div className="relative flex-1 min-w-[220px] max-w-xl">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
        aria-hidden="true"
      >
        <SearchIcon />
      </span>
      <input
        type="search"
        inputMode="search"
        placeholder="Search listings — MLS, address, city, or agent"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKey}
        aria-label="Search listings"
        className="w-full rounded-md border border-neutral-200 bg-white pl-9 pr-9 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-400"
      />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            if (timer.current !== null) window.clearTimeout(timer.current);
            setValue("");
            pushNow("");
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
        >
          <ClearIcon />
        </button>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );
}
