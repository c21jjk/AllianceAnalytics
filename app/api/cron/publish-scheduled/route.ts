/**
 * GET /api/cron/publish-scheduled
 *
 * Phase 5C (2026-05-16) — Scheduled post drain. Runs every 5 minutes on
 * Vercel (see vercel.json crons). Looks for generated_posts rows whose
 * `scheduled_for` jsonb map has at least one platform timestamp at or
 * before NOW(), then publishes each due platform via the existing
 * publish.ts publishers.
 *
 * Note: every-5-min crons are a Vercel Pro tier feature. On Hobby tier,
 * crons are restricted to daily. The schedule string in vercel.json
 * (`*&#47;5 * * * *`) is what the Pro tier respects; lower tiers will
 * still accept the file but will under-fire.
 *
 * Auth model:
 *   • Production / preview — verifies the Authorization header against
 *     CRON_SECRET. Vercel auto-injects this header on every cron tick.
 *   • Development — allowed without auth so `curl localhost:3000/api/cron/...`
 *     is enough to exercise the loop.
 *
 * For each due row:
 *   1. Read fresh state (caption, image_url, additional_images, posted_to,
 *      scheduled_for, platform_post_ids, property_id).
 *   2. For each platform whose ISO is <= NOW(): call the corresponding
 *      publisher, record the platform_post_id on success, log the error
 *      on failure (DO NOT retry within the same tick).
 *   3. After processing, REMOVE successfully-published platform keys from
 *      scheduled_for. Failed keys stay so the next cron tick retries them.
 *   4. If scheduled_for is empty AND status was "scheduled", flip to
 *      "posted" (or back to "draft" if nothing posted successfully).
 *
 * Failure isolation: one failing platform never blocks the others on the
 * same row. One failing row never blocks the other rows in the same tick.
 *
 * Returns a structured summary used by the cron log + future ops dashboard.
 */
import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadMetaCredentials,
  loadTikTokCredentials,
  publishToFBPage,
  publishToIG,
  publishToTikTok,
  type MetaCredentials,
  type TikTokCredentials,
  type PublishResult,
} from "@/lib/post-builder/publish";
import { createOutboxRowForPost } from "@/lib/data/agent-outbox-db";
import type {
  Json,
  Database,
} from "@/lib/supabase/types";
import type {
  LastScheduleError,
  ScheduledFor,
  SchedulablePlatform,
} from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// why: each publish call can take 20-30s (Reels and TT poll loops are
// slowest). With up to a few due rows per 5-min tick, 60s is a safe ceiling
// that keeps the cron tick well under Vercel's 300s function cap.
export const maxDuration = 60;

interface CronRowSummary {
  id: string;
  platforms_processed: SchedulablePlatform[];
  succeeded: SchedulablePlatform[];
  failed: SchedulablePlatform[];
}

interface CronResponseOk {
  ok: true;
  processed: number;
  succeeded: number;
  failed: number;
  details: CronRowSummary[];
}

interface CronResponseErr {
  ok: false;
  error: string;
}

type GeneratedPostRow = Database["public"]["Tables"]["generated_posts"]["Row"];

export async function GET(request: Request): Promise<NextResponse> {
  // ---- auth gate -------------------------------------------------------
  // why: Vercel auto-generates CRON_SECRET when crons are configured and
  // sends `Authorization: Bearer <secret>` on every tick. In dev we let
  // unauthenticated calls through so localhost curl + manual testing
  // works without setting up the env var. Anywhere else, the header must
  // match exactly.
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev) {
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    const got = request.headers.get("authorization") ?? "";
    // why: only reject if CRON_SECRET is set — an unset secret in prod is
    // a config bug, but we still want the cron to fail loud so the
    // operator notices, rather than silently allowing every caller.
    if (!process.env.CRON_SECRET) {
      return NextResponse.json(
        { ok: false, error: "CRON_SECRET not configured" } satisfies CronResponseErr,
        { status: 500 },
      );
    }
    if (got !== expected) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" } satisfies CronResponseErr,
        { status: 401 },
      );
    }
  }

  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // ---- find due rows ---------------------------------------------------
  // why: scheduled_for is jsonb keyed by platform → ISO. A row is "due" if
  // ANY platform value is <= NOW(). Postgres can compare jsonb→>text cast
  // to timestamptz, but combining 3 OR predicates against jsonb keys means
  // the partial GIN index (idx_generated_posts_scheduled_for, pre-existing)
  // doesn't help much — we ALSO filter by `scheduled_for != '{}'::jsonb`,
  // which IS sargable on the index, narrowing the scan to rows that have
  // at least one schedule before the OR test runs.
  //
  // We use raw SQL via .rpc-style PostgREST `or` chaining for the OR
  // predicate. Each platform check is `(scheduled_for->>'<p>') is not null
  // AND (scheduled_for->>'<p>')::timestamptz <= NOW()`.
  const orPredicate = (
    ["facebook", "instagram", "tiktok"] as const
  )
    .map(
      (p) =>
        `and(scheduled_for->>${p}.not.is.null,scheduled_for->>${p}.lte.${nowIso})`,
    )
    .join(",");

  const { data: rows, error: queryError } = await supabase
    .from("generated_posts")
    .select(
      // Phase D — captions_by_platform added so the scheduled publisher
      // reads the same per-platform caption variants as the manual Post
      // Now route. Falls back to legacy `caption` when the map is empty.
      "id, mls_number, caption, hashtags, captions_by_platform, image_url, posted_to, platform_post_ids, property_id, additional_images, scheduled_for, status, last_schedule_error, created_by",
    )
    .neq("scheduled_for", "{}")
    .or(orPredicate)
    .limit(50); // why: cap per tick — protects function time when a big backlog hits at once.

  if (queryError) {
    console.error("[cron/publish-scheduled] query failed:", queryError.message);
    return NextResponse.json(
      {
        ok: false,
        error: `query_failed: ${queryError.message}`,
      } satisfies CronResponseErr,
      { status: 500 },
    );
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      ok: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      details: [],
    } satisfies CronResponseOk);
  }

  // ---- credential cache ------------------------------------------------
  // why: many rows in the same tick share the same Meta/TT creds. Load once,
  // reuse. Cached null when the platform is unconfigured so we don't keep
  // hammering api_credentials.
  let metaCreds: MetaCredentials | null | undefined;
  let ttCreds: TikTokCredentials | null | undefined;
  async function getMeta(): Promise<MetaCredentials | null> {
    if (metaCreds === undefined) {
      metaCreds = await loadMetaCredentials();
    }
    return metaCreds;
  }
  async function getTikTok(): Promise<TikTokCredentials | null> {
    if (ttCreds === undefined) {
      ttCreds = await loadTikTokCredentials();
    }
    return ttCreds;
  }

  const details: CronRowSummary[] = [];
  let succeededTotal = 0;
  let failedTotal = 0;

  for (const row of rows) {
    const summary = await processRow(row as GeneratedPostRow, nowMs, getMeta, getTikTok);
    details.push(summary);
    succeededTotal += summary.succeeded.length;
    failedTotal += summary.failed.length;
  }

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    succeeded: succeededTotal,
    failed: failedTotal,
    details,
  } satisfies CronResponseOk);
}

/**
 * Process a single due row: publish each due platform, persist results,
 * mutate scheduled_for/status accordingly. All Supabase errors are logged
 * but do not throw — the cron must keep moving even if one row's update
 * fails (e.g. transient DB hiccup), and the partial-success state is
 * recoverable on the next tick.
 */
async function processRow(
  row: GeneratedPostRow,
  nowMs: number,
  getMeta: () => Promise<MetaCredentials | null>,
  getTikTok: () => Promise<TikTokCredentials | null>,
): Promise<CronRowSummary> {
  const supabase = createAdminClient();
  const summary: CronRowSummary = {
    id: row.id,
    platforms_processed: [],
    succeeded: [],
    failed: [],
  };

  // why: scheduled_for is jsonb; narrow defensively the same way the
  // server action does. Anything malformed falls back to {} and the row
  // just won't process this tick — the next save would normalize it.
  const schedMap: ScheduledFor =
    row.scheduled_for &&
    typeof row.scheduled_for === "object" &&
    !Array.isArray(row.scheduled_for)
      ? (row.scheduled_for as ScheduledFor)
      : {};

  // Build the working set of due platforms for THIS tick.
  const duePlatforms: SchedulablePlatform[] = [];
  for (const p of ["facebook", "instagram", "tiktok"] as const) {
    const iso = schedMap[p];
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    if (t <= nowMs) duePlatforms.push(p);
  }
  if (duePlatforms.length === 0) {
    // Row matched the SQL filter but no platform is actually due — could
    // happen on clock skew. Skip and move on.
    return summary;
  }

  // Resolve caption + image array — same shape the Post Now route builds.
  // Phase D — `caption` is the legacy fallback used for the "no caption at
  // all" guard. Each platform's actual publish call reads its own variant
  // from captions_by_platform via resolvePerPlatformCaption (defined
  // below) so the scheduled tick respects the per-platform edits Larissa
  // made in Studio.
  const caption = (row.caption ?? "").trim();
  if (!caption) {
    // No caption = nothing useful to post. Mark all due platforms as failed
    // so the UI flags this row for human attention; clear them from
    // scheduled_for so we don't retry endlessly.
    return await failAndClear(supabase, row, duePlatforms, "missing caption");
  }
  if (!row.image_url) {
    return await failAndClear(supabase, row, duePlatforms, "missing image_url");
  }

  const captionByPlatform = {
    facebook: resolvePerPlatformCaption(
      row.caption,
      row.captions_by_platform,
      "facebook",
    ),
    instagram: resolvePerPlatformCaption(
      row.caption,
      row.captions_by_platform,
      "instagram",
    ),
    tiktok: resolvePerPlatformCaption(
      row.caption,
      row.captions_by_platform,
      "tiktok",
    ),
  } as const;

  // why: additional_images is jsonb array of { url, ... } slides. Mirror
  // the validation from app/api/post-builder/post/route.ts so the publish
  // shape is identical between Post Now and cron — same defensive trim.
  const imageUrls: string[] = [row.image_url];
  const rawAdditional: unknown = row.additional_images;
  if (Array.isArray(rawAdditional)) {
    for (const entry of rawAdditional) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        "url" in entry &&
        typeof (entry as { url: unknown }).url === "string" &&
        (entry as { url: string }).url.trim().length > 0
      ) {
        imageUrls.push((entry as { url: string }).url);
      }
    }
  }

  // ---- publish each due platform --------------------------------------
  // why: fire them in parallel — they're independent. A failure on one
  // platform must not abort the others.
  const tasks: Array<Promise<PublishResult>> = [];
  for (const platform of duePlatforms) {
    summary.platforms_processed.push(platform);
    if (platform === "facebook" || platform === "instagram") {
      tasks.push(
        (async () => {
          const creds = await getMeta();
          if (!creds) {
            return {
              ok: false as const,
              platform,
              error: "Meta credentials not configured",
            };
          }
          if (platform === "facebook") {
            return await publishToFBPage({
              creds,
              image_urls: imageUrls,
              caption: captionByPlatform.facebook,
            });
          }
          if (!creds.ig_business_account_id) {
            return {
              ok: false as const,
              platform: "instagram",
              error: "Instagram Business account ID not configured",
            };
          }
          return await publishToIG({
            creds,
            image_urls: imageUrls,
            caption: captionByPlatform.instagram,
          });
        })(),
      );
    } else if (platform === "tiktok") {
      tasks.push(
        (async () => {
          const creds = await getTikTok();
          if (!creds) {
            return {
              ok: false as const,
              platform: "tiktok",
              error: "TikTok credentials not configured",
            };
          }
          return await publishToTikTok({
            creds,
            image_urls: imageUrls,
            caption: captionByPlatform.tiktok,
          });
        })(),
      );
    }
  }
  const results = await Promise.all(tasks);

  // ---- merge results back onto the row --------------------------------
  // why: build the next scheduled_for/posted_to/platform_post_ids/error
  // shapes deterministically from the existing row state + this tick's
  // results, then write them in a single UPDATE.
  const nextSched: ScheduledFor = { ...schedMap };
  const nextPostedTo = new Set<string>(row.posted_to ?? []);
  const existingIds: Record<string, string> =
    row.platform_post_ids &&
    typeof row.platform_post_ids === "object" &&
    !Array.isArray(row.platform_post_ids)
      ? (row.platform_post_ids as Record<string, string>)
      : {};
  const nextPlatformPostIds: Record<string, string> = { ...existingIds };
  const existingErrors: LastScheduleError =
    row.last_schedule_error &&
    typeof row.last_schedule_error === "object" &&
    !Array.isArray(row.last_schedule_error)
      ? (row.last_schedule_error as LastScheduleError)
      : {};
  const nextErrors: LastScheduleError = { ...existingErrors };

  const successPermalinks: Array<{ platform: SchedulablePlatform; url: string | null }> = [];

  for (const r of results) {
    const platform = r.platform as SchedulablePlatform;
    if (r.ok) {
      summary.succeeded.push(platform);
      nextPostedTo.add(platform);
      nextPlatformPostIds[platform] = r.platform_post_id;
      delete nextSched[platform];
      // Clear any prior schedule error for this platform on success.
      delete nextErrors[platform];
      successPermalinks.push({ platform, url: r.permalink });
    } else {
      summary.failed.push(platform);
      // why: keep the schedule entry intact so the NEXT cron tick retries.
      // The error map lets the UI explain what happened in the meantime.
      // Scope errors are recorded the same way; the user will see "→
      // re-authorize" once the UI reads this field.
      nextErrors[platform] = {
        error: r.error,
        at: new Date().toISOString(),
      };
    }
  }

  // Status transition rules:
  //   • Anything successful AND scheduled_for now empty → "posted".
  //   • Nothing successful AND scheduled_for now empty → leave as is
  //     (row was either "scheduled" with all failures, or "posted" already).
  //   • Schedules remain → keep status "scheduled".
  const allDone = Object.keys(nextSched).length === 0;
  let nextStatus: string | undefined;
  if (allDone && summary.succeeded.length > 0) {
    nextStatus = "posted";
  }

  const { error: updError } = await supabase
    .from("generated_posts")
    .update({
      scheduled_for: nextSched as unknown as Json,
      posted_to: Array.from(nextPostedTo),
      platform_post_ids: nextPlatformPostIds as unknown as Json,
      last_schedule_error: nextErrors as unknown as Json,
      // why: stamp posted_at on the FIRST successful publish only. Don't
      // overwrite an existing posted_at — that tracks the row's initial
      // publish moment, which downstream metrics joins rely on.
      ...(summary.succeeded.length > 0 && !row.posted_at
        ? { posted_at: new Date().toISOString() }
        : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (updError) {
    console.error(
      `[cron/publish-scheduled] update failed for ${row.id}:`,
      updError.message,
    );
  }

  // ---- agent outbox notification -------------------------------------
  // why: mirror /api/post-builder/post — every successful publish drops a
  // row into agent_post_outbox so the listing agent can be notified to
  // reshare. Best-effort; failure NEVER blocks the publish flow.
  if (summary.succeeded.length > 0 && row.property_id) {
    try {
      const postUrls = successPermalinks
        .filter((s) => s.url)
        .map((s) => ({ platform: s.platform, url: s.url as string }));
      await createOutboxRowForPost({
        generated_post_id: row.id,
        property_id: row.property_id,
        post_urls: postUrls,
        caption,
        thumbnail_url: row.image_url,
      });
    } catch (e) {
      console.error("[cron/publish-scheduled] outbox failed:", e);
    }
  }

  return summary;
}

/**
 * Mark every due platform as failed with the same error message, clear them
 * from scheduled_for so we don't retry forever, and persist. Used when the
 * row is structurally unpublishable (missing caption / image).
 */
async function failAndClear(
  supabase: ReturnType<typeof createAdminClient>,
  row: GeneratedPostRow,
  duePlatforms: SchedulablePlatform[],
  errorMsg: string,
): Promise<CronRowSummary> {
  const schedMap: ScheduledFor =
    row.scheduled_for &&
    typeof row.scheduled_for === "object" &&
    !Array.isArray(row.scheduled_for)
      ? (row.scheduled_for as ScheduledFor)
      : {};
  const nextSched: ScheduledFor = { ...schedMap };
  const existingErrors: LastScheduleError =
    row.last_schedule_error &&
    typeof row.last_schedule_error === "object" &&
    !Array.isArray(row.last_schedule_error)
      ? (row.last_schedule_error as LastScheduleError)
      : {};
  const nextErrors: LastScheduleError = { ...existingErrors };
  const at = new Date().toISOString();
  for (const p of duePlatforms) {
    delete nextSched[p];
    nextErrors[p] = { error: errorMsg, at };
  }
  await supabase
    .from("generated_posts")
    .update({
      scheduled_for: nextSched as unknown as Json,
      last_schedule_error: nextErrors as unknown as Json,
      updated_at: at,
    })
    .eq("id", row.id);
  return {
    id: row.id,
    platforms_processed: duePlatforms,
    succeeded: [],
    failed: duePlatforms,
  };
}

/**
 * Phase D — resolve the platform-specific caption for the scheduled
 * publisher. Mirrors the helper of the same name in /api/post-builder/
 * post/route.ts — see that file for the full rationale. Kept duplicated
 * (small + pure) rather than moved to a shared helper to keep the cron
 * route self-contained for ops debugging.
 */
function resolvePerPlatformCaption(
  legacy: string | null,
  captionsByPlatform: unknown,
  platform: "facebook" | "instagram" | "tiktok",
): string {
  if (captionsByPlatform && typeof captionsByPlatform === "object") {
    const map = captionsByPlatform as Record<string, unknown>;
    const entry = map[platform];
    if (entry && typeof entry === "object") {
      const e = entry as { caption?: unknown; hashtags?: unknown };
      const cap = typeof e.caption === "string" ? e.caption.trim() : "";
      if (cap) {
        const tags = Array.isArray(e.hashtags)
          ? e.hashtags.filter((t): t is string => typeof t === "string")
          : [];
        return tags.length > 0 ? `${cap}\n\n${tags.join(" ")}` : cap;
      }
    }
  }
  return (legacy ?? "").trim();
}
