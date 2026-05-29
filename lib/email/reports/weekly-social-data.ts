import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reachOf as sharedReachOf } from "@/lib/data/post-metrics";

/**
 * Data fetcher for the weekly social media email report.
 *
 * Pulls everything needed for the leadership recap in a single round-trip
 * to `posts` (the date range from Jan 1 last year through "now") plus one
 * small lookup for office display names. Falls back to a zero-shaped object
 * if anything goes wrong — the report should never block the send pipeline.
 *
 * Windows are computed in America/New_York:
 *   - `week`   = most recently completed Mon → Sun
 *   - `prevWeek` = the week before that (for WoW deltas)
 *   - `weekYoY`  = same Mon → Sun, shifted back 52 weeks (for week-of-last-year)
 *   - `ytd`    = Jan 1 (this year, ET) → end of `week`
 *   - `ytdYoY` = Jan 1 (last year, ET) → end of `week`, shifted back 52 weeks
 *
 * Aggregates returned:
 *   - per-platform reach + posts (current + prev for WoW)
 *   - YTD totals (this year + last year for YoY)
 *   - week-of-last-year totals (for week YoY)
 *   - top 3 campaigns (group-aware, reach merged across platforms within a group)
 *   - listings represented (with top 3 by post count)
 *   - office spotlight (top office by current-week reach)
 *   - agent leaderboard (top 3 normalized agents by current-week reach)
 */

export type WeeklyPlatform = "facebook" | "instagram" | "tiktok";

const PLATFORMS: WeeklyPlatform[] = ["facebook", "instagram", "tiktok"];

/** Portal slot keys mirror lib/data/portal-metrics-db.ts. */
export type WeeklyPortalKey = "zillow" | "realtor" | "trulia" | "redfin" | "cih";

const PORTAL_STRIP_DEFS: Array<{
  key: WeeklyPortalKey;
  display_name: string;
  members: string[];
}> = [
  { key: "zillow",  display_name: "Zillow",        members: ["Zillow.com","Zillow","zillow.com"] },
  { key: "realtor", display_name: "Realtor.com",   members: ["Realtor.com","realtor.com"] },
  { key: "trulia",  display_name: "Trulia",        members: ["Trulia","trulia.com"] },
  { key: "redfin",  display_name: "Redfin",        members: ["Redfin","redfin.com"] },
  { key: "cih",     display_name: "CIH",
    members: [
      "century21.com","century21global.com","Coldwell Banker","coldwellbanker.com","coldwellbankerhomes.com",
      "CBCworldwide.com","sothebysrealty.com","sir.com","BHGRE.com","bhgre.com",
      "Corcoran.com","corcoran.com","era.com","ERA.com","compass.com","Compass","NRT",
    ],
  },
];

export interface WeeklyPortalSlot {
  key: WeeklyPortalKey;
  display_name: string;
  views: number;
}

export interface WeeklyPortalListing {
  mls_number: string;
  address: string | null;
  city: string | null;
  hero_image_url: string | null;
  total_views: number;
  by_slot: Record<WeeklyPortalKey, number>;
}

export interface WeeklyPortalTraffic {
  /** True if the week had any portal views at all. False → section is hidden. */
  has_data: boolean;
  /** Org-wide total across every listing + every portal in the window. */
  total_views: number;
  /** Always-5-entries breakdown (Zillow, Realtor, Trulia, Redfin, CIH). */
  by_slot: WeeklyPortalSlot[];
  /** Top 5 listings by total views in the window. */
  top_listings: WeeklyPortalListing[];
}

function emptyPortalTraffic(): WeeklyPortalTraffic {
  return {
    has_data: false,
    total_views: 0,
    by_slot: PORTAL_STRIP_DEFS.map((d) => ({
      key: d.key,
      display_name: d.display_name,
      views: 0,
    })),
    top_listings: [],
  };
}

export interface WeeklyPlatformStats {
  posts: number;
  reach: number;
}

/**
 * Per-platform stats within a single campaign. Extends WeeklyPlatformStats
 * with the best (highest-reach) permalink for that platform inside the group,
 * so the email template can deep-link each platform badge directly to the
 * actual FB / IG / TT post.
 */
export interface WeeklyCampaignPlatformStats extends WeeklyPlatformStats {
  /** Highest-reach permalink for this platform within the campaign group. */
  permalink: string | null;
}

export interface WeeklyTopCampaign {
  /** Group id when the campaign spans multiple platforms; otherwise the post id with a `post:` prefix. */
  key: string;
  /** URL-safe slug for /groups/[id] (or /posts/[id] if singleton). */
  linkPath: string;
  /** Reach summed across every platform in the campaign. */
  mergedReach: number;
  /** Per-platform reach within this campaign, plus best-permalink per platform for deep links. */
  perPlatform: Partial<Record<WeeklyPlatform, WeeklyCampaignPlatformStats>>;
  /** Representative caption snippet. */
  caption: string | null;
  /** Representative thumbnail. */
  thumbnail_url: string | null;
  posted_at: string | null;
  property_address: string | null;
  property_city: string | null;
  /** Which platforms participated, in stable order. */
  platforms: WeeklyPlatform[];
}

export interface WeeklyListingMention {
  property_id: string;
  address: string | null;
  city: string | null;
  post_count: number;
}

export interface WeeklyOfficeSpotlight {
  office_id: string;
  name: string;
  reach: number;
  posts: number;
}

export interface WeeklyAgentLeader {
  display_name: string;
  reach: number;
  posts: number;
}

export interface AggregateWindow {
  reach: number;
  posts: number;
  listings: number;
}

export interface WeeklySocialReportData {
  /* ---- window labels & ISO bounds ---- */
  weekStartIso: string;
  weekEndIso: string;
  weekStartLabel: string;
  weekEndLabel: string;
  prevWeekStartIso: string;
  prevWeekEndIso: string;
  weekYoYStartIso: string;
  weekYoYEndIso: string;
  ytdStartIso: string;
  ytdEndIso: string;
  ytdYoYStartIso: string;
  ytdYoYEndIso: string;
  ytdYearLabel: string;
  ytdYoYYearLabel: string;

  /* ---- this-week numbers ---- */
  totals: WeeklyPlatformStats;
  prevTotals: WeeklyPlatformStats;
  weekYoY: WeeklyPlatformStats;
  byPlatform: Record<WeeklyPlatform, WeeklyPlatformStats>;
  prevByPlatform: Record<WeeklyPlatform, WeeklyPlatformStats>;

  /* ---- YTD numbers ---- */
  ytd: AggregateWindow;
  ytdYoY: AggregateWindow;
  /** Per-platform YTD reach + posts (current year). Used for in-cell mini-splits. */
  ytdByPlatform: Record<WeeklyPlatform, WeeklyPlatformStats>;

  /* ---- campaign / listing / office / agent breakdowns (current week) ---- */
  topCampaigns: WeeklyTopCampaign[];
  listings: WeeklyListingMention[];
  listingsTotal: number;
  officeSpotlight: WeeklyOfficeSpotlight | null;
  agentLeaderboard: WeeklyAgentLeader[];

  /* ---- portal traffic (ListTrac) — current week ---- */
  portalTraffic: WeeklyPortalTraffic;
}

/* --------------------------------------------------------------------- */
/* Window math (America/New_York)                                        */
/* --------------------------------------------------------------------- */

function nyMidnightIso(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const probe = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const tzName =
    offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-04:00";
  const offset = tzName.replace(/^GMT/, "") || "-04:00";
  return `${yyyy}-${mm}-${dd}T00:00:00${offset}`;
}

function formatMonthDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
}

function shiftDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Compute all windows the report needs in one shot. Anchored to NY-local
 * Monday boundaries.
 */
export function getReportWindow(now: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekdayShort = get("weekday");
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekdayShort,
  );
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);

  // Days back to "last complete week"'s Monday.
  const daysToLastMon = wd === 0 ? 13 : 6 + wd;
  const probe = new Date(Date.UTC(year, month - 1, day));

  const weekStartDate = shiftDays(probe, -daysToLastMon);
  const weekEndDate = shiftDays(weekStartDate, 7); // exclusive
  const weekLastDate = shiftDays(weekStartDate, 6); // Sunday (label only)
  const prevWeekStartDate = shiftDays(weekStartDate, -7);
  const weekYoYStartDate = shiftDays(weekStartDate, -7 * 52);
  const weekYoYEndDate = shiftDays(weekEndDate, -7 * 52);

  // YTD: Jan 1 (NY) of weekEnd's year → weekEnd.
  // YTD YoY: Jan 1 of last year (NY) → the SAME CALENDAR DATE as weekEnd, one
  // year prior.
  //
  // 2026-05-28 (Phase 4 #5) — previously ytdYoYEnd was weekEnd shifted back
  // 52 weeks (-364 days). That mixed conventions with the calendar Jan-1
  // start: the this-year YTD span (Jan 1 → weekEnd) and the last-year span
  // (Jan 1 → weekEnd-364) were unequal, and the end drifted ~1 day off the
  // true anniversary every year (2 in a leap year). YTD is a calendar
  // cumulative, so the correct last-year endpoint is the calendar anniversary
  // of weekEnd. (The WEEK YoY above intentionally keeps the 52-week shift so
  // the Mon→Sun window lines up on the same weekdays last year.)
  const weekEndYear = weekEndDate.getUTCFullYear();
  const ytdStartDate = new Date(Date.UTC(weekEndYear, 0, 1));
  const ytdYoYStartDate = new Date(Date.UTC(weekEndYear - 1, 0, 1));
  const ytdYoYEndDate = new Date(
    Date.UTC(
      weekEndYear - 1,
      weekEndDate.getUTCMonth(),
      weekEndDate.getUTCDate(),
    ),
  );

  return {
    weekStartIso: nyMidnightIso(weekStartDate),
    weekEndIso: nyMidnightIso(weekEndDate),
    prevWeekStartIso: nyMidnightIso(prevWeekStartDate),
    prevWeekEndIso: nyMidnightIso(weekStartDate),
    weekYoYStartIso: nyMidnightIso(weekYoYStartDate),
    weekYoYEndIso: nyMidnightIso(weekYoYEndDate),
    ytdStartIso: nyMidnightIso(ytdStartDate),
    ytdEndIso: nyMidnightIso(weekEndDate),
    ytdYoYStartIso: nyMidnightIso(ytdYoYStartDate),
    ytdYoYEndIso: nyMidnightIso(ytdYoYEndDate),
    weekStartLabel: formatMonthDay(weekStartDate),
    weekEndLabel: formatMonthDay(weekLastDate),
    ytdYearLabel: String(weekEndYear),
    ytdYoYYearLabel: String(weekEndYear - 1),
  };
}

/* --------------------------------------------------------------------- */
/* Read helpers                                                          */
/* --------------------------------------------------------------------- */

function emptyStats(): WeeklyPlatformStats {
  return { posts: 0, reach: 0 };
}

function emptyAggregate(): AggregateWindow {
  return { reach: 0, posts: 0, listings: 0 };
}

interface PostRow {
  id: string;
  platform: WeeklyPlatform;
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  metrics: Record<string, unknown> | null;
  property_id: string | null;
  group_id: string | null;
  office_id: string | null;
  agent_name: string | null;
  /** Used by reachOf() to mirror the dashboard's video-aware reach formula. */
  media_type: string | null;
}

interface PropertyRow {
  id: string;
  address: string | null;
  city: string | null;
}

interface OfficeRow {
  id: string;
  name: string;
  display_name: string | null;
}

/**
 * Per-post reach — thin wrapper around the shared post-metrics helper so the
 * weekly email, dashboard, and Owner Story all use identical math.
 */
function reachOf(
  row: Pick<PostRow, "metrics" | "media_type" | "platform">,
): number {
  return sharedReachOf({
    metrics: row.metrics,
    media_type: row.media_type,
    platform: row.platform,
  });
}

function bucketStats(
  rows: Pick<PostRow, "platform" | "metrics" | "media_type">[],
): Record<WeeklyPlatform, WeeklyPlatformStats> {
  const out: Record<WeeklyPlatform, WeeklyPlatformStats> = {
    facebook: emptyStats(),
    instagram: emptyStats(),
    tiktok: emptyStats(),
  };
  for (const row of rows) {
    if (!PLATFORMS.includes(row.platform)) continue;
    out[row.platform].posts += 1;
    out[row.platform].reach += reachOf(row);
  }
  return out;
}

function sumStats(
  map: Record<WeeklyPlatform, WeeklyPlatformStats>,
): WeeklyPlatformStats {
  const out = emptyStats();
  for (const p of PLATFORMS) {
    out.posts += map[p].posts;
    out.reach += map[p].reach;
  }
  return out;
}

function aggregateOver(rows: PostRow[]): AggregateWindow {
  const listingSet = new Set<string>();
  let reach = 0;
  let posts = 0;
  for (const row of rows) {
    if (!PLATFORMS.includes(row.platform)) continue;
    reach += reachOf(row);
    posts += 1;
    if (row.property_id) listingSet.add(row.property_id);
  }
  return { reach, posts, listings: listingSet.size };
}

/**
 * Normalize an agent name for grouping: trim, collapse whitespace, lowercase.
 * Returns null for blank inputs so we can drop those posts from the leaderboard.
 */
function normalizeAgentKey(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, " ").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

function displayAgentName(raw: string | null): string {
  if (!raw) return "Unknown";
  return raw.replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------------------- */
/* Public API                                                            */
/* --------------------------------------------------------------------- */

export async function loadWeeklySocialReportData(
  now: Date = new Date(),
): Promise<WeeklySocialReportData> {
  const win = getReportWindow(now);
  const empty: WeeklySocialReportData = {
    ...win,
    totals: emptyStats(),
    prevTotals: emptyStats(),
    weekYoY: emptyStats(),
    byPlatform: {
      facebook: emptyStats(),
      instagram: emptyStats(),
      tiktok: emptyStats(),
    },
    prevByPlatform: {
      facebook: emptyStats(),
      instagram: emptyStats(),
      tiktok: emptyStats(),
    },
    ytd: emptyAggregate(),
    ytdYoY: emptyAggregate(),
    ytdByPlatform: {
      facebook: emptyStats(),
      instagram: emptyStats(),
      tiktok: emptyStats(),
    },
    topCampaigns: [],
    listings: [],
    listingsTotal: 0,
    officeSpotlight: null,
    agentLeaderboard: [],
    portalTraffic: emptyPortalTraffic(),
  };

  try {
    const supabase = createAdminClient();

    // Single big query covering ytdLastYear → weekEnd. We then bucket into the
    // various windows in JS. Total rows is small (<2k for one brokerage over
    // ~17 months) so this is well within request limits.
    const { data, error } = await supabase
      .from("posts")
      .select(
        "id, platform, caption, permalink, thumbnail_url, posted_at, metrics, property_id, group_id, office_id, agent_name, media_type",
      )
      .gte("posted_at", win.ytdYoYStartIso)
      .lt("posted_at", win.weekEndIso);
    if (error || !data) return empty;

    const rows = data as unknown as PostRow[];

    // Pre-compute timestamp once per row.
    const stamped = rows
      .filter((r) => r.posted_at && PLATFORMS.includes(r.platform))
      .map((r) => ({ row: r, t: new Date(r.posted_at as string).getTime() }))
      .filter((x) => !Number.isNaN(x.t));

    const weekStartT = new Date(win.weekStartIso).getTime();
    const weekEndT = new Date(win.weekEndIso).getTime();
    const prevWeekStartT = new Date(win.prevWeekStartIso).getTime();
    const weekYoYStartT = new Date(win.weekYoYStartIso).getTime();
    const weekYoYEndT = new Date(win.weekYoYEndIso).getTime();
    const ytdStartT = new Date(win.ytdStartIso).getTime();
    const ytdYoYStartT = new Date(win.ytdYoYStartIso).getTime();
    const ytdYoYEndT = new Date(win.ytdYoYEndIso).getTime();

    const current: PostRow[] = [];
    const previous: PostRow[] = [];
    const weekYoYRows: PostRow[] = [];
    const ytdRows: PostRow[] = [];
    const ytdYoYRows: PostRow[] = [];

    for (const { row, t } of stamped) {
      if (t >= weekStartT && t < weekEndT) current.push(row);
      else if (t >= prevWeekStartT && t < weekStartT) previous.push(row);
      if (t >= weekYoYStartT && t < weekYoYEndT) weekYoYRows.push(row);
      if (t >= ytdStartT && t < weekEndT) ytdRows.push(row);
      if (t >= ytdYoYStartT && t < ytdYoYEndT) ytdYoYRows.push(row);
    }

    const byPlatform = bucketStats(current);
    const prevByPlatform = bucketStats(previous);
    const totals = sumStats(byPlatform);
    const prevTotals = sumStats(prevByPlatform);
    const weekYoYTotals = sumStats(bucketStats(weekYoYRows));
    const ytd = aggregateOver(ytdRows);
    const ytdYoY = aggregateOver(ytdYoYRows);
    // Per-platform YTD breakdown for the in-cell mini-splits.
    const ytdByPlatform = bucketStats(ytdRows);

    /* ---- Top campaigns (group-aware) ---- */
    interface CampaignAccumulator {
      key: string;
      groupId: string | null;
      mergedReach: number;
      perPlatform: Partial<Record<WeeklyPlatform, WeeklyCampaignPlatformStats>>;
      /** Best (highest-reach) permalink seen per platform, used for deep links. */
      bestPermalinkReach: Partial<Record<WeeklyPlatform, number>>;
      // Use the post with the highest reach within the group as the representative.
      representative: PostRow | null;
      representativeReach: number;
      platforms: Set<WeeklyPlatform>;
    }
    const campaigns = new Map<string, CampaignAccumulator>();
    for (const row of current) {
      const key = row.group_id ? `group:${row.group_id}` : `post:${row.id}`;
      let acc = campaigns.get(key);
      if (!acc) {
        acc = {
          key,
          groupId: row.group_id,
          mergedReach: 0,
          perPlatform: {},
          bestPermalinkReach: {},
          representative: null,
          representativeReach: -1,
          platforms: new Set(),
        };
        campaigns.set(key, acc);
      }
      const r = reachOf(row);
      acc.mergedReach += r;
      acc.platforms.add(row.platform);
      const existing = acc.perPlatform[row.platform];
      const cell: WeeklyCampaignPlatformStats =
        existing ?? { posts: 0, reach: 0, permalink: null };
      cell.posts += 1;
      cell.reach += r;
      // Track best permalink per platform: the post inside this group with the
      // highest reach on that platform "wins" — that's the most useful link target.
      const bestSoFar = acc.bestPermalinkReach[row.platform] ?? -1;
      if (r > bestSoFar && row.permalink) {
        cell.permalink = row.permalink;
        acc.bestPermalinkReach[row.platform] = r;
      }
      acc.perPlatform[row.platform] = cell;
      if (r > acc.representativeReach) {
        acc.representativeReach = r;
        acc.representative = row;
      }
    }
    const sortedCampaigns = Array.from(campaigns.values())
      .filter((c) => c.representative !== null)
      .sort((a, b) => b.mergedReach - a.mergedReach)
      .slice(0, 3);

    /* ---- Listings represented ---- */
    const listingCounts = new Map<string, number>();
    for (const row of current) {
      if (!row.property_id) continue;
      listingCounts.set(
        row.property_id,
        (listingCounts.get(row.property_id) ?? 0) + 1,
      );
    }
    const topListingIds = Array.from(listingCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    /* ---- Office spotlight ---- */
    const officeReach = new Map<string, { reach: number; posts: number }>();
    for (const row of current) {
      if (!row.office_id) continue;
      const cell = officeReach.get(row.office_id) ?? { reach: 0, posts: 0 };
      cell.reach += reachOf(row);
      cell.posts += 1;
      officeReach.set(row.office_id, cell);
    }
    let topOfficeId: string | null = null;
    let topOfficeReach = -1;
    for (const [id, cell] of officeReach) {
      if (cell.reach > topOfficeReach) {
        topOfficeReach = cell.reach;
        topOfficeId = id;
      }
    }

    /* ---- Agent leaderboard ---- */
    interface AgentAccumulator {
      key: string;
      displayCandidates: Map<string, number>;
      reach: number;
      posts: number;
    }
    const agentMap = new Map<string, AgentAccumulator>();
    for (const row of current) {
      const key = normalizeAgentKey(row.agent_name);
      if (!key) continue;
      let acc = agentMap.get(key);
      if (!acc) {
        acc = {
          key,
          displayCandidates: new Map(),
          reach: 0,
          posts: 0,
        };
        agentMap.set(key, acc);
      }
      const candidate = displayAgentName(row.agent_name);
      acc.displayCandidates.set(
        candidate,
        (acc.displayCandidates.get(candidate) ?? 0) + 1,
      );
      acc.reach += reachOf(row);
      acc.posts += 1;
    }
    const agentLeaderboard: WeeklyAgentLeader[] = Array.from(agentMap.values())
      .sort((a, b) => b.reach - a.reach)
      .slice(0, 3)
      .map((acc) => {
        // Pick the display variant that appeared most often.
        let bestName = "Unknown";
        let bestCount = -1;
        for (const [name, count] of acc.displayCandidates) {
          if (count > bestCount) {
            bestCount = count;
            bestName = name;
          }
        }
        return { display_name: bestName, reach: acc.reach, posts: acc.posts };
      });

    /* ---- Pull property / office display names in two small queries ---- */
    const propertyIds = new Set<string>();
    for (const id of topListingIds) propertyIds.add(id);
    for (const c of sortedCampaigns) {
      if (c.representative?.property_id) {
        propertyIds.add(c.representative.property_id);
      }
    }
    let propertiesById = new Map<string, PropertyRow>();
    if (propertyIds.size > 0) {
      const { data: props } = await supabase
        .from("properties")
        .select("id, address, city")
        .in("id", Array.from(propertyIds));
      if (props) {
        propertiesById = new Map(
          (props as unknown as PropertyRow[]).map((p) => [p.id, p]),
        );
      }
    }

    let officeName: string | null = null;
    if (topOfficeId) {
      const { data: officeRow } = await supabase
        .from("offices")
        .select("id, name, display_name")
        .eq("id", topOfficeId)
        .maybeSingle();
      if (officeRow) {
        const o = officeRow as unknown as OfficeRow;
        officeName = o.display_name?.trim() || o.name;
      }
    }

    /* ---- Materialize the shapes ---- */
    const topCampaigns: WeeklyTopCampaign[] = sortedCampaigns.map((c) => {
      const rep = c.representative as PostRow;
      const prop = rep.property_id
        ? propertiesById.get(rep.property_id)
        : undefined;
      const platforms = PLATFORMS.filter((p) => c.platforms.has(p));
      const linkPath = c.groupId
        ? `/groups/${c.groupId}`
        : `/posts/${rep.id}`;
      return {
        key: c.key,
        linkPath,
        mergedReach: c.mergedReach,
        perPlatform: c.perPlatform,
        caption: rep.caption,
        thumbnail_url: rep.thumbnail_url,
        posted_at: rep.posted_at,
        property_address: prop?.address ?? null,
        property_city: prop?.city ?? null,
        platforms,
      };
    });

    const listings: WeeklyListingMention[] = topListingIds.map((id) => {
      const prop = propertiesById.get(id);
      return {
        property_id: id,
        address: prop?.address ?? null,
        city: prop?.city ?? null,
        post_count: listingCounts.get(id) ?? 0,
      };
    });

    const officeSpotlight: WeeklyOfficeSpotlight | null =
      topOfficeId && officeName
        ? {
            office_id: topOfficeId,
            name: officeName,
            reach: officeReach.get(topOfficeId)?.reach ?? 0,
            posts: officeReach.get(topOfficeId)?.posts ?? 0,
          }
        : null;

    // Portal traffic — ListTrac-powered, scoped to the current week window.
    // Defensive: fetch failures fall back to empty so a syncing issue can't
    // block the email send pipeline.
    let portalTraffic: WeeklyPortalTraffic = emptyPortalTraffic();
    try {
      portalTraffic = await loadWeeklyPortalTraffic(
        supabase,
        win.weekStartIso,
        win.weekEndIso,
      );
    } catch (e) {
      console.warn("weekly portal traffic load failed:", (e as Error).message);
    }

    return {
      ...win,
      totals,
      prevTotals,
      weekYoY: weekYoYTotals,
      byPlatform,
      prevByPlatform,
      ytd,
      ytdYoY,
      ytdByPlatform,
      topCampaigns,
      listings,
      listingsTotal: listingCounts.size,
      officeSpotlight,
      agentLeaderboard,
      portalTraffic,
    };
  } catch {
    return empty;
  }
}

/* --------------------------------------------------------------------- */
/* Portal traffic (ListTrac) loader                                      */
/* --------------------------------------------------------------------- */

/**
 * Pull the week's portal-traffic stats from listing_portal_metrics joined
 * to the dedupe view + properties. Returns the org-wide-by-portal totals
 * AND the top 5 listings by total views.
 *
 * NOTE: The new tables/views aren't yet in the generated Database type,
 * so we cast the client through unknown. Regenerate Supabase types after
 * this lands to drop the casts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadWeeklyPortalTraffic(
  supabase: any,
  weekStartIso: string,
  weekEndIso: string,
): Promise<WeeklyPortalTraffic> {
  const startDate = weekStartIso.slice(0, 10);
  // weekEndIso is the EXCLUSIVE Mon-Sun upper bound (Mon 00:00 the following
  // week). For a date-only column we want metric_date < that Monday.
  const endDateExclusive = weekEndIso.slice(0, 10);

  const { data: rowsRaw, error } = await supabase
    .from("v_listing_portal_metrics_unified")
    .select("mls_number, portal_name, metric_date, views")
    .gte("metric_date", startDate)
    .lt("metric_date", endDateExclusive);
  if (error || !rowsRaw) return emptyPortalTraffic();

  type Row = { mls_number: string; portal_name: string; metric_date: string; views: number | null };
  const rows = rowsRaw as Row[];
  if (rows.length === 0) return emptyPortalTraffic();

  // Membership map: portal_name → slot key
  const memberToSlot = new Map<string, WeeklyPortalKey>();
  for (const def of PORTAL_STRIP_DEFS) {
    for (const m of def.members) memberToSlot.set(m, def.key);
  }

  // Aggregate per slot (org total) and per listing.
  type ListingAgg = {
    mls_number: string;
    total_views: number;
    by_slot: Record<WeeklyPortalKey, number>;
  };
  const slotTotals: Record<WeeklyPortalKey, number> = {
    zillow: 0, realtor: 0, trulia: 0, redfin: 0, cih: 0,
  };
  const perListing = new Map<string, ListingAgg>();
  let grandTotal = 0;

  for (const r of rows) {
    const v = Number(r.views) || 0;
    if (v <= 0) continue;
    const slot = memberToSlot.get(r.portal_name);
    if (!slot) continue;
    slotTotals[slot] += v;
    grandTotal += v;
    let entry = perListing.get(r.mls_number);
    if (!entry) {
      entry = {
        mls_number: r.mls_number,
        total_views: 0,
        by_slot: { zillow: 0, realtor: 0, trulia: 0, redfin: 0, cih: 0 },
      };
      perListing.set(r.mls_number, entry);
    }
    entry.total_views += v;
    entry.by_slot[slot] += v;
  }

  if (grandTotal === 0) return emptyPortalTraffic();

  // Top 5 listings — fetch property metadata for them in one round trip.
  const topListings = Array.from(perListing.values())
    .sort((a, b) => b.total_views - a.total_views)
    .slice(0, 5);

  const topMlsNumbers = topListings.map((l) => l.mls_number);
  type PropRow = {
    mls_number: string;
    address: string | null;
    city: string | null;
    hero_image_url: string | null;
  };
  const { data: propsRaw } = await supabase
    .from("properties")
    .select("mls_number, address, city, hero_image_url")
    .in("mls_number", topMlsNumbers);
  const propsByMls = new Map<string, PropRow>();
  for (const p of (propsRaw ?? []) as PropRow[]) {
    propsByMls.set(p.mls_number, p);
  }

  const enrichedListings: WeeklyPortalListing[] = topListings.map((l) => {
    const meta = propsByMls.get(l.mls_number);
    return {
      mls_number: l.mls_number,
      address: meta?.address ?? null,
      city: meta?.city ?? null,
      hero_image_url: meta?.hero_image_url ?? null,
      total_views: l.total_views,
      by_slot: l.by_slot,
    };
  });

  return {
    has_data: true,
    total_views: grandTotal,
    by_slot: PORTAL_STRIP_DEFS.map((d) => ({
      key: d.key,
      display_name: d.display_name,
      views: slotTotals[d.key],
    })),
    top_listings: enrichedListings,
  };
}
