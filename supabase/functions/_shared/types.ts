/**
 * Shared types for Phase 2 ingestion Edge Functions.
 * Mirrors lib/types/post.ts on the Next.js side, normalized to Postgres
 * column shapes (snake_case) for direct insert/upsert into the posts and
 * post_metrics_daily tables.
 *
 * NOTE: These types live in the Edge Function bundle (Deno). Do not import
 * from `@/lib/...` here — Edge Functions don't share the Next.js module
 * resolver.
 */

export type Platform = "facebook" | "instagram" | "tiktok";

export type MediaType = "image" | "video" | "carousel" | "reel";

export interface PlatformCredentials {
  platform: Platform;
  /** Raw jsonb from public.api_credentials */
  credentials: Record<string, unknown>;
  is_active: boolean;
  last_validated_at: string | null;
}

/** Normalized shape that all three platform syncs produce per post. */
export interface NormalizedPost {
  platform: Platform;
  platform_post_id: string;
  caption: string | null;
  posted_at: string; // ISO timestamp
  permalink: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  media_type: MediaType | null;
  hashtags: string[];
  /**
   * Latest-snapshot metrics. Stored on posts.metrics for fast list reads,
   * AND inserted into post_metrics_daily for time-series.
   */
  metrics: NormalizedMetrics;
  audience: NormalizedAudience;
  /** Full raw API payload for forensic / future use */
  raw_payload: Record<string, unknown>;
}

export interface NormalizedMetrics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  plays?: number;
  link_clicks?: number;
  profile_visits?: number;
  follows?: number;
  /** Decimal 0–1 */
  engagement_rate?: number;
  /** Decimal 0–1 */
  completion_rate?: number;
  avg_watch_time_sec?: number;
}

export interface AudienceSlice {
  label: string;
  /** Decimal 0–1 share */
  share: number;
}

export interface NormalizedAudience {
  top_locations?: AudienceSlice[];
  age_buckets?: AudienceSlice[];
  gender_split?: AudienceSlice[];
}

export interface SyncResult {
  platform: Platform;
  ok: boolean;
  inserted: number;
  updated: number;
  metrics_rows_written: number;
  errors: { post_id?: string; message: string }[];
  /** Wall-clock duration in ms */
  duration_ms: number;
  /** First-sync flag — pulled posts older than the existing latest_posted_at */
  backfilled: boolean;
}
