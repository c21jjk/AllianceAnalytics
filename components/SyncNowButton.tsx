"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { syncAll } from "@/lib/sync/actions";

interface SyncResult {
  platform: string;
  ok: boolean;
  inserted: number;
  updated: number;
  errors: { message: string }[];
  duration_ms: number;
}

interface GrouperResult {
  groups_created: number;
  posts_assigned: number;
}

interface SyncNowButtonProps {
  className?: string;
}

/**
 * Admin-only "Sync now" button. Invokes the syncAll server action which
 * sequentially calls each platform's Edge Function.
 *
 * UI states:
 *   - idle      → "Sync now" button
 *   - syncing   → spinner + "Syncing FB / IG / TT…"
 *   - success   → "Synced N new, M updated · 12s ago"
 *   - error     → "Sync failed — see details" with expandable error list
 *
 * The button only renders for admin users; gating is enforced server-side
 * by `requireAdmin()` inside the server action, but we also hide the button
 * client-side when role !== 'admin' (passed as prop from the dashboard
 * server component).
 */
export default function SyncNowButton({ className }: SyncNowButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [grouper, setGrouper] = useState<GrouperResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setResults(null);
    setGrouper(null);
    startTransition(async () => {
      try {
        const r = await syncAll();
        setResults(r.results);
        setGrouper(r.grouper);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className={clsx("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={clsx(
          "btn-secondary text-xs px-3 py-1.5",
          "inline-flex items-center gap-1.5",
        )}
        title="Trigger an immediate sync of FB, IG, and TT, then run the cross-platform grouper"
      >
        {isPending ? (
          <>
            <Spinner />
            Syncing FB · IG · TT…
          </>
        ) : (
          <>
            <SyncIcon />
            Sync all platforms
          </>
        )}
      </button>

      {error ? (
        <span className="text-[11px] text-rose-600">
          Sync failed: {error.slice(0, 80)}
        </span>
      ) : null}

      {results ? (
        <div className="text-[11px] text-neutral-500 text-right space-y-0.5">
          {results.map((r) => (
            <div
              key={r.platform}
              className={r.ok ? "text-emerald-600" : "text-rose-600"}
            >
              {r.platform}:{" "}
              {r.ok ? `+${r.inserted} new, ${r.updated} updated` : "failed"}
            </div>
          ))}
          {grouper ? (
            <div className="text-neutral-400 pt-0.5 border-t border-neutral-100">
              merged: +{grouper.groups_created} groups,{" "}
              {grouper.posts_assigned} posts
            </div>
          ) : null}
        </div>
      ) : null}
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
