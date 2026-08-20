"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PriceChangeMilestone } from "@/lib/data/price-changes";
import { formatCurrency } from "@/lib/format";
import { MILESTONE_FLOOR_EMPTY_COPY } from "@/lib/dashboard-window";
import MilestoneListingRow from "./MilestoneListingRow";

interface PriceChangeRowProps {
  listings: PriceChangeMilestone[];
  officeShortCode?: string | null;
  /** Count of reductions recorded in the last 24h. */
  freshCount?: number;
  className?: string;
}

/** localStorage key for the collapsed-state preference.
 *  Default is COLLAPSED. Stored value "0" = user explicitly expanded. */
const COLLAPSED_KEY = "price-changes-collapsed";

/**
 * Dashboard "Price Changes" card — 2026-08-05 (John), replacing the retired
 * Wins to Celebrate card in the right column.
 *
 * A price change here means a REDUCTION: the current list price came down
 * from the original or the previous list price. Rows come from the dated
 * `listing_price_changes` history (written by a trigger on properties), so a
 * listing that dropped twice shows the latest drop and says how many there
 * have been.
 *
 * Same chrome as Under Contract and Recently Sold: collapsible header with a
 * fresh badge, and every row carries "+ Build post" plus the Posted checkbox.
 */
export default function PriceChangeRow({
  listings,
  officeShortCode,
  freshCount = 0,
  className,
}: PriceChangeRowProps) {
  const [collapsed, setCollapsed] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      if (stored === "0") setCollapsed(false);
    } catch {
      // localStorage unavailable (Safari private mode etc.) — session only.
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

  const noun = listings.length === 1 ? "reduction" : "reductions";
  const scope = officeShortCode ? ` (${officeShortCode})` : "";

  const body = (
    <div id="price-changes-body" className="mt-3">
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
                eyebrowPrefix="Reduced"
                isFirst={idx === 0}
                postType="price_reduction"
                metaSuffix={<DropLine listing={listing} />}
                buildOverride={{
                  href: "/post-builder/roundup/price-reduced",
                  label: "Build Roundup Post",
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section
      className={`rounded-2xl border border-rose-200/70 bg-rose-50/30 p-4 shadow-card ${className ?? ""}`}
      aria-label="Price changes"
    >
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={!collapsed}
          aria-controls="price-changes-body"
          className="group min-w-0 flex items-start gap-2 text-left -ml-1 rounded-md px-1 py-0.5 hover:bg-rose-100/60 transition-colors flex-1"
        >
          <ChevronIcon collapsed={collapsed} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900 inline-flex items-center flex-wrap gap-2">
              Price Changes
              <span className="text-neutral-400 font-normal">
                · {listings.length} {noun}
                {scope}
              </span>
              {freshCount > 0 ? <FreshBadge count={freshCount} /> : null}
              {collapsed && freshCount === 0 ? (
                <span className="inline-flex items-center rounded-full bg-rose-200/70 ring-1 ring-rose-300 px-2 py-0.5 text-[11px] font-medium text-rose-800 tabular-nums">
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
            per-property singles). Mirrors the multi-OH CTA on the Open
            Houses card. Shown whenever the week has at least one row. */}
        {listings.length >= 1 ? (
          <Link
            href="/post-builder/roundup/price-reduced"
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-gold-300 bg-gold-50 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-gold-800 transition hover:border-gold-500 hover:bg-gold-100"
            title="Build this week's price improvement roundup post"
            aria-label={`Build price improvement roundup (${listings.length} reductions)`}
          >
            <RoundupGlyph />
            <span className="hidden sm:inline">Build Roundup</span>
            <span className="rounded-full bg-gold-200/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-900 tabular-nums">
              {listings.length}
            </span>
          </Link>
        ) : null}
      </header>

      {!collapsed && hydrated ? body : null}
      {/* SSR fallback — render expanded so first paint matches the default. */}
      {!hydrated ? body : null}
    </section>
  );
}

/**
 * The one line that makes this section worth having: what the price was, what
 * it is now, and how big the cut was.
 */
function DropLine({ listing }: { listing: PriceChangeMilestone }) {
  if (listing.previous_price === null || listing.new_price === null) return null;
  return (
    <div
      style={{
        marginTop: 2,
        fontSize: 11,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <span style={{ color: "#a3a3a3", textDecoration: "line-through" }}>
        {formatCurrency(listing.previous_price)}
      </span>
      <span style={{ color: "#d4d4d4" }}> → </span>
      <span style={{ color: "#171717", fontWeight: 600 }}>
        {formatCurrency(listing.new_price)}
      </span>
      {listing.drop_amount !== null ? (
        <span className="text-rose-700 font-medium">
          {" "}
          −{formatCurrency(listing.drop_amount)}
          {listing.drop_percent !== null ? ` (${listing.drop_percent}%)` : ""}
        </span>
      ) : null}
      {listing.reduction_count > 1 ? (
        <span style={{ color: "#737373" }}>
          {" "}
          · {listing.reduction_count} cuts
        </span>
      ) : null}
    </div>
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
