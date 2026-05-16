import type { AccountHealth, MlsFeedHealth } from "@/lib/types/post";
import PlatformHealthPill from "./PlatformHealthPill";
import MlsHealthPill from "./MlsHealthPill";

interface AccountSyncBarProps {
  /**
   * Social platform health (FB / IG / TT). Optional so callers can render
   * an MLS-only bar (e.g., the top of the dashboard, where social pills
   * have moved adjacent to the post stream).
   */
  health?: AccountHealth[];
  /**
   * MLS feed health (CMC, SJSR, Bright). Optional so callers can render
   * a social-only bar (e.g., the post-stream header).
   */
  mlsHealth?: MlsFeedHealth[];
  /**
   * When true, hide the trailing "· auto every 4h" caption. Useful for the
   * inline social bar above the post stream where vertical real estate is
   * tighter — the same caption is already shown alongside the MLS cluster
   * up top, so duplicating it is noise.
   */
  hideAutoCaption?: boolean;
  className?: string;
}

/**
 * Sync status strip used in two locations on the dashboard:
 *   1. Top of page — MLS feeds (CMC / SJSR / Bright), drives off
 *      mls_feeds.last_sync_at.
 *   2. Above the post stream — social platforms (FB / IG / TT), drives off
 *      posts.last_synced_at so the timestamp reflects "sync actually wrote
 *      data" even when the Edge Function times out before recording a
 *      clean run.
 *
 * Each cluster is independently optional. When both are passed, a vertical
 * separator divides them — that's the legacy single-bar shape we still
 * support for any caller that wants the combined view.
 */
export default function AccountSyncBar({
  health = [],
  mlsHealth = [],
  hideAutoCaption = false,
  className,
}: AccountSyncBarProps) {
  const showSocial = health.length > 0;
  const showMls = mlsHealth.length > 0;
  // why: render nothing rather than an empty "Sync" label when the caller
  // passes no health data — happens during initial sync setup before any
  // pill has data to show.
  if (!showSocial && !showMls) return null;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
          Sync
        </span>
        {showSocial
          ? health.map((h) => <PlatformHealthPill key={h.platform} health={h} />)
          : null}

        {showSocial && showMls ? (
          <span
            aria-hidden="true"
            className="inline-block w-px h-4 bg-neutral-200 mx-1"
          />
        ) : null}

        {showMls
          ? mlsHealth.map((m) => <MlsHealthPill key={m.short_code} health={m} />)
          : null}

        {hideAutoCaption ? null : (
          <span
            className="text-[11px] text-neutral-400 ml-1"
            title="Auto-sync runs every 4 hours via pg_cron — IG :05, FB :15, TT :25, MLS-CMC :35, MLS-SJSR :45 (UTC). Hover a pill to see when each feed last completed."
          >
            · auto every 4h
          </span>
        )}
      </div>
    </div>
  );
}
