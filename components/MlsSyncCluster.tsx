"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { MlsFeedHealth } from "@/lib/types/post";
import { syncOneMls } from "@/lib/sync/actions";
import MlsHealthPill from "./MlsHealthPill";

/**
 * Compact replacement for the old SyncNowButton "MLS Feeds" block.
 *
 * Renders the trigger button INLINE with the feed health pills so the
 * whole MLS sync row fits on one line:
 *
 *   [ ↻ Sync MLS ]  [CMC pill]  [SJSR pill]  [BR pill]
 *
 * The set of feeds is data-driven off the server's mlsHealth array, so
 * adding Bright later is a single-row Supabase insert + nothing here
 * needs to change. `syncOneMls`'s feed-key type widens automatically as
 * new entries land in mls_feeds.
 *
 * Admin-only: the trigger is hidden when `canSync=false`; pills still
 * render so non-admins can see freshness.
 */

interface MlsSyncClusterProps {
  mlsHealth: MlsFeedHealth[];
  /** Admin-only trigger. Pills still render when false. */
  canSync?: boolean;
  className?: string;
}

type PerFeedState = "idle" | "syncing";

// why: syncOneMls is typed against the RETS feed union (cmc | sjsr | bright
// as of 2026-09-02). Cast here so the data-driven loop compiles against the
// current union without re-narrowing in this component.
type MlsFeedKey = Parameters<typeof syncOneMls>[0];

export default function MlsSyncCluster({
  mlsHealth,
  canSync = false,
  className,
}: MlsSyncClusterProps) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, PerFeedState>>(() =>
    Object.fromEntries(mlsHealth.map((f) => [f.short_code, "idle"])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function runSync() {
    setErrors({});
    setState(Object.fromEntries(mlsHealth.map((f) => [f.short_code, "idle"])));

    startTransition(async () => {
      for (const f of mlsHealth) {
        setState((prev) => ({ ...prev, [f.short_code]: "syncing" }));
        try {
          const r = await syncOneMls(
            f.short_code.toLowerCase() as MlsFeedKey,
          );
          if (!r.ok) {
            setErrors((prev) => ({
              ...prev,
              [f.short_code]:
                r.errors[0]?.message ?? "Sync reported failure with no detail.",
            }));
          }
        } catch (e) {
          setErrors((prev) => ({
            ...prev,
            [f.short_code]: (e as Error).message,
          }));
        } finally {
          setState((prev) => ({ ...prev, [f.short_code]: "idle" }));
        }
      }

      // Refresh server data so the pill timestamps reflect the new
      // last_synced_at values written by the RETS sync above.
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
          label="Sync MLS"
          pending={pending}
          onClick={runSync}
        />
      ) : null}
      {mlsHealth.map((m) => (
        <MlsHealthPill
          key={m.short_code}
          health={m}
          syncing={state[m.short_code] === "syncing"}
          syncError={errors[m.short_code] ?? null}
        />
      ))}
    </span>
  );
}

/**
 * Pill-shaped trigger button so the sync action visually belongs with
 * the feed pills it operates on. Same height + ring style as the health
 * pills; only the fill + icon distinguish it as an action.
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
