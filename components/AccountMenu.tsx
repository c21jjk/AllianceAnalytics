"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { signOut } from "@/app/login/actions";
import type { AuthProfile } from "@/lib/auth";

interface AccountMenuProps {
  profile: AuthProfile;
}

/**
 * Avatar + name dropdown rendered in the global Header. Replaces the old
 * separate Settings nav item + Sign-out button — both now live inside this
 * menu, freeing the sidebar for primary navigation only.
 *
 * Items:
 *   - My account → /settings/security (any signed-in user)
 *   - Settings   → /settings (admin-only)
 *   - Sign out   → triggers the existing signOut server action
 *
 * Open/close: click the trigger, click outside, Esc, or click any item. We
 * intentionally don't lock body scroll — this is a small dropdown, not a
 * full overlay.
 */
export default function AccountMenu({ profile }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const isAdmin = profile.role === "admin";

  const initials =
    (profile.full_name ?? profile.email)
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const displayName = profile.full_name ?? profile.email.split("@")[0];

  // Click-outside + Esc to close
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (e.target instanceof Node && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          "flex items-center gap-2.5 rounded-full pl-2 pr-1 py-1 transition",
          "hover:bg-neutral-100",
          open && "bg-neutral-100",
        )}
      >
        <span className="hidden sm:flex flex-col items-end leading-tight">
          <span className="text-sm font-medium text-neutral-800">
            {displayName}
          </span>
          <span className="text-xs text-neutral-500 capitalize">
            {profile.role}
          </span>
        </span>
        <span
          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gold-100 text-gold-700 text-xs font-semibold"
          aria-hidden="true"
        >
          {initials}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account menu"
          className={clsx(
            "absolute right-0 mt-2 w-64 rounded-xl bg-white",
            "border border-neutral-200 shadow-elevated",
            "py-1.5 z-30",
            "animate-fade-in-up",
          )}
        >
          <div className="px-3 pt-2 pb-2.5 border-b border-neutral-100">
            <div className="text-sm font-semibold text-neutral-900 truncate">
              {displayName}
            </div>
            <div className="mt-0.5 text-xs text-neutral-500 truncate font-mono">
              {profile.email}
            </div>
          </div>

          <MenuItem
            href="/settings/security"
            onSelect={() => setOpen(false)}
            icon={<UserIcon />}
            label="My account"
            sub="Change password"
          />
          {isAdmin ? (
            <MenuItem
              href="/settings"
              onSelect={() => setOpen(false)}
              icon={<GearIcon />}
              label="Settings"
              sub="Feeds, credentials, users"
            />
          ) : null}

          <div className="my-1.5 border-t border-neutral-100" />

          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 inline-flex items-center gap-2.5"
            >
              <span className="text-neutral-400">
                <SignOutIcon />
              </span>
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  href,
  onSelect,
  icon,
  label,
  sub,
}: {
  href: string;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-start gap-2.5 px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
    >
      <span className="text-neutral-400 shrink-0 mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block leading-tight">{label}</span>
        {sub ? (
          <span className="block text-xs text-neutral-500 mt-0.5">{sub}</span>
        ) : null}
      </span>
    </Link>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M4 20c1.5-3.5 4.5-5.5 8-5.5s6.5 2 8 5.5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1A2 2 0 114.3 17l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1A2 2 0 117 4.3l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <path
        d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l-5-5 5-5M5 12h12"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
