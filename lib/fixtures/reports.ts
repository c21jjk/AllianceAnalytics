import type {
  PropertyReport,
  PropertyReportKpis,
  ReportDelivery,
  CompanyAnalyticsRollup,
} from "@/lib/types/report";
import type { Platform, AudienceSlice } from "@/lib/types/post";
import { POSTS, postsForMls, findProperty } from "@/lib/fixtures/posts";

const NOW = new Date("2026-05-08T15:00:00Z");

/**
 * Helper to compute aggregated KPIs from a list of post IDs.
 */
function computeKpisFromPosts(postIds: string[]): PropertyReportKpis {
  const posts = postIds
    .map((id) => POSTS.find((p) => p.id === id))
    .filter((p): p is typeof POSTS[0] => p !== undefined);

  const total_reach = posts.reduce((sum, p) => sum + p.metrics.reach, 0);
  const total_impressions = posts.reduce((sum, p) => sum + p.metrics.impressions, 0);
  const total_engagements = posts.reduce(
    (sum, p) =>
      sum + p.metrics.likes + p.metrics.comments + p.metrics.shares + p.metrics.saves,
    0,
  );
  const engagement_rate = total_reach > 0 ? total_engagements / total_reach : 0;

  const platforms = new Set(posts.map((p) => p.platform));

  let link_clicks = 0;
  let profile_visits = 0;
  posts.forEach((p) => {
    if (p.metrics.link_clicks) link_clicks += p.metrics.link_clicks;
    if (p.metrics.profile_visits) profile_visits += p.metrics.profile_visits;
  });

  return {
    total_reach,
    total_impressions,
    total_engagements,
    engagement_rate,
    post_count: posts.length,
    platforms_covered: platforms.size,
    ...(link_clicks > 0 && { link_clicks }),
    ...(profile_visits > 0 && { profile_visits }),
  };
}

/**
 * Helper to compute platform share breakdown.
 */
function computePlatformShare(
  postIds: string[],
): { platform: Platform; share: number; reach: number }[] {
  const posts = postIds
    .map((id) => POSTS.find((p) => p.id === id))
    .filter((p): p is typeof POSTS[0] => p !== undefined);

  const byPlatform: Record<Platform, number> = {
    facebook: 0,
    instagram: 0,
    tiktok: 0,
  };

  posts.forEach((p) => {
    byPlatform[p.platform] += p.metrics.reach;
  });

  const total_reach = Object.values(byPlatform).reduce((a, b) => a + b, 0);

  return (Object.entries(byPlatform) as Array<[Platform, number]>)
    .filter(([, reach]) => reach > 0)
    .map(([platform, reach]) => ({
      platform,
      reach,
      share: total_reach > 0 ? reach / total_reach : 0,
    }));
}

/**
 * Helper to compute aggregated audience across posts.
 */
function aggregateAudience(
  postIds: string[],
): {
  top_locations: AudienceSlice[];
  age_buckets: AudienceSlice[];
  gender_split: AudienceSlice[];
} {
  const posts = postIds
    .map((id) => POSTS.find((p) => p.id === id))
    .filter((p): p is typeof POSTS[0] => p !== undefined && p.audience !== undefined);

  if (posts.length === 0) {
    return {
      top_locations: [],
      age_buckets: [],
      gender_split: [],
    };
  }

  // Simple weighted average by reach
  const totalReach = posts.reduce((sum, p) => sum + p.metrics.reach, 0);

  // Aggregate locations
  const locMap: Record<string, number> = {};
  posts.forEach((p) => {
    if (p.audience?.top_locations) {
      const weight = p.metrics.reach / totalReach;
      p.audience.top_locations.forEach((loc) => {
        locMap[loc.label] = (locMap[loc.label] ?? 0) + loc.share * weight;
      });
    }
  });

  const top_locations = Object.entries(locMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, share]) => ({ label, share: share / 1 }));

  // Aggregate ages
  const ageMap: Record<string, number> = {};
  posts.forEach((p) => {
    if (p.audience?.age_buckets) {
      const weight = p.metrics.reach / totalReach;
      p.audience.age_buckets.forEach((age) => {
        ageMap[age.label] = (ageMap[age.label] ?? 0) + age.share * weight;
      });
    }
  });

  const age_buckets = Object.entries(ageMap)
    .sort((a, b) => b[1] - a[1])
    .map(([label, share]) => ({ label, share: share / 1 }));

  // Aggregate gender
  const genderMap: Record<string, number> = {};
  posts.forEach((p) => {
    if (p.audience?.gender_split) {
      const weight = p.metrics.reach / totalReach;
      p.audience.gender_split.forEach((gen) => {
        genderMap[gen.label] = (genderMap[gen.label] ?? 0) + gen.share * weight;
      });
    }
  });

  const gender_split = Object.entries(genderMap)
    .map(([label, share]) => ({ label, share: share / 1 }))
    .sort((a, b) => b.share - a.share);

  return { top_locations, age_buckets, gender_split };
}

/**
 * Helper to compute days ago as ISO date string.
 */
function isoDaysAgo(days: number, base: Date = NOW): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

/**
 * PROPERTY_REPORTS: 6 reports, one per MLS#.
 */
export const PROPERTY_REPORTS: PropertyReport[] = [
  {
    id: "rpt_NJBL2078123",
    mls: "NJBL2078123",
    period_start: isoDaysAgo(37),
    period_end: isoDaysAgo(0),
    post_ids: ["ig_3f4d2", "fb_19327"],
    kpis: computeKpisFromPosts(["ig_3f4d2", "fb_19327"]),
    audience: {
      ...aggregateAudience(["ig_3f4d2", "fb_19327"]),
      platform_share: computePlatformShare(["ig_3f4d2", "fb_19327"]),
    },
    narrative: {
      hero:
        "Over the past 37 days, your Cherry Hill listing reached 21,960 potential buyers across Instagram and Facebook — with your Reel capturing the attention of 18,420 people in the first week alone.",
      reach_summary:
        "65% of your audience was concentrated within a 10-mile radius of the property, heavily skewed toward the 35–54-year-old demographic — exactly the buyer profile actively searching in the $600K range in Cherry Hill right now.",
      closing:
        "Alliance's organic and paid social strategy put your home directly in front of qualified, geographically-relevant buyers. That reach, combined with strategic timing, is what made the difference.",
    },
    generated_at: NOW.toISOString(),
  },
  {
    id: "rpt_NJCD2089034",
    mls: "NJCD2089034",
    period_start: isoDaysAgo(42),
    period_end: isoDaysAgo(0),
    post_ids: ["tt_8a91c", "fb_19372"],
    kpis: computeKpisFromPosts(["tt_8a91c", "fb_19372"]),
    audience: {
      ...aggregateAudience(["tt_8a91c", "fb_19372"]),
      platform_share: computePlatformShare(["tt_8a91c", "fb_19372"]),
    },
    narrative: {
      hero:
        "Your Voorhees lake-view property made waves across TikTok and Facebook, generating 43,840 total impressions and reaching 41,200 diverse buyers over six weeks.",
      reach_summary:
        "The younger demographic (25–44) represented 54% of your reach, but the property's luxury positioning also attracted serious buyers aged 45–54. Geographically, 68% came from within the surrounding three-county area.",
      closing:
        "TikTok's rapid-discovery algorithm paired with Facebook's demographic targeting proved to be the winning combination for a waterfront property in this price range. Alliance leveraged both to maximize your property's visibility.",
    },
    generated_at: NOW.toISOString(),
  },
  {
    id: "rpt_NJBL2080915",
    mls: "NJBL2080915",
    period_start: isoDaysAgo(38),
    period_end: isoDaysAgo(0),
    post_ids: ["fb_19283"],
    kpis: computeKpisFromPosts(["fb_19283"]),
    audience: {
      ...aggregateAudience(["fb_19283"]),
      platform_share: computePlatformShare(["fb_19283"]),
    },
    narrative: {
      hero:
        "Your Marlton colonial reached 3,210 buyers via Facebook during its market window — a focused, high-intent audience primed for decision.",
      reach_summary:
        "This post skewed slightly older (45+ represented 52% of the audience) and concentrated heavily in Burlington County — 71% of reach came from the immediate local area, where your property's value proposition resonated most.",
      closing:
        "Sometimes less reach, better-targeted reach, wins the day. Alliance's Facebook strategy here prioritized intent and locality over raw impressions, and it worked.",
    },
    generated_at: NOW.toISOString(),
  },
  {
    id: "rpt_NJCD2091772",
    mls: "NJCD2091772",
    period_start: isoDaysAgo(40),
    period_end: isoDaysAgo(0),
    post_ids: ["ig_3f4e9", "ig_3f5b1"],
    kpis: computeKpisFromPosts(["ig_3f4e9", "ig_3f5b1"]),
    audience: {
      ...aggregateAudience(["ig_3f4e9", "ig_3f5b1"]),
      platform_share: computePlatformShare(["ig_3f4e9", "ig_3f5b1"]),
    },
    narrative: {
      hero:
        "Your Mount Laurel townhome campaign delivered 25,680 impressions across two Instagram posts — introducing the property to a highly engaged, younger buyer pool.",
      reach_summary:
        "The 25–44 age bracket dominated your audience at 61%, and the geographic split leaned South Jersey (Mount Laurel, Marlton, and Cherry Hill represented 52% of reach). These are buyers in move-up or first-time-homebuyer phases — precisely your target.",
      closing:
        "Instagram's visual-first, community-driven approach proved ideal for a townhome positioned as accessible and move-in ready. Alliance's photo and video strategy connected your property to the right next-owner audience.",
    },
    generated_at: NOW.toISOString(),
  },
  {
    id: "rpt_NJBL2084662",
    mls: "NJBL2084662",
    period_start: isoDaysAgo(45),
    period_end: isoDaysAgo(0),
    post_ids: ["tt_8a93f", "tt_8aa12"],
    kpis: computeKpisFromPosts(["tt_8a93f", "tt_8aa12"]),
    audience: {
      ...aggregateAudience(["tt_8a93f", "tt_8aa12"]),
      platform_share: computePlatformShare(["tt_8a93f", "tt_8aa12"]),
    },
    narrative: {
      hero:
        "Your $1.29M Moorestown estate commanded exceptional reach on TikTok: 142,800 impressions, 64,200 organic reach, and a sophisticated audience drawn by the luxury narrative.",
      reach_summary:
        "Luxury properties attract a different demographic: 48% of your reach came from the 35–54 age group — established wealth. Geographic distribution spread wider than typical, with buyers from across the tri-state area expressing interest. This is the national luxury-buyer audience TikTok reaches.",
      closing:
        "Luxury real estate lives on social discovery. TikTok's algorithm elevated your property to the exact audience that buys at this price point and location. Alliance's positioning turned your wine cellar and architectural details into cultural moments.",
    },
    generated_at: NOW.toISOString(),
  },
  {
    id: "rpt_NJCD2093208",
    mls: "NJCD2093208",
    period_start: isoDaysAgo(31),
    period_end: isoDaysAgo(0),
    post_ids: ["ig_3f548"],
    kpis: computeKpisFromPosts(["ig_3f548"]),
    audience: {
      ...aggregateAudience(["ig_3f548"]),
      platform_share: computePlatformShare(["ig_3f548"]),
    },
    narrative: {
      hero:
        "Your Haddonfield listing reached 11,200 engaged buyers on Instagram in just over a month — and the success of the sale itself became part of the story.",
      reach_summary:
        "The post announcing your $54K over ask result attracted a slightly older, serious-buyer demographic (45+ represented 48% of reach). Haddonfield and immediate neighbors made up 64% of the geographic mix — proof that local community engagement drives conversions in affluent suburbs.",
      closing:
        "When you win the market, you can say it publicly — and it resonates. Alliance's transparent, community-focused narrative made your property's success aspirational and credible to other local sellers considering listing.",
    },
    generated_at: NOW.toISOString(),
  },
];

/**
 * REPORT_DELIVERIES: 12 entries spanning ~90 days.
 * 8 viewed, 2 sent but not viewed, 2 pending.
 */
export const REPORT_DELIVERIES: ReportDelivery[] = [
  {
    id: "del_001",
    report_id: "rpt_NJBL2078123",
    mls: "NJBL2078123",
    recipient_name: "Robert Henderson",
    recipient_email: "rhenderson.realtor+2024@gmail.com",
    channel: "email",
    status: "viewed",
    sent_at: isoDaysAgo(84) + "T09:15:00Z",
    viewed_at: isoDaysAgo(82) + "T14:22:00Z",
    view_count: 3,
    share_token: "rpt_7x2kQ9mN4pL8vR5sT",
  },
  {
    id: "del_002",
    report_id: "rpt_NJCD2089034",
    mls: "NJCD2089034",
    recipient_name: "Priya Patel",
    recipient_email: "priya.home.sales@yahoo.com",
    channel: "link",
    status: "viewed",
    sent_at: isoDaysAgo(76) + "T10:30:00Z",
    viewed_at: isoDaysAgo(74) + "T16:45:00Z",
    view_count: 2,
    share_token: "rpt_2hJ8kL5mN9pQ3rX6uW",
  },
  {
    id: "del_003",
    report_id: "rpt_NJBL2080915",
    mls: "NJBL2080915",
    recipient_name: "Margaret O'Brien",
    recipient_email: "m.obrien.property@outlook.com",
    channel: "email",
    status: "viewed",
    sent_at: isoDaysAgo(68) + "T08:00:00Z",
    viewed_at: isoDaysAgo(65) + "T11:20:00Z",
    view_count: 1,
    share_token: "rpt_4dF2jK7nP1sT9vY2wB",
  },
  {
    id: "del_004",
    report_id: "rpt_NJCD2091772",
    mls: "NJCD2091772",
    recipient_name: "David Wong",
    recipient_email: "dwong.seller@gmail.com",
    channel: "email",
    status: "viewed",
    sent_at: isoDaysAgo(60) + "T13:45:00Z",
    viewed_at: isoDaysAgo(58) + "T18:30:00Z",
    view_count: 4,
    share_token: "rpt_6mZ4kL8qT2uV9xS1pR",
  },
  {
    id: "del_005",
    report_id: "rpt_NJBL2084662",
    mls: "NJBL2084662",
    recipient_name: "Victoria Marino",
    recipient_email: "victoria.m.estates@icloud.com",
    channel: "email",
    status: "viewed",
    sent_at: isoDaysAgo(51) + "T11:00:00Z",
    viewed_at: isoDaysAgo(49) + "T15:15:00Z",
    view_count: 2,
    share_token: "rpt_8xL5mN2pQ7rS9tV4wC",
  },
  {
    id: "del_006",
    report_id: "rpt_NJCD2093208",
    mls: "NJCD2093208",
    recipient_name: "Catherine Sullivan",
    recipient_email: "csullivan.haddonfield@gmail.com",
    channel: "link",
    status: "viewed",
    sent_at: isoDaysAgo(40) + "T09:30:00Z",
    viewed_at: isoDaysAgo(38) + "T12:45:00Z",
    view_count: 5,
    share_token: "rpt_1gJ3kM6nO9pQ2rT5sX",
  },
  {
    id: "del_007",
    report_id: "rpt_NJBL2078123",
    mls: "NJBL2078123",
    recipient_name: "James Chen",
    recipient_email: "jchen.buyer.co.seller@gmail.com",
    channel: "email",
    status: "viewed",
    sent_at: isoDaysAgo(28) + "T14:20:00Z",
    viewed_at: isoDaysAgo(26) + "T10:10:00Z",
    view_count: 3,
    share_token: "rpt_3hK5mL9nQ1pR8sT2uV",
  },
  {
    id: "del_008",
    report_id: "rpt_NJCD2089034",
    mls: "NJCD2089034",
    recipient_name: "Angela Rossi",
    recipient_email: "arossi.voorhees@yahoo.com",
    channel: "email",
    status: "viewed",
    sent_at: isoDaysAgo(19) + "T10:00:00Z",
    viewed_at: isoDaysAgo(17) + "T13:55:00Z",
    view_count: 1,
    share_token: "rpt_5mN7pL2qR4sT8uV3wX",
  },
  {
    id: "del_009",
    report_id: "rpt_NJBL2080915",
    mls: "NJBL2080915",
    recipient_name: "Thomas Kowalski",
    recipient_email: "tkowalski.property@outlook.com",
    channel: "email",
    status: "sent",
    sent_at: isoDaysAgo(12) + "T11:15:00Z",
    viewed_at: null,
    view_count: 0,
    share_token: "rpt_7dF4jK2nP6sT1vY9wA",
  },
  {
    id: "del_010",
    report_id: "rpt_NJCD2091772",
    mls: "NJCD2091772",
    recipient_name: "Sofia Russo",
    recipient_email: "srussia.mtlaurel.sell@gmail.com",
    channel: "link",
    status: "sent",
    sent_at: isoDaysAgo(8) + "T15:40:00Z",
    viewed_at: null,
    view_count: 0,
    share_token: "rpt_2kL6mN1pQ8rS3tV7uX",
  },
  {
    id: "del_011",
    report_id: "rpt_NJBL2084662",
    mls: "NJBL2084662",
    recipient_name: "Eleanor Grant",
    recipient_email: "egrant.luxury.homes@icloud.com",
    channel: "email",
    status: "pending",
    sent_at: null,
    viewed_at: null,
    view_count: 0,
    share_token: "rpt_9nM3pL5qR2sT6uV1wC",
  },
  {
    id: "del_012",
    report_id: "rpt_NJCD2093208",
    mls: "NJCD2093208",
    recipient_name: "Gregory Matthews",
    recipient_email: "gmatthews.haddonfield.estate@gmail.com",
    channel: "email",
    status: "pending",
    sent_at: null,
    viewed_at: null,
    view_count: 0,
    share_token: "rpt_4sP8kM3nR7tV2wY6xZ",
  },
];

/**
 * COMPANY_ROLLUPS: 2 windows (30-day and 90-day).
 */
export const COMPANY_ROLLUPS: CompanyAnalyticsRollup[] = [
  {
    label: "Last 30 days",
    window_days: 30,
    reports_sent: 4,
    properties_covered: 4,
    total_inventory_usd: 624900 + 412000 + 1295000 + 879000,
    total_reach_delivered: 56680, // Aggregated from 4 recent reports
    total_engagements_delivered: 3245,
    view_rate: 1.0, // 3 viewed out of 3 sent (1 pending not counted)
    generated_at: NOW.toISOString(),
  },
  {
    label: "Last 90 days",
    window_days: 90,
    reports_sent: 6,
    properties_covered: 6,
    total_inventory_usd: 624900 + 489000 + 729500 + 412000 + 1295000 + 879000,
    total_reach_delivered: 177890, // All 6 reports aggregated
    total_engagements_delivered: 12340,
    view_rate: 0.8, // 8 viewed, 2 sent, 2 pending = 8 / (8 + 2) = 0.8
    generated_at: NOW.toISOString(),
  },
];

/**
 * Helper: Look up a report by MLS#.
 */
export function findReport(mls: string): PropertyReport | undefined {
  return PROPERTY_REPORTS.find((r) => r.mls === mls);
}

/**
 * Helper: Look up a report by its ID.
 */
export function findReportById(id: string): PropertyReport | undefined {
  return PROPERTY_REPORTS.find((r) => r.id === id);
}

/**
 * Helper: Look up a delivery by share token.
 */
export function findDeliveryByToken(token: string): ReportDelivery | undefined {
  return REPORT_DELIVERIES.find((d) => d.share_token === token);
}

/**
 * Helper: Get all deliveries for a specific report ID.
 */
export function deliveriesForReport(reportId: string): ReportDelivery[] {
  return REPORT_DELIVERIES.filter((d) => d.report_id === reportId);
}
