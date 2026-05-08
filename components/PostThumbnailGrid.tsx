import clsx from "clsx";
import type { Post } from "@/lib/types/post";
import { formatCompactNumber } from "@/lib/format";
import PlatformBadge from "./PlatformBadge";

interface PostThumbnailGridProps {
  posts: Post[];
  className?: string;
}

export default function PostThumbnailGrid({
  posts,
  className,
}: PostThumbnailGridProps) {
  if (posts.length === 0) {
    return (
      <div
        className={clsx(
          "rounded-xl border border-neutral-200 bg-white p-8",
          "flex items-center justify-center",
          className,
        )}
      >
        <p className="text-sm text-neutral-500">No posts in this period</p>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3",
        className,
      )}
    >
      {posts.map((post) => {
        const totalEngagements =
          post.metrics.likes +
          post.metrics.comments +
          post.metrics.shares +
          post.metrics.saves;

        return (
          <a
            key={post.id}
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className={clsx(
              "relative group aspect-square rounded-lg overflow-hidden",
              "ring-1 ring-neutral-200 bg-neutral-100",
              "hover:ring-gold-300 transition-all",
            )}
            title={post.caption}
          >
            {/* Thumbnail image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.thumbnail_url}
              alt={post.caption}
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />

            {/* Platform badge in top-left */}
            <div className="absolute top-1.5 left-1.5">
              <PlatformBadge platform={post.platform} size="sm" />
            </div>

            {/* Hover overlay with caption + KPI strip */}
            <div
              className={clsx(
                "absolute inset-0 flex flex-col justify-end",
                "bg-gradient-to-t from-black/80 via-black/40 to-transparent",
                "opacity-0 group-hover:opacity-100 transition-opacity duration-200",
                "p-2",
              )}
            >
              {/* Caption excerpt */}
              <p className="text-[11px] text-white font-medium line-clamp-1 mb-2">
                {post.caption}
              </p>

              {/* KPI strip */}
              <div className="flex items-center gap-3 text-[10px] text-white/90 font-medium">
                <span className="flex items-center gap-1">
                  <EyeIcon />
                  {formatCompactNumber(post.metrics.reach)}
                </span>
                <span className="flex items-center gap-1">
                  <HeartIcon />
                  {formatCompactNumber(totalEngagements)}
                </span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0112 7a5.5 5.5 0 019.5 5c-2.5 4.5-9.5 9-9.5 9z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}
