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

export async function syncAll(): Promise<EdgeFunctionResult[]> {
  await requireAdmin();
  // Sequential to spread API quota burn — also helps with debugging
  const results: EdgeFunctionResult[] = [];
  for (const p of ["instagram", "facebook", "tiktok"] as Platform[]) {
    try {
      results.push(await invokeSync(p));
    } catch (e) {
      results.push({
        platform: p,
        ok: false,
        inserted: 0,
        updated: 0,
        errors: [{ message: (e as Error).message }],
        duration_ms: 0,
      });
    }
  }
  revalidatePath("/", "layout");
  return results;
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
