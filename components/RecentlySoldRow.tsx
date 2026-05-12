"use client";

import { useEffect, useState } from "react";
import type { ListingMilestone } from "@/lib/data/recently-sold";
import MilestoneListingRow from "./MilestoneListingRow";

interface RecentlySoldRowProps {
  listings: ListingMilestone[];
  /** Window in days the parent fetched against. Surfaced in the header copy. */
  windowDays?: number;
  officeShortCode?: string | null;
  className?: string;
}

/** localStorage key for the collapsed-state preference. */
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
  windowDays = 30,
  officeShortCode,
  className,
}: RecentlySoldRowProps) {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "1") setCollapsed(true);
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
            <h2 className="text-sm font-semibold text-neutral-900">
              Recently Sold
              <span className="text-neutral-400 font-normal">
                {" "}· last {windowDays} days · {listings.length} {noun}{scope}
              </span>
              {collapsed ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-emerald-200/70 ring-1 ring-emerald-300 px-2 py-0.5 text-[11px] font-medium text-emerald-800 tabular-nums">
                  {listings.length}
                </span>
              ) : null}
            </h2>
            {!collapsed ? (
              <p className="mt-0.5 text-xs text-neutral-600">
                {listings.length === 0
                  ? "Nothing settled in the last " + windowDays + " days."
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
              No settlements in the last {windowDays} days.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {listings.map((listing, idx) => (
                <li key={listing.id}>
                  <MilestoneListingRow
                    listing={listing}
                    eyebrowPrefix="Sold"
                    isFirst={idx === 0}
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
              No settlements in the last {windowDays} days.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {listings.map((listing, idx) => (
                <li key={listing.id}>
                  <MilestoneListingRow
                    listing={listing}
                    eyebrowPrefix="Sold"
                    isFirst={idx === 0}
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
