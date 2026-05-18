/**
 * Shared parsers for ingestion functions.
 * - Hashtag extraction from captions
 * - Engagement-rate computation
 * - Audience-slice normalization (each platform returns a different shape)
 */
import type {
  AudienceSlice,
  NormalizedMetrics,
  NormalizedAudience,
} from "./types.ts";

const HASHTAG_REGEX = /#([\p{L}\p{N}_]+)/gu;

export function extractHashtags(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const matches: string[] = [];
  for (const m of caption.matchAll(HASHTAG_REGEX)) {
    matches.push(`#${m[1].toLowerCase()}`);
  }
  // Deduplicate while preserving order
  return Array.from(new Set(matches));
}

export function computeEngagementRate(
  metrics: NormalizedMetrics,
): number | undefined {
  const reach = metrics.reach ?? metrics.impressions;
  if (!reach || reach <= 0) return undefined;
  // why: matches Meta Business Suite's "Engagement" definition for FB Reels
  // (reactions + comments + shares + clicks). IG/TT don't populate link_clicks
  // so this is a no-op there. See lib/data/post-detail.ts for the matching
  // app-side computation; both must stay in sync.
  const engagements =
    (metrics.likes ?? 0) +
    (metrics.comments ?? 0) +
    (metrics.shares ?? 0) +
    (metrics.saves ?? 0) +
    (metrics.link_clicks ?? 0);
  if (engagements === 0) return 0;
  return Math.round((engagements / reach) * 10000) / 10000;
}

/**
 * Normalize a key→count map (e.g. {"US/NJ/Cherry Hill": 1240, …}) into
 * AudienceSlice[] sorted by share descending. Returns at most `limit` slices.
 */
export function normalizeAudienceMap(
  map: Record<string, number> | undefined,
  limit = 10,
): AudienceSlice[] {
  if (!map) return [];
  const entries = Object.entries(map);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total <= 0) return [];
  return entries
    .map(([label, n]) => ({
      label,
      share: Math.round((n / total) * 10000) / 10000,
    }))
    .sort((a, b) => b.share - a.share)
    .slice(0, limit);
}

/**
 * Build the NormalizedAudience from individual platform-specific maps.
 * Each platform's sync function calls this with whatever it managed to pull.
 */
export function buildAudience(parts: {
  top_locations?: Record<string, number>;
  age_buckets?: Record<string, number>;
  gender_split?: Record<string, number>;
}): NormalizedAudience {
  const out: NormalizedAudience = {};
  const locs = normalizeAudienceMap(parts.top_locations, 8);
  const ages = normalizeAudienceMap(parts.age_buckets, 8);
  const gend = normalizeAudienceMap(parts.gender_split, 4);
  if (locs.length > 0) out.top_locations = locs;
  if (ages.length > 0) out.age_buckets = ages;
  if (gend.length > 0) out.gender_split = gend;
  return out;
}
