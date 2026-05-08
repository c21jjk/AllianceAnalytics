"use client";

import clsx from "clsx";
import type { Platform } from "@/lib/types/post";
import { platformLabel } from "./PlatformBadge";
import AskAiButton from "./AskAiButton";

export type DateRangeKey = "7d" | "30d" | "90d" | "all";

export interface PostFilterState {
  platforms: Set<Platform>;
  dateRange: DateRangeKey;
  linkedOnly: boolean;
  query: string;
}

interface PostFilterBarProps {
  state: PostFilterState;
  onChange: (next: PostFilterState) => void;
  /** Posts visible after filters — used for the count badge */
  visibleCount: number;
  totalCount: number;
}

const PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok"];

const DATE_RANGES: { key: DateRangeKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All" },
];

export default function PostFilterBar({
  state,
  onChange,
  visibleCount,
  totalCount,
}: PostFilterBarProps) {
  function togglePlatform(p: Platform) {
    const next = new Set(state.platforms);
    if (next.has(p)) {
      next.delete(p);
    } else {
      next.add(p);
    }
    onChange({ ...state, platforms: next });
  }

  function setRange(r: DateRangeKey) {
    onChange({ ...state, dateRange: r });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
      <div className="px-3 md:px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Platform multi-toggle */}
          <div className="inline-flex rounded-lg bg-neutral-50 ring-1 ring-neutral-200 p-0.5">
            {PLATFORMS.map((p) => {
              const active = state.platforms.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={clsx(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition",
                    active
                      ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200"
                      : "text-neutral-500 hover:text-neutral-800",
                  )}
                  aria-pressed={active}
                >
                  {platformLabel(p)}
                </button>
              );
            })}
          </div>

          {/* Date range */}
          <div className="inline-flex rounded-lg bg-neutral-50 ring-1 ring-neutral-200 p-0.5">
            {DATE_RANGES.map((r) => {
              const active = state.dateRange === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRange(r.key)}
                  className={clsx(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition",
                    active
                      ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200"
                      : "text-neutral-500 hover:text-neutral-800",
                  )}
                  aria-pressed={active}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          {/* Linked-only toggle */}
          <label
            className={clsx(
              "inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg",
              "ring-1 ring-neutral-200 bg-white text-xs font-medium cursor-pointer",
              "hover:ring-neutral-300 transition",
              state.linkedOnly ? "text-gold-700 ring-gold-200 bg-gold-50" : "text-neutral-600",
            )}
          >
            <input
              type="checkbox"
              checked={state.linkedOnly}
              onChange={(e) =>
                onChange({ ...state, linkedOnly: e.target.checked })
              }
              className="sr-only"
            />
            <span
              className={clsx(
                "w-3.5 h-3.5 inline-flex items-center justify-center rounded border",
                state.linkedOnly
                  ? "border-gold-500 bg-gold-500 text-white"
                  : "border-neutral-300 bg-white",
              )}
              aria-hidden="true"
            >
              {state.linkedOnly ? (
                <svg
                  viewBox="0 0 16 16"
                  className="w-2.5 h-2.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    d="M3 8l3.2 3.2L13 5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>
            Linked to property
          </label>

          <div className="ml-auto text-xs text-neutral-500 tabular-nums">
            <span className="font-medium text-neutral-800">{visibleCount}</span>
            <span className="text-neutral-400"> / {totalCount}</span> posts
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={state.query}
              onChange={(e) => onChange({ ...state, query: e.target.value })}
              placeholder="Search caption, MLS, or hashtag…"
              className={clsx(
                "block w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 py-2",
                "text-sm text-neutral-900 placeholder:text-neutral-400",
                "focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30",
              )}
            />
          </div>

          {/* Ask Claude — placeholder */}
          <AskAiButton />
        </div>
      </div>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={clsx("w-4 h-4", className)}
      fill="none"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M20 20l-3.5-3.5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
