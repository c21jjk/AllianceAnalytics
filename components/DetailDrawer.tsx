"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface DetailDrawerProps {
  /** Title shown in the sticky header. */
  title: string;
  /** Path the "View full page ↗" link points at. Defaults to a no-op when omitted. */
  fullPagePath?: string;
  /** When set, an "X close" + Esc + backdrop click run router.back() then fall
   *  back to this path if no history pop happened. */
  fallbackPath?: string;
  /** Optional sub-line under the title, e.g. relative time. */
  subtitle?: string;
  /** Server- or client-rendered drawer body. */
  children: React.ReactNode;
}

/**
 * Generic right-side drawer chrome rendered on top of the (app) layout. Wired
 * via the `@modal` parallel route slot + an intercepting `(.)…` route, so:
 *   - In-app click → URL becomes the intercepted path, drawer opens, the
 *     underlying page stays mounted behind a dim layer; close →
 *     router.back() returns the user to where they were.
 *   - Direct hit / refresh / paste-link → the standalone full page renders.
 *
 * Close behavior: Esc key, backdrop click, X button. Each calls router.back().
 * If there is no history (e.g. someone manually opens the drawer URL via JS),
 * router.back() may not change the URL — we fall back to `fallbackPath` (or
 * "/" by default) within ~150ms.
 */
export default function DetailDrawer({
  title,
  fullPagePath,
  fallbackPath = "/",
  subtitle,
  children,
}: DetailDrawerProps) {
  const router = useRouter();
  const drawerRef = useRef<HTMLDivElement | null>(null);

  function close() {
    const beforeHref = window.location.href;
    router.back();
    setTimeout(() => {
      if (window.location.href === beforeHref) {
        router.push(fallbackPath);
      }
    }, 150);
  }

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // close is stable for the lifetime of this render; re-creating on each render is fine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock body scroll while drawer is mounted
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // Move focus into the drawer for keyboard users
  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex justify-end"
    >
      <button
        type="button"
        onClick={close}
        className="absolute inset-0 bg-neutral-900/40 backdrop-blur-[1px] cursor-default"
        aria-label={`Close ${title.toLowerCase()}`}
      />

      <div
        ref={drawerRef}
        tabIndex={-1}
        className="relative w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl bg-white shadow-2xl border-l border-neutral-200 flex flex-col h-full focus:outline-none animate-slide-in"
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-neutral-200 bg-white sticky top-0 z-10">
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-neutral-100 transition shrink-0"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-neutral-900 truncate">
              {title}
            </div>
            {subtitle ? (
              <div className="text-xs text-neutral-500 truncate">{subtitle}</div>
            ) : null}
          </div>
          {fullPagePath ? (
            <Link
              href={fullPagePath}
              // Force a full navigation so the modal slot doesn't re-intercept
              // — we want the standalone page on "View full page".
              scroll={false}
              prefetch={false}
              className="text-xs px-2.5 py-1.5 rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition inline-flex items-center gap-1 shrink-0"
            >
              View full page
              <ExternalIcon />
            </Link>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
