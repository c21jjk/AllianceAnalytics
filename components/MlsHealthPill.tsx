import clsx from "clsx";
import type { MlsFeedHealth } from "@/lib/types/post";
import { formatRelativeTime } from "@/lib/format";

interface MlsHealthPillProps {
  health: MlsFeedHealth;
  /**
   * Phase 2M — when true, the pill renders an inline spinner in place of
   * the status dot. Driven by MlsSyncCluster while a manual sync is in
   * flight for this feed.
   */
  syncing?: boolean;
  /**
   * Phase 2M — most-recent error message from a manual sync attempt. When
   * set, the status dot turns rose and the message is appended to the
   * hover tooltip.
   */
  syncError?: string | null;
  className?: string;
}

const STATUS_DOT: Record<MlsFeedHealth["status"], string> = {
  connected: "bg-emerald-500",
  needs_attention: "bg-amber-500",
  disconnected: "bg-neutral-300",
};

const STATUS_LABEL: Record<MlsFeedHealth["status"], string> = {
  connected: "Connected",
  needs_attention: "Needs attention",
  disconnected: "Not connected",
};

/**
 * Sync-bar chip for the three Paragon RETS feeds (CMC, SJSR, Bright).
 * Visual analog of PlatformHealthPill — same shape, same status colors,
 * different left-side label glyph so admins can tell social vs MLS at a
 * glance without reading.
 */
export default function MlsHealthPill({
  health,
  syncing = false,
  syncError = null,
  className,
}: MlsHealthPillProps) {
  const synced = health.last_synced_at
    ? formatRelativeTime(health.last_synced_at)
    : "never";
  const tooltip = [
    `${health.short_label} MLS · ${STATUS_LABEL[health.status]}`,
    health.last_synced_at ? `last synced ${synced}` : "no successful sync yet",
    `${health.active_listings} active listing${
      health.active_listings === 1 ? "" : "s"
    } tracked`,
    syncing ? "syncing now…" : null,
    syncError ? `last manual sync failed: ${syncError}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full bg-white pl-1.5 pr-2.5 py-1",
        "ring-1 ring-neutral-200 text-xs font-medium text-neutral-700",
        "hover:ring-neutral-300 transition",
        className,
      )}
      title={tooltip}
    >
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-neutral-100 ring-1 ring-neutral-200 text-[9px] font-bold text-neutral-700 tracking-tight"
      >
        {health.short_label.slice(0, 2).toUpperCase()}
      </span>
      {syncing ? (
        <PillSpinner />
      ) : (
        <span
          className={clsx(
            "w-1.5 h-1.5 rounded-full",
            syncError ? "bg-rose-500" : STATUS_DOT[health.status],
          )}
          aria-hidden="true"
        />
      )}
      <span className={clsx(syncError ? "text-rose-600" : "text-neutral-500")}>
        {syncing ? "syncing…" : synced}
      </span>
    </span>
  );
}

function PillSpinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-2.5 h-2.5 animate-spin text-neutral-500"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={3}
        strokeOpacity={0.25}
      />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
}
