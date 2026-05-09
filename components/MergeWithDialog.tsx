"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { Platform } from "@/lib/types/post";
import { mergeIntoGroupAction } from "@/app/(app)/groups/actions";

interface MergeCandidate {
  id: string;
  platform: Platform;
  caption_preview: string;
  thumbnail_url: string | null;
  posted_at: string | null;
  media_type: string | null;
  current_group_id: string | null;
  current_group_method: string | null;
}

interface MergeWithDialogProps {
  groupId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Modal-style dialog that lets admins manually pair a post the auto-grouper
 * missed into an existing group.
 *
 * Behavior:
 *   - Fetches /api/groups/{groupId}/merge-candidates on mount when open.
 *   - Renders each candidate with thumbnail + platform pill + caption preview.
 *   - Click "Merge" -> calls mergeIntoGroupAction -> closes + refreshes page.
 *   - Empty + loading + error states.
 *   - Backdrop click + Escape to close.
 */
export default function MergeWithDialog({
  groupId,
  open,
  onClose,
}: MergeWithDialogProps) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fetch candidates when opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCandidates(null);
    setLoadError(null);
    setActionError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/groups/${encodeURIComponent(groupId)}/merge-candidates`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as { candidates?: MergeCandidate[] };
        if (cancelled) return;
        setCandidates(json.candidates ?? []);
      } catch (e) {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load candidates.",
        );
        setCandidates([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, groupId]);

  // Esc to close + body scroll lock.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleMerge(candidateId: string) {
    if (pendingId) return;
    setPendingId(candidateId);
    setActionError(null);
    startTransition(async () => {
      try {
        const result = await mergeIntoGroupAction(groupId, candidateId);
        if (!result.ok) {
          setActionError(result.error ?? "Merge failed.");
          setPendingId(null);
          return;
        }
        // Close + force a server-component refresh so the homepage reflects
        // the new group composition immediately.
        onClose();
        router.refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Merge failed.");
        setPendingId(null);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in-up"
      role="dialog"
      aria-modal="true"
      aria-label="Merge with another post"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="relative z-10 w-full max-w-lg bg-white rounded-xl shadow-elevated overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-200">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Merge with...
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Pair a post from another platform that the auto-grouper missed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {candidates === null ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">
              Loading candidates...
            </div>
          ) : loadError ? (
            <div className="px-4 py-8 text-center text-sm text-red-600">
              {loadError}
            </div>
          ) : candidates.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-neutral-500">
              No same-day candidates found from other platforms.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {candidates.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-neutral-50"
                >
                  <div className="shrink-0 w-14 h-14 rounded-md overflow-hidden bg-neutral-100 ring-1 ring-neutral-200">
                    {c.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.thumbnail_url}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <PlatformPill platform={c.platform} />
                      {c.current_group_method === "auto" ? (
                        <span className="inline-flex items-center rounded-md bg-neutral-100 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          In auto group
                        </span>
                      ) : null}
                      <span className="text-[11px] text-neutral-500">
                        {formatTime(c.posted_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-700 line-clamp-2">
                      {c.caption_preview || (
                        <span className="italic text-neutral-400">
                          No caption
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleMerge(c.id)}
                    disabled={isPending && pendingId === c.id}
                    className={clsx(
                      "shrink-0 inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium",
                      "bg-gold-500 hover:bg-gold-600 text-white",
                      "disabled:opacity-60 disabled:cursor-not-allowed",
                    )}
                  >
                    {isPending && pendingId === c.id ? "Merging..." : "Merge"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {actionError ? (
          <div className="px-4 py-2 text-xs text-red-600 border-t border-red-100 bg-red-50">
            {actionError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function PlatformPill({ platform }: { platform: Platform }) {
  const styles =
    platform === "instagram"
      ? "bg-pink-50 text-pink-700 ring-pink-200"
      : platform === "tiktok"
        ? "bg-neutral-900 text-white ring-neutral-900"
        : "bg-blue-50 text-blue-700 ring-blue-200";
  const label =
    platform === "instagram" ? "IG" : platform === "tiktok" ? "TT" : "FB";
  const fallback =
    platform === "instagram"
      ? { backgroundColor: "#fde7f0", color: "#8b1d4d" }
      : undefined;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md ring-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        styles,
      )}
      style={fallback}
    >
      {label}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6l-12 12"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}
