import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAudienceScopeFilter } from "./audience-scope-filter";
import type {
  AccountHealth,
  Platform,
  Post,
  PostAudience,
  PostCategory,
  PostLinkMethod,
  PostMetrics,
  PropertyRef,
} from "@/lib/types/post";

/**
 * Live-data accessors for posts/properties/metrics.
 *
 * Reads from the prod Supabase project via the service-role admin client.
 * Returns shapes matching lib/types/post.ts so pages can swap fixtures
 * for live data without changing component code.
 *
 * Toggle on by setting `ALLIANCE_DATA_SOURCE=db` (env var); the switch
 * lives in lib/data/source.ts and is consulted by lib/data/index.ts.
 */

interface DbPostRow {
  id: string;
  platform: string;
  platform_post_id: string | null;
  property_id: string | null;
  caption: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  media_type: string | null;
  posted_at: string | null;
  permalink: string | null;
  hashtags: string[] | null;
  metrics: Record<string, unknown> | null;
  audience: Record<string, unknown> | null;
  category: string | null;
  link_method: string | null;
  agent_name: string | null;
  group_id: string | null;
  mls_number_parsed: string | null;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  hero_image_url: string | null;
}

interface DbMetricsDailyRow {
  post_id: string;
  captured_date: string;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

function rowToPropertyRef(row: DbPropertyRow): PropertyRef {
  const addressParts = [row.address, row.city, row.state].filter(Boolean);
  return {
    mls: row.mls_number,
    address: addressParts.join(", "),
    list_price:
      row.list_price === null || row.list_price === undefined
        ? undefined
        : Number(row.list_price),
    hero_image_url: row.hero_image_url ?? undefined,
  };
}

function readNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function flattenMetricsJsonb(json: Record<string, unknown> | null): PostMetrics {
  const m = json ?? {};
  const reach = readNum(m.reach) ?? readNum(m.impressions) ?? readNum(m.views) ?? 0;
  const impressions = readNum(m.impressions) ?? readNum(m.views) ?? reach;
  const likes = readNum(m.likes) ?? 0;
  const comments = readNum(m.comments) ?? 0;
  const shares = readNum(m.shares) ?? 0;
  const saves = readNum(m.saves) ?? 0;
  const total = likes + comments + shares + saves;
  const engagementRate =
    readNum(m.engagement_rate) ?? (reach > 0 ? total / reach : 0);
  return {
    impressions,
    reach,
    likes,
    comments,
    shares,
    saves,
    engagement_rate: engagementRate,
    plays: readNum(m.plays),
    avg_watch_time_sec: readNum(m.avg_watch_time_sec),
    completion_rate: readNum(m.completion_rate),
    profile_visits: readNum(m.profile_visits),
    follows: readNum(m.follows),
    link_clicks: readNum(m.link_clicks),
  };
}

function asPlatform(value: string): Platform {
  if (value === "facebook" || value === "instagram" || value === "tiktok") {
    return value;
  }
  return "instagram"; // safe fallback
}

function asMediaType(value: string | null): Post["media_type"] {
  if (value === "carousel") return "carousel";
  if (value === "video" || value === "reel") return "video";
  return "image";
}

function asAudience(json: Record<string, unknown> | null): PostAudience | undefined {
  if (!json) return undefined;
  const hasAny =
    Array.isArray(json.top_locations) ||
    Array.isArray(json.age_buckets) ||
    Array.isArray(json.gender_split);
  if (!hasAny) return undefined;
  return json as unknown as PostAudience;
}

function asCategory(value: string | null): PostCategory | undefined {
  if (
    value === "property" ||
    value === "agent" ||
    value === "educational" ||
    value === "marketing" ||
    value === "community" ||
    value === "sold" ||
    value === "open_house" ||
    value === "other"
  ) {
    return value;
  }
  return undefined;
}

function asLinkMethod(value: string | null): PostLinkMethod | undefined {
  if (
    value === "manual" ||
    value === "auto_mls" ||
    value === "auto_address_full" ||
    value === "auto_address_partial"
  ) {
    return value;
  }
  return undefined;
}

function rowToPost(
  row: DbPostRow,
  property: PropertyRef | undefined,
  daily: DbMetricsDailyRow[],
): Post {
  return {
    id: row.id,
    platform: asPlatform(row.platform),
    permalink: row.permalink ?? "",
    posted_at: row.posted_at ?? new Date().toISOString(),
    media_type: asMediaType(row.media_type),
    thumbnail_url: row.thumbnail_url ?? row.media_url ?? "",
    media_url: row.media_url ?? undefined,
    caption: row.caption ?? "",
    hashtags: row.hashtags ?? [],
    property,
    mls_number_parsed: row.mls_number_parsed ?? undefined,
    category: asCategory(row.category),
    agent_name: row.agent_name ?? undefined,
    link_method: asLinkMethod(row.link_method),
    metrics: flattenMetricsJsonb(row.metrics),
    daily: daily
      .slice()
      .sort((a, b) => a.captured_date.localeCompare(b.captured_date))
      .map((d) => ({
        date: d.captured_date,
        reach: d.reach ?? d.impressions ?? 0,
        engagements:
          (d.likes ?? 0) + (d.comments ?? 0) + (d.shares ?? 0) + (d.saves ?? 0),
      })),
    audience: asAudience(row.audience),
  };
}

export interface FetchPostsOptions {
  /** Restrict to posts whose office_id matches this office.short_code. */
  office_short_code?: string | null;
  /** Inclusive lower bound on posted_at (ISO timestamp). */
  since?: string | null;
  /** Max rows to return. Defaults to 500. */
  limit?: number;
  /** "recent" (default) = posted_at DESC. "activity" = reach DESC. */
  sort?: "recent" | "activity";
}

export async function fetchPosts(opts: FetchPostsOptions = {}): Promise<Post[]> {
  const supabase = createAdminClient();

  // Audience-aware office filter — expand office short_code into a set of
  // matching post_groups.audience_scope values (see helper).
  const audienceFilter = await buildAudienceScopeFilter(
    supabase,
    opts.office_short_code ?? null,
  );
  if (audienceFilter.unknownOffice) return [];

  // When an office filter is active, restrict posts to those whose group
  // has a matching audience_scope. Two-step query: get the matching group
  // ids first, then filter posts by group_id IN them. Singletons (group_id
  // IS NULL) are inherently excluded — they have no audience scope.
  let allowedGroupIds: string[] | null = null;
  if (audienceFilter.allowedScopes) {
    const { data: groupRows } = await supabase
      .from("post_groups")
      .select("id")
      .in("audience_scope", audienceFilter.allowedScopes);
    allowedGroupIds = (groupRows ?? []).map((g) => g.id);
    // If no groups match the filter, return empty rather than fetching
    // every post unfiltered.
    if (allowedGroupIds.length === 0) return [];
  }

  let query = supabase
    .from("posts")
    .select(
      "id, platform, platform_post_id, property_id, caption, media_url, thumbnail_url, media_type, posted_at, permalink, hashtags, metrics, audience, category, link_method, agent_name, group_id, mls_number_parsed, office_id",
    )
    .order("posted_at", { ascending: false })
    .limit(opts.limit ?? 500);

  if (opts.since) query = query.gte("posted_at", opts.since);
  if (allowedGroupIds) query = query.in("group_id", allowedGroupIds);

  // Note: SQL ORDER stays on posted_at (the DB ORDER BY can't trivially
  // extract reach from the metrics JSONB across PostgREST). When the caller
  // wants "activity" sort, we re-sort in memory after the read — fine since
  // we already pull up to opts.limit rows.

  const { data: posts, error } = await query;
  if (error || !posts) {
    console.error("fetchPosts:", error);
    return [];
  }

  // why: scope the lookup to the property ids actually referenced by this
  // page of posts. The old unfiltered read pulled the ENTIRE properties
  // table (grows with RETS history) on every dashboard/posts render just to
  // build this map (audit 2026-06-10).
  const propertyIds = [
    ...new Set(posts.map((p) => p.property_id).filter((id): id is string => !!id)),
  ];
  const { data: properties, error: propertiesError } = propertyIds.length > 0
    ? await supabase
        .from("properties")
        .select("id, mls_number, address, city, state, list_price, hero_image_url")
        .in("id", propertyIds)
    : { data: [], error: null };
  if (propertiesError) {
    console.error("fetchPosts properties lookup:", propertiesError);
  }
  const propMap = new Map<string, PropertyRef>();
  for (const p of (properties ?? []) as DbPropertyRow[]) {
    propMap.set(p.id, rowToPropertyRef(p));
  }

  const cutoff = new Date(Date.now() - 60 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const postIds = posts.map((p) => p.id);
  const { data: daily } = postIds.length > 0
    ? await supabase
        .from("post_metrics_daily")
        .select(
          "post_id, captured_date, reach, impressions, likes, comments, shares, saves",
        )
        .in("post_id", postIds)
        .gte("captured_date", cutoff)
    : { data: [] };
  const dailyByPost = new Map<string, DbMetricsDailyRow[]>();
  for (const d of (daily ?? []) as DbMetricsDailyRow[]) {
    const arr = dailyByPost.get(d.post_id) ?? [];
    arr.push(d);
    dailyByPost.set(d.post_id, arr);
  }

  const mapped = (posts as DbPostRow[]).map((row) =>
    rowToPost(
      row,
      row.property_id ? propMap.get(row.property_id) : undefined,
      dailyByPost.get(row.id) ?? [],
    ),
  );

  // "activity" sort — by reach DESC with posted_at DESC as tie-break. The
  // initial SQL order was posted_at DESC so the tie-break is free.
  if (opts.sort === "activity") {
    mapped.sort((a, b) => {
      const byReach = (b.metrics?.reach ?? 0) - (a.metrics?.reach ?? 0);
      if (byReach !== 0) return byReach;
      return (
        new Date(b.posted_at ?? 0).getTime() -
        new Date(a.posted_at ?? 0).getTime()
      );
    });
  }

  return mapped;
}

export async function fetchPostById(id: string): Promise<Post | undefined> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("posts")
    .select(
      "id, platform, platform_post_id, property_id, caption, media_url, thumbnail_url, media_type, posted_at, permalink, hashtags, metrics, audience, category, link_method, agent_name, group_id, mls_number_parsed",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return undefined;

  // Property lookup
  let property: PropertyRef | undefined;
  if (row.property_id) {
    const { data: p } = await supabase
      .from("properties")
      .select("id, mls_number, address, city, state, list_price, hero_image_url")
      .eq("id", row.property_id)
      .maybeSingle();
    if (p) property = rowToPropertyRef(p as DbPropertyRow);
  }

  // Daily metrics (last 60 days for the sparkline + 30-day chart)
  const cutoff = new Date(Date.now() - 60 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const { data: daily } = await supabase
    .from("post_metrics_daily")
    .select(
      "post_id, captured_date, reach, impressions, likes, comments, shares, saves",
    )
    .eq("post_id", row.id)
    .gte("captured_date", cutoff);

  return rowToPost(
    row as DbPostRow,
    property,
    (daily ?? []) as DbMetricsDailyRow[],
  );
}

export async function fetchAccountHealth(): Promise<AccountHealth[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("api_credentials")
    .select("platform, is_active, last_validated_at")
    .in("platform", ["facebook", "instagram", "tiktok"]);
  if (error || !data) return [];

  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  // Pull BOTH the recent post count AND the most-recent last_synced_at per
  // platform. last_synced_at is set on every upsertPost, so it captures
  // "the sync touched something" even when the function later times out —
  // a more honest signal than api_credentials.last_validated_at (which only
  // updates on a fully-clean run).
  const { data: posts } = await supabase
    .from("posts")
    .select("platform, posted_at, last_synced_at")
    .gte("last_synced_at", cutoff);
  const countMap: Record<Platform, number> = {
    facebook: 0,
    instagram: 0,
    tiktok: 0,
  };
  const lastTouchMap: Record<Platform, string> = {
    facebook: new Date(0).toISOString(),
    instagram: new Date(0).toISOString(),
    tiktok: new Date(0).toISOString(),
  };
  for (const r of (posts ?? []) as {
    platform: string;
    posted_at: string | null;
    last_synced_at: string | null;
  }[]) {
    const p = asPlatform(r.platform);
    // Count posts whose posted_at is within the 30-day window.
    if (r.posted_at && r.posted_at >= cutoff) {
      countMap[p] = (countMap[p] ?? 0) + 1;
    }
    // Track the most recent last_synced_at — that's our "real" sync timestamp.
    if (r.last_synced_at && r.last_synced_at > lastTouchMap[p]) {
      lastTouchMap[p] = r.last_synced_at;
    }
  }

  return data
    .filter((row) =>
      row.platform === "facebook" ||
      row.platform === "instagram" ||
      row.platform === "tiktok",
    )
    .map((row) => {
      const platform = asPlatform(row.platform as string);
      // Prefer the live posts-table signal; fall back to api_credentials.
      const fallback = row.last_validated_at ?? new Date(0).toISOString();
      const liveSync = lastTouchMap[platform];
      const last_synced_at =
        liveSync > fallback ? liveSync : fallback;
      return {
        platform,
        status: row.is_active ? ("connected" as const) : ("disconnected" as const),
        last_synced_at,
        posts_last_30d: countMap[platform] ?? 0,
        next_scheduled_at: nextCronRunAt(platform).toISOString(),
      };
    });
}

/**
 * MLS feed health for the dashboard sync bar (CMC, SJSR, Bright). Reads
 * `mls_feeds.last_sync_at` as the timestamp source — that's set inside
 * the mls-rets-sync function on success. Active listings count comes from
 * the AllianceAnalytics.properties table joined to the source MLS.
 */
export async function fetchMlsFeedHealth(): Promise<
  import("@/lib/types/post").MlsFeedHealth[]
> {
  const supabase = createAdminClient();
  const { data: feeds, error } = await supabase
    .from("mls_feeds")
    .select("short_code, name, is_active, last_sync_at, last_validated_ok")
    .in("short_code", ["cmc", "sjsr", "bright"])
    .order("short_code");
  if (error || !feeds) return [];

  // Count active listings per feed (source_mls column).
  const { data: propRows } = await supabase
    .from("properties")
    .select("source_mls")
    .eq("status", "active");
  const countBySource: Record<string, number> = {};
  for (const r of (propRows ?? []) as { source_mls: string | null }[]) {
    if (!r.source_mls) continue;
    const key = r.source_mls.toLowerCase();
    countBySource[key] = (countBySource[key] ?? 0) + 1;
  }

  return feeds.map((f) => {
    const code = f.short_code as string;
    const label =
      code === "cmc"
        ? "CMC"
        : code === "sjsr"
          ? "SJSR"
          : code === "bright"
            ? "Bright"
            : code.toUpperCase();
    let status: "connected" | "needs_attention" | "disconnected";
    if (!f.is_active) {
      status = "disconnected";
    } else if (f.last_validated_ok === false) {
      status = "needs_attention";
    } else {
      status = "connected";
    }
    return {
      short_code: code,
      short_label: label,
      status,
      last_synced_at: (f.last_sync_at as string | null) ?? null,
      active_listings: countBySource[code] ?? 0,
    };
  });
}

/**
 * Returns the next UTC instant a given platform's pg_cron job will fire.
 * Schedule (set 2026-05-09 in migration `schedule_social_sync_every_4h`):
 *   ig-sync :05 every 4h, fb-sync :15 every 4h, tt-sync :25 every 4h.
 */
function nextCronRunAt(platform: Platform, now: Date = new Date()): Date {
  const minute = platform === "instagram" ? 5 : platform === "facebook" ? 15 : 25;
  // Try each 4-hour boundary today (00,04,08,12,16,20) plus tomorrow's 00.
  const candidates: Date[] = [];
  for (let h = 0; h <= 24; h += 4) {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      h,
      minute,
      0,
      0,
    ));
    candidates.push(d);
  }
  const next = candidates.find((d) => d.getTime() > now.getTime());
  return next ?? candidates[candidates.length - 1];
}

// ---------------------------------------------------------------------------
// Company analytics — top-of-dashboard KPI strip.
// ---------------------------------------------------------------------------

/**
 * Per-platform breakdown of the company-wide aggregate KPIs. Drives the
 * tiny mini-row under each tile on the dashboard so Larissa can see where
 * the reach/engagement is concentrated without leaving the strip.
 */
export interface CompanyAnalyticsByPlatform {
  facebook: {
    reach: number;
    engagement: number;
    engagement_rate: number;
    posts_published: number;
  };
  instagram: {
    reach: number;
    engagement: number;
    engagement_rate: number;
    posts_published: number;
  };
  tiktok: {
    reach: number;
    engagement: number;
    engagement_rate: number;
    posts_published: number;
  };
}

export interface CompanyAnalytics {
  /** Sums for the current window. */
  reach: number;
  engagement: number;
  engagement_rate: number; // 0..1 decimal
  posts_published: number;
  /** Same metrics for the previous window of equal length (for delta). */
  prev_reach: number;
  prev_engagement: number;
  prev_engagement_rate: number;
  prev_posts_published: number;
  /** Day-by-day series across the current window for sparklines. */
  daily: Array<{ date: string; reach: number; engagement: number }>;
  /** Per-platform breakdown of the same metrics for the current window. */
  by_platform: CompanyAnalyticsByPlatform;
}

const EMPTY_PLATFORM_STATS = {
  reach: 0,
  engagement: 0,
  engagement_rate: 0,
  posts_published: 0,
};

const EMPTY_ANALYTICS: CompanyAnalytics = {
  reach: 0,
  engagement: 0,
  engagement_rate: 0,
  posts_published: 0,
  prev_reach: 0,
  prev_engagement: 0,
  prev_engagement_rate: 0,
  prev_posts_published: 0,
  daily: [],
  by_platform: {
    facebook: { ...EMPTY_PLATFORM_STATS },
    instagram: { ...EMPTY_PLATFORM_STATS },
    tiktok: { ...EMPTY_PLATFORM_STATS },
  },
};

// ---------------------------------------------------------------------------
// Followers — daily snapshots from platform_followers, drives the Followers tile.
// ---------------------------------------------------------------------------

export interface FollowerCellSnapshot {
  current: number | null;
  prior: number | null;
  delta: number | null;
}

export interface FollowerSummary {
  facebook: FollowerCellSnapshot;
  instagram: FollowerCellSnapshot;
  tiktok: FollowerCellSnapshot;
  total: FollowerCellSnapshot;
  /** True when at least one platform has a non-null current count. */
  has_data: boolean;
}

const EMPTY_FOLLOWER_CELL: FollowerCellSnapshot = {
  current: null,
  prior: null,
  delta: null,
};

const EMPTY_FOLLOWER_SUMMARY: FollowerSummary = {
  facebook: EMPTY_FOLLOWER_CELL,
  instagram: EMPTY_FOLLOWER_CELL,
  tiktok: EMPTY_FOLLOWER_CELL,
  total: EMPTY_FOLLOWER_CELL,
  has_data: false,
};

/**
 * Pull the latest follower count per platform from platform_followers, plus
 * the snapshot from `days` days ago for the WoW delta. Each platform is
 * resolved independently so a missing snapshot for one platform doesn't
 * blank out the others.
 */
export async function fetchFollowerSummary(
  days: number,
): Promise<FollowerSummary> {
  try {
    const supabase = createAdminClient();
    const platforms: Platform[] = ["facebook", "instagram", "tiktok"];

    const cutoffDate = new Date(Date.now() - days * 86400_000)
      .toISOString()
      .slice(0, 10);

    // Latest snapshot per platform (most recent captured_date, ≤ today).
    const latestQ = await supabase
      .from("platform_followers")
      .select("platform, captured_date, follower_count")
      .order("captured_date", { ascending: false })
      .limit(50);

    const latestByPlatform = new Map<Platform, number>();
    for (const r of (latestQ.data ?? []) as Array<{
      platform: Platform;
      captured_date: string;
      follower_count: number;
    }>) {
      if (!latestByPlatform.has(r.platform)) {
        latestByPlatform.set(r.platform, Number(r.follower_count) || 0);
      }
    }

    // Prior-period snapshot per platform: latest snapshot whose
    // captured_date <= cutoffDate.
    const priorQ = await supabase
      .from("platform_followers")
      .select("platform, captured_date, follower_count")
      .lte("captured_date", cutoffDate)
      .order("captured_date", { ascending: false })
      .limit(50);
    const priorByPlatform = new Map<Platform, number>();
    for (const r of (priorQ.data ?? []) as Array<{
      platform: Platform;
      captured_date: string;
      follower_count: number;
    }>) {
      if (!priorByPlatform.has(r.platform)) {
        priorByPlatform.set(r.platform, Number(r.follower_count) || 0);
      }
    }

    function cellFor(p: Platform): FollowerCellSnapshot {
      const current = latestByPlatform.has(p)
        ? latestByPlatform.get(p)!
        : null;
      const prior = priorByPlatform.has(p) ? priorByPlatform.get(p)! : null;
      const delta =
        current !== null && prior !== null ? current - prior : null;
      return { current, prior, delta };
    }

    const fb = cellFor("facebook");
    const ig = cellFor("instagram");
    const tt = cellFor("tiktok");

    // Total only sums platforms that have a current value. Missing data on
    // one platform doesn't zero the total — it just contributes nothing.
    const currentParts = [fb.current, ig.current, tt.current].filter(
      (v): v is number => v !== null,
    );
    const priorParts = [fb.prior, ig.prior, tt.prior].filter(
      (v): v is number => v !== null,
    );
    const totalCurrent =
      currentParts.length > 0
        ? currentParts.reduce((s, n) => s + n, 0)
        : null;
    const totalPrior =
      priorParts.length > 0
        ? priorParts.reduce((s, n) => s + n, 0)
        : null;
    const totalDelta =
      totalCurrent !== null && totalPrior !== null
        ? totalCurrent - totalPrior
        : null;

    return {
      facebook: fb,
      instagram: ig,
      tiktok: tt,
      total: {
        current: totalCurrent,
        prior: totalPrior,
        delta: totalDelta,
      },
      has_data: currentParts.length > 0,
    };
  } catch (e) {
    console.error("fetchFollowerSummary error:", e);
    return EMPTY_FOLLOWER_SUMMARY;
  }
}

/**
 * Aggregate posts metrics over a window for the top-of-dashboard KPI strip.
 * Pulls posts in the prior 2*days range, splits into current + prior periods,
 * and computes totals + deltas. Also computes the top campaign by reach.
 */
export async function fetchCompanyAnalytics(opts: {
  days: number;
  office_short_code?: string | null;
}): Promise<CompanyAnalytics> {
  try {
    const supabase = createAdminClient();
    const now = new Date();
    const cutoffNow = new Date(now.getTime() - opts.days * 86400_000);
    const cutoffPrev = new Date(now.getTime() - 2 * opts.days * 86400_000);

    // Audience-aware office filter (same semantic as the post list).
    const audienceFilter = await buildAudienceScopeFilter(
      supabase,
      opts.office_short_code ?? null,
    );
    if (audienceFilter.unknownOffice) return EMPTY_ANALYTICS;

    let allowedGroupIds: string[] | null = null;
    if (audienceFilter.allowedScopes) {
      const { data: groupRows } = await supabase
        .from("post_groups")
        .select("id")
        .in("audience_scope", audienceFilter.allowedScopes);
      allowedGroupIds = (groupRows ?? []).map((g) => g.id);
      if (allowedGroupIds.length === 0) return EMPTY_ANALYTICS;
    }

    let query = supabase
      .from("posts")
      .select("id, posted_at, group_id, caption, platform, metrics, office_id")
      .gte("posted_at", cutoffPrev.toISOString());
    if (allowedGroupIds) {
      query = query.in("group_id", allowedGroupIds);
    }
    const { data, error } = await query;
    if (error || !data) return EMPTY_ANALYTICS;

    const cutoffNowMs = cutoffNow.getTime();
    type Row = (typeof data)[number];
    const currentPosts: Row[] = [];
    const priorPosts: Row[] = [];
    for (const p of data) {
      if (!p.posted_at) continue;
      const t = new Date(p.posted_at).getTime();
      if (t >= cutoffNowMs) currentPosts.push(p);
      else priorPosts.push(p);
    }

    function readMetrics(m: unknown): { reach: number; eng: number } {
      const obj = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      const reach = Number(obj.reach ?? 0) || 0;
      const eng =
        (Number(obj.likes ?? 0) || 0) +
        (Number(obj.comments ?? 0) || 0) +
        (Number(obj.shares ?? 0) || 0) +
        (Number(obj.saves ?? 0) || 0);
      return { reach, eng };
    }

    function aggregate(rows: Row[]): { reach: number; eng: number; count: number } {
      let reach = 0;
      let eng = 0;
      for (const p of rows) {
        const m = readMetrics(p.metrics);
        reach += m.reach;
        eng += m.eng;
      }
      return { reach, eng, count: rows.length };
    }

    const cur = aggregate(currentPosts);
    const prv = aggregate(priorPosts);

    // Daily series for sparklines.
    const daily: Array<{ date: string; reach: number; engagement: number }> = [];
    const dayKeys: string[] = [];
    const dayMap = new Map<string, { reach: number; engagement: number }>();
    for (let i = 0; i < opts.days; i++) {
      const d = new Date(cutoffNow.getTime() + i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      dayKeys.push(key);
      dayMap.set(key, { reach: 0, engagement: 0 });
    }
    for (const p of currentPosts) {
      const day = new Date(p.posted_at!).toISOString().slice(0, 10);
      const entry = dayMap.get(day);
      if (entry) {
        const m = readMetrics(p.metrics);
        entry.reach += m.reach;
        entry.engagement += m.eng;
      }
    }
    for (const k of dayKeys) {
      const v = dayMap.get(k)!;
      daily.push({ date: k, reach: v.reach, engagement: v.engagement });
    }

    // Per-platform breakdown — drives the inline mini-row under each
    // tile on the dashboard KPI strip. Replaces the Top Campaign tile
    // (which lived here in earlier versions).
    const platformAcc: Record<Platform, { reach: number; eng: number; count: number }> = {
      facebook: { reach: 0, eng: 0, count: 0 },
      instagram: { reach: 0, eng: 0, count: 0 },
      tiktok: { reach: 0, eng: 0, count: 0 },
    };
    for (const p of currentPosts) {
      const plat = p.platform as Platform;
      if (plat !== "facebook" && plat !== "instagram" && plat !== "tiktok") continue;
      const m = readMetrics(p.metrics);
      platformAcc[plat].reach += m.reach;
      platformAcc[plat].eng += m.eng;
      platformAcc[plat].count += 1;
    }
    const by_platform: CompanyAnalyticsByPlatform = {
      facebook: {
        reach: platformAcc.facebook.reach,
        engagement: platformAcc.facebook.eng,
        engagement_rate:
          platformAcc.facebook.reach > 0
            ? platformAcc.facebook.eng / platformAcc.facebook.reach
            : 0,
        posts_published: platformAcc.facebook.count,
      },
      instagram: {
        reach: platformAcc.instagram.reach,
        engagement: platformAcc.instagram.eng,
        engagement_rate:
          platformAcc.instagram.reach > 0
            ? platformAcc.instagram.eng / platformAcc.instagram.reach
            : 0,
        posts_published: platformAcc.instagram.count,
      },
      tiktok: {
        reach: platformAcc.tiktok.reach,
        engagement: platformAcc.tiktok.eng,
        engagement_rate:
          platformAcc.tiktok.reach > 0
            ? platformAcc.tiktok.eng / platformAcc.tiktok.reach
            : 0,
        posts_published: platformAcc.tiktok.count,
      },
    };

    return {
      reach: cur.reach,
      engagement: cur.eng,
      engagement_rate: cur.reach > 0 ? cur.eng / cur.reach : 0,
      posts_published: cur.count,
      prev_reach: prv.reach,
      prev_engagement: prv.eng,
      prev_engagement_rate: prv.reach > 0 ? prv.eng / prv.reach : 0,
      prev_posts_published: prv.count,
      daily,
      by_platform,
    };
  } catch (e) {
    console.error("fetchCompanyAnalytics error:", e);
    return EMPTY_ANALYTICS;
  }
}
