"use client";

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

/**
 * Sitewide Back affordance. Rendered by the (app) layout so every page in
 * the authenticated app shell gets one automatically — no per-page wiring.
 *
 * Behavior:
 *   1. When real browser history exists (the user clicked a link to land
 *      here, history.length > 1), back() pops that entry. Same as the
 *      browser's native back button.
 *   2. When there's no history (direct URL paste, refresh-then-navigate),
 *      falls back to a parent route inferred from the path. Prevents the
 *      "I'm stuck on this page" trap that the browser's back can't fix.
 *   3. Hidden on the dashboard root and the login page — nowhere to go back
 *      to.
 *
 * Styled with a gold tint so it reads as a primary navigation control, not
 * a secondary chip. ADHD-friendly: always in the same spot, same shape,
 * never hidden behind a menu.
 */
export default function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === "/" || pathname === "/login") return null;

  // 2026-07-24 (John) — the Multi-OH wizard owns its navigation: its
  // sticky footer has a step-aware Back (and Cancel on step 1), and its
  // stepper pills jump to completed steps. Rendering the sitewide Back on
  // top of that put TWO differently-behaved "Back" buttons on one screen:
  // this one pops browser history (exiting the wizard entirely, since the
  // wizard's internal steps use router.replace and leave no history
  // entries), while the footer's steps backward within the wizard. John
  // reported exactly that confusion. Hide this one there — one screen,
  // one Back.
  if (pathname.startsWith("/post-builder/multi-oh")) return null;

  const fallback = inferParent(pathname);

  function handleClick(e: React.MouseEvent) {
    // Prefer real history back. When the user landed directly (e.g. typed
    // the URL, hit refresh, came from an email), history.length is small
    // and router.back() leaves the app — so fall through to the <Link>
    // navigation in that case.
    if (typeof window !== "undefined" && window.history.length > 1) {
      e.preventDefault();
      router.back();
    }
  }

  return (
    <Link
      href={fallback}
      onClick={handleClick}
      aria-label="Go back"
      className="inline-flex items-center gap-1.5 rounded-md border border-gold-200 bg-gold-50 hover:bg-gold-100 hover:border-gold-300 px-3 py-1.5 text-sm font-medium text-gold-800 shadow-sm transition-colors"
    >
      <ArrowLeftIcon />
      Back
    </Link>
  );
}

/**
 * Best-effort parent-route inference for fallback navigation when there's
 * no browser history. Conservative on purpose — when in doubt, send the
 * user to the dashboard, which is always one click from anywhere else.
 */
function inferParent(pathname: string): string {
  // /properties/[mls]/edit → /properties/[mls]
  if (/^\/properties\/[^/]+\/edit\/?$/.test(pathname)) {
    return pathname.replace(/\/edit\/?$/, "");
  }
  // /properties/new → /properties
  if (pathname === "/properties/new") return "/properties";
  // /properties/[mls] → /properties
  if (/^\/properties\/[^/]+\/?$/.test(pathname)) return "/properties";
  // /properties → dashboard
  if (pathname === "/properties") return "/";
  // /posts/[id] → dashboard
  if (/^\/posts\//.test(pathname)) return "/";
  // /post-builder/* (multi-oh wizard, deep links) → /post-builder
  if (pathname.startsWith("/post-builder/")) return "/post-builder";
  // /post-builder root → dashboard
  if (pathname === "/post-builder") return "/";
  // /settings/[deep]/* → /settings
  if (pathname.startsWith("/settings/")) return "/settings";
  // /settings root → dashboard
  if (pathname === "/settings") return "/";
  // Anything else (coach, reports, future routes) → dashboard
  return "/";
}

function ArrowLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
