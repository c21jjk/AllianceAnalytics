"use client";

import { useEffect, useState } from "react";
import type { ListingMilestone } from "@/lib/data/recently-sold";
import MilestoneListingRow from "./MilestoneListingRow";
import {
  MILESTONE_FLOOR_EMPTY_COPY,
  MILESTONE_FLOOR_LABEL,
} from "@/lib/dashboard-window";

interface RecentlySoldRowProps {
  listings: ListingMilestone[];
  /** Window in days the parent fetched against. Surfaced in the header copy. */
  officeShortCode?: string | null;
  /** Count of listings that transitioned to sold in the last 24h. */
  freshCount?: number;
  className?: string;
}

/** localStorage key for the collapsed-state preference.
 *  Default is COLLAPSED. Stored value "0" = user explicitly expanded. */
const COLLAPSED_KEY = "recently-sold-collapsed";

/**
 * Dashboard card listing recently-settled Alliance properties. Lives in the
 * bottom-right of the milestones grid, beside RecentlyListedRow.
 *
 * Each row shows the sold price (NOT list price) and the close date. Deep-
 * links to the listing detail. Larissa uses this surface to decide which
 * sold listings deserve a "Just Sold" celebration post.
 *
 * Collapsible via chevron in header; state persists across reloads via
 * localStorage. Matches the pattern in RecentlyListedRow + UnderContractRow.
 */
export default function RecentlySoldRow({
  listings,
  officeShortCode,
  freshCount = 0,
  className,
}: RecentlySoldRowProps) {
  const [collapsed, setCollapsed] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "0") setCollapsed(false);
    } catch {
      // localStorage unavailable (Safari private mode etc.)
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
      className={`rounded-2xl border border-emerald-200/70 bg-emerald-50/30 p-4 shadow-card ${className ?? ""}`}
      aria-label="Recently sold listings"
    >
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={!collapsed}
          aria-controls="recently-sold-body"
          className="group min-w-0 flex items-start gap-2 text-left -ml-1 rounded-md px-1 py-0.5 hover:bg-emerald-100/60 transition-colors flex-1"
        >
          <ChevronIcon collapsed={collapsed} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900 inline-flex items-center flex-wrap gap-2">
              Recently Sold
              <span className="text-neutral-400 font-normal">
                · since {MILESTONE_FLOOR_LABEL} · {listings.length} {noun}{scope}
              </span>
              {freshCount > 0 ? <FreshBadge count={freshCount} /> : null}
              {collapsed && freshCount === 0 ? (
                <span className="inline-flex items-center rounded-full bg-emerald-200/70 ring-1 ring-emerald-300 px-2 py-0.5 text-[11px] font-medium text-emerald-800 tabular-nums">
                  {listings.length}
                </span>
              ) : null}
            </h2>
            {!collapsed ? (
              <p className="mt-0.5 text-xs text-neutral-600">
                {listings.length === 0
                  ? MILESTONE_FLOOR_EMPTY_COPY
                  : "Click any listing to make a Just-Sold post. Price shown is the settled price."}
              </p>
            ) : null}
          </div>
        </button>
      </header>

      {!collapsed && hydrated ? (
        <div id="recently-sold-body" className="mt-3">
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
                    eyebrowPrefix="Sold"
                    isFirst={idx === 0}
                    postType="just_sold"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* SSR fallback — render expanded so first paint matches default. */}
      {!hydrated ? (
        <div id="recently-sold-body" className="mt-3">
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
                    eyebrowPrefix="Sold"
                    isFirst={idx === 0}
                    postType="just_sold"
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
