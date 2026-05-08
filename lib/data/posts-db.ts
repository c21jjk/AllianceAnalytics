import "server-only";
import type { AccountHealth, Post } from "@/lib/types/post";

/**
 * Live-data accessors for the posts/properties/metrics tables.
 *
 * STATUS: stub. Returns empty arrays so the data-source switcher (lib/data/index.ts)
 * falls back to the fixture data when ALLIANCE_DATA_SOURCE=db is flipped without
 * any rows having been ingested yet.
 *
 * Real implementation comes online AFTER the Phase 2 migrations apply on the
 * Alliance Social Supabase project. At that point we:
 *   1. Run `npx supabase gen types typescript ...` (or use the MCP
 *      generate_typescript_types tool) to regenerate lib/supabase/types.ts
 *      with the new tables (post_metrics_daily, report_deliveries) and the
 *      new columns on posts (hashtags, audience, thumbnail_url).
 *   2. Replace this file's stub with the real query implementation that
 *      joins posts → properties and rolls up the last 60 days of
 *      post_metrics_daily for the sparkline data.
 *
 * The full reference implementation is preserved as comments at the bottom
 * of this file; uncomment after types regenerate.
 */

export async function fetchPosts(): Promise<Post[]> {
  // TODO(phase2): replace with real Supabase query once types are regenerated.
  // See trailing comment block for the reference implementation.
  return [];
}

export async function fetchAccountHealth(): Promise<AccountHealth[]> {
  // TODO(phase2): replace with real Supabase query once types are regenerated.
  return [];
}

/* === Reference implementation (uncomment after migrations + type regen) ===

import { createAdminClient } from "@/lib/supabase/admin";
import type { Platform, PostMetrics, PropertyRef } from "@/lib/types/post";

interface DbPostRow {
  id: string;
  platform: Platform;
  platform_post_id: string | null;
  property_id: string | null;
  caption: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  media_type: string | null;
  posted_at: string | null;
  permalink: string | null;
  hashtags: string[] | null;
  metrics: Record<string, number> | null;
  audience: Record<string, unknown> | null;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: string | number | null;
  status: string;
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
  return {
    mls: row.mls_number,
    address: [row.address, row.city, row.state]
      .filter(Boolean)
      .join(", "),
    list_price: row.list_price !== null ? Number(row.list_price) : undefined,
  };
}

function flattenMetricsJsonb(json: Record<string, number> | null): PostMetrics {
  const m = json ?? {};
  const likes = m.likes ?? 0;
  const comments = m.comments ?? 0;
  const shares = m.shares ?? 0;
  const saves = m.saves ?? 0;
  const reach = m.reach ?? m.impressions ?? 0;
  const total = likes + comments + shares + saves;
  return {
    impressions: m.impressions ?? 0,
    reach,
    likes,
    comments,
    shares,
    saves,
    engagement_rate: m.engagement_rate ?? (reach > 0 ? total / reach : 0),
    plays: m.plays,
    avg_watch_time_sec: m.avg_watch_time_sec,
    completion_rate: m.completion_rate,
    profile_visits: m.profile_visits,
    follows: m.follows,
    link_clicks: m.link_clicks,
  };
}

function rowToPost(
  row: DbPostRow,
  property: PropertyRef | undefined,
  daily: DbMetricsDailyRow[],
): Post {
  const mediaType =
    row.media_type === "reel"
      ? "video"
      : (row.media_type as Post["media_type"]) ?? "image";
  return {
    id: row.id,
    platform: row.platform,
    permalink: row.permalink ?? "",
    posted_at: row.posted_at ?? new Date().toISOString(),
    media_type: mediaType,
    thumbnail_url: row.thumbnail_url ?? row.media_url ?? "",
    media_url: row.media_url ?? undefined,
    caption: row.caption ?? "",
    hashtags: row.hashtags ?? [],
    property,
    metrics: flattenMetricsJsonb(row.metrics),
    daily: daily
      .sort((a, b) => a.captured_date.localeCompare(b.captured_date))
      .map((d) => ({
        date: d.captured_date,
        reach: d.reach ?? 0,
        engagements:
          (d.likes ?? 0) + (d.comments ?? 0) + (d.shares ?? 0) + (d.saves ?? 0),
      })),
    audience: row.audience as Post["audience"],
  };
}

export async function fetchPostsLive(): Promise<Post[]> {
  const supabase = createAdminClient();
  const { data: posts, error } = await supabase
    .from("posts")
    .select("*")
    .order("posted_at", { ascending: false })
    .limit(500);
  if (error || !posts) return [];

  const { data: properties } = await supabase.from("properties").select("*");
  const propMap = new Map<string, PropertyRef>();
  for (const p of (properties ?? []) as DbPropertyRow[]) {
    propMap.set(p.id, rowToPropertyRef(p));
  }

  const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
  const postIds = posts.map((p) => p.id);
  const { data: daily } = await supabase
    .from("post_metrics_daily")
    .select("post_id, captured_date, reach, impressions, likes, comments, shares, saves")
    .in("post_id", postIds)
    .gte("captured_date", cutoff);
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

export async function fetchAccountHealthLive(): Promise<AccountHealth[]> {
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
  for (const r of (counts ?? []) as { platform: Platform }[]) {
    countMap[r.platform] = (countMap[r.platform] ?? 0) + 1;
  }

  return data.map((row) => ({
    platform: row.platform as Platform,
    status: row.is_active ? "connected" : "disconnected",
    last_synced_at: row.last_validated_at ?? new Date(0).toISOString(),
    posts_last_30d: countMap[row.platform as Platform] ?? 0,
  }));
}
*/
