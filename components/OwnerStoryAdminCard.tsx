"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { updateReportPersonalNoteAction } from "@/app/(app)/properties/[mls]/actions";
import { formatRelativeTime } from "@/lib/format";
import type { OwnerStoryViewStats } from "@/lib/data/owner-story-db";

interface Props {
  reportId: string;
  mls: string;
  storyUrlPath: string;
  initialPersonalNote: string | null;
  viewStats: OwnerStoryViewStats | null;
}

const SAVE_DEBOUNCE_MS = 700;
const NOTE_MAX = 600;

/**
 * Owner Story admin card — renders inside the property detail page when an
 * owner report has been generated.
 *
 * Two jobs:
 *   1. Surface the new public story link (`/home/[token]`) with a copy
 *      button + "Open story page" preview link.
 *   2. Edit the optional personal note that renders above the listing hero
 *      on the story page. Autosaves with a short debounce — Larissa types,
 *      stops, the note saves on its own. No save button to forget.
 */
export default function OwnerStoryAdminCard({
  reportId,
  mls,
  storyUrlPath,
  initialPersonalNote,
  viewStats,
}: Props) {
  const [note, setNote] = useState<string>(initialPersonalNote ?? "");
  const [savedNote, setSavedNote] = useState<string>(initialPersonalNote ?? "");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [, startSave] = useTransition();
  const debounceRef = useRef<number | null>(null);

  // Schedule a debounced save whenever `note` diverges from `savedNote`.
  useEffect(() => {
    if (note === savedNote) {
      if (status.kind === "saving") setStatus({ kind: "saved" });
      return;
    }
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      setStatus({ kind: "saving" });
      const toSave = note;
      startSave(async () => {
        const result = await updateReportPersonalNoteAction(
          reportId,
          mls,
          toSave,
        );
        if (!result.ok) {
          setStatus({
            kind: "error",
            message: result.error ?? "Couldn’t save the note.",
          });
          return;
        }
        setSavedNote(toSave);
        setStatus({ kind: "saved" });
      });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, savedNote, reportId, mls]);

  // Fade "Saved" pill back to idle after a moment so it doesn't sit
  // permanently and lose its meaning.
  useEffect(() => {
    if (status.kind !== "saved") return;
    const t = window.setTimeout(() => setStatus({ kind: "idle" }), 1800);
    return () => window.clearTimeout(t);
  }, [status]);

  function buildFullUrl() {
    if (typeof window === "undefined") return storyUrlPath;
    return `${window.location.origin}${storyUrlPath}`;
  }

  async function handleCopy() {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(buildFullUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const charCount = note.length;
  const tooLong = charCount > NOTE_MAX;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gold-50 via-white to-gold-50/60 ring-1 ring-gold-200 shadow-card p-5 md:p-6 space-y-5">
      <div
        aria-hidden="true"
        className="absolute top-0 left-6 right-6 h-0.5 rounded-full bg-gradient-to-r from-gold-300/0 via-gold-500/70 to-gold-300/0"
      />
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-700">
          Seller-facing
        </div>
        <h2 className="mt-1 text-xl md:text-2xl font-semibold tracking-tight text-neutral-900">
          Owner Story page
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600 leading-relaxed">
          The link you send sellers. Status-aware, always live, anyone with the
          link can read — designed for forwarding to family.
        </p>
      </header>

      {/* View stats — the feedback loop. Shows nothing until someone has
          actually opened the page, so it doesn't beg for attention when
          quiet. The "Viewed N times" copy is the psychological hook for
          Larissa — she can tell a seller "I see you opened it twice this
          week" without anyone wiring up email. */}
      {viewStats && viewStats.total_views > 0 ? (
        <section
          className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-3 flex items-center justify-between gap-3"
          role="status"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              Activity
            </div>
            <div className="mt-1 text-sm text-emerald-900 font-medium">
              Viewed {viewStats.total_views}{" "}
              {viewStats.total_views === 1 ? "time" : "times"}
              {viewStats.last_viewed_at ? (
                <span className="font-normal text-emerald-800">
                  {" "}
                  · last opened {formatRelativeTime(viewStats.last_viewed_at)}
                </span>
              ) : null}
            </div>
          </div>
          {viewStats.views_last_7d > 0 ? (
            <div className="text-[11px] font-medium text-emerald-700 shrink-0">
              {viewStats.views_last_7d} in past 7d
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Shareable link */}
      <section className="rounded-lg bg-neutral-50 ring-1 ring-neutral-200 px-3 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          Public link
        </div>
        <code className="block mt-1 px-2 py-1.5 text-xs bg-white ring-1 ring-neutral-200 rounded break-all text-neutral-800">
          {storyUrlPath}
        </code>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium px-3 py-1.5 transition-colors"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <Link
            href={storyUrlPath}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-md ring-1 ring-neutral-300 hover:ring-neutral-400 bg-white text-neutral-800 text-xs font-medium px-3 py-1.5 transition-colors"
          >
            Open story page
          </Link>
        </div>
      </section>

      {/* Personal note */}
      <section>
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="personal-note"
            className="text-xs font-medium uppercase tracking-wide text-neutral-500"
          >
            Personal note (optional)
          </label>
          <SavePill status={status} />
        </div>
        <textarea
          id="personal-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Hi Sarah and Mike — wanted to share where we are with 142 Oak. A few of the posts have really taken off…"
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500 resize-y min-h-[88px]"
        />
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className="text-neutral-500">
            1–2 sentences. Renders above the hero on the story page.
          </span>
          <span
            className={
              tooLong ? "text-rose-700 font-medium" : "text-neutral-400"
            }
          >
            {charCount}/{NOTE_MAX}
          </span>
        </div>
        {status.kind === "error" ? (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {status.message}
          </div>
        ) : null}
      </section>
    </section>
  );
}

function SavePill({
  status,
}: {
  status:
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string };
}) {
  if (status.kind === "saving") {
    return <span className="text-[11px] text-neutral-500">Saving…</span>;
  }
  if (status.kind === "saved") {
    return (
      <span className="text-[11px] font-medium text-emerald-700">Saved</span>
    );
  }
  if (status.kind === "error") {
    return (
      <span className="text-[11px] font-medium text-rose-700">
        Save failed
      </span>
    );
  }
  return null;
}
