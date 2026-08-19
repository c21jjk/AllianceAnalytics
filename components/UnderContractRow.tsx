"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ListingMilestone } from "@/lib/data/recently-sold";
import MilestoneListingRow from "./MilestoneListingRow";
import {
  MILESTONE_FLOOR_EMPTY_COPY,
  ROLLING_WINDOW_LABEL,
} from "@/lib/dashboard-window";

interface UnderContractRowProps {
  listings: ListingMilestone[];
  officeShortCode?: string | null;
  /** Count of listings that transitioned to pending in the last 24h. */
  freshCount?: number;
  className?: string;
}

/** localStorage key for the collapsed-state preference.
 *  Default is COLLAPSED. Stored value "0" = user explicitly expanded. */
const COLLAPSED_KEY = "under-contract-collapsed";

/**
 * Dashboard card listing currently-pending (under contract) Alliance
 * listings. Lives in the top-right of the milestones grid, beside
 * RecentlyListedRow. Status updates via RETS sync — when Paragon flips a
 * listing from active → pending, it lands here on the next sync.
 *
 * Sorted newest-first by listing_date; no recency cutoff (pending is a
 * current state, not a windowed event). Each row deep-links to the listing
 * detail page.
 *
 * Collapsible via chevron in header; state persists across reloads via
 * localStorage. Matches the pattern in RecentlyListedRow so the three
 * milestone cards behave consistently.
 */
export default function UnderContractRow({
  listings,
  officeShortCode,
  freshCount = 0,
  className,
}: UnderContractRowProps) {
  const [collapsed, setCollapsed] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "0") setCollapsed(false);
    } catch {
      // localStorage unavailable (Safari private mode etc.) — fall back to
      // session-only state, no persistence.
    }
    setHydrated(true);
  }, []);

  function handleToggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  const noun = listings.length === 1 ? "listing" : "listings";
  const scope = officeShortCode ? ` (${officeShortCode})` : "";

  return (
    <section
      className={`rounded-2xl border border-amber-200/70 bg-amber-50/40 p-4 shadow-card ${className ?? ""}`}
      aria-label="Under contract listings"
    >
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={!collapsed}
          aria-controls="under-contract-body"
          className="group min-w-0 flex items-start gap-2 text-left -ml-1 rounded-md px-1 py-0.5 hover:bg-amber-100/60 transition-colors flex-1"
        >
          <ChevronIcon collapsed={collapsed} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900 inline-flex items-center flex-wrap gap-2">
              Under Contract
              <span className="text-neutral-400 font-normal">
                · {ROLLING_WINDOW_LABEL} · {listings.length} {noun}{scope}
              </span>
              {freshCount > 0 ? <FreshBadge count={freshCount} /> : null}
              {collapsed && freshCount === 0 ? (
                <span className="inline-flex items-center rounded-full bg-amber-200/70 ring-1 ring-amber-300 px-2 py-0.5 text-[11px] font-medium text-amber-800 tabular-nums">
                  {listings.length}
                </span>
              ) : null}
            </h2>
            {/* 2026-08-05 (John): how-it-works subtitle removed from every
                milestone card. The empty state below already covers the "why
                is this empty" case, so printing it here too said it twice. */}
          </div>
        </button>
        {/* 2026-08-19 — weekly roundup entry point (John: UC + Price Reduced
            publish as ONE company-wide multi-property post per week now, not
            per-property singles). Mirrors the multi-OH CTA on the Open Houses
            card. Shown whenever the week has at least one row. */}
        {listings.length >= 1 ? (
          <Link
            href="/post-builder/roundup/under-contract"
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-gold-300 bg-gold-50 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-gold-800 transition hover:border-gold-500 hover:bg-gold-100"
            title="Build this week's Under Contract roundup post"
            aria-label={`Build Under Contract roundup (${listings.length} listings)`}
          >
            <RoundupGlyph />
            <span className="hidden sm:inline">Build Roundup</span>
            <span className="rounded-full bg-gold-200/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-900 tabular-nums">
              {listings.length}
            </span>
          </Link>
        ) : null}
      </header>

      {!collapsed && hydrated ? (
        <div id="under-contract-body" className="mt-3">
          {listings.length === 0 ? (
            <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
              {MILESTONE_FLOOR_EMPTY_COPY}
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {listings.map((listing, idx) => (
                <li key={listing.id}>
                  <MilestoneListingRow
                    listing={listing}
                    eyebrowPrefix="Under contract"
                    isFirst={idx === 0}
                    postType="under_contract"
                    buildOverride={{
                      href: "/post-builder/roundup/under-contract",
                      label: "Build Roundup Post",
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* SSR fallback — render expanded so first paint matches default. */}
      {!hydrated ? (
        <div id="under-contract-body" className="mt-3">
          {listings.length === 0 ? (
            <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
              {MILESTONE_FLOOR_EMPTY_COPY}
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {listings.map((listing, idx) => (
                <li key={listing.id}>
                  <MilestoneListingRow
                    listing={listing}
                    eyebrowPrefix="Under contract"
                    isFirst={idx === 0}
                    postType="under_contract"
                    buildOverride={{
                      href: "/post-builder/roundup/under-contract",
                      label: "Build Roundup Post",
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function RoundupGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Same multi-house glyph as the multi-OH CTA so "this builds a
          multi-property post" reads consistently across the dashboard. */}
      <path d="M2 14h12" />
      <path d="M3 14V9l2-1.5L7 9v5" />
      <path d="M9 14V9l2-1.5L13 9v5" />
    </svg>
  );
}

function FreshBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-gold-100 ring-1 ring-gold-300 px-2 py-0.5 text-[11px] font-semibold text-gold-800 tabular-nums"
      aria-label={`${count} new in the last 24 hours`}
    >
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse"
      />
      {count} new
    </span>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-4 h-4 mt-0.5 text-neutral-500 group-hover:text-neutral-700 transition-transform shrink-0 ${
        collapsed ? "-rotate-90" : "rotate-0"
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
