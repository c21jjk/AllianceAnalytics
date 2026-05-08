import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
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
    value === "educational" ||
    value === "marketing" ||
    value === "community" ||
    value === "sold" ||
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
    category: asCategory(row.category),
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

export async function fetchPosts(): Promise<Post[]> {
  const supabase = createAdminClient();
  const { data: posts, error } = await supabase
    .from("posts")
    .select(
      "id, platform, platform_post_id, property_id, caption, media_url, thumbnail_url, media_type, posted_at, permalink, hashtags, metrics, audience, category, link_method",
    )
    .order("posted_at", { ascending: false })
    .limit(500);
  if (error || !posts) {
    console.error("fetchPosts:", error);
    return [];
  }

  const { data: properties } = await supabase
    .from("properties")
    .select("id, mls_number, address, city, state, list_price, hero_image_url");
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

  return (posts as DbPostRow[]).map((row) =>
    rowToPost(
      row,
      row.property_id ? propMap.get(row.property_id) : undefined,
      dailyByPost.get(row.id) ?? [],
    ),
  );
}

export async function fetchPostById(id: string): Promise<Post | undefined> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("posts")
    .select(
      "id, platform, platform_post_id, property_id, caption, media_url, thumbnail_url, media_type, posted_at, permalink, hashtags, metrics, audience, category, link_method",
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
  const { data: counts } = await supabase
    .from("posts")
    .select("platform")
    .gte("posted_at", cutoff);
  const countMap: Record<Platform, number> = {
    facebook: 0,
    instagram: 0,
    tiktok: 0,
  };
  for (const r of (counts ?? []) as { platform: string }[]) {
    const p = asPlatform(r.platform);
    countMap[p] = (countMap[p] ?? 0) + 1;
  }

  return data
    .filter((row) =>
      row.platform === "facebook" ||
      row.platform === "instagram" ||
      row.platform === "tiktok",
    )
    .map((row) => ({
      platform: asPlatform(row.platform as string),
      status: row.is_active ? ("connected" as const) : ("disconnected" as const),
      last_synced_at: row.last_validated_at ?? new Date(0).toISOString(),
      posts_last_30d: countMap[asPlatform(row.platform as string)] ?? 0,
    }));
}
