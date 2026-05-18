"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { syncOne, syncOneMls, runGrouperAction } from "@/lib/sync/actions";
import type { Platform } from "@/lib/types/post";

/**
 * Admin-only sync panel rendered on the dashboard.
 *
 * Two top-level triggers:
 *
 *   1. "Sync Social Platforms" — sequentially invokes the FB, IG, and TT
 *      sync Edge Functions. Each platform carries its own pill that flips
 *      idle → spinning → success/error inline. When all three resolve,
 *      the cross-platform grouper RPC runs so late arrivals get folded into
 *      existing groups.
 *
 *   2. "Sync MLS Feeds" — sequentially invokes the RETS sync for each
 *      configured feed. Same pill state model. Feeds are listed in a
 *      data-driven array so adding Bright later is a one-line change.
 *
 * Why sequential per group (not parallel like syncAll):
 *   The previous "Sync all platforms" button ran everything in parallel and
 *   surfaced a single combined result, which made debugging a partial failure
 *   awkward — when 2 of 5 things failed, retrying meant re-running the 3
 *   that succeeded too. Per-platform pills let admins see exactly what
 *   broke and re-trigger just the failing group.
 *
 * Why two separate triggers (not one master button):
 *   Social and MLS are independent concerns with independent failure modes.
 *   When the MLS feed is having a slow day, you don't want to wait through
 *   it before retrying a Meta sync. Keeping them on separate triggers also
 *   lets the buttons short-circuit when only one tier needs attention.
 *
 * Errors render inline beneath the failing pill with the full server
 * message, not just "failed", so admins can read what broke without
 * opening Vercel logs.
 */

const SOCIAL_PLATFORMS: { key: Platform; label: string }[] = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
];

const MLS_FEEDS: { key: "cmc" | "sjsr"; label: string }[] = [
  { key: "cmc", label: "CMC" },
  { key: "sjsr", label: "SJSR" },
  // why: when Bright comes online, add `{ key: "bright", label: "Bright" }`
  // here. The feed-key type widens automatically because syncOneMls already
  // accepts the union "cmc" | "sjsr" (extend that signature too).
];

type PillState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "done";
      label: string; // green summary, e.g. "+3 new, 219 updated"
    }
  | {
      status: "error";
      message: string;
    };

interface SyncNowButtonProps {
  className?: string;
}

export default function SyncNowButton({ className }: SyncNowButtonProps) {
  const [socialState, setSocialState] = useState<Record<Platform, PillState>>({
    facebook: { status: "idle" },
    instagram: { status: "idle" },
    tiktok: { status: "idle" },
  });

  const [mlsState, setMlsState] = useState<Record<string, PillState>>(() =>
    Object.fromEntries(MLS_FEEDS.map((f) => [f.key, { status: "idle" }])),
  );

  const [grouper, setGrouper] = useState<{
    groups_created: number;
    posts_assigned: number;
  } | null>(null);

  const [socialPending, startSocialTransition] = useTransition();
  const [mlsPending, startMlsTransition] = useTransition();

  function runSocialSync() {
    setGrouper(null);
    // why: reset pills to idle at the start so a previous error doesn't
    // linger as red while the new run is in flight. Also flips the just-
    // about-to-run platform to "running" so feedback is instant.
    setSocialState({
      facebook: { status: "idle" },
      instagram: { status: "idle" },
      tiktok: { status: "idle" },
    });

    startSocialTransition(async () => {
      for (const p of SOCIAL_PLATFORMS) {
        setSocialState((prev) => ({
          ...prev,
          [p.key]: { status: "running" },
        }));
        try {
          const r = await syncOne(p.key);
          if (r.ok) {
            setSocialState((prev) => ({
              ...prev,
              [p.key]: {
                status: "done",
                label: `+${r.inserted} new, ${r.updated} updated`,
              },
            }));
          } else {
            setSocialState((prev) => ({
              ...prev,
              [p.key]: {
                status: "error",
                message:
                  r.errors[0]?.message ?? "Sync reported failure with no detail.",
              },
            }));
          }
        } catch (e) {
          setSocialState((prev) => ({
            ...prev,
            [p.key]: {
              status: "error",
              message: (e as Error).message,
            },
          }));
        }
      }

      // After all 3 social syncs complete (success OR failure), fire the
      // grouper so late-arriving posts get folded into existing groups.
      try {
        const g = await runGrouperAction();
        if (g) setGrouper(g);
      } catch {
        // why: grouper is best-effort; pill-level errors already surfaced
        // the upstream sync failures, so this is just plumbing.
      }
    });
  }

  function runMlsSync() {
    setMlsState(
      Object.fromEntries(MLS_FEEDS.map((f) => [f.key, { status: "idle" }])),
    );

    startMlsTransition(async () => {
      for (const f of MLS_FEEDS) {
        setMlsState((prev) => ({
          ...prev,
          [f.key]: { status: "running" },
        }));
        try {
          const r = await syncOneMls(f.key);
          if (r.ok) {
            setMlsState((prev) => ({
              ...prev,
              [f.key]: {
                status: "done",
                label: `${r.total_upserted} listing${r.total_upserted === 1 ? "" : "s"} synced`,
              },
            }));
          } else {
            setMlsState((prev) => ({
              ...prev,
              [f.key]: {
                status: "error",
                message:
                  r.errors[0]?.message ?? "Sync reported failure with no detail.",
              },
            }));
          }
        } catch (e) {
          setMlsState((prev) => ({
            ...prev,
            [f.key]: {
              status: "error",
              message: (e as Error).message,
            },
          }));
        }
      }
    });
  }

  return (
    <div className={clsx("flex flex-col gap-3 items-stretch", className)}>
      <SyncGroup
        title="Social Platforms"
        buttonLabel="Sync Social"
        pendingLabel={
          socialPending
            ? activeRunningLabel(socialState, SOCIAL_PLATFORMS)
            : null
        }
        pending={socialPending}
        onClick={runSocialSync}
        pills={SOCIAL_PLATFORMS.map((p) => ({
          key: p.key,
          label: p.label,
          state: socialState[p.key],
        }))}
        footer={
          grouper ? (
            <span className="text-[11px] text-neutral-400">
              merged: +{grouper.groups_created} groups,{" "}
              {grouper.posts_assigned} posts
            </span>
          ) : null
        }
      />

      <SyncGroup
        title="MLS Feeds"
        buttonLabel="Sync MLS"
        pendingLabel={
          mlsPending
            ? activeRunningLabel(mlsState, MLS_FEEDS)
            : null
        }
        pending={mlsPending}
        onClick={runMlsSync}
        pills={MLS_FEEDS.map((f) => ({
          key: f.key,
          label: f.label,
          state: mlsState[f.key],
        }))}
      />
    </div>
  );
}

/**
 * Find the platform/feed currently in "running" state and produce a button
 * label like "Syncing Facebook…". Returns the first "running" item — there's
 * at most one because the loop is sequential.
 */
function activeRunningLabel<T extends { key: string; label: string }>(
  state: Record<string, PillState>,
  items: T[],
): string | null {
  for (const it of items) {
    if (state[it.key]?.status === "running") {
      return `Syncing ${it.label}…`;
    }
  }
  return null;
}

function SyncGroup(props: {
  title: string;
  buttonLabel: string;
  pendingLabel: string | null;
  pending: boolean;
  onClick: () => void;
  pills: { key: string; label: string; state: PillState }[];
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          {props.title}
        </span>
        <button
          type="button"
          onClick={props.onClick}
          disabled={props.pending}
          className={clsx(
            "btn-secondary text-xs px-3 py-1.5",
            "inline-flex items-center gap-1.5",
          )}
        >
          {props.pending ? (
            <>
              <Spinner />
              {props.pendingLabel ?? "Syncing…"}
            </>
          ) : (
            <>
              <SyncIcon />
              {props.buttonLabel}
            </>
          )}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {props.pills.map((p) => (
          <Pill key={p.key} label={p.label} state={p.state} />
        ))}
      </div>

      {props.footer}
    </div>
  );
}

function Pill({ label, state }: { label: string; state: PillState }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px] leading-tight">
      <span className="text-neutral-700 font-medium">{label}</span>
      <span className="text-right flex-1 min-w-0">
        {state.status === "idle" ? (
          <span className="text-neutral-400">—</span>
        ) : state.status === "running" ? (
          <span className="inline-flex items-center gap-1 text-neutral-500">
            <Spinner />
            syncing…
          </span>
        ) : state.status === "done" ? (
          <span className="text-emerald-600">{state.label}</span>
        ) : (
          <span
            className="text-rose-600 break-words inline-block max-w-full"
            title={state.message}
          >
            {truncate(state.message, 120)}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Trim long error messages for inline display. Full message stays in the
 * `title` attribute so an admin can hover for the whole string.
 */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
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
