"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ListingNeedingPosts } from "@/lib/data/listings-needing-posts";
import ListingsFilterChips from "./ListingsFilterChips";
import NeedsPostsCard from "./NeedsPostsCard";
import {
  MILESTONE_FLOOR_EMPTY_COPY,
  MILESTONE_FLOOR_LABEL,
} from "@/lib/dashboard-window";

interface RecentlyListedRowProps {
  listings: ListingNeedingPosts[];
  /** Currently active office filter short_code, when one is set. */
  officeShortCode?: string | null;
  /**
   * Active status filter — drives both the heading copy and which chip is
   * highlighted. Defaults to "needs_only" when omitted.
   */
  statusFilter?: "needs_only" | "all";
  /** Count of listings first seen in the last 24h. Drives the "X new" badge. */
  freshCount?: number;
  className?: string;
}

/** localStorage key for the collapsed-state preference.
 *  Recently Listed defaults to EXPANDED — it's the focus surface (new
 *  listings need posts). Stored "1" = user explicitly collapsed. */
const COLLAPSED_KEY = "recent-listings-collapsed";

/**
 * Dashboard "Recently Listed — needs coverage" card (renamed from
 * NeedsPostsRow for symmetry with UnderContractRow + RecentlySoldRow).
 * Lives in the left column of the milestones grid on the dashboard.
 *
 * Each row shows hero thumb, address, price, days, missing-platform chips,
 * MLS# copy chip, and a Status menu (Mark as posted / Dismiss / Reset).
 *
 * Filter chip lets the user toggle between "Needs attention" (default —
 * only listings still requiring action) and "All" (every recent listing
 * with its status banner). The chip rewrites the ?listings= URL param so
 * the server-side fetch happens with the right status_filter value.
 *
 * The whole section is collapsible — a chevron toggle in the header hides
 * the list so the user can focus on the post stream below. State persists
 * across reloads via localStorage so the dashboard remembers your choice.
 */
export default function RecentlyListedRow({
  listings,
  officeShortCode,
  statusFilter = "needs_only",
  freshCount = 0,
  className,
}: RecentlyListedRowProps) {
  // Hide entirely when there's nothing to show in "needs_only" view —
  // dashboard doesn't grow a permanent empty section. In "all" view we
  // always render the chrome so the toggle stays accessible.
  const renderEarly = statusFilter === "needs_only" && listings.length === 0;

  // Collapsed state — Recently Listed defaults to EXPANDED so new listings
  // stay in Larissa's eye line. localStorage "1" means the user explicitly
  // collapsed this card and wants it kept collapsed across reloads.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "1") setCollapsed(true);
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
      // ignore — see above
    }
  }

  if (renderEarly) return null;

  const noun = listings.length === 1 ? "listing" : "listings";
  const scope = officeShortCode ? ` (${officeShortCode})` : "";

  return (
    <section
      className={`rounded-2xl border border-gold-200 bg-gold-50/40 p-4 shadow-card ${className ?? ""}`}
      aria-label="Recent listings"
    >
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={!collapsed}
          aria-controls="recent-listings-body"
          className="group min-w-0 flex items-start gap-2 text-left -ml-1 rounded-md px-1 py-0.5 hover:bg-gold-100/60 transition-colors"
        >
          <ChevronIcon collapsed={collapsed} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900 inline-flex items-center flex-wrap gap-2">
              Recently Listed
              <span className="text-neutral-400 font-normal">
                · since {MILESTONE_FLOOR_LABEL} · needs a post{scope}
              </span>
              {freshCount > 0 ? <FreshBadge count={freshCount} /> : null}
              {collapsed && freshCount === 0 ? (
                <span className="inline-flex items-center rounded-full bg-gold-200/70 ring-1 ring-gold-300 px-2 py-0.5 text-[11px] font-medium text-gold-800 tabular-nums">
                  {listings.length}
                </span>
              ) : null}
            </h2>
            {!collapsed ? (
              <p className="mt-0.5 text-xs text-neutral-600">
                {statusFilter === "needs_only"
                  ? `${listings.length} ${noun} still need a Just Listed post. Tick the checkbox once one is made, or leave it — cards also drop off automatically when a hashtagged post auto-links.`
                  : `${listings.length} recent ${noun}. Banners across the thumbnail show whether each one has been posted, dismissed, or still needs attention.`}
              </p>
            ) : null}
          </div>
        </button>
        {!collapsed ? (
          <div className="flex items-center gap-3 shrink-0">
            <ListingsFilterChips current={statusFilter} />
            <Link
              href="/settings/promotions"
              className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
            >
              Dismissed
            </Link>
          </div>
        ) : null}
      </header>

      {/* Render the body only when expanded. Guard with `hydrated` so SSR's
          default (expanded) doesn't briefly flash a body that's about to
          collapse — once hydrated, collapsed users see no flicker. */}
      {!collapsed && hydrated ? (
        <div id="recent-listings-body" className="mt-3">
          {listings.length === 0 ? (
            <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
              {MILESTONE_FLOOR_EMPTY_COPY}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {listings.map((listing) => (
                <li key={listing.id}>
                  <NeedsPostsCard listing={listing} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {/* SSR fallback: before hydration, render the body anyway so server
          HTML matches the default (expanded) state. The useEffect collapses
          it on next tick if localStorage says so. */}
      {!hydrated ? (
        <div id="recent-listings-body" className="mt-3">
          {listings.length === 0 ? (
            <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
              {MILESTONE_FLOOR_EMPTY_COPY}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {listings.map((listing) => (
                <li key={listing.id}>
                  <NeedsPostsCard listing={listing} />
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
