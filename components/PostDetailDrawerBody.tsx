import {
  formatCompactNumber,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
} from "@/lib/format";
import PlatformBadge, { platformLabel } from "@/components/PlatformBadge";
import PropertyChip from "@/components/PropertyChip";
import MlsNumberInline from "@/components/MlsNumberInline";
import MetricSparkline from "@/components/MetricSparkline";
import AiInsightStrip from "@/components/AiInsightStrip";
import PropertyClassifyPanel from "@/components/PropertyClassifyPanel";
import type { Post } from "@/lib/types/post";

interface PostDetailDrawerBodyProps {
  post: Post;
  offices: Array<{ id: string; short_code: string; name: string }>;
  initialOfficeId: string | null;
}

/**
 * Single-column stacked layout used inside the right-side drawer overlay.
 * Same data as the standalone full-page detail at /posts/[id], but laid out
 * vertically so it reads comfortably in a ~760px-wide drawer.
 *
 * Order, top to bottom:
 *   1. Media + caption + hashtags + "Open on platform"
 *   2. MLS chip + property chip
 *   3. Big stats grid (4 across)
 *   4. Live AI insight strip
 *   5. Classify panel
 *   6. 30-day reach trend
 *   7. Audience breakdown (if available)
 */
export default function PostDetailDrawerBody({
  post,
  offices,
  initialOfficeId,
}: PostDetailDrawerBodyProps) {
  const totalEngagements =
    post.metrics.likes +
    post.metrics.comments +
    post.metrics.shares +
    post.metrics.saves;

  return (
    <div className="px-5 py-5 space-y-5">
      {/* Media + caption */}
      <article className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="relative aspect-square bg-neutral-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.thumbnail_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
            <span className="absolute top-2 left-2">
              <PlatformBadge platform={post.platform} size="sm" />
            </span>
            {post.media_type === "video" ? (
              <span className="absolute bottom-2 right-2 inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/60 text-white">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            ) : null}
          </div>

          <div className="p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <PlatformBadge platform={post.platform} size="sm" showLabel />
              <span className="text-xs text-neutral-500">
                {formatShortDate(post.posted_at)} ·{" "}
                {formatRelativeTime(post.posted_at)}
              </span>
              <span className="text-xs text-neutral-400 capitalize">
                · {post.media_type}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <MlsNumberInline
                postId={post.id}
                currentMls={post.mls_number_parsed ?? null}
                isLinked={Boolean(post.property)}
                compact
                size="sm"
              />
              {post.property ? (
                <>
                  <span className="text-neutral-300" aria-hidden="true">
                    ·
                  </span>
                  <PropertyChip property={post.property} />
                </>
              ) : null}
            </div>

            <p className="text-sm text-neutral-900 leading-relaxed whitespace-pre-line">
              {post.caption}
            </p>

            {post.hashtags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {post.hashtags.slice(0, 8).map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center rounded-md bg-neutral-50 ring-1 ring-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-600"
                  >
                    {h}
                  </span>
                ))}
                {post.hashtags.length > 8 ? (
                  <span className="text-[11px] text-neutral-400 self-center">
                    +{post.hashtags.length - 8}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="mt-1">
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-xs inline-flex items-center"
              >
                Open on {platformLabel(post.platform)}
                <ExternalIcon />
              </a>
            </div>
          </div>
        </div>
      </article>

      {/* Big stats — 4 across */}
      <section
        className="rounded-xl border border-neutral-200 bg-white shadow-card p-4"
        aria-label="Key metrics"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <BigStat label="Reach" value={formatNumber(post.metrics.reach)} />
          <BigStat
            label="Engagements"
            value={formatNumber(totalEngagements)}
          />
          <BigStat
            label="ER"
            value={formatPercent(post.metrics.engagement_rate, 1)}
          />
          <BigStat label="Comments" value={formatNumber(post.metrics.comments)} />
          <BigStat label="Likes" value={formatNumber(post.metrics.likes)} />
          <BigStat label="Shares" value={formatNumber(post.metrics.shares)} />
          <BigStat label="Saves" value={formatNumber(post.metrics.saves)} />
          {post.metrics.plays !== undefined ? (
            <BigStat label="Plays" value={formatNumber(post.metrics.plays)} />
          ) : (
            <BigStat
              label="Impressions"
              value={formatNumber(post.metrics.impressions)}
            />
          )}
        </div>

        {post.daily && post.daily.length > 1 ? (
          <div className="mt-4 pt-4 border-t border-neutral-100">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Reach over the {post.daily.length} days following posting
              </div>
              <div className="text-xs text-neutral-500">
                Peak:{" "}
                <span className="font-medium text-neutral-900 tabular-nums">
                  {formatCompactNumber(
                    Math.max(...post.daily.map((d) => d.reach)),
                  )}
                </span>
              </div>
            </div>
            <MetricSparkline
              values={post.daily.map((d) => d.reach)}
              width={680}
              height={72}
              className="w-full h-auto"
            />
          </div>
        ) : null}
      </section>

      {/* Live AI insight */}
      <AiInsightStrip postId={post.id} />

      {/* Classify */}
      <PropertyClassifyPanel
        postId={post.id}
        initialProperty={post.property}
        initialCategory={post.category}
        initialLinkMethod={post.link_method}
        initialAgentName={post.agent_name}
        offices={offices}
        initialOfficeId={initialOfficeId}
      />

      {/* Audience (if available) */}
      {post.audience ? (
        <section
          className="rounded-xl border border-neutral-200 bg-white shadow-card p-4"
          aria-label="Audience breakdown"
        >
          <h3 className="text-sm font-semibold text-neutral-900 mb-3">
            Who saw this post
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <AudienceBlock
              title="Top locations"
              slices={post.audience.top_locations}
            />
            <AudienceBlock title="Age" slices={post.audience.age_buckets} />
            <AudienceBlock
              title="Gender"
              slices={post.audience.gender_split}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900 leading-tight">
        {value}
      </div>
    </div>
  );
}

function AudienceBlock({
  title,
  slices,
}: {
  title: string;
  slices: { label: string; share: number }[];
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </div>
      <ul className="mt-1.5 space-y-1">
        {slices.map((s) => (
          <li key={s.label} className="text-xs">
            <div className="flex justify-between text-neutral-700 mb-0.5">
              <span className="truncate pr-2">{s.label}</span>
              <span className="tabular-nums text-neutral-500">
                {formatPercent(s.share, 0)}
              </span>
            </div>
            <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className="h-full bg-gold-500"
                style={{ width: `${Math.min(100, s.share * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3 ml-1"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
