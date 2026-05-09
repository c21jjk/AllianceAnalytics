/**
 * Post-group types for the operational homepage.
 *
 * A "group" represents a same-day cross-platform campaign (e.g. one IG post
 * + one TT post + one FB post about the same listing on the same day). The
 * underlying SQL function run_post_grouper() merges qualifying posts into
 * post_groups rows; the homepage hydrates those rows with the full per-platform
 * postings and computes display metrics on top.
 *
 * For continuity, the data layer also synthesizes a single-posting "group" for
 * any post in the time window that hasn't been merged yet (group_id IS NULL),
 * so the homepage timeline never has gaps.
 */
import type {
  Platform,
  PostCategory,
  PostLinkMethod,
  PropertyRef,
} from "./post";

export interface PlatformPosting {
  platform: Platform;
  /** Internal posts.id (uuid) */
  post_id: string;
  /** Public URL on the source platform */
  permalink: string;
  thumbnail_url?: string;
  caption: string;
  /** For IG/FB this is reach. For TT this is plays. */
  reach: number;
  /** likes + comments + shares + saves */
  engagements: number;
  is_video: boolean;
  /** IG/TT shortcode used to build embed URLs. Optional — falls back to permalink parsing. */
  shortcode?: string;
}

export type AiInsightTone = "info" | "success" | "warning" | "quiet";

export interface AiInsight {
  tone: AiInsightTone;
  /** Bold first phrase, ~6-10 words. */
  headline: string;
  /** Explanatory body, ~15-30 words. */
  body: string;
  /** e.g. "Boost on IG" — optional CTA label. */
  action_label?: string;
  /** For now use "#" — Track E will wire deep links. */
  action_href?: string;
}

export interface PostGroup {
  id: string;
  /** YYYY-MM-DD */
  posted_date: string;
  representative_caption: string;
  representative_thumbnail?: string;
  category?: PostCategory;
  agent_name?: string;
  property?: PropertyRef;
  link_method?: PostLinkMethod;
  /**
   * Canonical MLS# parsed from at least one posting's caption (or set manually
   * via the inline editor on any posting in the group). Three accepted forms:
   * "NJBL2078123" (Bright), "CMC230456", "SJSR571832". Set even when
   * `property` is undefined (the listing exists in our feed but RETS hasn't
   * synced it yet).
   */
  mls_number_parsed?: string;
  is_locked: boolean;
  postings: PlatformPosting[];
  total_reach: number;
  total_engagements: number;
  /** Engagement rate as a 0-1 decimal, division-safe. */
  engagement_rate: number;
  /** Days since posted_date — used by the "Generate report" gate. */
  days_old: number;
  ai_insight?: AiInsight;
}
