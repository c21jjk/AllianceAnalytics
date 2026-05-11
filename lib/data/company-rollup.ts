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
 */
export interface CompanyRollup {
  followers: {
    facebook: number | null;
    instagram: number | null;
    tiktok: number | null;
    total: number;
  };
  /** Total posts published across all properties in the last 30 days */
  posts_30d: number;
  /** Sum of reach across those posts */
  reach_30d: number;
  /** Count of properties where status = 'active' */
  active_listings: number;
  /** ISO timestamp when these numbers were computed */
  captured_at: string;
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
  return {
    followers: {
      facebook: null,
      instagram: null,
      tiktok: null,
      total: 0,
    },
    posts_30d: 0,
    reach_30d: 0,
    active_listings: 0,
    captured_at: new Date().toISOString(),
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

async function loadPosts30d(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ posts_30d: number; reach_30d: number }> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("posts")
      .select("metrics, posted_at")
      .gte("posted_at", cutoff);
    if (error || !data) return { posts_30d: 0, reach_30d: 0 };

    let reach = 0;
    for (const row of data) {
      const m = (row.metrics ?? {}) as Record<string, unknown>;
      reach += readNum(m.reach) || readNum(m.impressions);
    }
    return { posts_30d: data.length, reach_30d: reach };
  } catch {
    return { posts_30d: 0, reach_30d: 0 };
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
    const [followers, posts30d, activeListings] = await Promise.all([
      loadLatestFollowers(supabase),
      loadPosts30d(supabase),
      loadActiveListings(supabase),
    ]);

    return {
      followers,
      posts_30d: posts30d.posts_30d,
      reach_30d: posts30d.reach_30d,
      active_listings: activeListings,
      captured_at: new Date().toISOString(),
    };
  } catch {
    return emptyRollup();
  }
}
