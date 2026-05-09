"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { setPostMlsNumber } from "@/app/(app)/listings/actions";

interface MlsNumberInlineProps {
  postId: string;
  /** Canonical MLS form already on the post (e.g. "CMC230456"), or null. */
  currentMls: string | null;
  /** True when posts.property_id is set — i.e. a real listing row was found. */
  isLinked: boolean;
  /**
   * Click target context. PostListRow uses a stretched <Link>, so we need to
   * stop propagation and avoid being a link ourselves. Detail page header is
   * standalone — pass `compact={false}` to render the larger variant.
   */
  compact?: boolean;
  /** Visual size of the chip. Defaults to "sm". */
  size?: "sm" | "md";
  className?: string;
}

const FEED_LABEL: Record<"bright" | "cmc" | "sjsr", string> = {
  bright: "Bright",
  cmc: "CMC",
  sjsr: "SJSR",
};

const FEED_PILL_CLASS: Record<"bright" | "cmc" | "sjsr", string> = {
  bright: "bg-sky-50 text-sky-700 ring-sky-100",
  cmc: "bg-amber-50 text-amber-700 ring-amber-100",
  sjsr: "bg-indigo-50 text-indigo-700 ring-indigo-100",
};

function detectFeed(canonical: string): "bright" | "cmc" | "sjsr" | null {
  const u = canonical.toUpperCase();
  if (/^NJ[A-Z]{2}\d{5,8}$/.test(u)) return "bright";
  if (/^CMC\d{4,8}$/.test(u)) return "cmc";
  if (/^SJSR\d{4,8}$/.test(u)) return "sjsr";
  return null;
}

/**
 * Inline MLS# chip + editor for one post. Pluggable into any context that has
 * a postId; stops click propagation so it can sit inside row-level link
 * targets without hijacking them.
 *
 * States:
 *   - linked + canonical present       → chip with feed badge + "✓"
 *   - canonical present, not linked    → chip with feed badge + "pending sync" hint
 *   - empty                            → "+ Add MLS #" CTA
 *   - editing                          → text input with Save/Cancel
 */
export default function MlsNumberInline({
  postId,
  currentMls,
  isLinked,
  compact = true,
  size = "sm",
  className,
}: MlsNumberInlineProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentMls ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
  }

  function startEdit(e: React.MouseEvent) {
    stop(e);
    e.preventDefault();
    setDraft(currentMls ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel(e?: React.MouseEvent | React.KeyboardEvent) {
    if (e) stop(e);
    setEditing(false);
    setDraft(currentMls ?? "");
    setError(null);
  }

  function save(e?: React.MouseEvent | React.KeyboardEvent) {
    if (e) stop(e);
    setError(null);
    startTransition(async () => {
      const result = await setPostMlsNumber(postId, draft);
      if (!result.ok) {
        setError(result.error ?? "Save failed");
        return;
      }
      setEditing(false);
    });
  }

  const sizeClass = size === "md" ? "text-sm px-2.5 py-1" : "text-xs px-2 py-0.5";
  const feed = currentMls ? detectFeed(currentMls) : null;

  if (editing) {
    return (
      <span
        className={clsx(
          "pointer-events-auto inline-flex items-center gap-1",
          className,
        )}
        onClick={stop}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={stop}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === "Enter") save(e);
            else if (e.key === "Escape") cancel(e);
          }}
          autoFocus
          placeholder="NJBL2078123 / CMC230456 / SJSR571832"
          className={clsx(
            "rounded-md border border-neutral-300 bg-white",
            "focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400",
            "tabular-nums font-mono",
            size === "md" ? "text-sm px-2 py-1 w-64" : "text-xs px-1.5 py-0.5 w-52",
          )}
          disabled={isPending}
          aria-label="MLS number"
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className={clsx(
            "btn-primary inline-flex items-center",
            size === "md" ? "text-sm px-2.5 py-1" : "text-xs px-2 py-0.5",
          )}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isPending}
          className={clsx(
            "btn-ghost inline-flex items-center",
            size === "md" ? "text-sm px-2 py-1" : "text-xs px-1.5 py-0.5",
          )}
        >
          Cancel
        </button>
        {error ? (
          <span
            className="text-[11px] text-rose-600 ml-1 truncate max-w-xs"
            title={error}
          >
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  if (currentMls) {
    return (
      <span
        className={clsx(
          "pointer-events-auto inline-flex items-center gap-1.5",
          className,
        )}
        onClick={stop}
      >
        <span
          className={clsx(
            "inline-flex items-center gap-1 rounded-md ring-1 font-medium",
            sizeClass,
            feed
              ? FEED_PILL_CLASS[feed]
              : "bg-neutral-50 text-neutral-700 ring-neutral-200",
          )}
        >
          {feed ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
              {FEED_LABEL[feed]}
            </span>
          ) : null}
          <span className="font-mono tabular-nums">{currentMls}</span>
          {isLinked ? (
            <CheckIcon className="w-3 h-3 opacity-70" />
          ) : (
            <span
              className="text-[10px] italic opacity-60"
              title="Hashtag captured — listing will auto-fill on next RETS sync"
            >
              · pending
            </span>
          )}
        </span>
        {!compact ? (
          <button
            type="button"
            onClick={startEdit}
            className="text-[11px] text-neutral-500 hover:text-neutral-800 underline-offset-2 hover:underline"
          >
            Edit
          </button>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="text-neutral-400 hover:text-neutral-700"
            title="Edit MLS#"
            aria-label="Edit MLS number"
          >
            <PencilIcon className="w-3 h-3" />
          </button>
        )}
      </span>
    );
  }

  // Empty state
  return (
    <button
      type="button"
      onClick={startEdit}
      className={clsx(
        "pointer-events-auto inline-flex items-center gap-1 rounded-md",
        "border border-dashed border-neutral-300 hover:border-gold-400",
        "text-neutral-500 hover:text-gold-700 hover:bg-gold-50/40",
        "transition",
        sizeClass,
        className,
      )}
    >
      <PlusIcon className="w-3 h-3" />
      <span>Add MLS #</span>
    </button>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 12l5 5L20 7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}
