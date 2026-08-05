"use client";

/**
 * Review + publish client for an imported AutoReel reel — 2026-08-05.
 *
 * Left: the actual imported video (9:16 player). Right: per-platform caption
 * editors and the two publish controls. Publishing sets scheduled_for and
 * lets the existing publish-scheduled cron (every 5 min) carry it out with
 * the full standard path: claim guard, retries, outbox, agent emails. The
 * UI is honest about that ("within about 5 minutes").
 */

import { useState } from "react";
import Link from "next/link";

export interface ImportedReelData {
  gp_id: string;
  mls_number: string;
  status: string;
  video_url: string | null;
  cover_url: string | null;
  instagram_caption: string;
  facebook_caption: string;
  instagram_hashtags: string[];
  scheduled_for: Record<string, string> | null;
  posted_at: string | null;
}

export default function AutoReelReviewClient({ reel }: { reel: ImportedReelData }) {
  const [igCaption, setIgCaption] = useState(reel.instagram_caption);
  const [fbCaption, setFbCaption] = useState(reel.facebook_caption);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const alreadyPosted = reel.status === "posted";
  const alreadyScheduled = reel.status === "scheduled" && !publishedAt;

  async function saveCaptions(): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/post-builder/autoreel-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_captions",
          gp_id: reel.gp_id,
          instagram_caption: igCaption,
          facebook_caption: fbCaption,
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) {
        setError(j.error ?? "Could not save captions.");
        return false;
      }
      setDirty(false);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save captions.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish(whenIso: string | null) {
    setPublishing(true);
    setError(null);
    try {
      // Unsaved caption edits ride along automatically — nobody loses an
      // edit because they forgot to hit Save before Publish.
      if (dirty) {
        const saved = await saveCaptions();
        if (!saved) return;
      }
      const res = await fetch("/api/post-builder/autoreel-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          gp_id: reel.gp_id,
          when: whenIso ?? undefined,
        }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        publish_at?: string;
      };
      if (!j.ok || !j.publish_at) {
        setError(j.error ?? "Could not queue the reel.");
        return;
      }
      setPublishedAt(j.publish_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue the reel.");
    } finally {
      setPublishing(false);
    }
  }

  function handleScheduleSubmit() {
    if (!scheduleAt) return;
    const t = new Date(scheduleAt);
    if (Number.isNaN(t.getTime())) {
      setError("Pick a valid date and time.");
      return;
    }
    void publish(t.toISOString());
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,_5fr)_minmax(0,_7fr)] items-start">
      {/* Video */}
      <div className="rounded-2xl border border-neutral-200 bg-neutral-950 shadow-card overflow-hidden">
        {reel.video_url ? (
          <video
            src={reel.video_url}
            poster={reel.cover_url ?? undefined}
            controls
            playsInline
            className="w-full"
            style={{ maxHeight: "70vh", objectFit: "contain" }}
          />
        ) : (
          <div className="grid place-items-center text-neutral-400 text-sm py-24">
            No video attached
          </div>
        )}
      </div>

      {/* Captions + publish */}
      <div className="space-y-4">
        {publishedAt ? (
          <StatusBanner tone="success">
            Queued. The reel goes out to Facebook + Instagram{" "}
            {isSoon(publishedAt)
              ? "within about 5 minutes"
              : `at ${formatEastern(publishedAt)}`}
            . Track it in{" "}
            <Link href="/saved-posts" className="font-semibold underline underline-offset-2">
              Saved Posts
            </Link>
            .
          </StatusBanner>
        ) : alreadyPosted ? (
          <StatusBanner tone="neutral">
            This reel has already been posted.
          </StatusBanner>
        ) : alreadyScheduled ? (
          <StatusBanner tone="neutral">
            Already scheduled
            {reel.scheduled_for?.facebook
              ? ` for ${formatEastern(reel.scheduled_for.facebook)}`
              : ""}
            . Publishing again will move it.
          </StatusBanner>
        ) : null}

        <CaptionEditor
          label="Instagram caption"
          value={igCaption}
          onChange={(v) => {
            setIgCaption(v);
            setDirty(true);
          }}
          disabled={alreadyPosted || publishing}
        />
        <CaptionEditor
          label="Facebook caption"
          value={fbCaption}
          onChange={(v) => {
            setFbCaption(v);
            setDirty(true);
          }}
          disabled={alreadyPosted || publishing}
        />

        {reel.instagram_hashtags.length > 0 ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              Hashtags (appended automatically)
            </div>
            <div className="flex flex-wrap gap-1">
              {reel.instagram_hashtags.map((h) => (
                <span
                  key={h}
                  className="inline-flex rounded bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[11px] font-mono text-neutral-600"
                >
                  {h}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void saveCaptions()}
            disabled={saving || !dirty || alreadyPosted}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 disabled:opacity-40 transition"
          >
            {saving ? "Saving…" : savedTick ? "✓ Saved" : "Save captions"}
          </button>
          {!publishedAt && !alreadyPosted ? (
            <>
              <button
                type="button"
                onClick={() => void publish(null)}
                disabled={publishing || !reel.video_url}
                className="rounded-md bg-gold-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-gold-600 disabled:opacity-50 transition-colors"
              >
                {publishing ? "Queueing…" : "Publish to FB + IG"}
              </button>
              {!scheduleMode ? (
                <button
                  type="button"
                  onClick={() => setScheduleMode(true)}
                  disabled={publishing}
                  className="text-sm text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
                >
                  Schedule instead
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        {scheduleMode && !publishedAt && !alreadyPosted ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
            <button
              type="button"
              onClick={handleScheduleSubmit}
              disabled={publishing || !scheduleAt}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Schedule
            </button>
            <button
              type="button"
              onClick={() => setScheduleMode(false)}
              className="text-xs text-neutral-500 hover:text-neutral-800"
            >
              Cancel
            </button>
          </div>
        ) : null}

        <p className="text-[11px] text-neutral-400 leading-relaxed">
          Publishing runs through the standard pipeline: FB + IG reel publish,
          post tracking, and the instant agent notification email.
        </p>

        {error ? <p className="text-xs text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}

function CaptionEditor({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
        {label}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={5}
        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-gold-500/40 disabled:bg-neutral-50 disabled:text-neutral-500"
      />
    </div>
  );
}

function StatusBanner({
  tone,
  children,
}: {
  tone: "success" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "success"
          ? "rounded-lg bg-emerald-50 ring-1 ring-emerald-200 px-3 py-2.5 text-sm text-emerald-900"
          : "rounded-lg bg-neutral-50 ring-1 ring-neutral-200 px-3 py-2.5 text-sm text-neutral-700"
      }
    >
      {children}
    </div>
  );
}

function isSoon(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isNaN(t) || t - Date.now() < 6 * 60_000;
}

function formatEastern(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Standing rule: every render-path date formatter pins America/New_York.
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}
