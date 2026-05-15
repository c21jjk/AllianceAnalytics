"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { OwnerStoryIndexRow } from "@/lib/data/owner-story-index";
import { formatCurrency, formatRelativeTime } from "@/lib/format";

type StatusFilter = "all" | "active" | "pending" | "sold";
type SortKey = "recent_activity" | "newest" | "most_views" | "address";

interface Props {
  rows: OwnerStoryIndexRow[];
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Under contract" },
  { value: "sold", label: "Sold" },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "recent_activity", label: "Recent activity" },
  { value: "most_views", label: "Most views" },
  { value: "newest", label: "Newest listing" },
  { value: "address", label: "Address (A→Z)" },
];

/**
 * Owner Pages index — one row per listing's /home/[token] page, with copy,
 * preview, status, view count, last-viewed. Built as a client component so
 * sort + filter + copy interactions stay snappy without round-tripping.
 *
 * Data is loaded server-side and passed in; client never re-fetches.
 */
export default function OwnerStoryIndexTable({ rows }: Props) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent_activity");
  const [query, setQuery] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  // Phase 7 — bulk selection + copy. Stored as a Set of property_id.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCopied, setBulkCopied] = useState<"copied" | "empty" | null>(
    null,
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (status !== "all") {
      out = out.filter((r) => r.status === status);
    }
    if (q) {
      out = out.filter((r) => {
        const hay = [
          r.address,
          r.city,
          r.state,
          r.mls_number,
          r.agent_name,
          r.listing_office_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    const sorted = [...out];
    sorted.sort((a, b) => {
      if (sort === "most_views") {
        if (b.total_views !== a.total_views) {
          return b.total_views - a.total_views;
        }
      }
      if (sort === "newest") {
        const lda = a.listing_date ? new Date(a.listing_date).getTime() : 0;
        const ldb = b.listing_date ? new Date(b.listing_date).getTime() : 0;
        return ldb - lda;
      }
      if (sort === "address") {
        return (a.address ?? "").localeCompare(b.address ?? "");
      }
      // recent_activity (default): mirror server-side sort
      const lva = a.last_viewed_at ? new Date(a.last_viewed_at).getTime() : 0;
      const lvb = b.last_viewed_at ? new Date(b.last_viewed_at).getTime() : 0;
      if (lvb !== lva) return lvb - lva;
      const lda = a.listing_date ? new Date(a.listing_date).getTime() : 0;
      const ldb = b.listing_date ? new Date(b.listing_date).getTime() : 0;
      return ldb - lda;
    });
    return sorted;
  }, [rows, status, sort, query]);

  async function handleCopy(path: string, key: string) {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(key);
      window.setTimeout(() => setCopiedToken((c) => (c === key ? null : c)), 1600);
    } catch {
      // No-op — clipboard blocked.
    }
  }

  // Phase 7 — bulk selection helpers.
  function toggleSelected(propertyId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      // If every visible row is selected, clear; otherwise select all visible.
      const allSelected =
        filtered.length > 0 && filtered.every((r) => prev.has(r.property_id));
      if (allSelected) return new Set();
      const next = new Set(prev);
      for (const r of filtered) next.add(r.property_id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  async function handleBulkCopy() {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    const rowsToCopy = filtered.filter((r) => selected.has(r.property_id));
    if (rowsToCopy.length === 0) {
      setBulkCopied("empty");
      window.setTimeout(() => setBulkCopied(null), 1500);
      return;
    }
    // One line per row: address + URL. Tab-separated so it pastes cleanly
    // into both plain text and Gmail/Notes.
    const text = rowsToCopy
      .map((r) => {
        const label = r.address ?? r.mls_number;
        return `${label}\t${origin}${r.story_url_path}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setBulkCopied("copied");
      window.setTimeout(() => setBulkCopied(null), 1800);
    } catch {
      setBulkCopied(null);
    }
  }

  const totalViews = rows.reduce((s, r) => s + r.total_views, 0);
  const selectionCount = filtered.filter((r) =>
    selected.has(r.property_id),
  ).length;
  const allVisibleSelected =
    filtered.length > 0 &&
    filtered.every((r) => selected.has(r.property_id));
  const recentlyViewed = rows.filter((r) => {
    if (!r.last_viewed_at) return false;
    return Date.now() - new Date(r.last_viewed_at).getTime() < 7 * 86_400_000;
  }).length;

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
          Owner Story pages
        </h2>
        <p className="text-sm text-neutral-500 leading-relaxed">
          One link per listing — the seller-facing narrative view. Anyone with
          the link can read.
          {totalViews > 0 ? (
            <>
              {" "}
              <span className="text-neutral-700 font-medium">
                {totalViews.toLocaleString()}{" "}
                {totalViews === 1 ? "view" : "views"}
              </span>{" "}
              across all pages
              {recentlyViewed > 0 ? (
                <>
                  ; {recentlyViewed}{" "}
                  {recentlyViewed === 1 ? "page" : "pages"} viewed in the past
                  7 days.
                </>
              ) : (
                "."
              )}
            </>
          ) : null}
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <input
          type="search"
          placeholder="Search address, MLS, agent…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
        />
        <div className="flex gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk actions strip — shown only when at least one row is selected.
          Phase 7 — lets Larissa grab multiple story links in one paste. */}
      {selectionCount > 0 ? (
        <div className="rounded-md bg-gold-50 ring-1 ring-gold-200 px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-gold-900">
            {selectionCount}{" "}
            {selectionCount === 1 ? "listing selected" : "listings selected"}
          </span>
          <span className="text-neutral-400">·</span>
          <button
            type="button"
            onClick={handleBulkCopy}
            className="inline-flex items-center rounded-md bg-gold-600 hover:bg-gold-700 text-white text-xs font-semibold px-3 py-1.5"
          >
            {bulkCopied === "copied"
              ? `Copied ${selectionCount} links`
              : "Copy all selected"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs font-medium text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
          >
            Clear
          </button>
          {bulkCopied === "empty" ? (
            <span className="text-xs text-rose-700 font-medium">
              Nothing selected to copy
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 px-4 py-10 text-center text-sm text-neutral-500">
          {rows.length === 0
            ? "No listings yet. Once properties sync from MLS, their story pages will appear here."
            : "No listings match the current filters."}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
          <div className="hidden md:grid md:grid-cols-[36px_minmax(0,_3fr)_minmax(0,_1fr)_minmax(0,_1.4fr)_minmax(0,_1.2fr)_auto] gap-3 px-4 py-2 bg-neutral-50 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
            <div>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                aria-label="Select all visible listings"
                className="w-4 h-4 rounded border-neutral-300 text-gold-600 focus:ring-gold-500"
              />
            </div>
            <div>Listing</div>
            <div>Status</div>
            <div>Views</div>
            <div>Story link</div>
            <div className="text-right">Actions</div>
          </div>
          <ul className="divide-y divide-neutral-200">
            {filtered.map((row) => (
              <li
                key={row.property_id}
                className={
                  "grid grid-cols-1 md:grid-cols-[36px_minmax(0,_3fr)_minmax(0,_1fr)_minmax(0,_1.4fr)_minmax(0,_1.2fr)_auto] gap-3 px-4 py-3 items-center " +
                  (selected.has(row.property_id) ? "bg-gold-50/40" : "")
                }
              >
                {/* Bulk-select checkbox */}
                <div className="flex items-start md:items-center">
                  <input
                    type="checkbox"
                    checked={selected.has(row.property_id)}
                    onChange={() => toggleSelected(row.property_id)}
                    aria-label={`Select ${row.address ?? row.mls_number}`}
                    className="w-4 h-4 rounded border-neutral-300 text-gold-600 focus:ring-gold-500"
                  />
                </div>
                {/* Listing */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 shrink-0 rounded bg-neutral-100 overflow-hidden">
                    {row.hero_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.hero_image_url}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={`/properties/${row.mls_number}`}
                      className="block text-sm font-medium text-neutral-900 hover:text-gold-700 truncate"
                    >
                      {row.address ?? row.mls_number}
                    </Link>
                    <div className="text-xs text-neutral-500 truncate">
                      {row.city && row.state ? (
                        <>
                          {row.city}, {row.state}
                        </>
                      ) : null}
                      {row.list_price !== null ? (
                        <>
                          {row.city && row.state ? " · " : null}
                          {formatCurrency(row.list_price)}
                        </>
                      ) : null}
                      {row.agent_name ? (
                        <>
                          {row.city || row.list_price !== null ? " · " : null}
                          {row.agent_name}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Status */}
                <div>
                  <StatusPill status={row.status} />
                </div>

                {/* Views */}
                <div className="text-sm text-neutral-700">
                  {row.total_views > 0 ? (
                    <>
                      <span className="font-medium tabular-nums">
                        {row.total_views}
                      </span>
                      <span className="text-neutral-500">
                        {" "}
                        {row.total_views === 1 ? "view" : "views"}
                      </span>
                      {row.last_viewed_at ? (
                        <div className="text-xs text-neutral-500">
                          {formatRelativeTime(row.last_viewed_at)}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-xs text-neutral-400">No views yet</span>
                  )}
                </div>

                {/* Link */}
                <div className="text-xs text-neutral-600 font-mono truncate">
                  {row.story_url_path}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(row.story_url_path, row.property_id)
                    }
                    className="inline-flex items-center rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium px-2.5 py-1.5 transition-colors"
                  >
                    {copiedToken === row.property_id ? "Copied" : "Copy"}
                  </button>
                  <Link
                    href={row.story_url_path}
                    target="_blank"
                    className="inline-flex items-center rounded-md ring-1 ring-neutral-300 hover:ring-neutral-400 bg-white text-neutral-800 text-xs font-medium px-2.5 py-1.5 transition-colors"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs text-neutral-500">
        Showing {filtered.length} of {rows.length}{" "}
        {rows.length === 1 ? "listing" : "listings"}.
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: OwnerStoryIndexRow["status"] }) {
  const styles: Record<typeof status, string> = {
    active:
      "bg-emerald-50 ring-1 ring-emerald-200 text-emerald-800",
    pending: "bg-amber-50 ring-1 ring-amber-200 text-amber-800",
    sold: "bg-neutral-100 ring-1 ring-neutral-200 text-neutral-700",
    expired: "bg-neutral-50 ring-1 ring-neutral-200 text-neutral-500",
  };
  const label: Record<typeof status, string> = {
    active: "Active",
    pending: "Under contract",
    sold: "Sold",
    expired: "Expired",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}
    >
      {label[status]}
    </span>
  );
}
