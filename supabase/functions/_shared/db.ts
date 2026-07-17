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
 * Match a post caption to one or more properties by parsing for MLS-hashtag
 * tokens. Supports the three MLS feed conventions Alliance ingests today:
 *
 *   - Bright:  raw NJxx####### token (matches properties.mls_number directly)
 *   - CMC:     #?CMC###### → properties.source_mls='cmc' + mls_number=digits
 *   - SJSR:    #?SJSR###### → properties.source_mls='sjsr' + mls_number=digits
 *
 * Returns an array of (property_id, match) tuples in order of first appearance
 * in the caption. The FIRST entry is the natural "anchor" — that property
 * goes on `posts.property_id` for backward compat. Every match goes into
 * `post_listings` so multi-property carousels (e.g. multi-OH events) appear
 * in every featured listing's Owner Story.
 *
 * 2026-05-21 — extended from single-Bright matching to multi-feed
 * multi-match. Mirrors the TS auto-linker library (lib/linker/auto-linker.ts)
 * and the SQL run_auto_linker() function, but lives here so the per-post
 * ingest path can populate post_listings inline (the SQL function only
 * runs after RETS sync, every ~4h).
 */
const BRIGHT_RE_G = /\bNJ[A-Z]{2}\d{5,8}\b/gi;
const CMC_RE_G = /(?:^|[^A-Za-z0-9_])#?CMC(\d{4,8})\b/gi;
const SJSR_RE_G = /(?:^|[^A-Za-z0-9_])#?SJSR(\d{4,8})\b/gi;

interface PropertyMatch {
  property_id: string;
  mls_number: string;
  source_mls: "bright" | "cmc" | "sjsr";
}

export async function autoLinkAllProperties(
  client: SupabaseClient,
  caption: string | null,
): Promise<PropertyMatch[]> {
  if (!caption) return [];

  // Extract every canonical MLS token from the caption, dedup, preserve
  // first-appearance order.
  const tokens: Array<{ key: string; source: "bright" | "cmc" | "sjsr"; mls: string }> = [];
  const seen = new Set<string>();
  const add = (key: string, source: "bright" | "cmc" | "sjsr", mls: string): void => {
    const canonical = key.toUpperCase();
    if (seen.has(canonical)) return;
    seen.add(canonical);
    tokens.push({ key: canonical, source, mls });
  };

  for (const match of caption.matchAll(BRIGHT_RE_G)) {
    add(match[0], "bright", match[0].toUpperCase());
  }
  for (const match of caption.matchAll(CMC_RE_G)) {
    add(`CMC${match[1]}`, "cmc", match[1]);
  }
  for (const match of caption.matchAll(SJSR_RE_G)) {
    add(`SJSR${match[1]}`, "sjsr", match[1]);
  }

  if (tokens.length === 0) return [];

  // Resolve each token to a properties row. Single query batched per feed —
  // Postgres can handle 9+ ids per .in() comfortably.
  const out: PropertyMatch[] = [];

  const brightMlsList = tokens.filter((t) => t.source === "bright").map((t) => t.mls);
  if (brightMlsList.length > 0) {
    const { data } = await client
      .from("properties")
      .select("id, mls_number")
      .in("mls_number", brightMlsList);
    if (data) {
      // why: preserve token order in the output. Lookup map then iterate
      // tokens so the anchor (token[0]) lands at out[0].
      const byMls = new Map(data.map((r) => [r.mls_number.toUpperCase(), r.id]));
      for (const t of tokens) {
        if (t.source !== "bright") continue;
        const pid = byMls.get(t.mls.toUpperCase());
        if (pid) out.push({ property_id: pid, mls_number: t.mls, source_mls: "bright" });
      }
    }
  }

  const cmcMlsList = tokens.filter((t) => t.source === "cmc").map((t) => t.mls);
  if (cmcMlsList.length > 0) {
    const { data } = await client
      .from("properties")
      .select("id, mls_number")
      .eq("source_mls", "cmc")
      .in("mls_number", cmcMlsList);
    if (data) {
      const byMls = new Map(data.map((r) => [r.mls_number, r.id]));
      for (const t of tokens) {
        if (t.source !== "cmc") continue;
        const pid = byMls.get(t.mls);
        if (pid) out.push({ property_id: pid, mls_number: t.mls, source_mls: "cmc" });
      }
    }
  }

  const sjsrMlsList = tokens.filter((t) => t.source === "sjsr").map((t) => t.mls);
  if (sjsrMlsList.length > 0) {
    const { data } = await client
      .from("properties")
      .select("id, mls_number")
      .eq("source_mls", "sjsr")
      .in("mls_number", sjsrMlsList);
    if (data) {
      const byMls = new Map(data.map((r) => [r.mls_number, r.id]));
      for (const t of tokens) {
        if (t.source !== "sjsr") continue;
        const pid = byMls.get(t.mls);
        if (pid) out.push({ property_id: pid, mls_number: t.mls, source_mls: "sjsr" });
      }
    }
  }

  return out;
}

/**
 * Backward-compat shim — returns just the FIRST match's property_id. Used
 * by callers that only need the primary anchor (e.g. for posts.property_id
 * which is still single-FK). For the full multi-match list, call
 * `autoLinkAllProperties` directly.
 */
export async function autoLinkProperty(
  client: SupabaseClient,
  caption: string | null,
): Promise<string | null> {
  const matches = await autoLinkAllProperties(client, caption);
  return matches[0]?.property_id ?? null;
}

/**
 * After a post is upserted, sync the post_listings join table to reflect
 * the post's current set of MLS matches. Idempotent:
 *
 *   - The PRIMARY row (matches posts.property_id) is upserted with
 *     is_primary=true via a two-step write (try insert, then update on
 *     conflict). The post_listings PK is (post_id, property_id) so the
 *     existing migration backfill + previous runs are correctly merged.
 *   - All ADDITIONAL MLS matches get inserted with is_primary=false,
 *     ON CONFLICT DO NOTHING.
 *
 * Defensive — failures here are logged but don't throw, so a post_listings
 * write hiccup never blocks the parent post upsert.
 */
async function syncPostListings(
  client: SupabaseClient,
  postId: string,
  matches: PropertyMatch[],
  primaryPropertyId: string | null,
): Promise<void> {
  if (matches.length === 0) return;

  // Build the rows. The match whose property_id matches primaryPropertyId
  // gets is_primary=true. If primaryPropertyId is null (shouldn't happen
  // when matches.length > 0, since we set posts.property_id = matches[0])
  // we still mark matches[0] as primary defensively.
  const primaryId = primaryPropertyId ?? matches[0].property_id;
  const rows = matches.map((m) => ({
    post_id: postId,
    property_id: m.property_id,
    link_method: "auto_mls" as const,
    is_primary: m.property_id === primaryId,
  }));

  // Insert with ON CONFLICT DO NOTHING — first time a (post_id, property_id)
  // pair is inserted, it sticks. Re-syncs are no-ops.
  const { error } = await client
    .from("post_listings")
    .upsert(rows, { onConflict: "post_id,property_id", ignoreDuplicates: true });
  if (error) {
    console.warn("[_shared/db] syncPostListings upsert failed:", error.message);
  }
}

/**
 * Caption-independent fallback linker. Open House posts deliberately omit MLS#
 * hashtags (IG hashtag limits), so caption matching returns nothing for them.
 * When that happens, resolve the post back to the `generated_posts` row that
 * produced it (matched by platform_post_id) and use the properties the builder
 * recorded there: `linked_property_ids` (multi-OH carousels) or, failing that,
 * the single `property_id`. Returns [] on any miss so ingest is never blocked.
 */
async function resolveBuilderMatches(
  client: SupabaseClient,
  platform: string,
  platformPostId: string | null,
  permalink: string | null,
): Promise<{ matches: PropertyMatch[]; postType: string | null }> {
  if (!platformPostId && !permalink) return { matches: [], postType: null };
  try {
    // Permalink is the reliable join key: it's identical on both sides (the
    // publish step and the sync both read it from the platform). The
    // platform_post_id stored at publish doesn't reliably match the id the
    // sync ingests (e.g. IG container vs media id), so it's only a fallback.
    let gp:
      | {
          property_id: string | null;
          linked_property_ids: unknown;
          post_type: string | null;
        }
      | null = null;
    if (permalink) {
      const { data } = await client
        .from("generated_posts")
        .select("property_id, linked_property_ids, post_type")
        .eq(`platform_permalinks->>${platform}`, permalink)
        .maybeSingle();
      gp = data ?? null;
    }
    if (!gp && platformPostId) {
      const { data } = await client
        .from("generated_posts")
        .select("property_id, linked_property_ids, post_type")
        .eq(`platform_post_ids->>${platform}`, platformPostId)
        .maybeSingle();
      gp = data ?? null;
    }
    if (!gp) return { matches: [], postType: null };
    const postType = typeof gp.post_type === "string" ? gp.post_type : null;

    const ids: string[] = [];
    if (Array.isArray(gp.linked_property_ids)) {
      for (const id of gp.linked_property_ids) {
        if (typeof id === "string" && id.length > 0) ids.push(id);
      }
    }
    if (ids.length === 0 && typeof gp.property_id === "string" && gp.property_id) {
      ids.push(gp.property_id);
    }
    if (ids.length === 0) return { matches: [], postType };

    const { data: props } = await client
      .from("properties")
      .select("id, mls_number, source_mls")
      .in("id", ids);
    const byId = new Map((props ?? []).map((r) => [r.id, r]));

    const out: PropertyMatch[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) continue;
      const src =
        p.source_mls === "bright" || p.source_mls === "cmc" || p.source_mls === "sjsr"
          ? p.source_mls
          : "cmc";
      out.push({ property_id: id, mls_number: p.mls_number ?? "", source_mls: src });
    }
    return { matches: out, postType };
  } catch (e) {
    console.warn(
      "[_shared/db] resolveBuilderMatches failed:",
      (e as Error).message,
    );
    return { matches: [], postType: null };
  }
}

/**
 * Upsert a post + its latest metrics snapshot + a post_metrics_daily row.
 * Returns whether the row was newly inserted vs updated.
 */
export async function upsertPost(
  client: SupabaseClient,
  post: NormalizedPost,
): Promise<{ inserted: boolean; updated: boolean; post_id: string | null }> {
  // why: multi-match — autoLinkAllProperties returns every MLS hit in
  // caption order; matches[0] is the anchor that lands on posts.property_id
  // for backward compat, every match feeds the post_listings join table.
  let matches = await autoLinkAllProperties(client, post.caption);
  // why: track the originating builder post_type so we can auto-classify the
  // synced post's category (e.g. an Open House carousel → category
  // "open_house", surfaced in the tracker as "Open House Promotion"). Only
  // set from the builder fallback path — caption-linked posts keep whatever
  // category the grouper/editor assigns.
  let builderPostType: string | null = null;
  // Caption had no MLS (e.g. an Open House post) — fall back to the builder's
  // recorded property selection so the post still links to its home(s).
  if (matches.length === 0) {
    const builder = await resolveBuilderMatches(
      client,
      post.platform,
      post.platform_post_id,
      post.permalink,
    );
    if (builder.matches.length > 0) {
      matches = builder.matches;
      builderPostType = builder.postType;
    }
  }
  const propertyId = matches[0]?.property_id ?? null;
  // Map the builder post_type onto the tracker's category vocabulary.
  // 2026-07-17 — taxonomy collapsed to a binary (Property Promotion /
  // Other): ANY promotional builder type is, by definition, tied to a
  // listing → "property". Anything unrecognized stays null and the hourly
  // run_auto_classifier settles it from linkage. Fill-blanks-only.
  const autoCategory: string | null =
    builderPostType === "open_house" ||
    builderPostType === "just_sold" ||
    builderPostType === "just_listed" ||
    builderPostType === "price_reduction"
      ? "property"
      : null;

  // Check existence by (platform, platform_post_id). Pull the current category
  // so we NEVER clobber a value a human already set in the tracker — auto
  // classification only fills a blank.
  const { data: existing } = await client
    .from("posts")
    .select("id, category")
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
  // Auto-classify Open House posts. Fill only when we have a category AND the
  // existing row has none — a human-set category (or a later grouper cascade)
  // is always preserved. On first insert `existing` is null, so the auto value
  // seeds the row.
  const existingCategory = (existing as { category?: string | null } | null)
    ?.category;
  if (autoCategory && !existingCategory) {
    row.category = autoCategory;
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

  // 2026-05-21 — sync the post_listings join table so multi-property
  // carousel posts (e.g. multi-OH events) appear in every featured
  // listing's Owner Story. Defensive — failures here are logged but
  // don't throw, so post_listings hiccups don't block ingest.
  if (postId && matches.length > 0) {
    await syncPostListings(client, postId, matches, propertyId);
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
