"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { Platform } from "@/lib/types/post";
import PlatformBadge, { platformLabel } from "./PlatformBadge";
import { formatCompactNumber, formatShortDate } from "@/lib/format";

interface SearchResult {
  id: string;
  platform: Platform;
  posted_at: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  permalink: string | null;
  reach: number;
  engagements: number;
  listing: { mls_number: string; address: string | null } | null;
}

interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
}

const PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok"];

/**
 * Global post search lives in the top nav and stays visible across every
 * page. Cmd/Ctrl+K focuses it from anywhere. The dropdown opens once the
 * query has at least 2 chars, debounced ~220ms. Whole rows are <Link>s
 * pointing at /posts/[id] so the @modal intercept opens them in the drawer
 * instead of full-page navigating.
 *
 * No persistence — filters are purely in-memory for the session and are
 * encoded into the "See all" URL.
 */
export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [platformFilters, setPlatformFilters] = useState<Set<Platform>>(
    new Set(),
  );
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  const trimmed = query.trim();
  const hasFilters =
    platformFilters.size > 0 || Boolean(fromDate) || Boolean(toDate);

  // Debounced fetch. Mirrors the PropertyClassifyPanel pattern: clear the
  // existing timer on every keystroke, fire 220ms after the last edit.
  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      const params = new URLSearchParams();
      params.set("q", trimmed);
      params.set("limit", "10");
      // Repeated `platform` params — matches the API route's getAll("platform")
      // and the page.tsx normalizePlatformParam which accepts string[].
      for (const p of platformFilters) {
        params.append("platform", p);
      }
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      try {
        const res = await fetch(`/api/posts/search?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setResults([]);
          setTotalCount(0);
        } else {
          const json = (await res.json()) as Partial<SearchResponse>;
          setResults(json.results ?? []);
          setTotalCount(json.totalCount ?? 0);
        }
        setOpen(true);
      } catch {
        setResults([]);
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [trimmed, platformFilters, fromDate, toDate]);

  // Click-away closes the dropdown.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Global Cmd/Ctrl+K → focus the input. Escape → close + blur.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        if (
          document.activeElement === inputRef.current ||
          wrapperRef.current?.contains(document.activeElement)
        ) {
          setOpen(false);
          inputRef.current?.blur();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function togglePlatform(p: Platform) {
    setPlatformFilters((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function clearFilters() {
    setPlatformFilters(new Set());
    setFromDate("");
    setToDate("");
  }

  const seeAllHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("view", "list");
    if (trimmed) params.set("q", trimmed);
    // Repeated platform params so /?view=list reads them via the same
    // normalizePlatformParam path the API route uses.
    for (const p of platformFilters) {
      params.append("platform", p);
    }
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    return `/?${params.toString()}`;
  }, [trimmed, platformFilters, fromDate, toDate]);

  const showDropdown = open && trimmed.length >= 2;

  return (
    <div
      ref={wrapperRef}
      className="hidden md:block relative w-[320px] shrink-0"
    >
      <div className="relative">
        {/* Search icon prefix */}
        <span
          aria-hidden="true"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (trimmed.length >= 2) setOpen(true);
          }}
          placeholder="Search posts…"
          aria-label="Search posts"
          className={clsx(
            "w-full h-9 pl-8 pr-14 text-sm rounded-md",
            "border border-neutral-200 bg-white",
            "placeholder:text-neutral-400 text-neutral-900",
            "focus:outline-none focus:ring-2 focus:ring-gold-500/40 focus:border-gold-500",
          )}
        />

        {/* ⌘K hint on the right */}
        <span
          aria-hidden="true"
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-[10px] font-medium text-neutral-400 px-1.5 py-0.5 rounded border border-neutral-200 bg-neutral-50"
        >
          <kbd className="font-sans">⌘</kbd>
          <kbd className="font-sans">K</kbd>
        </span>
      </div>

      {showDropdown && (
        <div
          role="listbox"
          className={clsx(
            "absolute left-0 top-full mt-2 z-40",
            "min-w-[480px] max-w-[560px] w-max",
            "bg-white border border-neutral-200 rounded-lg shadow-lg",
            "max-h-[80vh] overflow-hidden flex flex-col",
            "animate-fade-in-up",
          )}
        >
          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-neutral-100">
            {PLATFORMS.map((p) => {
              const active = platformFilters.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full pl-0.5 pr-2.5 py-0.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-gold-50 text-gold-800 ring-1 ring-gold-500"
                      : "bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-100",
                  )}
                  aria-pressed={active}
                >
                  <PlatformBadge platform={p} size="sm" />
                  {platformLabel(p)}
                </button>
              );
            })}

            <div className="flex items-center gap-1.5 ml-auto">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="From date"
                className={clsx(
                  "h-7 text-xs rounded border bg-white px-1.5",
                  fromDate
                    ? "border-gold-500 ring-1 ring-gold-500/40"
                    : "border-neutral-200",
                )}
              />
              <span className="text-xs text-neutral-400">→</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="To date"
                className={clsx(
                  "h-7 text-xs rounded border bg-white px-1.5",
                  toDate
                    ? "border-gold-500 ring-1 ring-gold-500/40"
                    : "border-neutral-200",
                )}
              />
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-neutral-500 hover:text-neutral-800 underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Results */}
          <div className="overflow-y-auto flex-1">
            {loading && results.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-neutral-500">
                <Spinner />
                Searching…
              </div>
            )}

            {!loading && results.length === 0 && (
              <div className="px-3 py-6 text-sm text-neutral-500">
                No posts match — try a different keyword or widen the date
                range.
              </div>
            )}

            {results.length > 0 && (
              <ul className="divide-y divide-neutral-100">
                {results.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/posts/${r.id}`}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-3 py-2.5 hover:bg-neutral-50 transition-colors"
                    >
                      <ResultThumbnail result={r} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                          {r.posted_at && (
                            <span>{formatShortDate(r.posted_at)}</span>
                          )}
                          <span className="text-neutral-300">·</span>
                          <span>{platformLabel(r.platform)}</span>
                          {r.listing && (
                            <>
                              <span className="text-neutral-300">·</span>
                              <span className="inline-flex items-center rounded bg-gold-50 px-1.5 py-0.5 text-[10px] font-medium text-gold-800 ring-1 ring-gold-200">
                                MLS #{r.listing.mls_number}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="mt-0.5 text-sm text-neutral-800 line-clamp-2">
                          <Highlighted
                            text={r.caption ?? "(no caption)"}
                            query={trimmed}
                          />
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-neutral-500 leading-snug">
                        <div>
                          <span className="font-semibold text-neutral-800">
                            {formatCompactNumber(r.reach)}
                          </span>{" "}
                          reach
                        </div>
                        <div>
                          <span className="font-semibold text-neutral-800">
                            {formatCompactNumber(r.engagements)}
                          </span>{" "}
                          eng
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          {totalCount > 0 && (
            <div className="border-t border-neutral-100 px-3 py-2 bg-neutral-50/60">
              <Link
                href={seeAllHref}
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-gold-700 hover:text-gold-800"
              >
                See all {formatCompactNumber(totalCount)} result
                {totalCount === 1 ? "" : "s"} →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin text-neutral-400"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ResultThumbnail({ result }: { result: SearchResult }) {
  const src = result.thumbnail_url ?? result.media_url ?? null;
  return (
    <div className="relative w-12 h-12 shrink-0 rounded-md overflow-hidden bg-gradient-to-br from-neutral-100 to-neutral-200 ring-1 ring-neutral-200">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <PlatformBadge platform={result.platform} size="md" />
        </div>
      )}
      {src && (
        <div className="absolute top-0.5 left-0.5">
          <PlatformBadge platform={result.platform} size="sm" />
        </div>
      )}
    </div>
  );
}

/**
 * Highlight the FIRST occurrence of the query in the caption (case-insensitive)
 * — bounded to one match so very short queries don't <mark>-bomb the entire
 * caption.
 */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <mark className="bg-gold-100 text-gold-900 rounded-sm px-0.5">
        {match}
      </mark>
      {after}
    </>
  );
}
