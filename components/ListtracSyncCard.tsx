"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { syncListtracAction, type ListtracSyncResult } from "@/lib/sync/actions";

interface ListtracSyncCardProps {
  /** ISO timestamp of last successful sync, or null when never synced. */
  lastSyncAt: string | null;
  className?: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * ListTrac manual sync card on /settings.
 *
 * Fires `syncListtracAction()` which invokes the `listtrac-sync` Edge
 * Function. Shows last-sync status (pill) and a Sync now button. After a run,
 * surfaces totals: listings checked, listings with data, rows written, total
 * views found. Per project memory the daily cron also runs — this is just
 * the manual refresh path.
 */
export default function ListtracSyncCard({
  lastSyncAt,
  className,
}: ListtracSyncCardProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ListtracSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await syncListtracAction();
        setResult(r);
        if (!r.ok && r.errors.length > 0) {
          setError(r.errors[0]?.message ?? "Unknown error");
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  const pillClass = !lastSyncAt
    ? "bg-neutral-100 text-neutral-600"
    : "bg-emerald-50 text-emerald-700";
  const pillLabel = !lastSyncAt
    ? "Never synced"
    : `Last sync · ${relativeTime(lastSyncAt)}`;

  const coverage =
    result && result.listings_checked > 0
      ? Math.round((result.listings_with_data / result.listings_checked) * 100)
      : null;

  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 bg-white shadow-card p-5 space-y-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            ListTrac
          </h3>
          <p className="mt-1 text-xs text-neutral-500 max-w-md">
            Pulls portal traffic counts for every active, pending, and recently
            sold listing — Zillow, Realtor.com, Trulia, and the CIH brand
            network. Daily cron runs automatically; use this for a manual
            refresh.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          className={clsx(
            "btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 shrink-0",
            isPending && "opacity-60 cursor-not-allowed",
          )}
        >
          {isPending ? (
            <>
              <Spinner /> Syncing…
            </>
          ) : (
            <>
              <SyncIcon /> Sync now
            </>
          )}
        </button>
      </div>

      <div>
        <span
          className={clsx(
            "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
            pillClass,
          )}
        >
          {pillLabel}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-rose-600 break-words">
          Sync failed: {error}
        </p>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs space-y-2">
          <div
            className={clsx(
              "font-medium",
              result.ok ? "text-emerald-700" : "text-rose-700",
            )}
          >
            {result.ok ? "Sync complete" : "Sync had errors"} ·{" "}
            {(result.duration_ms / 1000).toFixed(1)}s
          </div>
          <div className="grid grid-cols-2 gap-2 text-neutral-700">
            <Stat label="Listings checked" value={result.listings_checked} />
            <Stat
              label="With portal data"
              value={
                coverage !== null
                  ? `${result.listings_with_data} (${coverage}%)`
                  : String(result.listings_with_data)
              }
            />
            <Stat label="Daily rows written" value={result.rows_written} />
            <Stat label="Total views" value={result.total_views.toLocaleString()} />
          </div>
          {result.errors.length > 0 ? (
            <details className="pt-1">
              <summary className="cursor-pointer text-rose-700 text-[11px]">
                {result.errors.length} per-listing error
                {result.errors.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {result.errors.slice(0, 8).map((e, idx) => (
                  <li key={idx} className="text-rose-600 text-[11px]">
                    {e.mls_number ? <span className="font-mono">{e.mls_number}: </span> : null}
                    {e.message.slice(0, 140)}
                  </li>
                ))}
                {result.errors.length > 8 ? (
                  <li className="text-rose-500 text-[11px]">
                    …and {result.errors.length - 8} more
                  </li>
                ) : null}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <span className="text-sm font-semibold text-neutral-900">{value}</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5 animate-spin text-neutral-500"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={2}
        strokeOpacity={0.25}
      />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M4 4v4h4M20 20v-4h-4"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
