"use server";

/**
 * Admin-only backfill: walk posts where thumbnail_cached_at IS NULL AND
 * thumbnail_url IS NOT NULL, download each thumbnail to Supabase Storage,
 * and rewrite the row to point at the durable Storage URL.
 *
 * Designed for one-batch-per-click invocation from the Settings page — the
 * UI surfaces remaining count and the admin clicks again to continue.
 * Never throws; returns ok:false + error on any unexpected failure so the
 * caller can show a friendly message.
 */
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  cacheThumbnailToStorage,
  type CachePlatform,
} from "@/lib/storage/thumbnail-cache";

export interface BackfillThumbnailCacheResult {
  ok: boolean;
  processed: number;
  cached: number;
  failed: number;
  remaining: number;
  error?: string;
}

export async function backfillThumbnailCacheAction(args: {
  limit?: number;
}): Promise<BackfillThumbnailCacheResult> {
  try {
    await requireAdmin();
  } catch (e) {
    return {
      ok: false,
      processed: 0,
      cached: 0,
      failed: 0,
      remaining: 0,
      error: `Not authorized: ${(e as Error).message}`,
    };
  }

  const limit = Math.max(1, Math.min(500, args.limit ?? 100));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      processed: 0,
      cached: 0,
      failed: 0,
      remaining: 0,
      error:
        "Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    };
  }

  const admin = createAdminClient();

  const { data: rows, error: readErr } = await admin
    .from("posts")
    .select("id, platform, platform_post_id, thumbnail_url")
    .is("thumbnail_cached_at", null)
    .not("thumbnail_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (readErr) {
    return {
      ok: false,
      processed: 0,
      cached: 0,
      failed: 0,
      remaining: 0,
      error: `Read failed: ${readErr.message}`,
    };
  }

  let cached = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const platform = row.platform as CachePlatform | string | null;
    if (
      !row.thumbnail_url ||
      !row.platform_post_id ||
      (platform !== "facebook" &&
        platform !== "instagram" &&
        platform !== "tiktok")
    ) {
      failed++;
      continue;
    }

    const result = await cacheThumbnailToStorage({
      supabaseUrl,
      serviceRoleKey,
      sourceUrl: row.thumbnail_url,
      platform: platform,
      postId: row.platform_post_id,
    });

    if (result.cachedUrl && result.cachedAt) {
      const { error: updErr } = await admin
        .from("posts")
        .update({
          thumbnail_url: result.cachedUrl,
          thumbnail_cached_at: result.cachedAt,
        })
        .eq("id", row.id);
      if (updErr) {
        console.warn(
          `backfillThumbnailCacheAction: row ${row.id} update failed: ${updErr.message}`,
        );
        failed++;
      } else {
        cached++;
      }
    } else {
      failed++;
    }
  }

  // Recount remaining for the UI's "X remaining" hint.
  const { count: remaining } = await admin
    .from("posts")
    .select("id", { count: "exact", head: true })
    .is("thumbnail_cached_at", null)
    .not("thumbnail_url", "is", null);

  revalidatePath("/settings");

  return {
    ok: true,
    processed: rows?.length ?? 0,
    cached,
    failed,
    remaining: remaining ?? 0,
  };
}

/**
 * Quick read for the Settings page: how many posts still need caching.
 * Server-side only (admin-gated indirectly via the page itself).
 */
export async function getUncachedThumbnailCount(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("posts")
    .select("id", { count: "exact", head: true })
    .is("thumbnail_cached_at", null)
    .not("thumbnail_url", "is", null);
  return count ?? 0;
}
