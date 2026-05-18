"use server";

import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { Platform } from "@/lib/types/post";

interface EdgeFunctionResult {
  platform: Platform;
  ok: boolean;
  inserted: number;
  updated: number;
  errors: { message: string; post_id?: string }[];
  duration_ms: number;
}

/**
 * Result shape returned by mls-rets-sync per feed. Mirrors what the Edge
 * Function emits so the dashboard can show per-class record counts.
 */
export interface MlsSyncResult {
  feed_short_code: "cmc" | "sjsr";
  feed_name: string;
  ok: boolean;
  duration_ms: number;
  classes: { class: string; records_seen: number; records_upserted: number; error?: string }[];
  errors: { message: string }[];
  photos_uploaded?: number;
  /** Convenience total — sum of records_upserted across all classes. */
  total_upserted: number;
}

/**
 * Server actions that invoke the platform sync Edge Functions.
 *
 * Wired up to:
 *   - SyncNowButton component on the dashboard (admin-only)
 *   - "Run first sync" CTA in the empty state on /posts
 *
 * Each action calls the corresponding Supabase Edge Function via the project
 * URL + service role key (env vars on Vercel). The function does the heavy
 * lifting (Graph API call, normalize, upsert into posts + post_metrics_daily).
 *
 * Only admins can invoke. Per project rule, the cron schedule still runs
 * daily regardless — these are "I want to refresh now" buttons.
 */

const FUNCTION_NAMES: Record<Platform, string> = {
  instagram: "ig-sync",
  facebook: "fb-sync",
  tiktok: "tt-sync",
};

async function invokeSync(
  platform: Platform,
): Promise<EdgeFunctionResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars not set on Vercel",
    );
  }
  const fnUrl = `${url}/functions/v1/${FUNCTION_NAMES[platform]}`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({}),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${platform} sync HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json() as EdgeFunctionResult;
}

export async function syncOne(
  platform: Platform,
): Promise<EdgeFunctionResult> {
  await requireAdmin();
  const result = await invokeSync(platform);
  revalidatePath("/", "layout");
  return result;
}

/**
 * Invoke the MLS RETS sync for a single feed (CMC or SJSR for now; Bright
 * slots in later). Public counterpart to the private invokeMlsSync helper —
 * the dashboard SyncPanel calls this once per feed in a sequential loop so
 * each feed's progress + result can render in its own pill.
 *
 * Errors from invokeMlsSync are caught and serialized into the standard
 * MlsSyncResult shape (ok:false + errors[]) so the client can render a
 * useful inline error without a try/catch wrapper at the call site.
 */
export async function syncOneMls(
  feedShortCode: "cmc" | "sjsr",
): Promise<MlsSyncResult> {
  await requireAdmin();
  try {
    const result = await invokeMlsSync(feedShortCode);
    revalidatePath("/", "layout");
    return result;
  } catch (e) {
    return {
      feed_short_code: feedShortCode,
      feed_name: feedShortCode.toUpperCase(),
      ok: false,
      duration_ms: 0,
      classes: [],
      errors: [{ message: (e as Error).message }],
      total_upserted: 0,
    };
  }
}

/**
 * Run the cross-platform grouper RPC. Called by the SyncPanel after a Social
 * batch completes so late arrivals get folded into existing groups (the same
 * post-grouper logic syncAll runs at the end of its batch).
 *
 * Returns null when the RPC errors — surfaced to the UI as "grouper skipped"
 * rather than a fatal sync failure.
 */
export async function runGrouperAction(): Promise<
  { groups_created: number; posts_assigned: number } | null
> {
  await requireAdmin();
  const supabase = createAdminClient();
  try {
    const { data, error } = await supabase.rpc("run_post_grouper");
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as {
      groups_created?: number;
      posts_assigned?: number;
    };
    return {
      groups_created: Number(row.groups_created ?? 0),
      posts_assigned: Number(row.posts_assigned ?? 0),
    };
  } catch (e) {
    console.error("runGrouperAction failed —", e);
    return null;
  }
}

/**
 * Invoke the mls-rets-sync Edge Function for one Paragon feed. Same auth
 * pattern as the social syncs — service-role key, no cron involvement. The
 * function takes ~10-15s per feed (Cape May ≈ 14s end-to-end including
 * photos, SJSR ≈ 10s) so calling both sequentially after the three social
 * syncs adds ~25s to a manual Sync All run.
 */
async function invokeMlsSync(
  feedShortCode: "cmc" | "sjsr",
): Promise<MlsSyncResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars not set on Vercel",
    );
  }
  const fnUrl = `${url}/functions/v1/mls-rets-sync`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ feed_short_code: feedShortCode }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `mls-rets-sync ${feedShortCode} HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const raw = await res.json() as {
    ok?: boolean;
    feed_short_code?: string;
    feed_name?: string;
    duration_ms?: number;
    classes?: { class: string; records_seen: number; records_upserted: number; error?: string }[];
    errors?: { message: string }[];
    photos_uploaded?: number;
  };
  const classes = raw.classes ?? [];
  const total_upserted = classes.reduce(
    (sum, c) => sum + (Number(c.records_upserted) || 0),
    0,
  );
  return {
    feed_short_code: feedShortCode,
    feed_name: raw.feed_name ?? feedShortCode.toUpperCase(),
    ok: Boolean(raw.ok),
    duration_ms: Number(raw.duration_ms) || 0,
    classes,
    errors: raw.errors ?? [],
    photos_uploaded: raw.photos_uploaded,
    total_upserted,
  };
}

export interface SyncAllResult {
  results: EdgeFunctionResult[];
  /** Per-feed MLS sync results (CMC + SJSR). Empty array if neither was run. */
  mls_results: MlsSyncResult[];
  grouper: { groups_created: number; posts_assigned: number } | null;
}

export async function syncAll(): Promise<SyncAllResult> {
  await requireAdmin();
  // Parallel: each platform's sync hits a different upstream API (Meta
  // Graph for FB/IG, TikTok, Paragon RETS for CMC/SJSR) with independent
  // sessions, so there's no shared-resource contention to throttle for.
  // Sequential adds ~110s (FB 30 + IG 30 + TT 30 + CMC 15 + SJSR 10),
  // which used to blow past Vercel's 60s function timeout and surface as
  // "Sync failed: An unexpected response was received from the server."
  // Parallel completes in ~max(durations) ≈ 30s. Promise.allSettled so a
  // single bad platform doesn't cancel the rest.
  const socialPromises = (["instagram", "facebook", "tiktok"] as Platform[]).map(
    async (p): Promise<EdgeFunctionResult> => {
      try {
        return await invokeSync(p);
      } catch (e) {
        return {
          platform: p,
          ok: false,
          inserted: 0,
          updated: 0,
          errors: [{ message: (e as Error).message }],
          duration_ms: 0,
        };
      }
    },
  );

  const mlsPromises = (["cmc", "sjsr"] as const).map(
    async (feed): Promise<MlsSyncResult> => {
      try {
        return await invokeMlsSync(feed);
      } catch (e) {
        return {
          feed_short_code: feed,
          feed_name: feed.toUpperCase(),
          ok: false,
          duration_ms: 0,
          classes: [],
          errors: [{ message: (e as Error).message }],
          total_upserted: 0,
        };
      }
    },
  );

  const [socialSettled, mlsSettled] = await Promise.all([
    Promise.all(socialPromises),
    Promise.all(mlsPromises),
  ]);

  const results: EdgeFunctionResult[] = socialSettled;
  const mls_results: MlsSyncResult[] = mlsSettled;

  // After all syncs complete, fire the cross-platform grouper so late
  // arrivals from this run get folded into existing groups (the patched
  // run_post_grouper has a "merge into existing groups" pass plus the
  // original new-group creation pass).
  let grouper: SyncAllResult["grouper"] = null;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("run_post_grouper");
    if (!error && Array.isArray(data) && data.length > 0) {
      const row = data[0] as { groups_created?: number; posts_assigned?: number };
      grouper = {
        groups_created: Number(row.groups_created ?? 0),
        posts_assigned: Number(row.posts_assigned ?? 0),
      };
    }
  } catch (e) {
    console.error("syncAll: grouper RPC failed —", e);
  }

  revalidatePath("/", "layout");
  return { results, mls_results, grouper };
}

/**
 * Last successful sync timestamps + post counts. Powers the
 * AccountSyncBar's hover tooltips and the "X minutes ago" pills.
 */
export async function getSyncStatus(): Promise<
  Record<Platform, { last_validated_at: string | null; is_active: boolean }>
> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("api_credentials")
    .select("platform, is_active, last_validated_at");

  const out: Record<Platform, { last_validated_at: string | null; is_active: boolean }> = {
    facebook: { last_validated_at: null, is_active: false },
    instagram: { last_validated_at: null, is_active: false },
    tiktok: { last_validated_at: null, is_active: false },
  };
  for (const row of (data ?? []) as { platform: Platform; is_active: boolean; last_validated_at: string | null }[]) {
    out[row.platform] = {
      last_validated_at: row.last_validated_at,
      is_active: row.is_active,
    };
  }
  return out;
}
