"use client";

/**
 * AutoReel embedded panel — EXPERIMENT (2026-08-05)
 * ---------------------------------------------------------------------------
 *
 * autoreelapp.com sends no frame-blocking headers, so it renders inside an
 * iframe on our domain (verified live 2026-08-05). What does NOT carry over
 * is the login: Clerk's session cookie is partitioned inside a third-party
 * frame, so the panel shows AutoReel's sign-in on first use. If signing in
 * INSIDE the frame works and sticks across visits, this page replaces the
 * popup for good; if the sign-in refuses to complete in-frame (Google OAuth
 * blocks iframes — use the email option), the "Open in a window" button is
 * the everyday fallback and this page can be removed.
 */

import { useState } from "react";

const AUTOREEL_HOME = "https://www.autoreelapp.com/";

export default function AutoReelEmbed() {
  const [loaded, setLoaded] = useState(false);

  function openWindow() {
    const w = Math.min(1360, Math.max(980, Math.floor(window.screen.width * 0.75)));
    const h = Math.min(940, Math.max(700, Math.floor(window.screen.height * 0.85)));
    const left = Math.max(0, Math.floor((window.screen.width - w) / 2));
    const top = Math.max(0, Math.floor((window.screen.height - h) / 3));
    window.open(
      AUTOREEL_HOME,
      "autoreel",
      `popup=yes,width=${w},height=${h},left=${left},top=${top}`,
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500 leading-relaxed max-w-xl">
          If AutoReel asks you to sign in here, use the{" "}
          <span className="font-medium text-neutral-700">email</span> option —
          the Google button doesn't work inside an embedded panel. You should
          only have to sign in once.
        </p>
        <button
          type="button"
          onClick={openWindow}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition focus-ring shrink-0"
        >
          Open in a window instead
        </button>
      </div>
      <div className="relative rounded-2xl border border-neutral-200 bg-white shadow-card overflow-hidden">
        {!loaded ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">
            Loading AutoReel…
          </div>
        ) : null}
        <iframe
          src={AUTOREEL_HOME}
          title="AutoReel"
          onLoad={() => setLoaded(true)}
          className="w-full"
          style={{ height: "calc(100vh - 220px)", minHeight: 560, border: 0 }}
          // why no sandbox attr: AutoReel needs cookies + popups (Dropbox
          // picker, upload dialogs) to function; sandboxing breaks its login.
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}
