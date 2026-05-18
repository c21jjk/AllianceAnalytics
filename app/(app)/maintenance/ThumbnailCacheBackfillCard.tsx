"use client";

import { useState, useTransition } from "react";
import { backfillThumbnailCacheAction } from "./thumbnail-cache-actions";

interface Props {
  /** How many posts currently still need caching (server-rendered count). */
  initialRemaining: number;
}

/**
 * Admin-only "Cache thumbnails to storage" button. One click = one batch
 * of 100. The admin clicks again to keep going. Dead simple — no auto-loop.
 */
export default function ThumbnailCacheBackfillCard({ initialRemaining }: Props) {
  const [isPending, startTransition] = useTransition();
  const [last, setLast] = useState<{
    processed: number;
    cached: number;
    failed: number;
    remaining: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = last?.remaining ?? initialRemaining;

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const r = await backfillThumbnailCacheAction({ limit: 100 });
      if (!r.ok) {
        setError(r.error ?? "Backfill failed.");
        return;
      }
      setLast({
        processed: r.processed,
        cached: r.cached,
        failed: r.failed,
        remaining: r.remaining,
      });
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-neutral-900">
            Cache thumbnails to storage
          </h3>
          <p className="mt-1 text-xs text-neutral-500 max-w-md">
            {remaining > 0
              ? `${remaining.toLocaleString()} posts still using platform CDN URLs that may expire. Click to cache the next 100 to Supabase Storage.`
              : "All eligible posts have durable Storage URLs."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending || remaining === 0}
          className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Caching…" : "Cache 100 now"}
        </button>
      </div>

      {error ? (
        <p className="text-xs text-rose-600">Error: {error}</p>
      ) : null}

      {last ? (
        <p className="text-xs text-neutral-600">
          Processed {last.processed} — {last.cached} cached, {last.failed}{" "}
          failed, {last.remaining.toLocaleString()} remaining
        </p>
      ) : null}
    </div>
  );
}
