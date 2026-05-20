import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Data fetcher for the weekly social media email report.
 *
 * Window = the most-recently-completed Mon→Sun period in America/New_York,
 * so a report fired Monday 8 AM ET covers the week that just ended Sunday.
 *
 * All reach numbers are sourced from `posts.metrics.reach` (falling back to
 * `metrics.impressions` for parity with company-rollup.ts). We never throw —
 * the report should degrade gracefully if a single platform's data is
 * unavailable rather than blocking the entire send.
 */

export type WeeklyPlatform = "facebook" | "instagram" | "tiktok";

export interface WeeklyPlatformStats {
  posts: number;
  reach: number;
}

export interface WeeklyTopPost {
  id: string;
  platform: WeeklyPlatform;
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  reach: number;
  posted_at: string | null;
  property_address: string | null;
  property_city: string | null;
}

export interface WeeklyListingMention {
  property_id: string;
  address: string | null;
  city: string | null;
  post_count: number;
}

export interface WeeklySocialReportData {
  /** Inclusive start of window, ISO instant. */
  weekStartIso: string;
  /** Exclusive end of window (= next Monday 00:00 ET), ISO instant. */
  weekEndIso: string;
  /** Human-readable date labels (e.g. "May 12" / "May 18"). */
  weekStartLabel: string;
  weekEndLabel: string;
  /** Same fields for the prior week, used to compute WoW deltas. */
  prevWeekStartIso: string;
  prevWeekEndIso: string;

  totals: WeeklyPlatformStats;
  prevTotals: WeeklyPlatformStats;
  byPlatform: Record<WeeklyPlatform, WeeklyPlatformStats>;
  prevByPlatform: Record<WeeklyPlatform, WeeklyPlatformStats>;

  topPosts: WeeklyTopPost[];
  listings: WeeklyListingMention[];
  /** Total distinct listings represented in the week's posts. */
  listingsTotal: number;
}

const PLATFORMS: WeeklyPlatform[] = ["facebook", "instagram", "tiktok"];
const emptyStats = (): WeeklyPlatformStats => ({ posts: 0, reach: 0 });

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Compute the report window in America/New_York.
 * Returns the most recently completed Mon 00:00 → next Mon 00:00 window,
 * along with the prior week for WoW comparison.
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

  // Days back to the start of "last complete week" (the Monday that began it).
  // Today=Mon → 7. Today=Tue → 8. Today=Sun → 13.
  const daysToLastMon = wd === 0 ? 13 : 6 + wd;

  // Compose calendar dates by walking back from today in UTC-date arithmetic
  // (we'll re-anchor to ET when forming UTC instants below).
  const probe = new Date(Date.UTC(year, month - 1, day));
  const lastMon = new Date(probe);
  lastMon.setUTCDate(probe.getUTCDate() - daysToLastMon);
  const dayAfterLastSun = new Date(lastMon);
  dayAfterLastSun.setUTCDate(lastMon.getUTCDate() + 7);
  const prevWeekMon = new Date(lastMon);
  prevWeekMon.setUTCDate(lastMon.getUTCDate() - 7);
  const lastSun = new Date(lastMon);
  lastSun.setUTCDate(lastMon.getUTCDate() + 6);

  const weekStartIso = nyMidnightIso(lastMon);
  const weekEndIso = nyMidnightIso(dayAfterLastSun);
  const prevWeekStartIso = nyMidnightIso(prevWeekMon);
  const prevWeekEndIso = weekStartIso;

  return {
    weekStartIso,
    weekEndIso,
    prevWeekStartIso,
    prevWeekEndIso,
    weekStartLabel: formatMonthDay(lastMon),
    weekEndLabel: formatMonthDay(lastSun),
  };
}

/**
 * Treat the y/m/d of `d` (in UTC) as a calendar date in America/New_York,
 * and return the ISO instant for midnight ET on that date.
 * Uses Intl to get the correct UTC offset (handles EDT vs EST automatically).
 */
function nyMidnightIso(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  // Probe noon UTC of that date to read the NY tz offset.
  const probe = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const tzName =
    offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-04:00";
  // longOffset returns "GMT-04:00" or "GMT-05:00"; strip "GMT".
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

interface PostRow {
  id: string;
  platform: WeeklyPlatform;
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  metrics: Record<string, unknown> | null;
  property_id: string | null;
}

interface PropertyRow {
  id: string;
  address: string | null;
  city: string | null;
}

/** Bucket a flat list of posts by platform. */
function bucketStats(
  rows: Pick<PostRow, "platform" | "metrics">[],
): Record<WeeklyPlatform, WeeklyPlatformStats> {
  const out: Record<WeeklyPlatform, WeeklyPlatformStats> = {
    facebook: emptyStats(),
    instagram: emptyStats(),
    tiktok: emptyStats(),
  };
  for (const row of rows) {
    const platform = row.platform;
    if (!PLATFORMS.includes(platform)) continue;
    const reach =
      readNum(row.metrics?.reach) || readNum(row.metrics?.impressions);
    out[platform].posts += 1;
    out[platform].reach += reach;
  }
  return out;
}

function sumStats(map: Record<WeeklyPlatform, WeeklyPlatformStats>) {
  const out: WeeklyPlatformStats = emptyStats();
  for (const p of PLATFORMS) {
    out.posts += map[p].posts;
    out.reach += map[p].reach;
  }
  return out;
}

/**
 * Pull the data for the weekly report. Safe: returns a zero-shaped object
 * if anything goes wrong.
 */
export async function loadWeeklySocialReportData(
  now: Date = new Date(),
): Promise<WeeklySocialReportData> {
  const win = getReportWindow(now);

  const empty: WeeklySocialReportData = {
    ...win,
    totals: emptyStats(),
    prevTotals: emptyStats(),
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
    topPosts: [],
    listings: [],
    listingsTotal: 0,
  };

  try {
    const supabase = createAdminClient();

    // Pull both weeks in one round-trip — small data set, simple in JS.
    const { data, error } = await supabase
      .from("posts")
      .select(
        "id, platform, caption, permalink, thumbnail_url, posted_at, metrics, property_id",
      )
      .gte("posted_at", win.prevWeekStartIso)
      .lt("posted_at", win.weekEndIso);
    if (error || !data) return empty;

    // Bucket into current and previous windows.
    const rows = data as unknown as PostRow[];
    const current: PostRow[] = [];
    const previous: PostRow[] = [];
    const weekStart = new Date(win.weekStartIso).getTime();
    const weekEnd = new Date(win.weekEndIso).getTime();
    const prevStart = new Date(win.prevWeekStartIso).getTime();
    for (const row of rows) {
      if (!row.posted_at) continue;
      const t = new Date(row.posted_at).getTime();
      if (Number.isNaN(t)) continue;
      if (t >= weekStart && t < weekEnd) current.push(row);
      else if (t >= prevStart && t < weekStart) previous.push(row);
    }

    const byPlatform = bucketStats(current);
    const prevByPlatform = bucketStats(previous);
    const totals = sumStats(byPlatform);
    const prevTotals = sumStats(prevByPlatform);

    // Top 3 posts of the current week by reach.
    const enriched = current
      .map((r) => {
        const reach =
          readNum(r.metrics?.reach) || readNum(r.metrics?.impressions);
        return { row: r, reach };
      })
      .filter((x) => PLATFORMS.includes(x.row.platform))
      .sort((a, b) => b.reach - a.reach)
      .slice(0, 3);

    // Pull addresses for the top posts + listings count.
    const listingCounts = new Map<string, number>();
    for (const r of current) {
      if (r.property_id) {
        listingCounts.set(
          r.property_id,
          (listingCounts.get(r.property_id) ?? 0) + 1,
        );
      }
    }
    const propertyIds = new Set<string>();
    for (const x of enriched) {
      if (x.row.property_id) propertyIds.add(x.row.property_id);
    }
    // Top 3 listings by post count for the "Listings represented" section.
    const topListingIds = Array.from(listingCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);
    for (const id of topListingIds) propertyIds.add(id);

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

    const topPosts: WeeklyTopPost[] = enriched.map(({ row, reach }) => {
      const prop = row.property_id
        ? propertiesById.get(row.property_id)
        : undefined;
      return {
        id: row.id,
        platform: row.platform,
        caption: row.caption,
        permalink: row.permalink,
        thumbnail_url: row.thumbnail_url,
        reach,
        posted_at: row.posted_at,
        property_address: prop?.address ?? null,
        property_city: prop?.city ?? null,
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

    return {
      ...win,
      totals,
      prevTotals,
      byPlatform,
      prevByPlatform,
      topPosts,
      listings,
      listingsTotal: listingCounts.size,
    };
  } catch {
    return empty;
  }
}
