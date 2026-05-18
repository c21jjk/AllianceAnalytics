"use client";

import { useEffect, useRef } from "react";
import { bumpLastActiveAction } from "@/app/(app)/activity-actions";

/**
 * Invisible component that bumps profiles.last_active_at for the signed-in
 * user so the Users page can show "Last Active" (real activity) instead of
 * "Last Sign-In" (only updates on fresh login).
 *
 * Cadence:
 *   • Fire once on mount — covers the case where a user opens the app and
 *     immediately walks away. We still want to record that they showed up.
 *   • setInterval every HEARTBEAT_MS while the tab is visible.
 *   • visibilitychange listener: when the tab goes hidden, suppress the
 *     interval; when it comes back, fire immediately + resume the interval.
 *
 * Why visibility-aware:
 *   If we kept beating in the background, a tab left open overnight would
 *   show as "active now" the entire time — which is misleading. Tying the
 *   beacon to visibility makes "last active" mean what it sounds like.
 *
 * Server-side debouncing:
 *   The action skips DB writes when the previous timestamp is fresher than
 *   2 min, so this component being chatty is harmless. We pick 5 min on the
 *   client side to balance freshness vs. request volume.
 */

const HEARTBEAT_MS = 5 * 60 * 1000; // 5 minutes

export default function LastActiveBeacon() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // why: catch all errors so a network glitch doesn't surface as an
    // unhandled-rejection in dev. The user doesn't need to know if a single
    // heartbeat failed — the next one will refresh the timestamp.
    function fire() {
      bumpLastActiveAction().catch(() => undefined);
    }

    function startInterval() {
      if (intervalRef.current !== null) return;
      intervalRef.current = setInterval(fire, HEARTBEAT_MS);
    }

    function stopInterval() {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        fire();
        startInterval();
      } else {
        stopInterval();
      }
    }

    // Initial heartbeat — record that the user showed up.
    fire();
    startInterval();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopInterval();
    };
  }, []);

  return null;
}
