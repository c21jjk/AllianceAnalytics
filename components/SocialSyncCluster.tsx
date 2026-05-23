"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { AccountHealth, Platform } from "@/lib/types/post";
import { syncOne, runGrouperAction } from "@/lib/sync/actions";
import PlatformHealthPill from "./PlatformHealthPill";

/**
 * Compact replacement for the old SyncNowButton "Social Platforms" block.
 *
 * Renders the trigger button INLINE with the FB / IG / TT health pills so
 * the whole social sync row fits on one line:
 *
 *   [ ↻ Sync Social ]  [FB pill]  [IG pill]  [TT pill]
 *
 * Per-platform sync state (idle / syncing / error) is owned here and
 * threaded into each pill via its `syncing` + `syncError` props — the
 * pill flips its dot to a spinner during the platform's leg of the
 * sequential run, then back to a fresh status dot once the action
 * resolves and `router.refresh()` rehydrates the server-side health
 * snapshot.
 *
 * Admin-only: the trigger button is hidden when `canSync=false`. The
 * pills still render so non-admins can see freshness.
 *
 * Why sequential per platform (not parallel like the old syncAll button):
 *   matches the previous SyncNowButton behavior — when 1 of 3 fails,
 *   admins can pinpoint the offender via the spinner that turned into a
 *   red dot, then re-trigger the whole cluster. The cross-platform
 *   grouper fires once at the end so late-arriving posts get folded into
 *   existing groups.
 */

const SOCIAL_PLATFORMS: { key: Platform; label: string }[] = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
];

interface SocialSyncClusterProps {
  health: AccountHealth[];
  /** Admin-only trigger. Pills still render when false. */
  canSync?: boolean;
  className?: string;
}

type PerPlatformState = "idle" | "syncing";

export default function SocialSyncCluster({
  health,
  canSync = false,
  className,
}: SocialSyncClusterProps) {
  const router = useRouter();
  const [state, setState] = useState<Record<Platform, PerPlatformState>>({
    facebook: "idle",
    instagram: "idle",
    tiktok: "idle",
  });
  const [errors, setErrors] = useState<Partial<Record<Platform, string>>>({});
  const [pending, startTransition] = useTransition();

  function runSync() {
    // why: reset error chrome at the start so a stale red dot doesn't
    // linger into the new run. Per-platform state flips to "syncing"
    // inside the loop, one at a time.
    setErrors({});
    setState({ facebook: "idle", instagram: "idle", tiktok: "idle" });

    startTransition(async () => {
      for (const p of SOCIAL_PLATFORMS) {
        setState((prev) => ({ ...prev, [p.key]: "syncing" }));
        try {
          const r = await syncOne(p.key);
          if (!r.ok) {
            setErrors((prev) => ({
              ...prev,
              [p.key]:
                r.errors[0]?.message ?? "Sync reported failure with no detail.",
            }));
          }
        } catch (e) {
          setErrors((prev) => ({
            ...prev,
            [p.key]: (e as Error).message,
          }));
        } finally {
          setState((prev) => ({ ...prev, [p.key]: "idle" }));
        }
      }

      // Grouper is best-effort — surfacing its failure here would be noise
      // since the per-platform pills already show what broke upstream.
      try {
        await runGrouperAction();
      } catch {
        // intentional swallow
      }

      // Refresh server data so the pill timestamps reflect the new
      // last_synced_at values written by the Edge Functions above.
      router.refresh();
    });
  }

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 flex-wrap",
        className,
      )}
    >
      {canSync ? (
        <SyncTriggerButton
          label="Sync Social"
          pending={pending}
          onClick={runSync}
        />
      ) : null}
      {health.map((h) => (
        <PlatformHealthPill
          key={h.platform}
          health={h}
          syncing={state[h.platform] === "syncing"}
          syncError={errors[h.platform] ?? null}
        />
      ))}
    </span>
  );
}

/**
 * Pill-shaped trigger button so the sync action visually belongs with
 * the FB / IG / TT pills it operates on. Same height + ring style as the
 * health pills; only the fill + icon distinguish it as an action.
 */
function SyncTriggerButton(props: {
  label: string;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.pending}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full pl-2 pr-2.5 py-1",
        "ring-1 ring-neutral-200 text-xs font-semibold",
        "bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-700",
        "disabled:bg-neutral-300 disabled:text-neutral-500 disabled:cursor-not-allowed",
        "transition",
      )}
      title={props.pending ? "Sync in progress…" : props.label}
    >
      {props.pending ? <ButtonSpinner /> : <SyncIcon />}
      {props.label}
    </button>
  );
}

function ButtonSpinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3 animate-spin"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeOpacity={0.35}
      />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M4 4v4h4M20 20v-4h-4"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
