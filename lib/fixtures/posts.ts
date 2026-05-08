import type {
  AccountHealth,
  DailyMetric,
  Platform,
  Post,
  PostAudience,
  PostMetrics,
  PropertyRef,
} from "@/lib/types/post";

/**
 * Mock data for the dashboard + posts UI.
 *
 * Phase 2 will replace this with real ingestion from Facebook Graph,
 * Instagram Graph, and TikTok APIs into Supabase. Until then, this fixture
 * lets us iterate on design with realistic shapes and volumes.
 *
 * Notes on volumes:
 *   - A typical Alliance NJ realtor reel gets 800–25k views, 30–500 likes.
 *   - Property posts on FB get smaller reach but better link-click rates.
 *   - TikTok skews higher-reach, lower-engagement-rate.
 */

const NOW = new Date("2026-05-08T15:00:00Z");

/**
 * Tiny deterministic PRNG so the fixture stays stable across renders
 * (no SSR/CSR hydration drift) without pulling in a dep.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDaysAgo(days: number, base: Date = NOW): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function isoDateOnly(daysAgo: number, base: Date = NOW): string {
  return isoDaysAgo(daysAgo, base).slice(0, 10);
}

/**
 * Build a 30-day daily series following a post's publish date.
 * Reach decays exponentially after the first ~3 days, with small noise.
 */
function buildDailySeries(
  seed: number,
  totalReach: number,
  postedDaysAgo: number,
): DailyMetric[] {
  const rand = mulberry32(seed);
  const days = Math.min(30, Math.max(1, postedDaysAgo + 1));
  // Distribute reach: peak ~day 1, decay
  const weights: number[] = [];
  for (let i = 0; i < days; i++) {
    const peak = i < 2 ? 1 + rand() * 0.4 : Math.exp(-i * 0.18) * (0.6 + rand() * 0.4);
    weights.push(peak);
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w, i) => {
    const reach = Math.round((w / sum) * totalReach);
    const engagements = Math.round(reach * (0.03 + rand() * 0.07));
    return {
      date: isoDateOnly(postedDaysAgo - i),
      reach,
      engagements,
    };
  });
}

interface PostSeed {
  id: string;
  platform: Platform;
  daysAgo: number;
  caption: string;
  hashtags: string[];
  media_type: Post["media_type"];
  permalinkSlug: string;
  thumbnailSeed: string;
  property?: PropertyRef;
  /** Reach scale; metrics are derived from this */
  reach: number;
  /** Engagement rate scaling factor (0.02–0.12 typical) */
  erBase: number;
  audience?: PostAudience;
}

const PROPERTIES: PropertyRef[] = [
  {
    mls: "NJBL2078123",
    address: "12 Park Ave, Cherry Hill, NJ",
    list_price: 624900,
  },
  {
    mls: "NJCD2089034",
    address: "847 Lakeshore Dr, Voorhees, NJ",
    list_price: 489000,
  },
  {
    mls: "NJBL2080915",
    address: "204 Hawthorne Ln, Marlton, NJ",
    list_price: 729500,
  },
  {
    mls: "NJCD2091772",
    address: "31 Ridgeway Ct, Mount Laurel, NJ",
    list_price: 412000,
  },
  {
    mls: "NJBL2084662",
    address: "1156 Linden Blvd, Moorestown, NJ",
    list_price: 1295000,
  },
  {
    mls: "NJCD2093208",
    address: "78 Sunset Way, Haddonfield, NJ",
    list_price: 879000,
  },
];

const STANDARD_AUDIENCE: PostAudience = {
  top_locations: [
    { label: "Cherry Hill, NJ", share: 0.34 },
    { label: "Marlton, NJ", share: 0.18 },
    { label: "Mount Laurel, NJ", share: 0.14 },
    { label: "Philadelphia, PA", share: 0.11 },
    { label: "Voorhees, NJ", share: 0.09 },
  ],
  age_buckets: [
    { label: "25–34", share: 0.32 },
    { label: "35–44", share: 0.29 },
    { label: "45–54", share: 0.21 },
    { label: "55–64", share: 0.12 },
    { label: "18–24", share: 0.06 },
  ],
  gender_split: [
    { label: "Women", share: 0.62 },
    { label: "Men", share: 0.37 },
    { label: "Unspecified", share: 0.01 },
  ],
};

const SEEDS: PostSeed[] = [
  {
    id: "ig_3f4d2",
    platform: "instagram",
    daysAgo: 1,
    caption:
      "Just listed in Cherry Hill — 4 bed, 3 bath, walkable to Croft Farm. Open house Saturday 11–1. DM for the private tour link.",
    hashtags: ["#cherryhillrealestate", "#njhomes", "#century21alliance"],
    media_type: "video",
    permalinkSlug: "C9xKf2QPbA1",
    thumbnailSeed: "modern-kitchen",
    property: PROPERTIES[0],
    reach: 18420,
    erBase: 0.082,
    audience: STANDARD_AUDIENCE,
  },
  {
    id: "tt_8a91c",
    platform: "tiktok",
    daysAgo: 2,
    caption:
      "POV: you finally walk into your forever home. Voorhees, $489K, full backyard reveal at the end 🏡",
    hashtags: ["#houseTok", "#njrealtor", "#voorheesnj", "#dreamhome"],
    media_type: "video",
    permalinkSlug: "7321094523801938201",
    thumbnailSeed: "backyard-pool",
    property: PROPERTIES[1],
    reach: 41200,
    erBase: 0.041,
  },
  {
    id: "fb_19283",
    platform: "facebook",
    daysAgo: 3,
    caption:
      "Closed today on a beautiful colonial in Marlton — congrats to the Hendersons! 🥂 If you're thinking about listing this summer, message me — inventory is moving fast in Burlington County.",
    hashtags: ["#marltonNJ", "#realestate", "#century21"],
    media_type: "image",
    permalinkSlug: "alliancesocial/posts/192845",
    thumbnailSeed: "colonial-front",
    property: PROPERTIES[2],
    reach: 3210,
    erBase: 0.094,
  },
  {
    id: "ig_3f4e9",
    platform: "instagram",
    daysAgo: 4,
    caption:
      "Tour Tuesday: take a walk through this Mount Laurel townhome before it hits the market on Friday.",
    hashtags: ["#tourtuesday", "#mountlaurelnj", "#comingsoon"],
    media_type: "video",
    permalinkSlug: "C9xMcVgPaaa",
    thumbnailSeed: "townhome-tour",
    property: PROPERTIES[3],
    reach: 12480,
    erBase: 0.071,
    audience: STANDARD_AUDIENCE,
  },
  {
    id: "ig_3f502",
    platform: "instagram",
    daysAgo: 5,
    caption:
      "Three things every NJ buyer should ask before making an offer on a 1960s ranch. (Save this!)",
    hashtags: ["#firsttimebuyer", "#njrealestate", "#buyertips"],
    media_type: "carousel",
    permalinkSlug: "C9wTYxRPxxa",
    thumbnailSeed: "buyer-tips",
    reach: 9840,
    erBase: 0.108,
    audience: STANDARD_AUDIENCE,
  },
  {
    id: "tt_8a93f",
    platform: "tiktok",
    daysAgo: 5,
    caption:
      "$1.29M Moorestown estate — wait until you see the wine cellar 🍷",
    hashtags: ["#luxuryrealestate", "#moorestownnj", "#luxuryhomes"],
    media_type: "video",
    permalinkSlug: "7320887341290038129",
    thumbnailSeed: "luxury-estate",
    property: PROPERTIES[4],
    reach: 78600,
    erBase: 0.029,
  },
  {
    id: "fb_19294",
    platform: "facebook",
    daysAgo: 6,
    caption:
      "Burlington County market update for April: median price up 4.8% YoY, days on market down to 19. Full breakdown in the linked post.",
    hashtags: ["#marketupdate", "#nj"],
    media_type: "image",
    permalinkSlug: "alliancesocial/posts/192901",
    thumbnailSeed: "market-graph",
    reach: 4720,
    erBase: 0.052,
  },
  {
    id: "ig_3f520",
    platform: "instagram",
    daysAgo: 7,
    caption:
      "Sunday open houses are back. Three this weekend — Haddonfield, Cherry Hill, Marlton. Times in stories.",
    hashtags: ["#openhouse", "#njhomes"],
    media_type: "image",
    permalinkSlug: "C9vAZyqPbqq",
    thumbnailSeed: "open-house",
    reach: 6200,
    erBase: 0.066,
  },
  {
    id: "tt_8a95c",
    platform: "tiktok",
    daysAgo: 8,
    caption:
      "Why your Zillow estimate is wrong (and what realtors actually use instead) 📊",
    hashtags: ["#realtortok", "#zestimate", "#njrealtor"],
    media_type: "video",
    permalinkSlug: "7320441290380129383",
    thumbnailSeed: "zillow-takedown",
    reach: 32400,
    erBase: 0.058,
  },
  {
    id: "ig_3f548",
    platform: "instagram",
    daysAgo: 9,
    caption:
      "Just sold in Haddonfield — $54K over ask, 11 offers in 5 days. The right pricing strategy still wins this market.",
    hashtags: ["#justsold", "#haddonfield"],
    media_type: "image",
    permalinkSlug: "C9uQhbrPfbb",
    thumbnailSeed: "sold-haddonfield",
    property: PROPERTIES[5],
    reach: 11200,
    erBase: 0.087,
    audience: STANDARD_AUDIENCE,
  },
  {
    id: "fb_19310",
    platform: "facebook",
    daysAgo: 10,
    caption:
      "Q&A live this Thursday at 7pm: rates, inventory, and whether to wait until fall. Drop your questions below.",
    hashtags: [],
    media_type: "image",
    permalinkSlug: "alliancesocial/posts/193099",
    thumbnailSeed: "qa-promo",
    reach: 2890,
    erBase: 0.073,
  },
  {
    id: "ig_3f55e",
    platform: "instagram",
    daysAgo: 11,
    caption:
      "Before & after: same Voorhees split-level, $32K of strategic prep work, $61K higher list price.",
    hashtags: ["#beforeandafter", "#sellerprep", "#njhomes"],
    media_type: "carousel",
    permalinkSlug: "C9tBgqxPxxx",
    thumbnailSeed: "before-after",
    reach: 14760,
    erBase: 0.098,
    audience: STANDARD_AUDIENCE,
  },
  {
    id: "tt_8a98a",
    platform: "tiktok",
    daysAgo: 12,
    caption:
      "Three red flags I look for when I tour a house with a buyer 🚩",
    hashtags: ["#realtortips", "#homebuying"],
    media_type: "video",
    permalinkSlug: "7320128475192038475",
    thumbnailSeed: "red-flags",
    reach: 26800,
    erBase: 0.064,
  },
  {
    id: "ig_3f57a",
    platform: "instagram",
    daysAgo: 13,
    caption:
      "First-time homebuyer down payment programs available in NJ right now — saving this is free, missing it is expensive.",
    hashtags: ["#downpayment", "#njbuyers"],
    media_type: "carousel",
    permalinkSlug: "C9sDtycPsss",
    thumbnailSeed: "down-payment",
    reach: 8120,
    erBase: 0.121,
    audience: STANDARD_AUDIENCE,
  },
  {
    id: "fb_19327",
    platform: "facebook",
    daysAgo: 14,
    caption:
      "New listing in Cherry Hill — 3 bed ranch on a quiet cul-de-sac, fully renovated kitchen. Showings start Saturday.",
    hashtags: ["#newlisting", "#cherryhillnj"],
    media_type: "image",
    permalinkSlug: "alliancesocial/posts/193270",
    thumbnailSeed: "ranch-cul-de-sac",
    property: PROPERTIES[0],
    reach: 3540,
    erBase: 0.068,
  },
  {
    id: "ig_3f593",
    platform: "instagram",
    daysAgo: 15,
    caption: "Spring curb appeal — small updates that read big.",
    hashtags: ["#curbappeal", "#sellertips"],
    media_type: "image",
    permalinkSlug: "C9rMavqPmmm",
    thumbnailSeed: "curb-appeal",
    reach: 5740,
    erBase: 0.057,
  },
  {
    id: "tt_8a9c3",
    platform: "tiktok",
    daysAgo: 17,
    caption:
      "Rate buydowns in plain English — when sellers offer them and when they save you money 💵",
    hashtags: ["#mortgage", "#firsttimebuyer"],
    media_type: "video",
    permalinkSlug: "7319887341290038129",
    thumbnailSeed: "rate-buydown",
    reach: 18900,
    erBase: 0.052,
  },
  {
    id: "ig_3f5b1",
    platform: "instagram",
    daysAgo: 18,
    caption:
      "Walking through a fixer-upper in Mount Laurel — what's worth fixing yourself vs. negotiating into the price.",
    hashtags: ["#fixerupper", "#mountlaurelnj"],
    media_type: "video",
    permalinkSlug: "C9qPcabPnnn",
    thumbnailSeed: "fixer-upper",
    property: PROPERTIES[3],
    reach: 13200,
    erBase: 0.074,
    audience: STANDARD_AUDIENCE,
  },
  {
    id: "fb_19345",
    platform: "facebook",
    daysAgo: 20,
    caption:
      "Helping a seller decide between selling now and refinancing — full breakdown in the comments 👇",
    hashtags: [],
    media_type: "image",
    permalinkSlug: "alliancesocial/posts/193458",
    thumbnailSeed: "decision-graphic",
    reach: 1820,
    erBase: 0.041,
  },
  {
    id: "ig_3f5dd",
    platform: "instagram",
    daysAgo: 22,
    caption:
      "Saturday at the Cherry Hill open house — thanks to everyone who came through!",
    hashtags: ["#openhouse"],
    media_type: "image",
    permalinkSlug: "C9oZqmqPzzz",
    thumbnailSeed: "open-house-recap",
    reach: 4960,
    erBase: 0.054,
  },
  {
    id: "tt_8aa12",
    platform: "tiktok",
    daysAgo: 23,
    caption:
      "Inside a $2M Moorestown listing in 60 seconds — the closet alone…",
    hashtags: ["#luxurytour", "#moorestownnj"],
    media_type: "video",
    permalinkSlug: "7319441290380129383",
    thumbnailSeed: "luxury-closet",
    property: PROPERTIES[4],
    reach: 64200,
    erBase: 0.034,
  },
  {
    id: "ig_3f608",
    platform: "instagram",
    daysAgo: 25,
    caption:
      "5 things I'd never do as a NJ buyer in 2026. (Number 3 surprises everyone.)",
    hashtags: ["#buyertips", "#nj"],
    media_type: "carousel",
    permalinkSlug: "C9mHsrePppp",
    thumbnailSeed: "buyer-tips-2",
    reach: 7820,
    erBase: 0.116,
    audience: STANDARD_AUDIENCE,
  },
  {
    id: "fb_19372",
    platform: "facebook",
    daysAgo: 26,
    caption:
      "Voorhees lake-view home — under contract in 4 days. Inventory on the lake side moves fast every spring.",
    hashtags: ["#voorheesnj", "#undercontract"],
    media_type: "image",
    permalinkSlug: "alliancesocial/posts/193722",
    thumbnailSeed: "lake-house",
    property: PROPERTIES[1],
    reach: 2640,
    erBase: 0.063,
  },
  {
    id: "ig_3f622",
    platform: "instagram",
    daysAgo: 28,
    caption:
      "When the inspection comes back rough — three options the buyer rep should walk you through.",
    hashtags: ["#homeinspection", "#buyertips"],
    media_type: "image",
    permalinkSlug: "C9kPaqcPqqq",
    thumbnailSeed: "inspection",
    reach: 6310,
    erBase: 0.078,
  },
  {
    id: "tt_8aa45",
    platform: "tiktok",
    daysAgo: 30,
    caption:
      "Four neighborhoods in South Jersey under $500K (and worth the drive) 🚗",
    hashtags: ["#southjersey", "#firsttimebuyer", "#njrealtor"],
    media_type: "video",
    permalinkSlug: "7318887341290038129",
    thumbnailSeed: "neighborhoods",
    reach: 38900,
    erBase: 0.049,
  },
];

function platformPermalink(platform: Platform, slug: string): string {
  switch (platform) {
    case "instagram":
      return `https://www.instagram.com/p/${slug}/`;
    case "facebook":
      return `https://www.facebook.com/${slug}`;
    case "tiktok":
      return `https://www.tiktok.com/@c21alliance/video/${slug}`;
  }
}

function buildMetrics(seed: PostSeed, rngSeed: number): PostMetrics {
  const rand = mulberry32(rngSeed);
  const impressions = Math.round(seed.reach * (1.15 + rand() * 0.45));
  const engagementRate = seed.erBase * (0.85 + rand() * 0.3);
  const totalEngagements = Math.round(seed.reach * engagementRate);
  // Distribute engagements across types — varies by platform
  const isVideo = seed.media_type === "video";
  const distribution = {
    facebook: { likes: 0.55, comments: 0.18, shares: 0.18, saves: 0.09 },
    instagram: { likes: 0.66, comments: 0.1, shares: 0.08, saves: 0.16 },
    tiktok: { likes: 0.74, comments: 0.12, shares: 0.1, saves: 0.04 },
  }[seed.platform];

  const likes = Math.round(totalEngagements * distribution.likes);
  const comments = Math.round(totalEngagements * distribution.comments);
  const shares = Math.round(totalEngagements * distribution.shares);
  const saves = Math.round(totalEngagements * distribution.saves);

  const metrics: PostMetrics = {
    impressions,
    reach: seed.reach,
    likes,
    comments,
    shares,
    saves,
    engagement_rate: engagementRate,
  };

  if (isVideo) {
    metrics.plays = Math.round(impressions * (1.3 + rand() * 0.6));
    metrics.avg_watch_time_sec = Math.round(8 + rand() * 22);
    metrics.completion_rate = 0.18 + rand() * 0.32;
  }

  if (seed.platform === "instagram" || seed.platform === "facebook") {
    metrics.profile_visits = Math.round(seed.reach * (0.012 + rand() * 0.02));
    metrics.follows = Math.round((metrics.profile_visits ?? 0) * (0.06 + rand() * 0.08));
  }

  if (seed.property) {
    metrics.link_clicks = Math.round(seed.reach * (0.008 + rand() * 0.014));
  }

  return metrics;
}

function placeholderThumb(seed: string, platform: Platform): string {
  // Stable, public placeholder service. We use plain <img> tags so no
  // next.config image domain entry is required. Real ingestion will replace
  // these with platform-hosted CDN URLs.
  const seedSlug = `${platform}-${seed}`;
  return `https://picsum.photos/seed/${encodeURIComponent(seedSlug)}/600/600`;
}

export const POSTS: Post[] = SEEDS.map((seed, idx) => {
  const rngSeed = 1000 + idx * 37;
  const metrics = buildMetrics(seed, rngSeed);
  const daily = buildDailySeries(rngSeed + 1, seed.reach, seed.daysAgo);
  return {
    id: seed.id,
    platform: seed.platform,
    permalink: platformPermalink(seed.platform, seed.permalinkSlug),
    posted_at: isoDaysAgo(seed.daysAgo),
    media_type: seed.media_type,
    thumbnail_url: placeholderThumb(seed.thumbnailSeed, seed.platform),
    caption: seed.caption,
    hashtags: seed.hashtags,
    property: seed.property,
    metrics,
    daily,
    audience: seed.audience,
  };
});

export const ACCOUNT_HEALTH: AccountHealth[] = [
  {
    platform: "facebook",
    status: "connected",
    last_synced_at: isoDaysAgo(0, new Date(NOW.getTime() - 47 * 60 * 1000)),
    posts_last_30d: POSTS.filter((p) => p.platform === "facebook").length,
  },
  {
    platform: "instagram",
    status: "connected",
    last_synced_at: isoDaysAgo(0, new Date(NOW.getTime() - 23 * 60 * 1000)),
    posts_last_30d: POSTS.filter((p) => p.platform === "instagram").length,
  },
  {
    platform: "tiktok",
    status: "connected",
    last_synced_at: isoDaysAgo(0, new Date(NOW.getTime() - 71 * 60 * 1000)),
    posts_last_30d: POSTS.filter((p) => p.platform === "tiktok").length,
  },
];

/** Aggregate the last N days of posts into top-line KPIs for the dashboard strip. */
export function aggregateKpis(
  posts: Post[],
  windowDays: number,
  now: Date = NOW,
): {
  reach: number;
  engagements: number;
  engagementRate: number;
  postCount: number;
} {
  const cutoff = now.getTime() - windowDays * 86400_000;
  const window = posts.filter((p) => new Date(p.posted_at).getTime() >= cutoff);
  const reach = window.reduce((sum, p) => sum + p.metrics.reach, 0);
  const engagements = window.reduce(
    (sum, p) =>
      sum +
      p.metrics.likes +
      p.metrics.comments +
      p.metrics.shares +
      p.metrics.saves,
    0,
  );
  const engagementRate = reach > 0 ? engagements / reach : 0;
  return {
    reach,
    engagements,
    engagementRate,
    postCount: window.length,
  };
}

export function findPost(id: string): Post | undefined {
  return POSTS.find((p) => p.id === id);
}

/** All distinct properties referenced by the post fixture. */
export const PROPERTIES_BY_MLS: Record<string, PropertyRef> = Object.fromEntries(
  PROPERTIES.map((p) => [p.mls, p]),
);

/** Look up a property's full record (address, list price) by MLS number. */
export function findProperty(mls: string): PropertyRef | undefined {
  return PROPERTIES_BY_MLS[mls];
}

/** All posts attached to a given MLS#. */
export function postsForMls(mls: string): Post[] {
  return POSTS.filter((p) => p.property?.mls === mls);
}
