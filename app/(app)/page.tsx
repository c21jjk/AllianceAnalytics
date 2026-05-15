import { requireUser } from "@/lib/auth";
import {
  getAccountHealth,
  getMlsFeedHealth,
  getCompanyAnalytics,
  getFollowerSummary,
  getPosts,
} from "@/lib/data";
import { getGroupsLastNDays } from "@/lib/data/groups";
import { getListingsNeedingPosts } from "@/lib/data/listings-needing-posts";
import {
  getRecentlySoldListings,
  getUnderContractListings,
} from "@/lib/data/recently-sold";
import { getRecentStatusFlips } from "@/lib/data/recent-status-flips";
import { backfillStatusFlipOutbox } from "@/lib/data/agent-outbox-db";
import { countOwnerStoryViewsInWindow } from "@/lib/data/owner-story-db";
import { getUpcomingOpenHouses } from "@/lib/data/open-houses";
import { listOffices } from "@/lib/data/offices";
import {
  searchPosts,
  type SearchPostResult,
} from "@/lib/data/search-posts";
import type { Platform, Post } from "@/lib/types/post";
import AccountSyncBar from "@/components/AccountSyncBar";
import CompanyAnalyticsStrip from "@/components/CompanyAnalyticsStrip";
import DashboardViewToggle from "@/components/DashboardViewToggle";
import GlobalSearch from "@/components/GlobalSearch";
import PostStreamDnd from "@/components/PostStreamDnd";
import RecentlyListedRow from "@/components/RecentlyListedRow";
import UnderContractRow from "@/components/UnderContractRow";
import RecentlySoldRow from "@/components/RecentlySoldRow";
import UpcomingOpenHousesRow from "@/components/UpcomingOpenHousesRow";
import WinsToCelebrateCard from "@/components/WinsToCelebrateCard";
import MorningBriefingCard from "@/components/MorningBriefingCard";
import OfficeFilterChips from "@/components/OfficeFilterChips";
import PageHeader from "@/components/PageHeader";
import PostStream from "@/components/PostStream";
import SortToggle from "@/components/SortToggle";
import SyncNowButton from "@/components/SyncNowButton";
import TimeRangeToggle from "@/components/TimeRangeToggle";

export const metadata = {
  title: "Alliance Social — Operational view",
};
export const dynamic = "force-dynamic";

const ALLOWED_RANGES = [7, 14, 30, 90, 365] as const;
type View = "grouped" | "list";

interface HomePageProps {
  searchParams: Promise<{
    range?: string;
    office?: string;
    view?: string;
    /**
     * Listings strip filter: "all" | undefined (default = "needs_only").
     * Drives the Status filter chip on the Recent Listings strip.
     */
    listings?: string;
    /**
     * Sort order for the post stream. "recent" (default) = newest first by
     * posted_date. "activity" = highest total reach first. Surfaced as
     * tabs directly above the posts. See SortToggle.
     */
    sort?: string;
    /**
     * Global post search params (active only when view=list AND at least one
     * is present). Multiple platform values are supported via repeated
     * query params: `?platform=facebook&platform=instagram`.
     */
    q?: string;
    platform?: string | string[];
    from?: string;
    to?: string;
  }>;
}

const PLATFORM_SET = new Set<Platform>(["facebook", "instagram", "tiktok"]);

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
  const profile = await requireUser();
  const {
    range,
    office,
    view,
    listings: listingsParam,
    sort: sortParam,
    q: qRaw,
    platform: platformRaw,
    from: fromRaw,
    to: toRaw,
  } = await searchParams;
  const days = parseRange(range);
  const currentView: View = view === "list" ? "list" : "grouped";
  const currentSort: "recent" | "activity" =
    sortParam === "activity" ? "activity" : "recent";
  const listingsFilter: "needs_only" | "all" =
    listingsParam === "all" ? "all" : "needs_only";

  const offices = await listOffices({ active_only: true });
  const validShortCodes = new Set(offices.map((o) => o.short_code));
  const officeFilter =
    office && validShortCodes.has(office) ? office : null;

  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  // Search params are only honored in list view. Any one of q/platform/from/to
  // flips us into "search mode" — the list is filtered via the GIN-indexed
  // posts.search_text column instead of the standard recency window.
  const q = (qRaw ?? "").trim();
  const platformValues = normalizePlatformParam(platformRaw);
  const dateFrom = isValidDateLike(fromRaw) ? fromRaw : undefined;
  const dateTo = isValidDateLike(toRaw) ? toRaw : undefined;
  const searchMode: boolean =
    currentView === "list" &&
    (q.length > 0 ||
      platformValues.length > 0 ||
      Boolean(dateFrom) ||
      Boolean(dateTo));

  // Fetch only what the active view needs. The "needs Larissa" strip runs
  // on every render — it's cheap (≤25 properties + a single posts.platform
  // count query) and catches new listings the moment the RETS sync replicates
  // them, which is the whole point.
  const [
    groups,
    posts,
    accountHealth,
    mlsHealth,
    listingsNeedingPosts,
    underContractListings,
    recentlySoldListings,
    upcomingOpenHouses,
    recentStatusFlips,
    _outboxBackfilled,
    storyViewsLast24h,
    companyAnalytics,
    followerSummary,
  ] = await Promise.all([
    currentView === "grouped"
      ? getGroupsLastNDays(days, {
          office_short_code: officeFilter,
          sort: currentSort,
        })
      : Promise.resolve([]),
    currentView === "list"
      ? searchMode
        ? searchPosts({
            q,
            platforms: platformValues.length > 0 ? platformValues : undefined,
            dateFrom,
            dateTo,
            limit: 200,
          }).then((res) => res.results.map(searchResultToPost))
        : getPosts({
            office_short_code: officeFilter,
            since: sinceIso,
            sort: currentSort,
          })
      : Promise.resolve([]),
    getAccountHealth(),
    getMlsFeedHealth(),
    getListingsNeedingPosts({
      office_short_code: officeFilter,
      status_filter: listingsFilter,
    }),
    getUnderContractListings({
      office_short_code: officeFilter,
      limit: 8,
    }),
    getRecentlySoldListings({
      office_short_code: officeFilter,
      windowDays: 30,
      limit: 8,
    }),
    getUpcomingOpenHouses({
      office_short_code: officeFilter,
      windowDays: 7,
      limit: 12,
    }),
    getRecentStatusFlips({
      office_short_code: officeFilter,
      daysBack: 3,
      limit: 20,
    }),
    // Phase 6 — best-effort backfill of status_flip outbox rows on every
    // dashboard load. Idempotent via the unique index on
    // (property_id, flip_at) WHERE notification_type='status_flip', so it's
    // safe to run on every render. New flips automatically materialize
    // outbox rows that Larissa can email from /outbox.
    backfillStatusFlipOutbox({ daysBack: 3 }).then(() => null).catch(() => null),
    // Story-view rollup for the Morning Briefing card. Single COUNT query.
    countOwnerStoryViewsInWindow(24 * 3_600_000),
    getCompanyAnalytics({ days, office_short_code: officeFilter }),
    getFollowerSummary(days),
  ]);

  const description =
    currentView === "grouped"
      ? describeGroupedWindow(groups.length, days, officeFilter, offices)
      : searchMode
        ? describeSearchWindow(posts.length, q, platformValues, dateFrom, dateTo)
        : describeListWindow(posts.length, days, officeFilter, offices);

  return (
    <div className="space-y-6">
      <PageHeader
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <DashboardViewToggle value={currentView} />
            <TimeRangeToggle value={days} />
          </div>
        }
      />

      {/* Global post search — moved from top nav to here so it lives with
          the dashboard data it surfaces. Cmd+K shortcut still works. */}
      <div className="w-full max-w-2xl">
        <GlobalSearch />
      </div>

      {offices.length > 0 ? (
        <OfficeFilterChips
          options={offices.map((o) => ({
            short_code: o.short_code,
            name: o.name,
          }))}
          value={officeFilter}
        />
      ) : null}

      <CompanyAnalyticsStrip
        data={companyAnalytics}
        followers={followerSummary}
        days={days}
        officeShortCode={officeFilter}
      />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <AccountSyncBar
          health={accountHealth}
          mlsHealth={mlsHealth}
          className="flex-1 min-w-0"
        />
        {profile.role === "admin" ? <SyncNowButton /> : null}
      </div>

      {/* Wins to celebrate — Phase 6. Renders only when there's actually
          something flipped recently AND uncelebrated; quiet on slow weeks. */}
      <WinsToCelebrateCard flips={recentStatusFlips} />

      {/* Milestones grid — four collapsible cards.
          Layout: 2-column grid on desktop, single column on mobile.
            Left  (50%): Recently Listed — needs coverage (full height)
            Right (50%): Open Houses → Under Contract → Recently Sold
          Each card collapses by default; freshCount drives the "X new"
          badge that pulls Larissa into whichever card has news from the
          last 24 hours. */}
      {(() => {
        // Compute fresh-in-last-24h counts for each card. Cheap — these are
        // already-fetched lists; we just filter by first_seen_at.
        const cutoffMs = Date.now() - 24 * 3600_000;
        const isFresh = (iso: string): boolean => {
          const t = Date.parse(iso);
          return Number.isFinite(t) && t >= cutoffMs;
        };
        const listedFreshCount = listingsNeedingPosts.filter((x) =>
          isFresh(x.first_seen_at),
        ).length;
        const openHousesFreshCount = upcomingOpenHouses.filter((x) =>
          isFresh(x.first_seen_at),
        ).length;
        const underContractFreshCount = underContractListings.filter((x) =>
          isFresh(x.first_seen_at),
        ).length;
        const recentlySoldFreshCount = recentlySoldListings.filter((x) =>
          isFresh(x.first_seen_at),
        ).length;

        return (
          <>
            {/* Phase 7 — Morning Briefing one-liner. Anchors below jump to
                the relevant milestone card. Hides when there's nothing to say. */}
            <MorningBriefingCard
              newListingsFresh={listedFreshCount}
              underContractFresh={underContractFreshCount}
              recentlySoldFresh={recentlySoldFreshCount}
              openHousesThisWeek={upcomingOpenHouses.length}
              storyViewsLast24h={storyViewsLast24h ?? 0}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div id="recently-listed" className="scroll-mt-32">
                <RecentlyListedRow
                  listings={listingsNeedingPosts}
                  statusFilter={listingsFilter}
                  officeShortCode={officeFilter}
                  freshCount={listedFreshCount}
                />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div id="open-houses" className="scroll-mt-32">
                  <UpcomingOpenHousesRow
                    openHouses={upcomingOpenHouses}
                    windowDays={7}
                    officeShortCode={officeFilter}
                    freshCount={openHousesFreshCount}
                  />
                </div>
                <div id="under-contract" className="scroll-mt-32">
                  <UnderContractRow
                    listings={underContractListings}
                    officeShortCode={officeFilter}
                    freshCount={underContractFreshCount}
                  />
                </div>
                <div id="recently-sold" className="scroll-mt-32">
                  <RecentlySoldRow
                    listings={recentlySoldListings}
                    windowDays={30}
                    officeShortCode={officeFilter}
                    freshCount={recentlySoldFreshCount}
                  />
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* Section break + sort tabs — visually separates the "Recent listings
          to action" zone above from the "Posts to review" zone below. The
          tabs sit directly above the post stream so the sort control is
          right where the user's eye lands when scanning posts. */}
      <div className="pt-2 border-t-2 border-neutral-200">
        <SortToggle value={currentSort} />
      </div>

      {currentView === "grouped" ? (
        groups.length === 0 ? (
          <EmptyGroupedState days={days} />
        ) : (
          <PostStreamDnd
            groups={groups}
            offices={offices.map((o) => ({
              short_code: o.short_code,
              name: o.name,
            }))}
            isAdmin={profile.role === "admin"}
          />
        )
      ) : (
        <PostStream posts={posts} pageSize={30} />
      )}
    </div>
  );
}

function parseRange(raw: string | undefined): number {
  if (raw === "ytd") return ytdDays();
  // "1y" is the canonical rolling-12-months token. Literal "365" is also
  // accepted because it's in ALLOWED_RANGES — keeps deep links from older
  // builds (and any direct URL hacking) working.
  if (raw === "1y") return 365;
  const parsed = Number(raw);
  if (
    Number.isFinite(parsed) &&
    (ALLOWED_RANGES as readonly number[]).includes(parsed)
  ) {
    return parsed;
  }
  return 30;
}

/** Days from Jan 1 of the current year through today (UTC), inclusive. */
function ytdDays(now: Date = new Date()): number {
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const diffMs = now.getTime() - startOfYear.getTime();
  return Math.max(1, Math.ceil(diffMs / 86_400_000));
}

const DIVISION_LABELS: Record<string, string> = {
  shore: "Shore Division",
  south_jersey: "South Jersey Division",
};

/**
 * Audience-aware scope label. When an office is selected the filter
 * matches three audience scopes — the office, its division, and brand-wide
 * — so the description should reflect that, not just the office name.
 */
function audienceScopeLabel(
  officeShortCode: string | null,
  offices: { short_code: string; name: string; division: string | null }[],
): string {
  if (!officeShortCode) return "";
  const office = offices.find((o) => o.short_code === officeShortCode);
  if (!office) return "";
  const divisionLabel = office.division
    ? DIVISION_LABELS[office.division] ?? null
    : null;
  return divisionLabel
    ? ` scoped to ${office.name} + ${divisionLabel} + brand-wide`
    : ` scoped to ${office.name} + brand-wide`;
}

function describeGroupedWindow(
  count: number,
  days: number,
  officeShortCode: string | null,
  offices: { short_code: string; name: string; division: string | null }[],
): string {
  const scope = audienceScopeLabel(officeShortCode, offices);
  if (count === 0) {
    return `Looking back ${days} days${scope}. No campaigns to show yet.`;
  }
  const noun = count === 1 ? "campaign" : "campaigns";
  return `${count} ${noun} in the last ${days} days${scope}. Same-day posts across platforms are merged into a single card.`;
}

function normalizePlatformParam(raw: string | string[] | undefined): Platform[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const out: Platform[] = [];
  for (const v of values) {
    const lower = v.trim().toLowerCase();
    if (PLATFORM_SET.has(lower as Platform)) {
      out.push(lower as Platform);
    }
  }
  return out;
}

function isValidDateLike(s: string | undefined): s is string {
  if (!s) return false;
  return !Number.isNaN(Date.parse(s));
}

/**
 * Adapt the lightweight SearchPostResult shape into the full Post type that
 * <PostStream> + <PostListRow> expect. Missing fields get safe defaults —
 * search results don't carry daily series or audience data, so we synthesize
 * a single-point reach + per-platform engagement-rate calc.
 */
function searchResultToPost(r: SearchPostResult): Post {
  const reach = r.reach;
  const engagements = r.engagements;
  const er = reach > 0 ? engagements / reach : 0;
  return {
    id: r.id,
    platform: r.platform,
    permalink: r.permalink ?? "",
    posted_at: r.posted_at ?? new Date(0).toISOString(),
    media_type: r.media_url ? "video" : "image",
    thumbnail_url: r.thumbnail_url ?? "",
    media_url: r.media_url ?? undefined,
    caption: r.caption ?? "",
    hashtags: [],
    property: r.listing
      ? {
          mls: r.listing.mls_number,
          address: r.listing.address ?? "",
        }
      : undefined,
    metrics: {
      impressions: reach,
      reach,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      engagement_rate: er,
    },
    daily: [],
  };
}

function describeSearchWindow(
  count: number,
  q: string,
  platforms: Platform[],
  dateFrom: string | undefined,
  dateTo: string | undefined,
): string {
  const noun = count === 1 ? "post" : "posts";
  const parts: string[] = [];
  if (q.length > 0) parts.push(`matching "${q}"`);
  if (platforms.length > 0) parts.push(`on ${platforms.join(", ")}`);
  if (dateFrom || dateTo) {
    const range =
      dateFrom && dateTo
        ? `between ${dateFrom.slice(0, 10)} and ${dateTo.slice(0, 10)}`
        : dateFrom
          ? `since ${dateFrom.slice(0, 10)}`
          : `through ${dateTo!.slice(0, 10)}`;
    parts.push(range);
  }
  const filterText = parts.length > 0 ? ` ${parts.join(", ")}` : "";
  if (count === 0) {
    return `No posts${filterText}. Try widening the filters.`;
  }
  return `${count} ${noun}${filterText}.`;
}

function describeListWindow(
  count: number,
  days: number,
  officeShortCode: string | null,
  offices: { short_code: string; name: string; division: string | null }[],
): string {
  const scope = audienceScopeLabel(officeShortCode, offices);
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
