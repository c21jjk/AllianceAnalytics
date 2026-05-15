import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Company-wide rollup numbers used in the seller-facing report's
 * "Alliance Marketing Engine" section.
 *
 * Goals:
 *   - Always answer (never throw). If something goes wrong we degrade
 *     to zeros — the section just looks understated instead of crashing
 *     a public seller URL.
 *   - Read-only. We never write anything from here.
 *
 * Numbers are computed at request time. The route renders with
 * `force-dynamic`, so each report load picks up the latest cron-synced
 * follower/post counts.
 *
 * Two windows are returned: 30d (recent momentum) and trailing-365d
 * (full year's body of work). Sellers see them side-by-side in the
 * Marketing Engine section.
 */
export interface CompanyRollup {
  followers: {
    facebook: number | null;
    instagram: number | null;
    tiktok: number | null;
    /** Sum across the three platforms — surfaced as "Audience" on the listing report. */
    total: number;
  };
  /** Rolling 30-day window — short-term momentum. */
  window_30d: WindowStats;
  /** Rolling 90-day window — Phase 7.5 baseline for the auto-pick comparison. */
  window_90d: WindowStats;
  /** Trailing 365-day window — full year of work behind every listing. */
  window_365d: WindowStats;
  /** Count of properties where status = 'active'. Same in either window. */
  active_listings: number;
  /** ISO timestamp when these numbers were computed. */
  captured_at: string;

  // --- Back-compat aliases (legacy callers reading the flat shape) ---
  /** @deprecated use `window_30d.posts` */
  posts_30d: number;
  /** @deprecated use `window_30d.reach` */
  reach_30d: number;
}

export interface WindowStats {
  /** Number of posts published in this window across all properties. */
  posts: number;
  /** Sum of post-level reach in this window. */
  reach: number;
}

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function emptyRollup(): CompanyRollup {
  const empty: WindowStats = { posts: 0, reach: 0 };
  return {
    followers: {
      facebook: null,
      instagram: null,
      tiktok: null,
      total: 0,
    },
    window_30d: empty,
    window_90d: empty,
    window_365d: empty,
    active_listings: 0,
    captured_at: new Date().toISOString(),
    posts_30d: 0,
    reach_30d: 0,
  };
}

async function loadLatestFollowers(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<CompanyRollup["followers"]> {
  const result: CompanyRollup["followers"] = {
    facebook: null,
    instagram: null,
    tiktok: null,
    total: 0,
  };

  const platforms: Array<keyof Omit<CompanyRollup["followers"], "total">> = [
    "facebook",
    "instagram",
    "tiktok",
  ];

  await Promise.all(
    platforms.map(async (platform) => {
      try {
        const { data, error } = await supabase
          .from("platform_followers")
          .select("follower_count, captured_date")
          .eq("platform", platform)
          .order("captured_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error || !data) return;
        const n = readNum(data.follower_count);
        if (n > 0) result[platform] = n;
      } catch {
        // graceful degrade
      }
    }),
  );

  result.total =
    (result.facebook ?? 0) + (result.instagram ?? 0) + (result.tiktok ?? 0);
  return result;
}

/**
 * Load posts within both windows in a single query, then bucket in JS. One
 * round-trip beats two; the data set is small (a few hundred rows over a
 * full year for one brokerage).
 */
async function loadPostWindows(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{
  window_30d: WindowStats;
  window_90d: WindowStats;
  window_365d: WindowStats;
}> {
  try {
    const now = Date.now();
    const cutoff30Ms = now - 30 * 86_400_000;
    const cutoff90Ms = now - 90 * 86_400_000;
    const cutoff365Iso = new Date(now - 365 * 86_400_000).toISOString();

    const { data, error } = await supabase
      .from("posts")
      .select("metrics, posted_at")
      .gte("posted_at", cutoff365Iso);
    if (error || !data) {
      const empty: WindowStats = { posts: 0, reach: 0 };
      return { window_30d: empty, window_90d: empty, window_365d: empty };
    }

    let posts30 = 0;
    let reach30 = 0;
    let posts90 = 0;
    let reach90 = 0;
    let posts365 = 0;
    let reach365 = 0;

    for (const row of data) {
      const m = (row.metrics ?? {}) as Record<string, unknown>;
      const reach = readNum(m.reach) || readNum(m.impressions);
      posts365 += 1;
      reach365 += reach;
      const t = row.posted_at ? new Date(row.posted_at).getTime() : 0;
      if (t >= cutoff90Ms) {
        posts90 += 1;
        reach90 += reach;
      }
      if (t >= cutoff30Ms) {
        posts30 += 1;
        reach30 += reach;
      }
    }

    return {
      window_30d: { posts: posts30, reach: reach30 },
      window_90d: { posts: posts90, reach: reach90 },
      window_365d: { posts: posts365, reach: reach365 },
    };
  } catch {
    const empty: WindowStats = { posts: 0, reach: 0 };
    return { window_30d: empty, window_90d: empty, window_365d: empty };
  }
}

async function loadActiveListings(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch the company-wide rollup used on the seller-facing report's
 * "Alliance Marketing Engine" section. Never throws — degrades to zeros.
 */
export async function fetchCompanyRollup(): Promise<CompanyRollup> {
  try {
    const supabase = createAdminClient();
    const [followers, windows, activeListings] = await Promise.all([
      loadLatestFollowers(supabase),
      loadPostWindows(supabase),
      loadActiveListings(supabase),
    ]);

    return {
      followers,
      window_30d: windows.window_30d,
      window_90d: windows.window_90d,
      window_365d: windows.window_365d,
      active_listings: activeListings,
      captured_at: new Date().toISOString(),
      posts_30d: windows.window_30d.posts,
      reach_30d: windows.window_30d.reach,
    };
  } catch {
    return emptyRollup();
  }
}
