import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPostById } from "@/lib/data";
import {
  formatCompactNumber,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
} from "@/lib/format";
import PlatformBadge, { platformLabel } from "@/components/PlatformBadge";
import PropertyChip from "@/components/PropertyChip";
import MlsNumberInline from "@/components/MlsNumberInline";
import MetricSparkline from "@/components/MetricSparkline";
import AiAnalysisPanel from "@/components/AiAnalysisPanel";
import AiInsightStrip from "@/components/AiInsightStrip";
import PropertyClassifyPanel from "@/components/PropertyClassifyPanel";
import { listOffices } from "@/lib/data/offices";
import { createAdminClient } from "@/lib/supabase/admin";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const post = await getPostById(id);
  if (!post) return { title: "Post — Alliance Social" };
  return {
    title: `${platformLabel(post.platform)} post — Alliance Social`,
  };
}

export default async function PostDetailPage({ params }: PageProps) {
  await requireUser();
  const { id } = await params;
  const post = await getPostById(id);
  if (!post) notFound();

  // Fetch active offices + the post's current office_id for the Classify
  // panel. office_id isn't on the Post type yet — read directly.
  const [offices, postOfficeRow] = await Promise.all([
    listOffices({ active_only: true }),
    (async () => {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("posts")
        .select("office_id")
        .eq("id", id)
        .maybeSingle();
      return data ?? null;
    })(),
  ]);
  const officeOptions = offices.map((o) => ({
    id: o.id,
    short_code: o.short_code,
    name: o.name,
  }));
  const initialOfficeId = postOfficeRow?.office_id ?? null;

  const totalEngagements =
    post.metrics.likes +
    post.metrics.comments +
    post.metrics.shares +
    post.metrics.saves;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-800">
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <Link href="/posts" className="hover:text-neutral-800">
          Posts
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700 truncate max-w-xs">{post.id}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        {/* Main column */}
        <div className="space-y-6 min-w-0">
          {/* Media + caption card */}
          <article className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-[260px_minmax(0,1fr)]">
              <div className="relative aspect-square bg-neutral-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.thumbnail_url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <span className="absolute top-3 left-3">
                  <PlatformBadge platform={post.platform} size="md" />
                </span>
                {post.media_type === "video" ? (
                  <span className="absolute bottom-3 right-3 inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/60 text-white">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-5 h-5"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                ) : null}
              </div>

              <div className="p-5 flex flex-col gap-3">
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
                    compact={false}
                    size="md"
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

                <p className="text-sm md:text-base text-neutral-900 leading-relaxed whitespace-pre-line">
                  {post.caption}
                </p>

                {post.hashtags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {post.hashtags.map((h) => (
                      <span
                        key={h}
                        className="inline-flex items-center rounded-md bg-neutral-50 ring-1 ring-neutral-200 px-2 py-0.5 text-xs text-neutral-600"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-1 flex flex-wrap gap-2">
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-sm"
                  >
                    Open on {platformLabel(post.platform)}
                    <svg
                      viewBox="0 0 24 24"
                      className="w-3.5 h-3.5 ml-1.5"
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
                  </a>
                  <Link href="/posts" className="btn-secondary text-sm">
                    Back to posts
                  </Link>
                </div>
              </div>
            </div>
          </article>

          {/* Live AI insight strip — fetches /api/ai/insight, hides if not configured. */}
          <AiInsightStrip postId={post.id} />

          {/* Full analytics */}
          <section
            className="rounded-xl border border-neutral-200 bg-white shadow-card p-5"
            aria-labelledby="analytics-heading"
          >
            <header className="flex items-center justify-between">
              <h2
                id="analytics-heading"
                className="text-lg font-semibold tracking-tight text-neutral-900"
              >
                Full analytics
              </h2>
              <span className="text-xs text-neutral-500">
                As of {formatRelativeTime(post.posted_at)}
              </span>
            </header>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-5">
              <BigStat label="Reach" value={formatNumber(post.metrics.reach)} />
              <BigStat
                label="Impressions"
                value={formatNumber(post.metrics.impressions)}
              />
              <BigStat
                label="Total engagements"
                value={formatNumber(totalEngagements)}
              />
              <BigStat
                label="Engagement rate"
                value={formatPercent(post.metrics.engagement_rate, 2)}
              />
              <BigStat label="Likes" value={formatNumber(post.metrics.likes)} />
              <BigStat
                label="Comments"
                value={formatNumber(post.metrics.comments)}
              />
              <BigStat
                label="Shares"
                value={formatNumber(post.metrics.shares)}
              />
              <BigStat label="Saves" value={formatNumber(post.metrics.saves)} />
              {post.metrics.plays !== undefined ? (
                <BigStat
                  label="Plays"
                  value={formatNumber(post.metrics.plays)}
                />
              ) : null}
              {post.metrics.avg_watch_time_sec !== undefined ? (
                <BigStat
                  label="Avg watch time"
                  value={formatDuration(post.metrics.avg_watch_time_sec)}
                />
              ) : null}
              {post.metrics.completion_rate !== undefined ? (
                <BigStat
                  label="Completion rate"
                  value={formatPercent(post.metrics.completion_rate, 1)}
                />
              ) : null}
              {post.metrics.profile_visits !== undefined ? (
                <BigStat
                  label="Profile visits"
                  value={formatNumber(post.metrics.profile_visits)}
                />
              ) : null}
              {post.metrics.follows !== undefined ? (
                <BigStat
                  label="New follows"
                  value={formatNumber(post.metrics.follows)}
                />
              ) : null}
              {post.metrics.link_clicks !== undefined ? (
                <BigStat
                  label="Link clicks"
                  value={formatNumber(post.metrics.link_clicks)}
                />
              ) : null}
            </div>

            {/* Sparkline timeseries */}
            {post.daily && post.daily.length > 1 ? (
              <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-25 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                      Reach over the {post.daily.length} days following posting
                    </div>
                    <div className="mt-0.5 text-sm text-neutral-600">
                      Peak day:{" "}
                      <span className="font-medium text-neutral-900 tabular-nums">
                        {formatCompactNumber(
                          Math.max(...post.daily.map((d) => d.reach)),
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <MetricSparkline
                    values={post.daily.map((d) => d.reach)}
                    width={640}
                    height={96}
                    className="w-full h-auto"
                  />
                </div>
              </div>
            ) : null}
          </section>

          {/* Audience breakdown if available */}
          {post.audience ? (
            <section
              className="rounded-xl border border-neutral-200 bg-white shadow-card p-5"
              aria-labelledby="audience-heading"
            >
              <h2
                id="audience-heading"
                className="text-lg font-semibold tracking-tight text-neutral-900"
              >
                Who saw this post
              </h2>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-5">
                <AudienceBlock
                  title="Top locations"
                  slices={post.audience.top_locations}
                />
                <AudienceBlock
                  title="Age"
                  slices={post.audience.age_buckets}
                />
                <AudienceBlock
                  title="Gender"
                  slices={post.audience.gender_split}
                />
              </div>
            </section>
          ) : null}

          {/* Claude AI analysis seed */}
          <AiAnalysisPanel />
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          {post.property ? (
            <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5">
              <h3 className="text-sm font-semibold text-neutral-900">
                Linked property
              </h3>
              <div className="mt-3">
                <PropertyChip property={post.property} variant="full" />
                <p className="mt-3 text-xs text-neutral-500">
                  Performance from this post rolls up into the property&apos;s
                  report card on the Reports tab.
                </p>
              </div>
            </div>
          ) : null}

          <PropertyClassifyPanel
            postId={post.id}
            initialProperty={post.property}
            initialCategory={post.category}
            initialLinkMethod={post.link_method}
            initialAgentName={post.agent_name}
            offices={officeOptions}
            initialOfficeId={initialOfficeId}
          />

          <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5">
            <h3 className="text-sm font-semibold text-neutral-900">
              Quick context
            </h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Platform" value={platformLabel(post.platform)} />
              <Row label="Posted" value={formatShortDate(post.posted_at)} />
              <Row label="Media" value={cap(post.media_type)} />
              <Row label="Post ID" value={post.id} mono />
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-neutral-900">
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
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {slices.map((s) => (
          <li key={s.label} className="text-sm">
            <div className="flex justify-between text-neutral-700 mb-0.5">
              <span className="truncate pr-2">{s.label}</span>
              <span className="tabular-nums text-neutral-500">
                {formatPercent(s.share, 0)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
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

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd
        className={
          "text-neutral-800 truncate " + (mono ? "font-mono text-xs" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
