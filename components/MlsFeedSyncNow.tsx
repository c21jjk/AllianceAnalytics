"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { syncMlsFeed, type MlsFeedSyncResult } from "@/app/(app)/settings/actions";

interface MlsFeedSyncNowProps {
  shortCode: string;
  /** ISO timestamp of last sync, or null when never synced. */
  lastSyncAt: string | null;
  /** Whether the most recent validation succeeded. */
  lastValidatedOk: boolean | null;
  /** Disable the button (e.g., feed type is RESO and not yet supported). */
  disabled?: boolean;
  disabledReason?: string;
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
 * Admin-only Sync Now button + last-sync indicator for one MLS feed.
 * Renders inside the per-feed edit page (`/settings/feeds/[short_code]/edit`).
 *
 * On click: fires the syncMlsFeed server action, which invokes the
 * mls-rets-sync Edge Function. Results are shown inline as a per-class
 * breakdown so we can see e.g. "RE_1: +42 / 42 seen, MF_4: error".
 */
export default function MlsFeedSyncNow({
  shortCode,
  lastSyncAt,
  lastValidatedOk,
  disabled = false,
  disabledReason,
  className,
}: MlsFeedSyncNowProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<MlsFeedSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await syncMlsFeed(shortCode);
        setResult(r);
        if (!r.ok && r.errors.length > 0) {
          setError(r.errors[0]);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  // Status pill colour: green if ok, red if failed, grey if never run.
  const pillClass = !lastSyncAt
    ? "bg-neutral-100 text-neutral-600"
    : lastValidatedOk
      ? "bg-emerald-50 text-emerald-700"
      : "bg-rose-50 text-rose-700";
  const pillLabel = !lastSyncAt
    ? "Never synced"
    : lastValidatedOk
      ? `Last sync ok · ${relativeTime(lastSyncAt)}`
      : `Last sync failed · ${relativeTime(lastSyncAt)}`;

  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
              pillClass,
            )}
          >
            {pillLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending || disabled}
          title={disabled ? disabledReason : undefined}
          className={clsx(
            "btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5",
            (isPending || disabled) && "opacity-60 cursor-not-allowed",
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

      {disabled && disabledReason ? (
        <p className="text-xs text-neutral-500">{disabledReason}</p>
      ) : null}

      {error ? (
        <p className="text-xs text-rose-600 break-words">
          Sync failed: {error}
        </p>
      ) : null}

      {result && result.classes.length > 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs space-y-1">
          <div
            className={clsx(
              "font-medium",
              result.ok ? "text-emerald-700" : "text-rose-700",
            )}
          >
            {result.ok ? "Sync complete" : "Sync had errors"} ·{" "}
            {(result.duration_ms / 1000).toFixed(1)}s
          </div>
          <ul className="space-y-0.5">
            {result.classes.map((c) => (
              <li
                key={c.class}
                className={c.error ? "text-rose-600" : "text-neutral-700"}
              >
                <span className="font-mono">{c.class}</span>:{" "}
                {c.error
                  ? `failed — ${c.error.slice(0, 120)}`
                  : `${c.records_upserted} upserted / ${c.records_seen} seen`}
              </li>
            ))}
          </ul>
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
