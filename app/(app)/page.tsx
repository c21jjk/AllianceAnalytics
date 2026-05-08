import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { aggregateKpis } from "@/lib/fixtures/posts";
import { getPosts, getAccountHealth } from "@/lib/data";
import { getTopRecommendation } from "@/lib/fixtures/strategy";
import {
  formatCompactNumber,
  formatPercent,
} from "@/lib/format";
import AccountSyncBar from "@/components/AccountSyncBar";
import KpiInline from "@/components/KpiInline";
import PostStream from "@/components/PostStream";
import AiInsightCard from "@/components/AiInsightCard";
import StrategySnapshotCard from "@/components/StrategySnapshotCard";

export const metadata = {
  title: "Dashboard — Alliance Social",
};

export default async function DashboardPage() {
  const profile = await requireUser();
  const firstName =
    profile.full_name?.split(" ")[0] ?? profile.email.split("@")[0];

  const [posts, accountHealth] = await Promise.all([
    getPosts(),
    getAccountHealth(),
  ]);

  const kpis7 = aggregateKpis(posts, 7);
  const kpis14_7 = aggregateKpis(posts, 14);
  // Prior 7-day window = days 8–14 = full 14 minus most recent 7
  const priorReach = Math.max(kpis14_7.reach - kpis7.reach, 0);
  const reachDelta =
    priorReach === 0 ? 0 : (kpis7.reach - priorReach) / priorReach;

  const priorEngagements = Math.max(
    kpis14_7.engagements - kpis7.engagements,
    0,
  );
  const engagementDelta =
    priorEngagements === 0
      ? 0
      : (kpis7.engagements - priorEngagements) / priorEngagements;

  return (
    <div className="space-y-6">
      {/* Slim greeting header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <h1 className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
            Welcome back, {firstName}.
          </h1>
        </div>
        <AccountSyncBar health={accountHealth} />
      </div>

      {/* Compact KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiInline
          label="7-day reach"
          value={formatCompactNumber(kpis7.reach)}
          delta={
            reachDelta === 0
              ? undefined
              : {
                  text: `${formatPercent(Math.abs(reachDelta), 1)} vs prior 7d`,
                  direction: reachDelta > 0 ? "up" : "down",
                }
          }
        />
        <KpiInline
          label="Engagements"
          value={formatCompactNumber(kpis7.engagements)}
          delta={
            engagementDelta === 0
              ? undefined
              : {
                  text: `${formatPercent(Math.abs(engagementDelta), 1)} vs prior 7d`,
                  direction: engagementDelta > 0 ? "up" : "down",
                }
          }
        />
        <KpiInline
          label="Engagement rate"
          value={formatPercent(kpis7.engagementRate, 1)}
        />
        <KpiInline
          label="Posts published"
          value={kpis7.postCount.toString()}
          delta={{
            text: `${posts.length} in last 30d`,
            direction: "flat",
          }}
        />
      </div>

      {/* Claude AI seeds: weekly insight + Coach snapshot, side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AiInsightCard
          isPlaceholder
          headline="Weekly performance summary, written for you"
          body="Once Claude is connected, this card will surface a plain-English read on your week — what worked, what didn't, and which posts to reshare or repurpose."
          bullets={[
            "Top performing post and why it landed",
            "One pattern across your last 7 posts",
            "One concrete content idea for next week",
          ]}
        />
        <StrategySnapshotCard recommendation={getTopRecommendation()} />
      </div>

      {/* The post stream — the main attraction */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
              Recent posts
            </h2>
            <p className="text-sm text-neutral-500">
              Tap a thumbnail to open the original post · tap the row for full
              analytics.
            </p>
          </div>
          <Link
            href="/posts"
            className="text-sm font-medium text-gold-700 hover:text-gold-800 inline-flex items-center gap-1"
          >
            Advanced view
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
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
          </Link>
        </div>

        <PostStream posts={posts} pageSize={8} />
      </section>
    </div>
  );
}
