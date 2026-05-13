/**
 * Shared post + analytics types.
 * Used by the dashboard, posts list, and post detail pages.
 *
 * Phase 2 ingestion will populate Supabase rows that map cleanly onto these
 * shapes — keeping the UI mock-driven for now lets us iterate on design before
 * the data pipeline is wired up.
 */

export type Platform = "facebook" | "instagram" | "tiktok";

export type MediaType = "image" | "video" | "carousel";

/**
 * Editorial category for a post. Property-tied posts will also have property_id;
 * non-property posts (educational, marketing, etc) will not.
 */
export type PostCategory =
  | "property"
  | "agent"
  | "educational"
  | "marketing"
  | "community"
  | "sold"
  | "open_house"
  | "other";

/** How a post got tied to a listing — manual override, or one of the auto-linkers. */
export type PostLinkMethod =
  | "manual"
  | "auto_mls"
  | "auto_address_full"
  | "auto_address_partial";

export interface PropertyRef {
  /** MLS number, e.g. "NJBL2078123" */
  mls: string;
  /** Short address line, e.g. "12 Park Ave, Cherry Hill, NJ" */
  address: string;
  /** Optional list price for surfacing on chips */
  list_price?: number;
  /** Optional hero photo URL — used as the cover on seller property reports */
  hero_image_url?: string;
}

export interface PostMetrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** Engagement rate as a decimal (e.g. 0.067 = 6.7%) */
  engagement_rate: number;
  /** Video-only metrics */
  plays?: number;
  avg_watch_time_sec?: number;
  /** Completion rate as a decimal (0–1) */
  completion_rate?: number;
  /** Discovery / conversion */
  profile_visits?: number;
  follows?: number;
  link_clicks?: number;
}

/** A single day of post performance, used for sparklines / time-series charts. */
export interface DailyMetric {
  /** ISO date string for the day (YYYY-MM-DD) */
  date: string;
  reach: number;
  engagements: number;
}

export interface AudienceSlice {
  label: string;
  /** 0–1 share of audience for this slice */
  share: number;
}

export interface PostAudience {
  top_locations: AudienceSlice[];
  age_buckets: AudienceSlice[];
  gender_split: AudienceSlice[];
}

export interface Post {
  id: string;
  platform: Platform;
  /** URL to the live post on the source platform */
  permalink: string;
  posted_at: string; // ISO timestamp
  media_type: MediaType;
  /** URL of the primary thumbnail to render in lists */
  thumbnail_url: string;
  /** URL of the playable media (video) — optional */
  media_url?: string;
  caption: string;
  hashtags: string[];
  property?: PropertyRef;
  /**
   * Canonical MLS# parsed from the caption (or set manually via the inline
   * editor). Three accepted forms:
   *   - "NJBL2078123" (Bright)
   *   - "CMC230456"   (CMC, Paragon)
   *   - "SJSR571832"  (SJSR, Paragon)
   *
   * May be set even when `property` is undefined (Larissa hashtagged a listing
   * RETS hasn't synced yet — auto-link fires on the next RETS sync).
   */
  mls_number_parsed?: string;
  /** Editorial classification. May be undefined for unclassified posts. */
  category?: PostCategory;
  /** Agent name when category is 'agent' (agent-promotion posts). */
  agent_name?: string;
  /** How property_id was set. NULL when no link. */
  link_method?: PostLinkMethod;
  metrics: PostMetrics;
  /** 30-day daily reach + engagement series following posted_at */
  daily?: DailyMetric[];
  audience?: PostAudience;
}

export interface AccountHealth {
  platform: Platform;
  status: "connected" | "needs_attention" | "disconnected";
  last_synced_at: string; // ISO timestamp
  posts_last_30d: number;
  /**
   * Next scheduled auto-sync (ISO timestamp). Computed from the pg_cron
   * schedules: ig at :05, fb at :15, tt at :25, every 4h UTC. Optional so
   * fixtures don't have to populate it.
   */
  next_scheduled_at?: string;
}

/**
 * MLS feed health — analog of AccountHealth for the Paragon RETS + Bright
 * RETS feeds. Powers the MLS-side chips on the dashboard sync bar.
 */
export interface MlsFeedHealth {
  /** Short code from mls_feeds.short_code: "cmc" | "sjsr" | "bright". */
  short_code: string;
  /** Display name e.g. "CMC", "SJSR", "Bright". */
  short_label: string;
  status: "connected" | "needs_attention" | "disconnected";
  /** ISO timestamp of the most recent listing upsert from this feed. NULL
   *  when no successful sync yet. */
  last_synced_at: string | null;
  /** Number of active listings currently tracked from this feed. */
  active_listings: number;
}
