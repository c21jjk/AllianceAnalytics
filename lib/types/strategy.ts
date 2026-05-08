import type { Platform } from "@/lib/types/post";

export type RecommendationKind =
  | "boost"            // Put paid spend behind a specific organic post
  | "reallocate"       // Move $ from one platform/post to another
  | "pause"            // Stop spending on something underperforming
  | "publish_more"     // Make more content of a certain type
  | "target_change";   // Adjust audience targeting

export type RecommendationPriority = "high" | "medium" | "low";

export interface RecommendationProjection {
  /** Projected reach lift if applied (additional people reached) */
  reach_lift?: number;
  /** Projected new engagements if applied */
  engagement_lift?: number;
  /** Projected new leads (form fills, DMs, calls) — optional */
  lead_lift?: number;
  /** Confidence as a decimal 0–1 */
  confidence: number;
}

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  priority: RecommendationPriority;
  /** Short headline rendered as the card title */
  headline: string;
  /** 1–3 sentences explaining the recommendation in plain English */
  rationale: string;
  /** Optional bullet list of specific actions */
  actions?: string[];
  /** Suggested dollar spend (USD) — undefined for non-spend recs */
  spend_usd?: number;
  /** Time window to apply this rec, e.g. "next 7 days", "this weekend" */
  window: string;
  /** Platforms this rec applies to */
  platforms: Platform[];
  /** Projected impact */
  projection: RecommendationProjection;
  /** Optional reference back to a specific post id from lib/fixtures/posts */
  post_id?: string;
  /** Optional MLS number from lib/fixtures/posts properties */
  mls?: string;
  /** ISO timestamp when this rec was generated */
  generated_at: string;
}

export interface BudgetSliceByPlatform {
  platform: Platform;
  /** Recommended share, decimal 0–1, summing across slices to 1.0 */
  share: number;
  /** Recommended weekly $ for this platform */
  weekly_usd: number;
}

export interface BudgetAllocation {
  id: string;
  /** Property this budget is allocated against (MLS#) */
  mls: string;
  /** Total weekly $ being split */
  total_weekly_usd: number;
  /** Splits across platforms, sums to total_weekly_usd */
  slices: BudgetSliceByPlatform[];
  /** Plain-English why */
  rationale: string;
  /** ISO timestamp when generated */
  generated_at: string;
}

export type TrendDirection = "up" | "down" | "watch";

export interface TrendNote {
  id: string;
  direction: TrendDirection;
  /** Short headline, e.g. "Reels are outpacing image posts 2.4x" */
  headline: string;
  /** 1–2 sentences of supporting detail */
  detail: string;
  /** Magnitude as a decimal where applicable (e.g. 1.4 = +40%); optional */
  magnitude?: number;
  /** Platforms involved, optional */
  platforms?: Platform[];
  generated_at: string;
}
