import type { Platform, AudienceSlice, Post, PropertyRef } from "@/lib/types/post";

export type { PropertyRef };

export interface PropertyReportKpis {
  /** Total unique reach across all posts for this property */
  total_reach: number;
  /** Total impressions */
  total_impressions: number;
  /** Likes + comments + shares + saves */
  total_engagements: number;
  /** Aggregate engagement rate as a decimal */
  engagement_rate: number;
  /** Number of posts that ran for this listing */
  post_count: number;
  /** Number of platforms covered (1-3) */
  platforms_covered: number;
  /** Total link clicks if any post had them */
  link_clicks?: number;
  /** Profile/account visits attributable to this property */
  profile_visits?: number;
}

export interface PropertyReport {
  /** Stable ID, e.g. "rpt_NJBL2078123" */
  id: string;
  mls: string;
  /** ISO date the report period began (typically the day of the first post) */
  period_start: string;
  /** ISO date the report period ended (typically today or close date) */
  period_end: string;
  /** Post IDs included in this report (refer to lib/fixtures/posts) */
  post_ids: string[];
  kpis: PropertyReportKpis;
  /** Audience rollup across all the posts in this report */
  audience: {
    top_locations: AudienceSlice[];
    age_buckets: AudienceSlice[];
    gender_split: AudienceSlice[];
    /** Per-platform reach breakdown */
    platform_share: { platform: Platform; share: number; reach: number }[];
  };
  /**
   * AI-written narrative paragraphs that the seller reads. Mock copy for now —
   * Claude will generate this in production.
   */
  narrative: {
    /** 1-paragraph hero blurb */
    hero: string;
    /** 1-paragraph reach/audience section */
    reach_summary: string;
    /** 1-paragraph closing/why-Alliance */
    closing: string;
  };
  /** ISO timestamp when this report was generated */
  generated_at: string;
}

export type DeliveryChannel = "email" | "link";
export type DeliveryStatus = "pending" | "sent" | "viewed";

export interface ReportDelivery {
  id: string;
  /** Which property report this delivery is for */
  report_id: string;
  /** MLS — convenience copy for filtering without joining */
  mls: string;
  /** Recipient name (typically the seller) */
  recipient_name: string;
  /** Email — partial-mask in UI like "j****@gmail.com" */
  recipient_email: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  /** ISO timestamp when sent */
  sent_at: string | null;
  /** ISO timestamp when first viewed (if ever) */
  viewed_at: string | null;
  /** Times the recipient opened the link */
  view_count: number;
  /** The shareable token (uuid-like). Used to construct /r/[token] URLs */
  share_token: string;
}

export interface CompanyAnalyticsRollup {
  /** Window label, e.g. "Last 30 days" */
  label: string;
  /** Window length in days */
  window_days: number;
  /** Number of property reports sent in this window */
  reports_sent: number;
  /** Number of distinct properties covered */
  properties_covered: number;
  /** Total list price $ of properties covered */
  total_inventory_usd: number;
  /** Total reach delivered to all sellers */
  total_reach_delivered: number;
  /** Total engagements */
  total_engagements_delivered: number;
  /** % of reports that were viewed */
  view_rate: number;
  /** Generated at ISO */
  generated_at: string;
}
