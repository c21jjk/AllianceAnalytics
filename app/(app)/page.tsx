import { requireUser } from "@/lib/auth";
import { getAccountHealth } from "@/lib/data";
import { getGroupsLastNDays } from "@/lib/data/groups";
import AccountSyncBar from "@/components/AccountSyncBar";
import GroupCard from "@/components/GroupCard";
import PageHeader from "@/components/PageHeader";
import TimeRangeToggle from "@/components/TimeRangeToggle";

export const metadata = {
  title: "Alliance Social — Operational view",
};

const ALLOWED_RANGES = [7, 14, 30] as const;

interface HomePageProps {
  searchParams: Promise<{ range?: string }>;
}

/**
 * Operational homepage: rolling timeline of post-groups (cross-platform
 * campaigns merged into one card). Default window is 7 days; toggle picks
 * 14d / 30d.
 */
export default async function HomePage({ searchParams }: HomePageProps) {
  await requireUser();
  const { range } = await searchParams;
  const days = parseRange(range);

  const [groups, accountHealth] = await Promise.all([
    getGroupsLastNDays(days),
    getAccountHealth(),
  ]);

  const description = describeWindow(groups.length, days);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alliance Social"
        description={description}
        actions={<TimeRangeToggle value={days} />}
      />

      <AccountSyncBar health={accountHealth} />

      {groups.length === 0 ? (
        <EmptyState days={days} />
      ) : (
        <section className="space-y-3">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </section>
      )}
    </div>
  );
}

function parseRange(raw: string | undefined): number {
  const parsed = Number(raw);
  if (
    Number.isFinite(parsed) &&
    (ALLOWED_RANGES as readonly number[]).includes(parsed)
  ) {
    return parsed;
  }
  return 7;
}

function describeWindow(count: number, days: number): string {
  if (count === 0) {
    return `Looking back ${days} days. No campaigns to show yet.`;
  }
  const noun = count === 1 ? "campaign" : "campaigns";
  return `${count} ${noun} in the last ${days} days. Same-day posts across platforms are merged into a single card.`;
}

function EmptyState({ days }: { days: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-card">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 7h16M4 12h16M4 17h10"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-neutral-900">
        No campaigns this week
      </h2>
      <p className="mt-1 text-sm text-neutral-500 max-w-sm mx-auto">
        Nothing posted in the last {days} days. New posts will land here as
        they sync from Instagram, TikTok, and Facebook.
      </p>
    </div>
  );
}
