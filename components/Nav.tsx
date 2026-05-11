"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { AuthProfile } from "@/lib/auth";
import AccountMenu from "./AccountMenu";
import GlobalSearch from "./GlobalSearch";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

// NOTE: the canonical nav item list lives in `./nav-config.tsx`. This file
// only owns the TopNav / BottomNav presentational components.

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Desktop top nav (md+). Sticky to the top of the viewport. Holds the brand
 * mark on the left, the primary tabs in the middle, and the account menu on
 * the right. The active tab gets a 2px gold underline anchored to the bottom
 * border of the bar.
 *
 * Replaces the old left sidebar — frees up ~240px of horizontal real estate
 * for the main content area, which now uses max-w-7xl.
 */
export function TopNav({
  items,
  profile,
}: {
  items: NavItem[];
  profile: AuthProfile;
}) {
  const pathname = usePathname();
  return (
    <header
      className={clsx(
        "sticky top-0 z-30 backdrop-blur",
        // Subtle warm gradient gives the bar a "executive" feel without being heavy
        "bg-gradient-to-b from-white via-white to-neutral-50/80",
        "border-b border-neutral-200",
      )}
    >
      {/* Thin gold accent line at the very top — subtle brand cue */}
      <div className="h-0.5 bg-gradient-to-r from-gold-500/0 via-gold-500/60 to-gold-500/0" />

      <div className="px-4 md:px-8 max-w-7xl mx-auto">
        <div className="h-14 flex items-center gap-6 md:gap-10">
          {/* Brand */}
          <Link
            href="/"
            className="flex items-center gap-2.5 shrink-0 group"
            aria-label="Alliance Social home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/c21-seal.png"
              alt=""
              className="w-8 h-9 object-contain shrink-0"
            />
            <span className="hidden sm:inline font-semibold tracking-tight text-neutral-900 group-hover:text-neutral-700">
              Alliance Social
            </span>
          </Link>

          {/* Global post search — desktop only. Hidden on mobile to keep the
              bar compact; mobile users access list view via BottomNav. */}
          <GlobalSearch />

          {/* Tabs (desktop only — mobile uses BottomNav) */}
          <nav
            className="hidden md:flex items-stretch gap-1 flex-1"
            aria-label="Primary navigation"
          >
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "relative inline-flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "text-neutral-900"
                      : "text-neutral-600 hover:text-neutral-900",
                  )}
                >
                  <span
                    className={clsx(
                      "transition-colors",
                      active ? "text-gold-600" : "text-neutral-400",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                  {/* Gold underline anchor */}
                  <span
                    aria-hidden="true"
                    className={clsx(
                      "absolute -bottom-px left-2 right-2 h-0.5 rounded-full transition-all",
                      active ? "bg-gold-500" : "bg-transparent",
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center">
            <AccountMenu profile={profile} />
          </div>
        </div>
      </div>
    </header>
  );
}

/** Mobile bottom nav — unchanged from the sidebar era. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur"
      aria-label="Primary"
    >
      <ul
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={clsx(
                  "flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium",
                  active ? "text-gold-700" : "text-neutral-500",
                )}
              >
                <span className={active ? "text-gold-600" : "text-neutral-400"}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Deprecated alias — keep until existing imports are updated.
 */
export const Sidebar = TopNav;
