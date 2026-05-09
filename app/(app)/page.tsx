import { requireUser } from "@/lib/auth";
import { getAccountHealth, getPosts } from "@/lib/data";
import { getGroupsLastNDays } from "@/lib/data/groups";
import { listOffices } from "@/lib/data/offices";
import AccountSyncBar from "@/components/AccountSyncBar";
import DashboardViewToggle from "@/components/DashboardViewToggle";
import GroupCard from "@/components/GroupCard";
import OfficeFilterChips from "@/components/OfficeFilterChips";
import PageHeader from "@/components/PageHeader";
import PostStream from "@/components/PostStream";
import TimeRangeToggle from "@/components/TimeRangeToggle";

export const metadata = {
  title: "Alliance Social — Operational view",
};
export const dynamic = "force-dynamic";

const ALLOWED_RANGES = [7, 14, 30] as const;
type View = "grouped" | "list";

interface HomePageProps {
  searchParams: Promise<{
    range?: string;
    office?: string;
    view?: string;
  }>;
}

/**
 * Operational homepage. Two views over the same data:
 *   - Grouped (default) — cross-platform campaign cards, one per (date+property)
 *     group. Same as before.
 *   - List — flat per-post stream with platform/date/query filters.
 *
 * Both views respect the time-range toggle (7/14/30d) and office filter chip.
 * Clicking any card opens the post detail in a right-side drawer overlay
 * (intercepted (.)posts/[id] route).
 */
export default async function HomePage({ searchParams }: HomePageProps) {
  await requireUser();
  const { range, office, view } = await searchParams;
  const days = parseRange(range);
  const currentView: View = view === "list" ? "list" : "grouped";

  const offices = await listOffices({ active_only: true });
  const validShortCodes = new Set(offices.map((o) => o.short_code));
  const officeFilter =
    office && validShortCodes.has(office) ? office : null;

  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  // Fetch only what the active view needs.
  const [groups, posts, accountHealth] = await Promise.all([
    currentView === "grouped"
      ? getGroupsLastNDays(days, { office_short_code: officeFilter })
      : Promise.resolve([]),
    currentView === "list"
      ? getPosts({ office_short_code: officeFilter, since: sinceIso })
      : Promise.resolve([]),
    getAccountHealth(),
  ]);

  const description =
    currentView === "grouped"
      ? describeGroupedWindow(groups.length, days, officeFilter, offices)
      : describeListWindow(posts.length, days, officeFilter, offices);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alliance Social"
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <DashboardViewToggle value={currentView} />
            <TimeRangeToggle value={days} />
          </div>
        }
      />

      {offices.length > 0 ? (
        <OfficeFilterChips
          options={offices.map((o) => ({
            short_code: o.short_code,
            name: o.name,
          }))}
          value={officeFilter}
        />
      ) : null}

      <AccountSyncBar health={accountHealth} />

      {currentView === "grouped" ? (
        groups.length === 0 ? (
          <EmptyGroupedState days={days} />
        ) : (
          <section className="space-y-3">
            {groups.map((g) => (
              <GroupCard key={g.id} group={g} />
            ))}
          </section>
        )
      ) : (
        <PostStream posts={posts} pageSize={30} />
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

function describeGroupedWindow(
  count: number,
  days: number,
  officeShortCode: string | null,
  offices: { short_code: string; name: string }[],
): string {
  const officeName = officeShortCode
    ? offices.find((o) => o.short_code === officeShortCode)?.name ?? null
    : null;
  const scope = officeName ? ` for ${officeName}` : "";
  if (count === 0) {
    return `Looking back ${days} days${scope}. No campaigns to show yet.`;
  }
  const noun = count === 1 ? "campaign" : "campaigns";
  return `${count} ${noun} in the last ${days} days${scope}. Same-day posts across platforms are merged into a single card.`;
}

function describeListWindow(
  count: number,
  days: number,
  officeShortCode: string | null,
  offices: { short_code: string; name: string }[],
): string {
  const officeName = officeShortCode
    ? offices.find((o) => o.short_code === officeShortCode)?.name ?? null
    : null;
  const scope = officeName ? ` for ${officeName}` : "";
  if (count === 0) {
    return `Looking back ${days} days${scope}. No posts in this window.`;
  }
  const noun = count === 1 ? "post" : "posts";
  return `${count} ${noun} in the last ${days} days${scope}. Click any row to open the post detail.`;
}

function EmptyGroupedState({ days }: { days: number }) {
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
