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
 *   - Admin section (admin-only): Agent Outbox, Users, Templates, Audio
 *     Library, Settings. 2026-08-05 (John) trimmed this from seven entries:
 *     "Custom Templates" was the same table as Template Builder filtered to
 *     source='studio' (now a pill there), and "Maintenance" was one card
 *     (now a section in Settings). Both routes redirect.
 *     surfaced as direct shortcuts so the most-touched admin pages are one
 *     click from anywhere instead of two clicks under /settings.
 *   - Sign out
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
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-neutral-400">
                Admin
              </div>
              {/* 2026-08-05 (John) — Outbox moved out of the top nav. It is
                  admin-only, low frequency, and still a manual mailto queue
                  until auto-send ships, so it does not earn a hero slot. */}
              <MenuItem
                href="/outbox"
                onSelect={() => setOpen(false)}
                icon={<OutboxIcon />}
                label="Agent Outbox"
                sub="Nudge listing agents to reshare"
              />
              <MenuItem
                href="/users"
                onSelect={() => setOpen(false)}
                icon={<UsersIcon />}
                label="Users"
                sub="Invite, roles, activity"
              />
              <MenuItem
                href="/admin/templates"
                onSelect={() => setOpen(false)}
                icon={<LayersIcon />}
                label="Templates"
                sub="Every template, including designs saved from Studio"
              />
              <MenuItem
                href="/admin/audio-library"
                onSelect={() => setOpen(false)}
                icon={<MusicIcon />}
                label="Audio Library"
                sub="Reel music tracks + post-type tags"
              />
              <MenuItem
                href="/settings"
                onSelect={() => setOpen(false)}
                icon={<GearIcon />}
                label="Settings"
                sub="Credentials, feeds, more"
              />
            </>
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

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M2.5 19.5c.9-2.8 3.4-4.5 6.5-4.5s5.6 1.7 6.5 4.5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <circle
        cx="17"
        cy="9.5"
        r="2.6"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <path
        d="M16 14.5c2.2.1 4 1.5 4.7 3.3"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <path
        d="M12 3l9 5-9 5-9-5 9-5z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path
        d="M3 13l9 5 9-5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path
        d="M3 17l9 5 9-5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <path
        d="M9 18V6l10-2v12"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth={1.6} />
      <circle cx="16" cy="16" r="3" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <path
        d="M15.5 3.5a4.5 4.5 0 00-5.9 5.9L3.5 15.5a2 2 0 102.8 2.8l6.1-6.1a4.5 4.5 0 005.9-5.9l-2.9 2.9-2.3-2.3 2.4-2.4z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
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

function OutboxIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 13l3-9h12l3 9M3 13v6a1 1 0 001 1h16a1 1 0 001-1v-6M3 13h5l1 2h6l1-2h5" />
    </svg>
  );
}
