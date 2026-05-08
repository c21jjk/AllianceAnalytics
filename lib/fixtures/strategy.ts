import type {
  Recommendation,
  BudgetAllocation,
  TrendNote,
} from "@/lib/types/strategy";

const NOW = "2026-05-08T15:00:00Z";

/**
 * Mock recommendations for the Coach UI. Tied to real post IDs and MLS numbers
 * from lib/fixtures/posts. Spans all 5 RecommendationKind values with realistic
 * priorities, spend amounts, and projections.
 */
export const RECOMMENDATIONS: Recommendation[] = [
  {
    id: "rec_001",
    kind: "boost",
    priority: "high",
    headline: "Boost this Reel to drive more Voorhees traffic",
    rationale:
      "Your POV home tour is hitting 41K reach with solid engagement on TikTok. A $75 boost over 7 days could drive an additional 8–12K reach among home-buyers in your target radius, lifting link clicks by ~18%.",
    actions: [
      "Enable paid promotion on ig_3f4d2",
      "Budget $75 over 7 days",
      "Target: 25–54, homebuyers, South Jersey",
    ],
    spend_usd: 75,
    window: "next 7 days",
    platforms: ["instagram"],
    projection: {
      reach_lift: 9200,
      engagement_lift: 680,
      lead_lift: 4,
      confidence: 0.82,
    },
    post_id: "tt_8a91c",
    mls: "NJCD2089034",
    generated_at: NOW,
  },
  {
    id: "rec_002",
    kind: "reallocate",
    priority: "high",
    headline: "Reallocate Facebook budget to TikTok long-form video",
    rationale:
      "Your Facebook market update is getting 4.7K reach at low engagement. Meanwhile, your TikTok educational content (rate buydowns, Zestimate explainer) is hitting 18–32K reach. Shift $60 from Facebook to TikTok video boosting this week.",
    actions: [
      "Pause Facebook property-ad spend",
      "Move $60 to TikTok boosting for educational content",
      "Re-test in 2 weeks",
    ],
    spend_usd: 60,
    window: "this week",
    platforms: ["facebook", "tiktok"],
    projection: {
      reach_lift: 14200,
      engagement_lift: 920,
      confidence: 0.77,
    },
    post_id: "fb_19294",
    generated_at: NOW,
  },
  {
    id: "rec_003",
    kind: "pause",
    priority: "medium",
    headline: "Pause boost on saturated market-update posts",
    rationale:
      "Your April market update (fb_19294) has been promoted for 6+ days and is hitting engagement saturation. Engagement rate dropped 23% after day 4. Pausing frees up $40 and gives your audience a break before the May update.",
    spend_usd: 0,
    window: "today",
    platforms: ["facebook"],
    projection: {
      confidence: 0.88,
    },
    post_id: "fb_19294",
    generated_at: NOW,
  },
  {
    id: "rec_004",
    kind: "publish_more",
    priority: "high",
    headline: "Publish more before-&-after renovation carousels",
    rationale:
      "Your before-&-after carousel (ig_3f55e) is outperforming single-image posts by 2.1x on reach and 2.4x on engagement. Carousel format is uniquely strong for Voorhees/Moorestown properties. Commit to 2–3 per month instead of sporadic posting.",
    window: "ongoing",
    platforms: ["instagram"],
    projection: {
      reach_lift: 6400,
      engagement_lift: 520,
      confidence: 0.85,
    },
    generated_at: NOW,
  },
  {
    id: "rec_005",
    kind: "target_change",
    priority: "medium",
    headline: "Shift Cherry Hill audience targeting to 35–54 demo",
    rationale:
      "Your top engagers on the Cherry Hill listing (ig_3f4d2) skew 35–54 (58% of comments, 62% of shares). Current targeting is 25–44. Tightening to 35–54 will improve relevance and reduce wasted spend on younger audiences less likely to buy in this price range.",
    window: "before next boost",
    platforms: ["instagram"],
    projection: {
      engagement_lift: 240,
      lead_lift: 2,
      confidence: 0.79,
    },
    post_id: "ig_3f4d2",
    mls: "NJBL2078123",
    generated_at: NOW,
  },
  {
    id: "rec_006",
    kind: "boost",
    priority: "medium",
    headline: "Small boost on high-ER educational carousel",
    rationale:
      "Your buyer-tips carousel (ig_3f57a) has the highest engagement rate on Instagram (12.1%) but modest reach (8.1K). A modest $35 boost can get this educational content in front of more first-time buyers with high intent.",
    spend_usd: 35,
    window: "next 5 days",
    platforms: ["instagram"],
    projection: {
      reach_lift: 4200,
      engagement_lift: 380,
      confidence: 0.81,
    },
    post_id: "ig_3f57a",
    generated_at: NOW,
  },
  {
    id: "rec_007",
    kind: "reallocate",
    priority: "medium",
    headline: "Move small Instagram spend to Moorestown luxury video",
    rationale:
      "Your luxury estate video on TikTok (tt_8a93f) hit 78K reach with 2.3K engagements, but you haven't boosted it. Reallocating $45 from a lower-performing Instagram image post can extend its reach among high-net-worth 35–64 buyers.",
    spend_usd: 45,
    window: "this week",
    platforms: ["tiktok"],
    projection: {
      reach_lift: 11500,
      engagement_lift: 410,
      lead_lift: 3,
      confidence: 0.73,
    },
    post_id: "tt_8a93f",
    mls: "NJBL2084662",
    generated_at: NOW,
  },
  {
    id: "rec_008",
    kind: "publish_more",
    priority: "medium",
    headline: "Increase Sunday open-house teaser posts",
    rationale:
      "Sunday open-house carousel (ig_3f520) gets strong engagement but limited frequency. Posting Thursday teasers + Saturday time-slots 2 days before open houses (vs. generic 1-day notices) correlates with 31% higher traffic. Test 2x/week during spring market.",
    window: "ongoing",
    platforms: ["instagram"],
    projection: {
      reach_lift: 8100,
      engagement_lift: 540,
      confidence: 0.76,
    },
    generated_at: NOW,
  },
  {
    id: "rec_009",
    kind: "target_change",
    priority: "low",
    headline: "Broaden age targeting on buyer-education content",
    rationale:
      "Your down-payment-programs carousel (ig_3f57a) skews slightly younger (32% ages 25–34). Expanding to include 35–44 (+10% targeting) matches your engagement data and taps first-time buyers with more purchase power.",
    window: "before next boost",
    platforms: ["instagram"],
    projection: {
      reach_lift: 2400,
      confidence: 0.71,
    },
    post_id: "ig_3f57a",
    generated_at: NOW,
  },
  {
    id: "rec_010",
    kind: "pause",
    priority: "low",
    headline: "Pause Tuesday tour-showcase video after day 5",
    rationale:
      "Mount Laurel tour video (ig_3f5b1) shows typical engagement curve — strong first 3 days, drops 40% by day 5. Pausing on day 5–6 and shifting budget to newer content typically improves overall campaign ROI and audience interest.",
    spend_usd: 0,
    window: "after day 5 of next boost",
    platforms: ["instagram"],
    projection: {
      confidence: 0.68,
    },
    post_id: "ig_3f5b1",
    mls: "NJCD2091772",
    generated_at: NOW,
  },
];

/**
 * Budget allocations across platforms for specific properties.
 * Tied to real MLS numbers. Instagram-heavy split reflects Reels/Stories
 * dominance in agent lead generation.
 */
export const BUDGET_ALLOCATIONS: BudgetAllocation[] = [
  {
    id: "budget_001",
    mls: "NJBL2078123",
    total_weekly_usd: 150,
    slices: [
      {
        platform: "instagram",
        share: 0.56,
        weekly_usd: 84,
      },
      {
        platform: "tiktok",
        share: 0.28,
        weekly_usd: 42,
      },
      {
        platform: "facebook",
        share: 0.16,
        weekly_usd: 24,
      },
    ],
    rationale:
      "Cherry Hill $625K colonial hits highest engagement on Reels (12 Park Ave). Instagram targeting 35–54 local buyers. Small TikTok for brand discovery. Facebook link-clicks to MLS.",
    generated_at: NOW,
  },
  {
    id: "budget_002",
    mls: "NJBL2084662",
    total_weekly_usd: 250,
    slices: [
      {
        platform: "instagram",
        share: 0.52,
        weekly_usd: 130,
      },
      {
        platform: "tiktok",
        share: 0.32,
        weekly_usd: 80,
      },
      {
        platform: "facebook",
        share: 0.16,
        weekly_usd: 40,
      },
    ],
    rationale:
      "Moorestown $1.295M luxury estate ($1.29M wine-cellar video). TikTok outreach to aspirational younger wealth. Instagram Story ads for 45–65 net-worth segments. Facebook retargeting website visitors.",
    generated_at: NOW,
  },
  {
    id: "budget_003",
    mls: "NJCD2089034",
    total_weekly_usd: 400,
    slices: [
      {
        platform: "instagram",
        share: 0.58,
        weekly_usd: 232,
      },
      {
        platform: "tiktok",
        share: 0.26,
        weekly_usd: 104,
      },
      {
        platform: "facebook",
        share: 0.16,
        weekly_usd: 64,
      },
    ],
    rationale:
      "Voorhees lakeshore $489K listing shows strong TikTok POV (41K reach). Allocate 58% to Instagram Stories/Reels for local buyer saturation. 26% TikTok for broader reach. Facebook for DM lead capture.",
    generated_at: NOW,
  },
];

/**
 * Trend observations for the Coach to surface.
 * Mixed directions (up/down/watch) with realistic findings about
 * performance patterns, day-of-week effects, and platform behavior.
 */
export const TREND_NOTES: TrendNote[] = [
  {
    id: "trend_001",
    direction: "up",
    headline: "Reels and video outpacing image posts 2.4x on reach",
    detail:
      "Video content (Reels, TikToks, Stories) is hitting 2.4× the reach of single-image carousel posts when controlling for audience size and posting time. Carousels still win on engagement rate, but volume wins the month.",
    magnitude: 2.4,
    platforms: ["instagram", "tiktok"],
    generated_at: NOW,
  },
  {
    id: "trend_002",
    direction: "down",
    headline: "Saturday open-house posts underperform vs. Thursday teasers",
    detail:
      "Posts going live Saturday morning average 31% lower reach than Thursday teaser posts for the same property. Buyers are researching Wed–Fri and planning visits; Saturday posts miss that window. Thursday scheduling with time-slot reminder Friday shows best results.",
    magnitude: 0.69,
    platforms: ["instagram", "facebook"],
    generated_at: NOW,
  },
  {
    id: "trend_003",
    direction: "watch",
    headline: "Facebook engagement rate declining after day 7 on property posts",
    detail:
      "Property listings on Facebook show normal reach decay but sharper engagement-rate drop after day 7. Engagement rate halves by day 10. Recommend rotating creative or pausing boosted spend at day 6–7 mark and relaunching fresh.",
    magnitude: 0.5,
    platforms: ["facebook"],
    generated_at: NOW,
  },
  {
    id: "trend_004",
    direction: "up",
    headline: "Educational carousels (buyer tips, prep guides) outperform listings 1.8x on ER",
    detail:
      "Non-property educational content (down-payment guides, inspection tips, buyer checklists) consistently achieves 10–12% engagement rates vs. 5–7% on property listings. Higher-intent audience; consider 40% editorial content mix.",
    magnitude: 1.8,
    platforms: ["instagram"],
    generated_at: NOW,
  },
  {
    id: "trend_005",
    direction: "watch",
    headline: "TikTok luxury content getting flagged for impressions plateau around day 12",
    detail:
      "High-reach TikTok videos ($1M+ properties) show unusual plateau in new impressions around day 12, despite continued engagement. May be algorithmic fatigue or bot-filter. Monitor luxury video lifespan closely; rotate creative more frequently.",
    platforms: ["tiktok"],
    generated_at: NOW,
  },
];

/**
 * Helper: return the top recommendation (first in sorted array).
 * In production, this would rank by priority + confidence + window urgency.
 */
export function getTopRecommendation(): Recommendation {
  return RECOMMENDATIONS[0];
}

/**
 * Helper: find a recommendation by ID.
 */
export function findRecommendation(id: string): Recommendation | undefined {
  return RECOMMENDATIONS.find((rec) => rec.id === id);
}
