"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteGeneratedPostAction } from "@/app/(app)/post-builder/actions";
import type { CreatedPostRow } from "@/lib/data/created-posts-db";
import type { PostType } from "@/lib/post-builder/types";

/**
 * CreatedPostsStrip — horizontal scroll strip of saved Studio posts for one
 * listing, grouped by post type, with delete-on-hover and click-to-resume.
 *
 * Lives on /properties/[mls] under the social-posts grid. Pure presentational
 * client component — the parent server-fetches the rows once on render and
 * passes them in via props. After a delete we router.refresh() so the parent's
 * server fetch re-runs and the row disappears.
 *
 * Click target → /post-builder?gp=<id>. The Post Builder reads ?gp= on mount
 * (Task #70) and rehydrates the editor state from the row so the user picks
 * up where they left off.
 */

interface CreatedPostsStripProps {
  initialPosts: CreatedPostRow[];
  /** When true, the empty state isn't rendered (the parent has its own "no posts yet" copy). */
  hideWhenEmpty?: boolean;
}

const POST_TYPE_DISPLAY: Record<PostType, string> = {
  just_listed: "Just Listed",
  just_sold: "Just Sold",
  under_contract: "Under Contract",
  open_house: "Open House",
  price_reduction: "Price Reduced",
};

const POST_TYPE_ORDER: PostType[] = [
  "just_listed",
  "open_house",
  "price_reduction",
  "under_contract",
  "just_sold",
];

/**
 * Format a Reel duration (ms) as "M:SS" — e.g., 7000 → "0:07". The cap is
 * 90s (IG Reels limit) so we don't need to worry about minutes ≥ 2 digits.
 */
function formatReelDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function CreatedPostsStrip({
  initialPosts,
  hideWhenEmpty = false,
}: CreatedPostsStripProps) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (posts.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <section className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 px-4 py-6 text-center text-sm text-neutral-500">
        No posts created for this listing yet. Open it in the{" "}
        <Link
          href={`/post-builder?mls=${posts[0]?.mls_number ?? ""}`}
          className="font-medium text-gold-800 underline-offset-2 hover:underline"
        >
          Post Builder
        </Link>{" "}
        to start your first one.
      </section>
    );
  }

  // why: group by post_type so the strip reads "Just Listed (3) · Open House (1)
  // · Just Sold (2)" rather than a flat blob — matches the way agents
  // mentally separate post intents.
  const grouped = new Map<PostType, CreatedPostRow[]>();
  for (const pt of POST_TYPE_ORDER) grouped.set(pt, []);
  for (const p of posts) {
    grouped.get(p.post_type)?.push(p);
  }

  function handleDelete(id: string) {
    // why: optimistic remove first so the click feels instant. If the
    // action fails, we restore the row and surface the error. Inside a
    // startTransition so the React re-render isn't blocking.
    setErrorMsg(null);
    setPendingDeleteId(id);
    const snapshot = posts;
    setPosts((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => {
      const res = await deleteGeneratedPostAction({ id });
      if (!res.ok) {
        setErrorMsg(`Delete failed: ${res.error}`);
        setPosts(snapshot);
      } else {
        // why: refresh the parent so any other surface in the page (linked-
        // posts grid, stat tiles) re-reads if it shares this data source.
        router.refresh();
      }
      setPendingDeleteId(null);
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
            Created posts
          </h2>
          <p className="text-sm text-neutral-500">
            {posts.length} saved {posts.length === 1 ? "post" : "posts"} for
            this listing. Click any one to keep editing in Studio.
          </p>
        </div>
      </div>

      {errorMsg ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {errorMsg}
        </div>
      ) : null}

      <div className="space-y-5">
        {POST_TYPE_ORDER.map((pt) => {
          const list = grouped.get(pt) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={pt} className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                {POST_TYPE_DISPLAY[pt]} · {list.length}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                {list.map((p) => (
                  <CreatedPostThumb
                    key={p.id}
                    post={p}
                    pending={pendingDeleteId === p.id && isPending}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface CreatedPostThumbProps {
  post: CreatedPostRow;
  pending: boolean;
  onDelete: (id: string) => void;
}

function CreatedPostThumb({ post, pending, onDelete }: CreatedPostThumbProps) {
  const [confirming, setConfirming] = useState(false);
  // why: card pinned to a 4:5 portrait box because that's the most common
  // social format and the visual variance across square/portrait/story is
  // small enough at thumbnail size that one container works for all three.
  // why: Reels route to /post-builder/reel?gp= so Larissa lands in Reel
  // Studio (timeline + motion + music) instead of the image canvas-editor.
  // Image posts (single + carousel) continue to the standard /post-builder
  // resume path which knows how to hydrate layer_tree.
  const editHref =
    post.media_type === "reel"
      ? `/post-builder/reel?gp=${post.id}`
      : `/post-builder?gp=${post.id}`;
  return (
    <div className="relative shrink-0 w-[160px]">
      <Link
        href={editHref}
        className="block rounded-lg overflow-hidden border border-neutral-200 bg-white shadow-card hover:border-gold-300 hover:shadow-card-hover transition"
      >
        <div className="aspect-[4/5] bg-neutral-100 relative">
          {post.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.image_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-xs text-neutral-400">
              No image
            </div>
          )}
          {/* Status badge top-left */}
          <span
            className={[
              "absolute top-1.5 left-1.5 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              post.is_posted
                ? "bg-emerald-600 text-white"
                : post.status === "scheduled"
                  ? "bg-sky-600 text-white"
                  : "bg-neutral-900/80 text-white backdrop-blur-sm",
            ].join(" ")}
          >
            {post.is_posted ? "Posted" : post.status === "scheduled" ? "Scheduled" : "Draft"}
          </span>
          {/* Reel marker — gold play-button overlaid top-center so the
              thumbnail reads as a VIDEO at a glance. Bottom-right pill
              shows the rendered duration ("0:07") so Larissa knows
              what's queued without opening it. Both render only when
              the row is actually a Reel — image posts stay clean. */}
          {post.media_type === "reel" ? (
            <>
              <span
                className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-gold-500 text-neutral-900 shadow-md"
                aria-label="Reel"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <path d="M3 2.5l6 3.5-6 3.5z" fill="currentColor" />
                </svg>
              </span>
              {typeof post.reel_duration_ms === "number" &&
              post.reel_duration_ms > 0 ? (
                <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                  {formatReelDuration(post.reel_duration_ms)}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="px-2 py-2">
          <div className="text-[11px] font-mono text-neutral-500">
            {post.format === "square_1x1" ? "Square 1080×1080" : "9:16"}{" "}
            · {post.variant}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Edited {formatRelative(post.updated_at)}
          </div>
        </div>
      </Link>

      {/* Delete affordance — appears on hover via opacity. Keeps the card
          clean by default; surfaces an action only when the user wants to
          act on this specific thumbnail. */}
      <div className="absolute top-1.5 right-1.5">
        {confirming ? (
          <div className="flex items-center gap-1 rounded-md bg-white/95 ring-1 ring-rose-300 backdrop-blur-sm px-1.5 py-1 shadow-md">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(post.id);
              }}
              disabled={pending}
              className="text-[10px] font-semibold uppercase tracking-wide text-rose-700 hover:text-rose-900 disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirming(false);
              }}
              className="text-[10px] text-neutral-500 hover:text-neutral-700"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirming(true);
            }}
            className="inline-flex items-center justify-center rounded-md bg-white/85 ring-1 ring-neutral-300 backdrop-blur-sm px-1.5 py-1 text-neutral-700 hover:text-rose-700 hover:ring-rose-300 transition"
            aria-label="Delete saved post"
            title="Delete this saved post"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 4h11M6.5 4V2.5h3V4M3.5 4l.7 9a1 1 0 001 .9h5.6a1 1 0 001-.9l.7-9M6.5 7v4M9.5 7v4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
