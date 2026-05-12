/**
 * Shared Supabase client + DB helpers for ingestion Edge Functions.
 * All callers run with the service role key (set automatically in the Edge
 * Function runtime via SUPABASE_SERVICE_ROLE_KEY env var).
 */
// @ts-expect-error - Deno-resolved import; runs in the Edge Function runtime
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type {
  NormalizedPost,
  Platform,
  PlatformCredentials,
} from "./types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Look up the credential row for a platform.
 * Throws if not found, inactive, or missing required keys.
 */
export async function loadCredentials(
  client: SupabaseClient,
  platform: Platform,
  required: string[],
): Promise<PlatformCredentials> {
  const { data, error } = await client
    .from("api_credentials")
    .select("platform, credentials, is_active, last_validated_at")
    .eq("platform", platform)
    .maybeSingle();

  if (error) throw new Error(`api_credentials read failed: ${error.message}`);
  if (!data) throw new Error(`No api_credentials row for platform=${platform}`);
  if (!data.is_active) throw new Error(`api_credentials for ${platform} is not active`);

  const creds = (data.credentials ?? {}) as Record<string, unknown>;
  const missing = required.filter((k) => !creds[k]);
  if (missing.length > 0) {
    throw new Error(
      `api_credentials for ${platform} missing fields: ${missing.join(", ")}`,
    );
  }

  return data as PlatformCredentials;
}

/**
 * Match a post caption to a property by parsing for an MLS number, then by
 * matching against known property addresses. Returns the property uuid or null.
 *
 * Default regex: NJ MLS numbers in the form NJBL2078123 / NJCD2089034.
 * Falls back to a fuzzy address contains-check.
 */
const NJ_MLS_REGEX = /\b(NJ[A-Z]{2}\d{5,8})\b/i;

export async function autoLinkProperty(
  client: SupabaseClient,
  caption: string | null,
): Promise<string | null> {
  if (!caption) return null;

  // 1) Direct MLS number match
  const m = caption.match(NJ_MLS_REGEX);
  if (m) {
    const mls = m[1].toUpperCase();
    const { data } = await client
      .from("properties")
      .select("id")
      .eq("mls_number", mls)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // 2) Fuzzy address match — caption mentions a known property address
  // Disabled by default for now (false positive risk on common street names).
  // Will be re-enabled with stricter matching after first real-data review.

  return null;
}

/**
 * Upsert a post + its latest metrics snapshot + a post_metrics_daily row.
 * Returns whether the row was newly inserted vs updated.
 */
export async function upsertPost(
  client: SupabaseClient,
  post: NormalizedPost,
): Promise<{ inserted: boolean; updated: boolean; post_id: string | null }> {
  const propertyId = await autoLinkProperty(client, post.caption);

  // Check existence by (platform, platform_post_id)
  const { data: existing } = await client
    .from("posts")
    .select("id")
    .eq("platform", post.platform)
    .eq("platform_post_id", post.platform_post_id)
    .maybeSingle();

  const row: Record<string, unknown> = {
    platform: post.platform,
    platform_post_id: post.platform_post_id,
    property_id: propertyId,
    caption: post.caption,
    media_url: post.media_url,
    thumbnail_url: post.thumbnail_url,
    media_type: post.media_type,
    posted_at: post.posted_at,
    permalink: post.permalink,
    hashtags: post.hashtags,
    audience: post.audience,
    metrics: post.metrics,
    last_synced_at: new Date().toISOString(),
  };
  // Only set thumbnail_cached_at when caching succeeded — otherwise leave
  // the existing column value alone on update, or null on insert.
  if (post.thumbnail_cached_at) {
    row.thumbnail_cached_at = post.thumbnail_cached_at;
  }

  let postId: string | null = null;
  let inserted = false;
  let updated = false;

  if (existing?.id) {
    const { error } = await client
      .from("posts")
      .update(row)
      .eq("id", existing.id);
    if (error) throw new Error(`posts update failed: ${error.message}`);
    postId = existing.id;
    updated = true;
  } else {
    const { data, error } = await client
      .from("posts")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(`posts insert failed: ${error.message}`);
    postId = data.id;
    inserted = true;
  }

  // Daily metrics snapshot (one row per post per UTC date)
  if (postId) {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await client
      .from("post_metrics_daily")
      .upsert(
        {
          post_id: postId,
          captured_date: today,
          captured_at: new Date().toISOString(),
          ...post.metrics,
          raw_payload: post.raw_payload,
        },
        { onConflict: "post_id,captured_date" },
      );
    if (error) {
      throw new Error(`post_metrics_daily upsert failed: ${error.message}`);
    }
  }

  return { inserted, updated, post_id: postId };
}

/**
 * Upsert the follower count snapshot for a given platform/day. Each sync
 * function calls this once at the start of its run with the value pulled
 * from the platform's profile API. PK is (platform, captured_date) so
 * multiple syncs the same day just refresh the count.
 */
export async function recordPlatformFollowers(
  client: SupabaseClient,
  platform: Platform,
  followerCount: number,
  rawPayload?: Record<string, unknown>,
): Promise<void> {
  if (!Number.isFinite(followerCount) || followerCount < 0) return;
  const captured_date = new Date().toISOString().slice(0, 10);
  await client
    .from("platform_followers")
    .upsert(
      {
        platform,
        captured_date,
        follower_count: Math.round(followerCount),
        captured_at: new Date().toISOString(),
        raw_payload: rawPayload ?? {},
      },
      { onConflict: "platform,captured_date" },
    )
    .then(() => undefined, (e) => {
      console.error(`recordPlatformFollowers(${platform}):`, e);
    });
}

/**
 * Run the cross-platform post-grouping SQL function. Each sync calls this
 * after upserting so newly-ingested posts merge into existing campaigns
 * within seconds, instead of waiting for the standalone grouper cron tick
 * (every ~4h). Defensive — logs and swallows any error so a grouping
 * hiccup never blocks a successful sync.
 */
export async function runPostGrouper(
  client: SupabaseClient,
  platform: Platform,
): Promise<void> {
  try {
    const { error } = await client.rpc("run_post_grouper");
    if (error) {
      console.warn(
        `[${platform}-sync] run_post_grouper RPC error: ${error.message}`,
      );
    }
  } catch (e) {
    console.warn(`[${platform}-sync] run_post_grouper threw:`, e);
  }
}

export async function recordSyncRun(
  client: SupabaseClient,
  platform: Platform,
  ok: boolean,
  summary: Record<string, unknown>,
): Promise<void> {
  // Append to api_credentials.last_validated_at + a notification row so the
  // dashboard's "Sync now" button can surface success/failure.
  if (ok) {
    await client
      .from("api_credentials")
      .update({ last_validated_at: new Date().toISOString() })
      .eq("platform", platform);
  }

  // No-op if notifications table absence ever errors — non-fatal.
  await client.from("notifications").insert({
    user_id: null, // System notification; not tied to a single user
    type: ok ? "sync_success" : "sync_failure",
    title: `${platform} sync ${ok ? "succeeded" : "failed"}`,
    message: JSON.stringify(summary).slice(0, 500),
    metadata: summary,
  }).then(() => undefined, () => undefined);
}
