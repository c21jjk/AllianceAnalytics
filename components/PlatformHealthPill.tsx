import clsx from "clsx";
import type { AccountHealth } from "@/lib/types/post";
import { formatRelativeTime } from "@/lib/format";
import PlatformBadge, { platformLabel } from "./PlatformBadge";

interface PlatformHealthPillProps {
  health: AccountHealth;
  /**
   * Phase 2M — when true, the pill renders an inline spinner in place of
   * the status dot. Driven by SocialSyncCluster while a manual sync is
   * in flight for this platform. Leaves the timestamp text alone so the
   * pill doesn't reflow.
   */
  syncing?: boolean;
  /**
   * Phase 2M — most-recent error message from a manual sync attempt. When
   * set, the status dot turns rose and the message is appended to the
   * hover tooltip so admins can read it without leaving the dashboard.
   */
  syncError?: string | null;
  className?: string;
}

const STATUS_DOT: Record<AccountHealth["status"], string> = {
  connected: "bg-emerald-500",
  needs_attention: "bg-amber-500",
  disconnected: "bg-rose-500",
};

const STATUS_LABEL: Record<AccountHealth["status"], string> = {
  connected: "Connected",
  needs_attention: "Needs attention",
  disconnected: "Disconnected",
};

export default function PlatformHealthPill({
  health,
  syncing = false,
  syncError = null,
  className,
}: PlatformHealthPillProps) {
  const synced = formatRelativeTime(health.last_synced_at);
  const nextRun = health.next_scheduled_at
    ? formatRelativeTime(health.next_scheduled_at)
    : null;
  const tooltip = [
    `${platformLabel(health.platform)} · ${STATUS_LABEL[health.status]}`,
    `last synced ${synced}`,
    nextRun ? `next auto-sync ${nextRun}` : null,
    syncing ? "syncing now…" : null,
    syncError ? `last manual sync failed: ${syncError}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full bg-white pl-1 pr-2.5 py-1",
        "ring-1 ring-neutral-200 text-xs font-medium text-neutral-700",
        "hover:ring-neutral-300 transition",
        className,
      )}
      title={tooltip}
    >
      <PlatformBadge platform={health.platform} size="sm" />
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

/**
 * Tiny inline spinner sized to replace the 1.5×1.5 status dot without
 * reflowing the pill. Stroke uses the same neutral that the timestamp
 * text uses so the chip stays calm during sync.
 */
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
