import Link from "next/link";
import clsx from "clsx";
import type { Post } from "@/lib/types/post";
import {
  formatCompactNumber,
  formatPercent,
  formatRelativeTime,
} from "@/lib/format";
import PlatformBadge, { platformLabel } from "./PlatformBadge";
import PropertyChip from "./PropertyChip";
import MlsNumberInline from "./MlsNumberInline";
import MetricCell from "./MetricCell";
import MetricSparkline from "./MetricSparkline";

interface PostListRowProps {
  post: Post;
}

/**
 * Single row in the dashboard post stream.
 *
 * Click target hierarchy:
 *   - Whole row → /posts/[id] (full analytics)
 *   - Thumbnail / "View on platform" → permalink in a new tab
 */
export default function PostListRow({ post }: PostListRowProps) {
  const totalEngagements =
    post.metrics.likes +
    post.metrics.comments +
    post.metrics.shares +
    post.metrics.saves;

  const sparkValues = post.daily?.map((d) => d.reach) ?? [];

  return (
    <article
      className={clsx(
        "relative group rounded-xl border border-neutral-200 bg-white",
        "shadow-card hover:shadow-card-hover hover:border-gold-200",
        "transition-all overflow-hidden",
      )}
    >
      {/* Stretched link layer — covers the whole row */}
      <Link
        href={`/posts/${post.id}`}
        className="absolute inset-0 z-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40"
        aria-label={`View full analytics for ${platformLabel(post.platform)} post from ${formatRelativeTime(
          post.posted_at,
        )}`}
      />

      <div className="relative pointer-events-none flex flex-col md:flex-row gap-4 p-3 md:p-4">
        {/* Thumbnail — its own link to the source platform */}
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className={clsx(
            "pointer-events-auto relative shrink-0 block",
            "w-full md:w-32 aspect-square md:aspect-square rounded-lg overflow-hidden",
            "ring-1 ring-neutral-200 bg-neutral-100",
            "group/thumb",
          )}
          aria-label={`Open original post on ${platformLabel(post.platform)}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.thumbnail_url}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-[1.03]"
          />
          <span className="absolute top-1.5 left-1.5">
            <PlatformBadge platform={post.platform} size="sm" />
          </span>
          {post.media_type === "video" ? <PlayBadge /> : null}
          {post.media_type === "carousel" ? <CarouselBadge /> : null}
          {/* Hover overlay → "Open on Instagram" hint */}
          <span
            className={clsx(
              "absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] font-medium text-white",
              "bg-gradient-to-t from-black/70 via-black/30 to-transparent",
              "opacity-0 group-hover/thumb:opacity-100 transition",
              "flex items-center gap-1",
            )}
          >
            <ExternalIcon />
            Open on {platformLabel(post.platform)}
          </span>
        </a>

        {/* Body */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-neutral-900 leading-snug line-clamp-2">
                {post.caption}
              </p>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-neutral-500">
                <span>{formatRelativeTime(post.posted_at)}</span>
                <span aria-hidden="true">·</span>
                <MlsNumberInline
                  postId={post.id}
                  currentMls={post.mls_number_parsed ?? null}
                  isLinked={Boolean(post.property)}
                  compact
                  size="sm"
                />
                {post.property ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <PropertyChip property={post.property} />
                  </>
                ) : null}
              </div>
              {post.hashtags.length > 0 ? (
                <div className="mt-1 text-[11px] text-neutral-400 truncate">
                  {post.hashtags.slice(0, 4).join("  ")}
                </div>
              ) : null}
            </div>

            <ChevronRight className="hidden md:block shrink-0 mt-1 text-neutral-300 group-hover:text-gold-600 transition" />
          </div>

          {/* KPI strip + sparkline */}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-x-4 gap-y-2 items-end">
            <MetricCell
              label="Reach"
              value={formatCompactNumber(post.metrics.reach)}
              icon={<EyeIcon />}
            />
            <MetricCell
              label="Engagements"
              value={formatCompactNumber(totalEngagements)}
              icon={<HeartIcon />}
            />
            <MetricCell
              label="ER"
              value={formatPercent(post.metrics.engagement_rate)}
              icon={<SparkIcon />}
            />
            <MetricCell
              label="Comments"
              value={formatCompactNumber(post.metrics.comments)}
              icon={<CommentIcon />}
              className="hidden sm:flex"
            />
            <MetricCell
              label="Shares"
              value={formatCompactNumber(post.metrics.shares)}
              icon={<ShareIcon />}
              className="hidden md:flex"
            />
            <div className="hidden md:flex flex-col items-end">
              <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                30d trend
              </span>
              <MetricSparkline
                values={sparkValues}
                width={110}
                height={32}
                ariaLabel="Reach over the 30 days following this post"
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function PlayBadge() {
  return (
    <span className="absolute bottom-1.5 right-1.5 inline-flex items-center justify-center w-7 h-7 rounded-full bg-black/55 text-white">
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  );
}

function CarouselBadge() {
  return (
    <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-md bg-black/55 text-white">
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" aria-hidden="true">
        <rect
          x="6"
          y="3"
          width="14"
          height="14"
          rx="2"
          stroke="currentColor"
          strokeWidth={1.6}
        />
        <path
          d="M3 7v13a1 1 0 001 1h13"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={clsx("w-5 h-5", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M21 12c0 4.4-4 8-9 8a10 10 0 01-3.5-.6L3 21l1.7-4.5A8 8 0 013 12c0-4.4 4-8 9-8s9 3.6 9 8z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v14"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M3 17l5-7 4 4 5-9 4 7"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
