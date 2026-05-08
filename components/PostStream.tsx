"use client";

import { useMemo, useState } from "react";
import type { Platform, Post } from "@/lib/types/post";
import PostListRow from "./PostListRow";
import PostFilterBar, {
  type DateRangeKey,
  type PostFilterState,
} from "./PostFilterBar";

interface PostStreamProps {
  posts: Post[];
  /** Initial page size; "Load more" expands by this each click. */
  pageSize?: number;
}

const RANGE_DAYS: Record<DateRangeKey, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

const ALL_PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok"];

export default function PostStream({ posts, pageSize = 8 }: PostStreamProps) {
  const [state, setState] = useState<PostFilterState>({
    platforms: new Set<Platform>(ALL_PLATFORMS),
    dateRange: "30d",
    linkedOnly: false,
    query: "",
  });
  const [shown, setShown] = useState(pageSize);

  const filtered = useMemo(() => {
    const days = RANGE_DAYS[state.dateRange];
    const cutoff =
      days === null ? null : Date.now() - days * 86400_000;
    const q = state.query.trim().toLowerCase();

    return posts.filter((post) => {
      if (!state.platforms.has(post.platform)) return false;
      if (cutoff !== null && new Date(post.posted_at).getTime() < cutoff)
        return false;
      if (state.linkedOnly && !post.property) return false;
      if (q.length > 0) {
        const haystack = [
          post.caption,
          post.property?.mls ?? "",
          post.property?.address ?? "",
          post.hashtags.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [posts, state]);

  const visible = filtered.slice(0, shown);
  const hasMore = filtered.length > visible.length;

  return (
    <div className="flex flex-col gap-3">
      <PostFilterBar
        state={state}
        onChange={(next) => {
          setState(next);
          setShown(pageSize); // reset paging when filters change
        }}
        visibleCount={filtered.length}
        totalCount={posts.length}
      />

      {filtered.length === 0 ? (
        <EmptyFiltered />
      ) : (
        <ul className="space-y-3">
          {visible.map((post) => (
            <li key={post.id}>
              <PostListRow post={post} />
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => setShown((s) => s + pageSize)}
            className="btn-secondary text-sm"
          >
            Load {Math.min(pageSize, filtered.length - visible.length)} more
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EmptyFiltered() {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
      <h3 className="font-semibold text-neutral-900">No posts match</h3>
      <p className="mt-1.5 text-sm text-neutral-500 max-w-sm mx-auto">
        Try widening the date range or clearing platform filters. New posts
        will land here automatically once ingestion runs.
      </p>
    </div>
  );
}
