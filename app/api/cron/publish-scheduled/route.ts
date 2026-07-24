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
import { requireCronAuth } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadMetaCredentials,
  loadTikTokCredentials,
  publishReelToIG,
  publishToFBPage,
  publishToIG,
  publishToTikTok,
  publishVideoToFB,
  publishVideoToTikTok,
  type MetaCredentials,
  type TikTokCredentials,
  type PublishResult,
} from "@/lib/post-builder/publish";
import { notifyListingAgentsForPost } from "@/lib/email/agent-post-notification";
import { openHousePublishGuard } from "@/lib/post-builder/oh-publish-guard";
import { notifyAdmins } from "@/lib/push/send";
import {
  AUTO_REEL_TEMPLATE_ID,
  finalizeAutoReels,
  maybeKickoffAutoReel,
  type FinalizeAutoReelsSummary,
} from "@/lib/post-builder/auto-reel";
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
// why: each publish call can take 20-30s, and the worst single row is far
// slower — an IG Reel container can poll up to ~120s and TT video up to
// ~60s. The old 60s ceiling could kill the function BETWEEN the claim step
// (which strips due keys from scheduled_for) and the merge write that
// restores failed keys — silently losing the schedule entry (audit
// 2026-06-10, High #2). 300s (Vercel Pro cap) plus the ROW_DEADLINE_MS
// budget below guarantees we stop STARTING new rows with enough headroom
// for the slowest in-flight publish to finish and persist.
export const maxDuration = 300;

// Stop picking up new rows once this much wall time has elapsed. Remaining
// due rows are untouched (their scheduled_for keys are still intact) and the
// next 5-minute tick picks them up. 150s leaves ~150s of headroom — enough
// for the slowest possible row (IG Reel ~120s poll) to complete and merge.
const ROW_DEADLINE_MS = 150_000;

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
  /** 2026-07-23 — auto-reel render-finalize summary for this tick. */
  auto_reel?: FinalizeAutoReelsSummary;
}

interface CronResponseErr {
  ok: false;
  error: string;
}

type GeneratedPostRow = Database["public"]["Tables"]["generated_posts"]["Row"];

export async function GET(request: Request): Promise<NextResponse> {
  // ---- auth gate -------------------------------------------------------
  // why: strict Bearer CRON_SECRET, shared across all cron routes since
  // 2026-06-10 (lib/cron-auth.ts). This route's inline version was the
  // model for the shared helper.
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // ---- auto-reel finalize ----------------------------------------------
  // 2026-07-23 — poll pending auto-reel render jobs FIRST, so a reel that
  // just finished rendering AND is already past its publish time gets
  // scheduled here and published by the drain below in the SAME tick.
  // finalizeAutoReels never throws; the belt-and-suspenders try/catch
  // keeps any surprise from killing the publish drain.
  let autoReelSummary: FinalizeAutoReelsSummary | undefined;
  try {
    autoReelSummary = await finalizeAutoReels();
  } catch (e) {
    console.error("[cron/publish-scheduled] auto-reel finalize failed:", e);
  }

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
      // 2026-05-16 — media_type + video_url added so the cron can branch
      // between image and reel publishing in processRow.
      // 2026-05-28 — updated_at added: used as an optimistic-concurrency
      // version token to CLAIM a due row before publishing, so two
      // overlapping cron ticks (or a manual trigger racing the scheduled
      // one) can't publish the same row twice. See the claim step in processRow.
      // 2026-07-23 — template_id added so the outbox email + auto-reel
      // kickoff below can tell auto-generated reels apart from source posts.
      "id, mls_number, caption, hashtags, captions_by_platform, image_url, posted_to, posted_at, platform_post_ids, property_id, additional_images, scheduled_for, status, last_schedule_error, created_by, media_type, video_url, test_mode, updated_at, template_id, post_type",
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
      ...(autoReelSummary ? { auto_reel: autoReelSummary } : {}),
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
  let deferred = 0;

  for (const row of rows) {
    // why: time budget — never START a row we might not be able to FINISH.
    // An unprocessed row's scheduled_for keys are untouched, so the next
    // tick simply picks it up. Killing a row mid-publish is the dangerous
    // case (claim already stripped the keys); deferring is always safe.
    if (Date.now() - nowMs > ROW_DEADLINE_MS) {
      deferred = rows.length - details.length;
      console.warn(
        `[cron/publish-scheduled] time budget reached — deferring ${deferred} row(s) to next tick`,
      );
      break;
    }
    const summary = await processRow(row as GeneratedPostRow, nowMs, getMeta, getTikTok);
    details.push(summary);
    succeededTotal += summary.succeeded.length;
    failedTotal += summary.failed.length;
  }

  return NextResponse.json({
    ok: true,
    processed: details.length,
    succeeded: succeededTotal,
    failed: failedTotal,
    details,
    ...(autoReelSummary ? { auto_reel: autoReelSummary } : {}),
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

  // ---- CLAIM the due platforms (double-publish guard) ------------------
  // why: without an atomic claim, two overlapping cron ticks (or a manual
  // trigger racing the scheduled one) both SELECT this row as due, both
  // publish, and the listing goes out twice. We claim by removing the due
  // platform keys from scheduled_for in a SINGLE conditional UPDATE guarded
  // by the row's current `updated_at` (an optimistic-concurrency version
  // token). Postgres serializes the two writers: the first flips updated_at
  // and gets the row back; the second's `.eq(updated_at, <stale>)` no longer
  // matches, returns no row, and we bail BEFORE publishing. Failed platforms
  // are re-added to scheduled_for by the merge write below so they still
  // retry next tick — the claim only removes them up-front.
  const claimStamp = new Date().toISOString();
  const claimedSched: ScheduledFor = { ...schedMap };
  for (const p of duePlatforms) delete claimedSched[p];
  // Guard on the exact current updated_at. Handle legacy rows whose
  // updated_at is null (PostgREST `.eq` never matches null, so use `.is`).
  const claimQuery = supabase
    .from("generated_posts")
    .update({
      scheduled_for: claimedSched as unknown as Json,
      updated_at: claimStamp,
    })
    .eq("id", row.id);
  const guardedClaim =
    row.updated_at === null
      ? claimQuery.is("updated_at", null)
      : claimQuery.eq("updated_at", row.updated_at);
  const { data: claimedRow, error: claimErr } = await guardedClaim
    .select("id")
    .maybeSingle();
  if (claimErr) {
    console.error(
      `[cron/publish-scheduled] claim failed for ${row.id}:`,
      claimErr.message,
    );
    return summary;
  }
  if (!claimedRow) {
    // Lost the race — another tick already claimed these platforms. Skipping
    // is exactly the desired outcome: no double publish.
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

  // 2026-07-24 — stale open-house guard. A scheduled OH post that fires
  // after every open house across its properties has ENDED would advertise
  // a past event. failAndClear (not a silent skip) so the row surfaces in
  // the UI with a clear error instead of retrying forever. Lookup failures
  // fail open inside the guard — a DB hiccup never blocks a publish.
  const ohGuard = await openHousePublishGuard({
    generated_post_id: row.id,
    property_id: row.property_id,
    post_type: row.post_type,
    template_id: row.template_id,
  });
  if (ohGuard.applicable && !ohGuard.upcoming) {
    return await failAndClear(
      supabase,
      row,
      duePlatforms,
      "open houses in this post have already ended — publish blocked (repost manually with a fresh date if intended)",
    );
  }

  // why: media_type drives which publishers fire. "reel" routes through
  // the video publishers (publishReelToIG / publishVideoToFB /
  // publishVideoToTikTok); anything else (default "image") routes through
  // the photo carousel publishers. Per-media-type validation runs before
  // the task fan-out so we can failAndClear with a clear message when the
  // row is structurally unpublishable for its media_type.
  const isReel = row.media_type === "reel";
  if (isReel) {
    if (!row.video_url) {
      return await failAndClear(
        supabase,
        row,
        duePlatforms,
        "missing video_url for reel",
      );
    }
    // IG Reels require a cover image; if the row is missing one we'd
    // rather fail the IG branch and let FB/TT publish than block the
    // whole row. So we DON'T failAndClear here — the per-platform check
    // below records the IG-only failure and clears just that platform.
  } else {
    if (!row.image_url) {
      return await failAndClear(
        supabase,
        row,
        duePlatforms,
        "missing image_url",
      );
    }
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

  // why: per-row test_mode flag drives whether each publisher routes
  // through hidden/draft paths. Resolved once per row, passed to every
  // task below — keeps the cron fan-out symmetric with the Post Now route.
  const test_mode = row.test_mode === true;

  // why: additional_images is jsonb array of { url, ... } slides. Only
  // relevant on the image branch — reels publish a single video URL.
  // Mirror the validation from app/api/post-builder/post/route.ts so the
  // publish shape is identical between Post Now and cron.
  let imageUrls: string[] = [];
  if (!isReel && row.image_url) {
    const validatedAdditionalUrls: string[] = [];
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
          validatedAdditionalUrls.push((entry as { url: string }).url);
        }
      }
    }
    // 2026-07-24 — multi-OH hero exclusion, mirrored from the Post Now
    // route (2026-05-27 decision): the event-summary hero is a Studio
    // preview graphic, NOT a published slide. This branch was missing
    // here, so a multi-OH post published via SCHEDULE went out with the
    // hero as slide 1 while Post Now (correctly) omitted it — the two
    // paths now produce identical carousels.
    const isMultiOhEvent =
      typeof row.template_id === "string" &&
      row.template_id.startsWith("multi_oh_event_");
    imageUrls =
      isMultiOhEvent && validatedAdditionalUrls.length > 0
        ? validatedAdditionalUrls
        : [row.image_url, ...validatedAdditionalUrls];
    // 2026-07-24 — trim to IG's 10-image cap (publishToIG hard-errors
    // above 10; it does not trim). Same backstop as the Post Now route.
    const IG_MAX_SLIDES = 10;
    if (imageUrls.length > IG_MAX_SLIDES) {
      console.warn(
        `[cron/publish-scheduled] gp ${row.id} has ${imageUrls.length} slides; trimming to ${IG_MAX_SLIDES}.`,
      );
      imageUrls = imageUrls.slice(0, IG_MAX_SLIDES);
    }
  }

  // ---- publish each due platform --------------------------------------
  // why: fire them in parallel — they're independent. A failure on one
  // platform must not abort the others. Reel + image branches share the
  // same fan-out shape so the merge logic below doesn't care which path
  // produced the PublishResult.
  const tasks: Array<Promise<PublishResult>> = [];
  for (const platform of duePlatforms) {
    summary.platforms_processed.push(platform);

    if (isReel) {
      // ============ Reel branch — scheduled video publish ============
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
              return await publishVideoToFB({
                creds,
                video_url: row.video_url as string,
                caption: captionByPlatform.facebook,
                test_mode,
              });
            }
            // Instagram Reels
            if (!creds.ig_business_account_id) {
              return {
                ok: false as const,
                platform: "instagram",
                error: "Instagram Business account ID not configured",
              };
            }
            if (!row.image_url) {
              return {
                ok: false as const,
                platform: "instagram",
                error:
                  "Reel row has no cover image_url — IG Reels require one. FB/TT can still publish.",
              };
            }
            return await publishReelToIG({
              creds,
              video_url: row.video_url as string,
              cover_url: row.image_url,
              caption: captionByPlatform.instagram,
              test_mode,
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
            return await publishVideoToTikTok({
              creds,
              video_url: row.video_url as string,
              caption: captionByPlatform.tiktok,
              test_mode,
            });
          })(),
        );
      }
    } else {
      // ============ Image / carousel branch — unchanged ============
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
                test_mode,
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
              test_mode,
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
              test_mode,
            });
          })(),
        );
      }
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
      // 2026-07-23 — engagement seeding for EVERY listing agent in the post
      // (anchor + linked properties, deduped per agent), mirrored from the
      // Post Now route. Emails SKIPPED for auto-generated reels — the agent
      // already got the photo-post email ~45 min earlier; two pings in an
      // hour is spam. Outbox rows are still created for the admin view.
      await notifyListingAgentsForPost({
        generated_post_id: row.id,
        anchor_property_id: row.property_id,
        post_urls: postUrls,
        caption,
        thumbnail_url: row.image_url,
        send_emails: row.template_id !== AUTO_REEL_TEMPLATE_ID,
      });
    } catch (e) {
      console.error("[cron/publish-scheduled] agent notification failed:", e);
    }
  }

  // 2026-07-24 — Mobile push (Phase D), mirroring the Post Now route.
  // Success pushes are SKIPPED for auto-generated reels (same rule as the
  // agent email — the photo post already pinged ~45 min earlier); failures
  // always push, auto-reel or not, because a stuck pipeline is exactly
  // what the admins need to know about. Best-effort; never blocks the row.
  try {
    const prettyPlatform = (p: string) =>
      p === "facebook" ? "Facebook" : p === "instagram" ? "Instagram" : "TikTok";
    if (
      summary.succeeded.length > 0 &&
      row.template_id !== AUTO_REEL_TEMPLATE_ID
    ) {
      const firstPermalink =
        successPermalinks.find((s) => s.url)?.url ?? null;
      await notifyAdmins({
        type: "publish_result",
        title: `Scheduled post live on ${summary.succeeded.map(prettyPlatform).join(" + ")}`,
        body: `${row.mls_number} — ${(caption ?? "").slice(0, 120)}`,
        url: firstPermalink ?? "/m/track",
        tag: `publish-${row.id}`,
        metadata: {
          generated_post_id: row.id,
          mls_number: row.mls_number,
          platforms: summary.succeeded,
          url: firstPermalink ?? "/m/track",
        },
      });
    }
    // Only push a failure the FIRST time a platform fails for this row —
    // the cron retries every 5 minutes and a persistent outage would
    // otherwise buzz the phone at the same cadence.
    const newlyFailed = summary.failed.filter((p) => !existingErrors[p]);
    if (newlyFailed.length > 0) {
      const failDetails = newlyFailed
        .map((p) => `${prettyPlatform(p)}: ${nextErrors[p]?.error ?? "failed"}`)
        .join(" · ");
      await notifyAdmins({
        type: "publish_failure",
        title: `Scheduled publish failed on ${newlyFailed.map(prettyPlatform).join(" + ")}`,
        body: `${row.mls_number} — ${failDetails.slice(0, 160)} (will retry next tick)`,
        url: "/saved-posts",
        tag: `publish-fail-${row.id}`,
        metadata: {
          generated_post_id: row.id,
          mls_number: row.mls_number,
          failed_platforms: newlyFailed,
          url: "/saved-posts",
        },
      });
    }
  } catch (e) {
    console.error("[cron/publish-scheduled] admin push failed:", e);
  }

  // 2026-07-23 — Auto-Reel kickoff for SCHEDULED image posts, mirroring the
  // Post Now route: a photo post published by this cron spawns its delayed
  // Reel too. Guards (image-only, not test, not multi-OH, has photos, once
  // per source) live inside maybeKickoffAutoReel; it never throws. Reels
  // themselves are excluded here so an auto reel can't spawn another reel.
  if (
    summary.succeeded.length > 0 &&
    row.media_type !== "reel" &&
    row.test_mode !== true
  ) {
    await maybeKickoffAutoReel(row.id);
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
