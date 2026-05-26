"use client";

/**
 * SyncStatusPill — shared "Synced 12m ago" / "Last sync failed Nm ago" /
 *                  "Never synced" header pill used by BrandPanel + AgentPanel.
 * ------------------------------------------------------------------------
 *
 * Both panels expose the same Sync button + the same drift-visibility need:
 * if the Drive→Supabase sync is silently failing or hasn't run in a while,
 * the user should see that without having to dig into logs. Rather than
 * duplicating the timestamp formatter + state machine in each panel, both
 * import this primitive.
 *
 * States (mutually exclusive, derived from BrandSyncStatus shape):
 *   1. status === undefined          → render nothing (caller didn't wire it).
 *   2. lastSyncedAt === null         → "Never synced" — neutral pill.
 *   3. lastSyncError !== null        → "Last sync failed 12m ago" — rose-700.
 *      The 24h staleness hint is suppressed here; the failure message IS
 *      the action signal.
 *   4. age >= 24h                    → "Synced 2d ago" pill + amber "Could
 *                                       be out of date" sibling pill.
 *   5. otherwise                     → plain "Synced 12m ago" pill.
 *
 * Why a primitive rather than two parallel implementations:
 *   - Same exact decision tree in both panels; copy-paste drift would let
 *     one diverge over time.
 *   - Tailwind classes are identical so we're not encoding any panel-
 *     specific styling here.
 *   - Tiny surface — accepts only what it renders.
 */

import { type JSX, useEffect, useState } from "react";

import type { BrandSyncStatus } from "../contracts";

interface SyncStatusPillProps {
  /** The status row, or undefined when the caller hasn't loaded it yet. */
  status: BrandSyncStatus | undefined;
}

/**
 * Format an ISO timestamp as a compact "Xm/Xh/Xd ago" string.
 *
 * Why custom (not Intl.RelativeTimeFormat):
 *   RTF returns natural-language strings like "2 hours ago" which read fine
 *   in long-form prose but eat the whole pill width. The Brand panel header
 *   is only ~120px wide — we need the terse "12m ago" / "3h ago" form. The
 *   units thresholds match the spec.
 *
 * @param fromIso ISO 8601 timestamp (already validated non-null by caller).
 * @param now Reference "now" timestamp in ms. Defaults to Date.now() — left
 *            injectable so the consuming component can deterministically
 *            re-render every 60s without us having to call Date.now() inside
 *            a useMemo that React might not invalidate.
 * @returns Compact relative-time string, e.g. "12m ago", "3h ago", "2d ago".
 */
export function formatRelativeAge(fromIso: string, now = Date.now()): string {
  const fromMs = new Date(fromIso).getTime();
  // why: defensive — `new Date(invalid).getTime()` returns NaN. If we got a
  // garbage timestamp we don't want to render "NaNm ago"; fall back to "—".
  if (Number.isNaN(fromMs)) return "—";
  const deltaMs = Math.max(0, now - fromMs);
  const deltaMin = Math.floor(deltaMs / 60_000);
  if (deltaMin < 1) return "just now";
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  return `${deltaDay}d ago`;
}

/**
 * Age threshold (ms) at which a successful sync is considered "stale enough
 * to mention". 24h matches the nightly cron cadence — if we're past one
 * cycle without a fresh run, something might be wrong (cron failure, etc).
 */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export default function SyncStatusPill(props: SyncStatusPillProps): JSX.Element | null {
  // why: keep a "now" tick state so the pill text updates from "1m ago" to
  // "2m ago" without a page reload. 60s cadence is enough for minute-level
  // resolution; faster would just waste renders.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const status = props.status;
  if (status === undefined) return null;

  // ---- State 2: never synced ----
  if (!status.lastSyncedAt) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-[var(--studio-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--studio-text-muted)]"
        title="No sync has run yet. Click the refresh icon to run one now."
      >
        Never synced
      </span>
    );
  }

  const age = formatRelativeAge(status.lastSyncedAt, nowMs);

  // ---- State 3: failed ----
  if (status.lastSyncError !== null) {
    // why: title attribute carries the full error message so power users can
    // hover for the stack trace without us making the pill itself wider.
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-rose-950/40 px-2 py-0.5 text-[10px] font-medium text-rose-200"
        title={`Last sync failed: ${status.lastSyncError}`}
      >
        <FailureDot />
        Last sync failed {age}
      </span>
    );
  }

  // ---- State 4/5: success ----
  const ageMs = Math.max(0, nowMs - new Date(status.lastSyncedAt).getTime());
  const isStale = ageMs >= STALE_THRESHOLD_MS;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-200"
        title={`Last successful sync at ${new Date(status.lastSyncedAt).toLocaleString()}`}
      >
        <SuccessDot />
        Synced {age}
      </span>
      {isStale ? (
        <span
          className="inline-flex items-center rounded-full bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium text-amber-200"
          title="Last sync is over 24 hours old. Click refresh to pull the latest from Drive."
        >
          Could be out of date
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tiny status-dot SVGs — sized to read inline at 10px font without throwing
// the pill out of alignment. Solid fills are intentional: a stroke-only
// glyph would visually disappear at this scale on retina screens.
// ---------------------------------------------------------------------------

function SuccessDot(): JSX.Element {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
      <circle cx="3" cy="3" r="3" fill="currentColor" />
    </svg>
  );
}

function FailureDot(): JSX.Element {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true">
      <circle cx="3" cy="3" r="3" fill="currentColor" />
    </svg>
  );
}
