"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js) once on mount. Rendered in
 * the root layout so registration happens on every entry point — the SW
 * powers app-shell caching, the offline fallback, and Web Push delivery
 * for the installed PWA.
 *
 * Registration is skipped in development: a stale SW intercepting Next
 * dev-server requests is a classic source of "why isn't my change
 * showing" confusion.
 */
export default function PwaRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[pwa] service worker registration failed", err));
  }, []);

  return null;
}
