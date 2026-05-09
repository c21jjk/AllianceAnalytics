import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AudienceSlice,
  Platform,
  Post,
  PostAudience,
  PostMetrics,
  PropertyRef,
} from "@/lib/types/post";
import type { PropertyReportKpis } from "@/lib/types/report";

/**
 * Pure-ish payload shape for both the HTML flyer and the (future) react-pdf
 * renderer. We keep it independent of the existing PropertyReport type so
 * server-side aggregation can run before any DB row exists, and so we can
 * snapshot it into reports.kpis / reports.audience on save.
 */
export interface ReportCampaign {
  /** Group id from post_groups, or "ungrouped:{post_id}" for solo posts */
  id: string;
  /** Editorial label — falls back to first caption sentence */
  label: string;
  /** Posted date for the group (earliest post) */
  posted_at: string;
  /** Thumbnail to render alongside the campaign */
  thumbnail_url: string;
  /** Per-platform reach + engagement breakdown for this campaign */
  by_platform: {
    platform: Platform;
    reach: number;
    engagements: number;
  }[];
  /** Convenience totals across platforms */
  total_reach: number;
  total_engagements: number;
  post_count: number;
}

export interface ReportPayload {
  property: PropertyRef;
  /** propertyId (uuid) on the AllianceAnalytics properties table */
  property_id: string;
  /** ISO date — earliest post date or today if no posts */
  period_start: string;
  /** ISO date — today */
  period_end: string;
  kpis: PropertyReportKpis;
  campaigns: ReportCampaign[];
  audience: {
    top_locations: AudienceSlice[];
    age_buckets: AudienceSlice[];
    gender_split: AudienceSlice[];
    platform_share: { platform: Platform; share: number; reach: number }[];
  };
  /** Post IDs (uuids) included in this report — what gets persisted to reports.post_ids */
  post_ids: string[];
  /** True if no posts found */
  empty: boolean;
  /** ISO timestamp of the most recent post in the group — used for the 7-day age gate */
  newest_post_at: string | null;
}

interface DbPostRow {
  id: string;
  group_id: string | null;
  platform: string;
  caption: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  posted_at: string | null;
  metrics: Record<string, unknown> | null;
  audience: Record<string, unknown> | null;
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

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function flattenMetrics(json: Record<string, unknown> | null): PostMetrics {
  const m = json ?? {};
  const reach = readNum(m.reach) || readNum(m.impressions) || readNum(m.views);
  const impressions = readNum(m.impressions) || readNum(m.views) || reach;
  const likes = readNum(m.likes);
  const comments = readNum(m.comments);
  const shares = readNum(m.shares);
  const saves = readNum(m.saves);
  const total = likes + comments + shares + saves;
  const engagement_rate =
    readNum(m.engagement_rate) || (reach > 0 ? total / reach : 0);
  return {
    impressions,
    reach,
    likes,
    comments,
    shares,
    saves,
    engagement_rate,
    plays: readNum(m.plays) || undefined,
    avg_watch_time_sec: readNum(m.avg_watch_time_sec) || undefined,
    completion_rate: readNum(m.completion_rate) || undefined,
    profile_visits: readNum(m.profile_visits) || undefined,
    follows: readNum(m.follows) || undefined,
    link_clicks: readNum(m.link_clicks) || undefined,
  };
}

function asPlatform(value: string): Platform {
  if (value === "facebook" || value === "instagram" || value === "tiktok") {
    return value;
  }
  return "instagram";
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

function rowToPropertyRef(row: DbPropertyRow): PropertyRef {
  const parts = [row.address, row.city, row.state].filter(Boolean);
  return {
    mls: row.mls_number,
    address: parts.join(", "),
    list_price:
      row.list_price === null || row.list_price === undefined
        ? undefined
        : Number(row.list_price),
    hero_image_url: row.hero_image_url ?? undefined,
  };
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Untitled campaign";
  // Split on sentence boundary — keep it simple
  const m = trimmed.split(/[.!?]\s/);
  const first = (m[0] ?? trimmed).slice(0, 80);
  return first.length < trimmed.length ? `${first}…` : first;
}

function aggregateAudienceSlice(
  posts: { metrics: PostMetrics; audience: PostAudience | undefined }[],
  pick: (a: PostAudience) => AudienceSlice[] | undefined,
): AudienceSlice[] {
  const totalReach = posts.reduce((sum, p) => sum + p.metrics.reach, 0);
  if (totalReach <= 0) return [];
  const map = new Map<string, number>();
  for (const p of posts) {
    if (!p.audience) continue;
    const slices = pick(p.audience);
    if (!slices) continue;
    const weight = p.metrics.reach / totalReach;
    for (const s of slices) {
      map.set(s.label, (map.get(s.label) ?? 0) + s.share * weight);
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, share]) => ({ label, share }));
}

interface BuildOptions {
  /** Override "now" for tests */
  now?: Date;
}

/**
 * Build a snapshot report payload for a single property by aggregating
 * its posts. Uses the service-role client; safe to call from server actions
 * and route handlers, never from client code.
 */
export async function buildReportPayload(
  propertyId: string,
  opts: BuildOptions = {},
): Promise<ReportPayload> {
  const supabase = createAdminClient();
  const now = opts.now ?? new Date();

  // 1) Property
  const { data: propRow, error: propErr } = await supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, list_price, hero_image_url",
    )
    .eq("id", propertyId)
    .maybeSingle();
  if (propErr || !propRow) {
    throw new Error(
      `buildReportPayload: property ${propertyId} not found${propErr ? `: ${propErr.message}` : ""}`,
    );
  }
  const property = rowToPropertyRef(propRow as DbPropertyRow);

  // 2) Posts for this property
  const { data: postRows, error: postErr } = await supabase
    .from("posts")
    .select(
      "id, group_id, platform, caption, thumbnail_url, media_url, posted_at, metrics, audience",
    )
    .eq("property_id", propertyId);
  if (postErr) {
    throw new Error(`buildReportPayload: posts query failed: ${postErr.message}`);
  }

  const posts = (postRows ?? []) as DbPostRow[];

  if (posts.length === 0) {
    const today = now.toISOString().slice(0, 10);
    return {
      property,
      property_id: propertyId,
      period_start: today,
      period_end: today,
      kpis: {
        total_reach: 0,
        total_impressions: 0,
        total_engagements: 0,
        engagement_rate: 0,
        post_count: 0,
        platforms_covered: 0,
      },
      campaigns: [],
      audience: {
        top_locations: [],
        age_buckets: [],
        gender_split: [],
        platform_share: [],
      },
      post_ids: [],
      empty: true,
      newest_post_at: null,
    };
  }

  // Normalize for aggregation
  const normalized = posts.map((row) => {
    const metrics = flattenMetrics(row.metrics);
    return {
      id: row.id,
      platform: asPlatform(row.platform),
      caption: row.caption ?? "",
      thumbnail_url: row.thumbnail_url ?? row.media_url ?? "",
      posted_at: row.posted_at ?? now.toISOString(),
      group_id: row.group_id ?? `ungrouped:${row.id}`,
      metrics,
      audience: asAudience(row.audience),
    };
  });

  // 3) KPIs
  const total_reach = normalized.reduce((s, p) => s + p.metrics.reach, 0);
  const total_impressions = normalized.reduce(
    (s, p) => s + p.metrics.impressions,
    0,
  );
  const total_engagements = normalized.reduce(
    (s, p) =>
      s + p.metrics.likes + p.metrics.comments + p.metrics.shares + p.metrics.saves,
    0,
  );
  const engagement_rate = total_reach > 0 ? total_engagements / total_reach : 0;
  const platforms = new Set(normalized.map((p) => p.platform));
  const link_clicks = normalized.reduce(
    (s, p) => s + (p.metrics.link_clicks ?? 0),
    0,
  );
  const profile_visits = normalized.reduce(
    (s, p) => s + (p.metrics.profile_visits ?? 0),
    0,
  );

  const kpis: PropertyReportKpis = {
    total_reach,
    total_impressions,
    total_engagements,
    engagement_rate,
    post_count: normalized.length,
    platforms_covered: platforms.size,
    ...(link_clicks > 0 && { link_clicks }),
    ...(profile_visits > 0 && { profile_visits }),
  };

  // 4) Campaigns: group by group_id
  const campaignMap = new Map<string, ReportCampaign>();
  for (const p of normalized) {
    const existing = campaignMap.get(p.group_id);
    const engagements =
      p.metrics.likes + p.metrics.comments + p.metrics.shares + p.metrics.saves;
    if (!existing) {
      campaignMap.set(p.group_id, {
        id: p.group_id,
        label: firstSentence(p.caption),
        posted_at: p.posted_at,
        thumbnail_url: p.thumbnail_url,
        by_platform: [
          { platform: p.platform, reach: p.metrics.reach, engagements },
        ],
        total_reach: p.metrics.reach,
        total_engagements: engagements,
        post_count: 1,
      });
    } else {
      const slot = existing.by_platform.find((x) => x.platform === p.platform);
      if (slot) {
        slot.reach += p.metrics.reach;
        slot.engagements += engagements;
      } else {
        existing.by_platform.push({
          platform: p.platform,
          reach: p.metrics.reach,
          engagements,
        });
      }
      existing.total_reach += p.metrics.reach;
      existing.total_engagements += engagements;
      existing.post_count += 1;
      // Keep the earliest posted_at as the campaign date
      if (p.posted_at < existing.posted_at) {
        existing.posted_at = p.posted_at;
      }
    }
  }
  const campaigns = Array.from(campaignMap.values()).sort(
    (a, b) => b.total_reach - a.total_reach,
  );

  // 5) Audience rollup
  const audience = {
    top_locations: aggregateAudienceSlice(normalized, (a) => a.top_locations).slice(0, 5),
    age_buckets: aggregateAudienceSlice(normalized, (a) => a.age_buckets),
    gender_split: aggregateAudienceSlice(normalized, (a) => a.gender_split),
    platform_share: (() => {
      const byPlatform: Record<Platform, number> = {
        facebook: 0,
        instagram: 0,
        tiktok: 0,
      };
      for (const p of normalized) byPlatform[p.platform] += p.metrics.reach;
      const total = byPlatform.facebook + byPlatform.instagram + byPlatform.tiktok;
      return (Object.entries(byPlatform) as Array<[Platform, number]>)
        .filter(([, reach]) => reach > 0)
        .map(([platform, reach]) => ({
          platform,
          reach,
          share: total > 0 ? reach / total : 0,
        }));
    })(),
  };

  // 6) Period
  const earliest = normalized.reduce(
    (min, p) => (p.posted_at < min ? p.posted_at : min),
    normalized[0].posted_at,
  );
  const latest = normalized.reduce(
    (max, p) => (p.posted_at > max ? p.posted_at : max),
    normalized[0].posted_at,
  );
  const period_start = earliest.slice(0, 10);
  const period_end = now.toISOString().slice(0, 10);

  return {
    property,
    property_id: propertyId,
    period_start,
    period_end,
    kpis,
    campaigns,
    audience,
    post_ids: normalized.map((p) => p.id),
    empty: false,
    newest_post_at: latest,
  };
}

/**
 * Returns the age in days of the most recent post in a payload. Used by the
 * 7-day post-age gate before a report can be generated.
 */
export function newestPostAgeDays(
  payload: ReportPayload,
  now: Date = new Date(),
): number {
  if (payload.empty || !payload.newest_post_at) return 0;
  const newest = new Date(payload.newest_post_at).getTime();
  if (!Number.isFinite(newest)) return 0;
  const ms = now.getTime() - newest;
  return Math.floor(ms / 86_400_000);
}
