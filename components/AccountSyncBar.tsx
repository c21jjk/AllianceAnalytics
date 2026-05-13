import type { AccountHealth, MlsFeedHealth } from "@/lib/types/post";
import PlatformHealthPill from "./PlatformHealthPill";
import MlsHealthPill from "./MlsHealthPill";

interface AccountSyncBarProps {
  health: AccountHealth[];
  /** MLS feed health (CMC, SJSR, Bright). Renders to the right of the
   *  social platform pills. Optional so older callers still compile. */
  mlsHealth?: MlsFeedHealth[];
  className?: string;
}

/**
 * Sync status strip at the top of the dashboard. Two clusters:
 *   - Social platforms (FB / IG / TT) — drives off posts.last_synced_at,
 *     so the timestamp reflects "sync actually wrote data" even when the
 *     Edge Function times out before recording a clean run.
 *   - MLS feeds (CMC / SJSR / Bright) — drives off mls_feeds.last_sync_at.
 *
 * Visual separator between the clusters so admins can scan either side.
 */
export default function AccountSyncBar({
  health,
  mlsHealth = [],
  className,
}: AccountSyncBarProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
          Sync
        </span>
        {health.map((h) => (
          <PlatformHealthPill key={h.platform} health={h} />
        ))}

        {mlsHealth.length > 0 ? (
          <>
            <span
              aria-hidden="true"
              className="inline-block w-px h-4 bg-neutral-200 mx-1"
            />
            {mlsHealth.map((m) => (
              <MlsHealthPill key={m.short_code} health={m} />
            ))}
          </>
        ) : null}

        <span
          className="text-[11px] text-neutral-400 ml-1"
          title="Auto-sync runs every 4 hours via pg_cron — IG :05, FB :15, TT :25 (UTC). MLS feeds run on the same 4h cadence + a dedicated Thursday 3pm EDT pull. Hover a pill to see specifics."
        >
          · auto every 4h
        </span>
      </div>
    </div>
  );
}
