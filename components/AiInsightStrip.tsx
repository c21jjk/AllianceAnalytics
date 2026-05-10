"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AiInsight } from "@/lib/types/group";

/**
 * Compact AI insight bar.
 *
 * Two render modes:
 *   1. Static insight (legacy): pass `insight` prop directly. Used by GroupCard
 *      with a heuristic-derived insight from the group payload.
 *   2. Live insight: pass `postId` and the strip fetches /api/ai/insight,
 *      caches the result client-side per id, and renders when ready. If
 *      Anthropic isn't configured the API returns null and the strip hides
 *      itself silently.
 *
 * Tonal variants: info | success | warning | quiet (warning is new — added
 * for live API mode; legacy callers using AiInsight.tone still resolve).
 */

type ApiInsightTone = "info" | "success" | "warning" | "quiet";
type ApiActionKind =
  | "boost_ig"
  | "boost_fb"
  | "boost_tt"
  | "pin_ig"
  | null;

interface ApiInsight {
  tone: ApiInsightTone;
  headline: string;
  body: string;
  action_label?: string;
  action_kind?: ApiActionKind;
  est_reach?: number;
  est_cost?: number;
}

interface AiInsightStripProps {
  /** Pre-computed insight (legacy GroupCard mode). */
  insight?: AiInsight;
  /** Post id — when provided, the strip fetches a live insight from /api/ai/insight. */
  postId?: string;
  className?: string;
}

/** Sentinel returned by the API when the post is < 24h old. We render a
 *  muted "performance settling" placeholder rather than fake coaching. */
const TOO_RECENT = "__too_recent__" as const;
type LiveCacheValue = ApiInsight | null | typeof TOO_RECENT;

// Module-level cache so re-renders + sibling components don't re-fetch.
const liveCache = new Map<string, LiveCacheValue>();

export default function AiInsightStrip({
  insight,
  postId,
  className,
}: AiInsightStripProps) {
  const cachedAtMount = postId ? liveCache.get(postId) : undefined;
  const [liveInsight, setLiveInsight] = useState<LiveCacheValue | undefined>(
    cachedAtMount,
  );
  const [loading, setLoading] = useState<boolean>(
    Boolean(postId) && cachedAtMount === undefined,
  );
  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    if (!postId) return;
    if (liveCache.has(postId)) {
      setLiveInsight(liveCache.get(postId) ?? null);
      setLoading(false);
      return;
    }
    if (inFlight.current === postId) return;
    inFlight.current = postId;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/ai/insight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ post_id: postId }),
        });
        if (!res.ok) {
          liveCache.set(postId, null);
          setLiveInsight(null);
          return;
        }
        const json = (await res.json()) as {
          insight?: ApiInsight | null;
          too_recent?: boolean;
        };
        const got: LiveCacheValue = json.too_recent
          ? TOO_RECENT
          : json.insight ?? null;
        liveCache.set(postId, got);
        setLiveInsight(got);
      } catch {
        liveCache.set(postId, null);
        setLiveInsight(null);
      } finally {
        if (inFlight.current === postId) inFlight.current = null;
        setLoading(false);
      }
    })();
  }, [postId]);

  // useMemo on the resolved insight so display values stay stable.
  const display = useMemo<ApiInsight | AiInsight | null>(() => {
    if (postId) {
      // Treat the too-recent sentinel as "no insight" for the display path —
      // we render a dedicated placeholder below before reaching this branch.
      if (liveInsight === TOO_RECENT) return null;
      return liveInsight ?? null;
    }
    return insight ?? null;
  }, [postId, liveInsight, insight]);

  // Loading skeleton (live mode only).
  if (postId && loading) {
    return (
      <div
        className={clsx(
          "flex items-center gap-2 rounded-lg ring-1 ring-neutral-200 bg-neutral-50 px-3 py-2",
          className,
        )}
        aria-busy="true"
        aria-label="Loading AI insight"
      >
        <SparkleIcon className="text-neutral-300" />
        <span className="inline-block h-2 w-24 rounded bg-neutral-200 animate-pulse" />
        <span className="inline-block h-2 w-40 rounded bg-neutral-200 animate-pulse" />
      </div>
    );
  }

  // Post is < 24h old — render a muted "settling" placeholder so the user
  // knows tracking is on but coaching needs more performance data.
  if (postId && liveInsight === TOO_RECENT) {
    return (
      <div
        className={clsx(
          "flex items-center gap-2 text-xs text-neutral-500",
          className,
        )}
        title="AI coaching insight unlocks 24 hours after posting — early-day metrics are too noisy to draw conclusions from."
      >
        <SparkleIcon className="text-neutral-400" />
        <span>Performance settling — coaching unlocks 24h after posting.</span>
      </div>
    );
  }

  // Live mode but API returned null (no key configured / error / no insight)
  // → hide silently.
  if (postId && !display) {
    return null;
  }

  // Static-mode fallback (no insight passed) keeps prior "tracking normal" UI.
  if (!display || display.tone === "quiet") {
    if (!display && postId) return null;
    const body = display?.body ?? "Tracking normal.";
    return (
      <div
        className={clsx(
          "flex items-center gap-2 text-xs text-neutral-500",
          className,
        )}
      >
        <SparkleIcon className="text-neutral-400" />
        <span>{body}</span>
      </div>
    );
  }

  const tone = display.tone;
  const tonedClasses =
    tone === "success"
      ? "bg-green-50 ring-green-100 text-green-900"
      : tone === "warning"
        ? "bg-amber-50 ring-amber-100 text-amber-900"
        : "bg-blue-50 ring-blue-100 text-blue-900";
  const iconColor =
    tone === "success"
      ? "text-green-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-blue-700";
  const linkColor =
    tone === "success"
      ? "text-green-800 hover:text-green-900"
      : tone === "warning"
        ? "text-amber-800 hover:text-amber-900"
        : "text-blue-800 hover:text-blue-900";

  // Resolve href: legacy AiInsight has action_href; ApiInsight does not yet.
  const actionHref =
    "action_href" in display && typeof display.action_href === "string"
      ? display.action_href
      : "#";

  return (
    <div
      className={clsx(
        "flex items-start gap-2 rounded-lg ring-1 px-3 py-2 text-xs",
        tonedClasses,
        className,
      )}
    >
      <SparkleIcon className={clsx("mt-0.5 shrink-0", iconColor)} />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">{display.headline}</span>{" "}
        <span className="text-neutral-700">{display.body}</span>
      </div>
      {display.action_label ? (
        <a
          href={actionHref}
          className={clsx(
            "shrink-0 inline-flex items-center gap-0.5 font-medium",
            linkColor,
          )}
        >
          {display.action_label}
          <ArrowUpRight />
        </a>
      ) : null}
    </div>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={clsx("w-4 h-4", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path
        d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8L16.5 17.5l1.8-.7L19 15z"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowUpRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 17L17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
