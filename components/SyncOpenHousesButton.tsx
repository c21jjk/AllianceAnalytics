"use client";

/**
 * SyncOpenHousesButton — on-demand Open House refresh.
 *
 * 2026-07-31 (John). The 4-hourly cron is fine for most things, but Larissa
 * builds the multi-property Open House carousel on Thursday and Friday
 * mornings, minutes after the office finalises the weekend's schedule. Waiting
 * up to four hours for the next cron — or worse, building the post from a
 * stale list and having to redo it — was the actual friction. This puts the
 * refresh under her thumb, right next to the picker she's about to use.
 *
 * Deliberately honest about coverage: CMC and SJSR sync for real, Bright
 * cannot (licence-restricted OpenHouse resource on our RETS account), and the
 * component says so rather than leaving her to assume three-for-three. The
 * Bright line shows how fresh the Bright rows on file are, so the gap is
 * visible at the one moment it matters — just before she builds.
 *
 * When Bright lifts the restriction, the server action gains a third feed and
 * this component renders it with no changes here.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { RefreshCw, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import {
  syncOpenHousesNowAction,
  type OhSyncReport,
} from "@/app/(app)/post-builder/open-house-actions";

export interface SyncOpenHousesButtonProps {
  /**
   * "full" renders the button plus the result panel underneath (section
   * headers, empty states). "compact" renders just the button and collapses
   * the result to a single line — for tight header rows.
   */
  variant?: "full" | "compact";
  /** Called after a sync completes, before the router refresh. */
  onSynced?: (report: OhSyncReport) => void;
  className?: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 90) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export default function SyncOpenHousesButton({
  variant = "full",
  onSynced,
  className,
}: SyncOpenHousesButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<OhSyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await syncOpenHousesNowAction();
        setReport(r);
        onSynced?.(r);
        // why: the OH lists on this page are server-fetched props. Without the
        // refresh the button would report "3 synced" while the picker below it
        // still showed the old list — the exact confusion this feature exists
        // to remove.
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Sync failed. Please try again.",
        );
      }
    });
  }

  const button = (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={clsx(
        "flex-none inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition",
        isPending
          ? "border-neutral-200 bg-neutral-50 text-neutral-500 cursor-wait"
          : "border-gold-300 bg-gold-50/40 text-gold-800 hover:bg-gold-100",
      )}
    >
      <RefreshCw
        className={clsx("w-3.5 h-3.5", isPending && "animate-spin")}
        aria-hidden="true"
      />
      {isPending ? "Syncing open houses…" : "Sync Open Houses"}
    </button>
  );

  if (variant === "compact") {
    return (
      <div className={clsx("flex flex-col items-start gap-1", className)}>
        {button}
        {error !== null && (
          <span className="text-[11px] text-rose-700">{error}</span>
        )}
        {error === null && report !== null && (
          <span
            className={clsx(
              "text-[11px]",
              report.ok ? "text-neutral-500" : "text-amber-700",
            )}
          >
            {report.ok
              ? `Synced · ${report.upcoming_total} upcoming`
              : "Synced with warnings — see details below"}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      {button}

      {error !== null && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-none" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {error === null && report !== null && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50/70 px-3 py-2.5 text-xs text-neutral-700 space-y-1.5">
          {report.feeds.map((f) => (
            <div key={f.feed} className="flex items-start gap-2">
              {f.ok ? (
                <CheckCircle2
                  className="w-3.5 h-3.5 mt-0.5 flex-none text-emerald-600"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle
                  className="w-3.5 h-3.5 mt-0.5 flex-none text-amber-600"
                  aria-hidden="true"
                />
              )}
              <span>
                <span className="font-medium text-neutral-900">{f.label}</span>
                {f.ok ? (
                  <>
                    {" — "}
                    {f.synced === 0
                      ? "no open houses on the feed"
                      : `${f.synced} open house${f.synced === 1 ? "" : "s"} refreshed`}
                  </>
                ) : (
                  <>
                    {" — couldn't sync"}
                    {f.error ? `: ${f.error}` : "."}
                  </>
                )}
              </span>
            </div>
          ))}

          {/* Bright is a standing gap, not a failure of this run — styled as
              information so it doesn't read as something Larissa broke. */}
          <div className="flex items-start gap-2 border-t border-neutral-200 pt-1.5">
            <Info
              className="w-3.5 h-3.5 mt-0.5 flex-none text-sky-600"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium text-neutral-900">Bright MLS</span>
              {" — "}
              {report.bright.upcoming} upcoming on file, updated{" "}
              {relativeTime(report.bright.last_synced_at)}. {report.bright.note}
            </span>
          </div>

          <div className="border-t border-neutral-200 pt-1.5 text-neutral-600">
            {report.upcoming_total} open house
            {report.upcoming_total === 1 ? "" : "s"} upcoming across all
            sources.
          </div>
        </div>
      )}
    </div>
  );
}
