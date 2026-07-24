import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPosts, getCompanyAnalytics } from "@/lib/data";
import type { Post } from "@/lib/types/post";

export const metadata = { title: "Track — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Mobile Track — phone-first performance view (Larissa's iPhone).
 *
 * 30-day company KPIs up top, then the recent-post stream with reach +
 * engagement at a glance. Tapping a post opens the full post detail
 * (/posts/[id] — same bundle the desktop drawer uses).
 *
 * Reach nuance: Meta stopped reporting reach for static FB photo posts
 * (API deprecation, June 2026) — those show "n/a", matching the desktop
 * PlatformMetricCell presentation, so a 0 is never confused with
 * "Facebook won't say."
 */

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDelta(current: number, prev: number): { text: string; up: boolean } | null {
  if (prev <= 0) return null;
  const pct = ((current - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return null;
  return { text: `${pct >= 0 ? "+" : ""}${Math.round(pct)}%`, up: pct >= 0 };
}

/** Meta no longer reports reach for static FB photo/carousel posts. */
function reachUnavailable(post: Post): boolean {
  return post.platform === "facebook" && post.media_type !== "video";
}

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  facebook: { label: "FB", className: "bg-[#1877F2]/10 text-[#1877F2]" },
  instagram: { label: "IG", className: "bg-[#E4405F]/10 text-[#E4405F]" },
  tiktok: { label: "TT", className: "bg-neutral-900/10 text-neutral-900" },
};

export default async function MobileTrackPage() {
  await requireUser();

  const [posts, analytics] = await Promise.all([
    getPosts({ sort: "recent" }),
    getCompanyAnalytics({ days: 30 }),
  ]);

  const recent = posts.slice(0, 40);
  const engagements = (p: Post) =>
    p.metrics.likes + p.metrics.comments + p.metrics.shares + p.metrics.saves +
    (p.metrics.link_clicks ?? 0);

  const reachDelta = fmtDelta(analytics.reach, analytics.prev_reach);
  const engDelta = fmtDelta(analytics.engagement, analytics.prev_engagement);

  return (
    <div className="mx-auto max-w-md pb-10">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Track</h1>

      {/* 30-day KPI strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Reach 30d
          </p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {fmtCount(analytics.reach)}
          </p>
          {reachDelta ? (
            <p
              className={
                reachDelta.up ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-red-600"
              }
            >
              {reachDelta.text}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Engagement
          </p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {fmtCount(analytics.engagement)}
          </p>
          {engDelta ? (
            <p
              className={
                engDelta.up ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-red-600"
              }
            >
              {engDelta.text}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Posts 30d
          </p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {analytics.posts_published}
          </p>
        </div>
      </div>

      {/* Recent posts */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-neutral-800">
        Recent posts
      </h2>
      {recent.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          No synced posts yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {recent.map((post) => {
            const badge = PLATFORM_BADGE[post.platform] ?? {
              label: post.platform,
              className: "bg-neutral-100 text-neutral-600",
            };
            const noReach = reachUnavailable(post);
            const posted = new Date(post.posted_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "America/New_York",
            });
            return (
              <li key={post.id}>
                <Link
                  href={`/posts/${post.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-2.5 active:bg-neutral-50"
                >
                  {post.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.thumbnail_url}
                      alt=""
                      className="h-16 w-16 shrink-0 rounded-xl object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-16 w-16 shrink-0 rounded-xl bg-neutral-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      <span className="text-[11px] text-neutral-500">{posted}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium text-neutral-900">
                      {post.property?.address ?? post.caption.slice(0, 60)}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {noReach ? (
                        <span title="Meta no longer reports reach for Facebook photo posts">
                          Reach n/a
                        </span>
                      ) : (
                        <>Reach {fmtCount(post.metrics.reach || post.metrics.plays || 0)}</>
                      )}
                      {" · "}
                      {fmtCount(engagements(post))} engagements
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
