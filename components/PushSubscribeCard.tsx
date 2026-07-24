"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Smartphone } from "lucide-react";

/**
 * Push-notification opt-in card (mobile Alerts page + anywhere else).
 *
 * Handles the full browser flow: permission prompt → pushManager
 * subscribe with the VAPID public key → POST to /api/push/subscribe.
 * Unsubscribing tears down both the browser subscription and the server
 * row.
 *
 * iOS nuance surfaced in the UI: Safari only exposes the Push API when
 * the app is installed to the home screen (iOS 16.4+). When the API is
 * missing we show install instructions instead of a broken button.
 */

type PushState =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "denied"
  | "off"
  | "on"
  | "busy";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari legacy flag
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function PushSubscribeCard() {
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // iOS exposes the Push API only inside an installed PWA.
        setState(isIos() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        setState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setState("busy");
    setError(null);
    try {
      // Public key is served at runtime (VAPID keys live in the DB, not
      // build-time env) — see /api/push/public-key.
      const keyRes = await fetch("/api/push/public-key");
      const keyJson = await keyRes.json().catch(() => null);
      const publicKey: string | undefined = keyJson?.ok ? keyJson.publicKey : undefined;
      if (!publicKey) {
        throw new Error("Push isn't configured on the server yet.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: json.keys,
          user_agent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error("Couldn't save the subscription.");
      setState("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("off");
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setState("busy");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("on");
    }
  }, []);

  if (state === "loading") return null;

  if (state === "needs-install") {
    return (
      <div className="rounded-2xl border border-gold-200 bg-gold-50/60 p-4 flex gap-3">
        <Smartphone className="w-5 h-5 shrink-0 text-gold-700 mt-0.5" />
        <div className="text-sm text-neutral-700 leading-relaxed">
          <p className="font-semibold text-neutral-900 mb-0.5">
            Install the app to get notifications
          </p>
          <p>
            In Safari tap <span className="font-medium">Share</span> →{" "}
            <span className="font-medium">Add to Home Screen</span>, then open
            Alliance Social from your home screen and turn on alerts here.
          </p>
        </div>
      </div>
    );
  }

  if (state === "unsupported") {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
        This browser doesn&rsquo;t support push notifications.
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
        Notifications are blocked for Alliance Social. Enable them in your
        device Settings → Notifications, then come back here.
      </div>
    );
  }

  const on = state === "on";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-3">
        {on ? (
          <Bell className="w-5 h-5 text-gold-600 shrink-0" />
        ) : (
          <BellOff className="w-5 h-5 text-neutral-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900">
            Push notifications
          </p>
          <p className="text-xs text-neutral-500">
            {on
              ? "On — you'll get publish results and performance alerts."
              : "Get pinged when posts go live and when a post takes off."}
          </p>
        </div>
        <button
          type="button"
          disabled={state === "busy"}
          onClick={on ? unsubscribe : subscribe}
          className={
            on
              ? "shrink-0 rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 active:bg-neutral-100 disabled:opacity-50"
              : "shrink-0 rounded-full bg-gold-500 px-4 py-2 text-sm font-semibold text-neutral-900 active:bg-gold-600 disabled:opacity-50"
          }
        >
          {state === "busy" ? "…" : on ? "Turn off" : "Turn on"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
