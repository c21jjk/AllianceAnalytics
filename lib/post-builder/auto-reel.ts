/**
 * lib/post-builder/auto-reel.ts — fully-automatic Reel pipeline (2026-07-23)
 * ---------------------------------------------------------------------------
 *
 * WHY THIS EXISTS
 *   API-published multi-photo Facebook posts land as "added photos" stories,
 *   which FB's feed ranking treats as low-priority — they sit on the Page
 *   but rarely reach personal feeds (observed 3× by John, incl. 1 Palmer
 *   Drive on 2026-07-23). Stripping photos was rejected; instead, every
 *   standard property post now AUTOMATICALLY becomes a short Reel published
 *   ~45 minutes after the photo post. Video gets FB's best feed
 *   distribution AND is the only static-content type whose reach Meta still
 *   reports at the API, so the dashboard can actually measure the win.
 *
 * FLOW (no human steps — John's explicit requirement, 2026-07-23)
 *   1. maybeKickoffAutoReel(sourceGpId) — called fire-and-forget-style from
 *      BOTH publish paths (/api/post-builder/post + the publish-scheduled
 *      cron) after a successful image publish:
 *        a. guards (image post, not test, not multi-OH, has photos,
 *           not already kicked off),
 *        b. renders the 9:16 hero template to a PNG via renderCanvasSchema
 *           (bound fields hydrate through the Chromium render page — the
 *           video worker can't hydrate design scenes itself),
 *        c. builds the composition (photo-hero variant of
 *           buildReelFromCarousel),
 *        d. submits it to the Fly render worker (POST /render),
 *        e. inserts a draft generated_posts reel row carrying the job id in
 *           customizations.auto_reel.
 *   2. finalizeAutoReels() — runs at the top of every publish-scheduled
 *      cron tick (every 5 min): polls the worker for pending auto-reel
 *      jobs; on success writes video_url/cover and sets scheduled_for to
 *      max(now, source publish + 45 min) for facebook + instagram. The
 *      SAME cron's existing drain then publishes it like any scheduled
 *      reel — claim guard, retries, outbox row and all.
 *
 * FAILURE POSTURE: everything here is best-effort. No failure in this
 * module may ever break a publish. Failed renders are marked in
 * customizations.auto_reel and left as drafts — Larissa can still open
 * them in the Reel editor and render manually.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderCanvasSchema } from "@/lib/post-builder/canvas-editor/render-canvas-schema";
import { resolveTemplateForStatus } from "@/lib/data/custom-templates-db";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import {
  buildReelFromCarousel,
} from "@/lib/post-builder/reel-templates/build-from-carousel";
import {
  isMultiEventTemplateId,
  type PostType,
  type PostVariant,
  type ReelRenderJob,
  type ScheduledFor,
} from "@/lib/post-builder/types";
import type { Json } from "@/lib/supabase/types";

/** template_id stamped on every auto-generated reel row. Also the
 *  idempotency namespace: one auto reel per source post, ever. */
export const AUTO_REEL_TEMPLATE_ID = "auto_reel_v1";

/** Publish the reel this long after the source photo post went live.
 *  why 45 min: far enough that the Page isn't posting twice in the same
 *  feed-ranking window, close enough that the listing is still "new". */
const PUBLISH_DELAY_MS = 45 * 60_000;

/** Give up on a render job that hasn't finished after this long. */
const JOB_STALE_MS = 30 * 60_000;

/**
 * 2026-07-23 — max times finalize will RE-SUBMIT a render whose job the
 * worker no longer knows about (machine restart / deploy wiped the
 * in-memory job store — exactly what killed the first Palmer Drive reel).
 * Capped so a systematically-broken render can't loop forever.
 */
const MAX_RESUBMITS = 2;

/** Shape stored under customizations.auto_reel on the reel row. */
interface AutoReelMeta {
  source_gp_id: string;
  job_id: string;
  submitted_at: string;
  /** Source post's posted_at — anchor for the 45-min publish delay. */
  source_posted_at: string | null;
  /** How many times finalize has re-submitted the render (lost-job heal). */
  resubmit_count?: number;
  finalized_at?: string;
  failed_at?: string;
  fail_reason?: string;
}

// ---------------------------------------------------------------------------
// Worker client (mirrors the private helpers in post-builder/actions.ts —
// duplicated because that file is a "use server" actions module; this one
// runs from API routes and crons with no user session).
// ---------------------------------------------------------------------------

function readWorkerEnv():
  | { ok: true; baseUrl: string; token: string }
  | { ok: false; error: string } {
  const baseUrl = process.env.REEL_WORKER_URL;
  const token = process.env.REEL_WORKER_AUTH_TOKEN;
  if (!baseUrl) return { ok: false, error: "REEL_WORKER_URL is not set" };
  if (!token) return { ok: false, error: "REEL_WORKER_AUTH_TOKEN is not set" };
  return {
    ok: true,
    baseUrl: baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl,
    token,
  };
}

async function submitRenderJob(
  composition: unknown,
): Promise<{ ok: true; job_id: string } | { ok: false; error: string }> {
  const env = readWorkerEnv();
  if (!env.ok) return { ok: false, error: env.error };
  try {
    const res = await fetch(`${env.baseUrl}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.token}`,
      },
      body: JSON.stringify({
        composition,
        idempotency_key: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as { job_id?: string; error?: string };
    if (!res.ok || typeof body.job_id !== "string") {
      return {
        ok: false,
        error: body.error ?? `worker HTTP ${res.status}`,
      };
    }
    return { ok: true, job_id: body.job_id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function fetchRenderJob(
  jobId: string,
): Promise<
  | { ok: true; job: ReelRenderJob }
  | { ok: false; notFound: boolean; error: string }
> {
  const env = readWorkerEnv();
  if (!env.ok) return { ok: false, notFound: false, error: env.error };
  try {
    const res = await fetch(
      `${env.baseUrl}/render/${encodeURIComponent(jobId)}`,
      {
        headers: { Authorization: `Bearer ${env.token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await res.json()) as ReelRenderJob & { error?: string };
    if (!res.ok) {
      return {
        ok: false,
        // why: 404 means the worker doesn't know this job — its in-memory
        // store was wiped by a restart/deploy. The caller resubmits.
        notFound: res.status === 404,
        error: body.error ?? `worker HTTP ${res.status}`,
      };
    }
    return { ok: true, job: body };
  } catch (e) {
    return {
      ok: false,
      notFound: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Kickoff
// ---------------------------------------------------------------------------

/**
 * Start the auto-reel pipeline for a freshly-published image post. Never
 * throws — every failure logs and returns so the publish flow that called
 * us is untouched. Idempotent per source post.
 */
export async function maybeKickoffAutoReel(sourceGpId: string): Promise<void> {
  try {
    await kickoff(sourceGpId);
  } catch (e) {
    console.error(
      `[auto-reel] kickoff crashed for ${sourceGpId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

async function kickoff(sourceGpId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: src, error: srcErr } = await supabase
    .from("generated_posts")
    .select(
      "id, mls_number, source_mls, property_id, post_type, variant, template_id, media_type, test_mode, image_url, additional_images, caption, hashtags, captions_by_platform, posted_at, created_by, posted_by",
    )
    .eq("id", sourceGpId)
    .maybeSingle();
  if (srcErr || !src) {
    console.error(
      `[auto-reel] source lookup failed for ${sourceGpId}:`,
      srcErr?.message ?? "not found",
    );
    return;
  }

  // ---- guards ----------------------------------------------------------
  // Image posts only (reels don't spawn reels), never test posts, and only
  // when there are carousel photos to sequence.
  //
  // 2026-07-24 — multi-OH event roundups are now SUPPORTED (previously an
  // early return). They're the highest-value weekly post and their
  // per-property slides are already-rendered PNGs, i.e. perfect reel
  // scenes. Differences from the single-listing path are flagged on
  // isMultiOh below: the scene list is the slide set itself, and the
  // square event hero opens the reel as-is (cover-cropped) — the 9:16
  // story re-render only exists for single-listing canvas templates.
  if (src.media_type === "reel") return;
  if (src.test_mode === true) return;
  // 2026-08-19 — generalized to every multi-slide event kind. The weekly
  // Under Contract / Price Reduced roundups (uc_roundup_* / pr_roundup_*)
  // take the same path as multi-OH: their slide set IS the scene list,
  // their square hero opens the reel as-is, and their linked_property_ids
  // ride onto the reel row. The variable keeps its historical name.
  const isMultiOh = isMultiEventTemplateId(
    typeof src.template_id === "string" ? src.template_id : null,
  );
  if (src.template_id === AUTO_REEL_TEMPLATE_ID) return;
  if (!src.property_id || !src.image_url) return;

  const photoUrls: string[] = [];
  if (Array.isArray(src.additional_images)) {
    for (const entry of src.additional_images) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        "url" in entry &&
        typeof (entry as { url: unknown }).url === "string" &&
        (entry as { url: string }).url.trim().length > 0
      ) {
        photoUrls.push((entry as { url: string }).url);
      }
    }
  }
  if (photoUrls.length === 0 || (isMultiOh && photoUrls.length < 2)) {
    // Single-image post with no carousel photos — a one-scene reel isn't
    // worth publishing (worker minScenes is 2 anyway). Multi-OH events
    // additionally need at least 2 property slides to read as a roundup.
    return;
  }

  // ---- idempotency: one auto reel per source post, ever ----------------
  // why the jsonb-path filter goes through an untyped client: the arrow
  // path isn't a column name the generated types know about.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { data: existing } = await sbAny
    .from("generated_posts")
    .select("id")
    .eq("template_id", AUTO_REEL_TEMPLATE_ID)
    .eq("customizations->auto_reel->>source_gp_id", sourceGpId)
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const postType = (src.post_type ?? "just_listed") as PostType;
  const variant = (src.variant ?? "v1") as PostVariant;
  const mls = src.mls_number ?? "";

  // ---- 9:16 hero PNG ---------------------------------------------------
  // Larissa's saved default template for this status wins; factory canvas
  // template is the fallback. If neither exists (or the render fails), the
  // square feed card still works as an opener — cover-cropped, not ideal,
  // but never a blocked pipeline.
  let heroImageUrl: string = src.image_url;
  try {
    // 2026-07-24 — multi-OH: keep the square event hero. The 9:16 render
    // below binds SINGLE-listing fields via renderCanvasSchema; the event
    // hero comes from multi-oh-render.ts and has no canvas schema, so a
    // story re-render would produce a wrong-listing card. The worker
    // cover-crops the square opener; acceptable, and never a blocked
    // pipeline.
    const schema = isMultiOh
      ? null
      : ((await resolveTemplateForStatus(postType, "story_9x16")) ??
        findCanvasTemplate(postType, variant, "story_9x16"));
    if (schema) {
      const rendered = await renderCanvasSchema({
        schema,
        listingId: src.property_id,
        mlsNumber: mls,
        format: "story_9x16",
        storagePrefix: "auto-reel-",
        logLabel: `auto-reel:${sourceGpId.slice(0, 8)}`,
      });
      if (rendered.ok) {
        heroImageUrl = rendered.image_url;
      } else {
        console.warn(
          `[auto-reel] hero render failed (${rendered.stage}): ${rendered.error} — falling back to square card`,
        );
      }
    }
  } catch (e) {
    console.warn(
      "[auto-reel] hero render crashed — falling back to square card:",
      e instanceof Error ? e.message : e,
    );
  }

  // ---- composition -----------------------------------------------------
  const composition = buildReelFromCarousel({
    postType,
    variant,
    photoUrls,
    sourceListingMls: mls,
    pace: "cinematic",
    heroImageUrl,
  });
  if (!composition) {
    console.error(`[auto-reel] composition build returned null for ${sourceGpId}`);
    return;
  }

  // ---- submit to the render worker ------------------------------------
  const submitted = await submitRenderJob(composition);
  if (!submitted.ok) {
    console.error(
      `[auto-reel] worker submit failed for ${sourceGpId}: ${submitted.error}`,
    );
    return;
  }

  // ---- insert the draft reel row --------------------------------------
  const meta: AutoReelMeta = {
    source_gp_id: sourceGpId,
    job_id: submitted.job_id,
    submitted_at: new Date().toISOString(),
    source_posted_at: src.posted_at,
  };

  // 2026-07-24 — carry the multi-OH property linkage onto the reel row so
  // posted-coverage badges, Owner Stories, and the stale-OH publish guard
  // all see every property this reel features. Untyped read/insert because
  // linked_property_ids isn't in the generated types yet (same pattern as
  // the publish routes).
  let linkedPropertyIds: string[] | null = null;
  if (isMultiOh) {
    const { data: linkRow } = await sbAny
      .from("generated_posts")
      .select("linked_property_ids")
      .eq("id", sourceGpId)
      .maybeSingle();
    if (linkRow && Array.isArray(linkRow.linked_property_ids)) {
      const ids = linkRow.linked_property_ids.filter(
        (v: unknown): v is string => typeof v === "string" && v.length > 0,
      );
      if (ids.length > 0) linkedPropertyIds = ids;
    }
  }

  const { error: insErr } = await sbAny.from("generated_posts").insert({
    linked_property_ids: linkedPropertyIds,
    mls_number: mls,
    source_mls: src.source_mls,
    property_id: src.property_id,
    post_type: postType,
    variant,
    format: "story_9x16",
    template_id: AUTO_REEL_TEMPLATE_ID,
    media_type: "reel",
    // Cover/thumbnail until the worker's real first-frame cover lands in
    // finalizeAutoReels (job.cover_url).
    image_url: heroImageUrl,
    image_path: null,
    hero_image_source_url: heroImageUrl,
    video_url: null,
    video_path: null,
    composition_json: composition as unknown as Json,
    reel_duration_ms: composition.totalDurationMs,
    template_props: {} as Json,
    // Same captions as the source post — one campaign, two formats.
    caption: src.caption,
    hashtags: src.hashtags,
    captions_by_platform: (src.captions_by_platform ?? {}) as Json,
    customizations: { auto_reel: meta } as unknown as Json,
    status: "draft",
    test_mode: false,
    created_by: src.posted_by ?? src.created_by,
  });
  if (insErr) {
    console.error(
      `[auto-reel] reel row insert failed for ${sourceGpId}: ${insErr.message}`,
    );
    return;
  }

  console.log(
    `[auto-reel] kicked off for ${sourceGpId} (mls ${mls}): job ${submitted.job_id}`,
  );
}

// ---------------------------------------------------------------------------
// Finalize (cron)
// ---------------------------------------------------------------------------

export interface FinalizeAutoReelsSummary {
  checked: number;
  scheduled: number;
  still_rendering: number;
  failed: number;
}

/**
 * Poll pending auto-reel render jobs; schedule the finished ones. Runs at
 * the top of every publish-scheduled cron tick. Never throws.
 */
export async function finalizeAutoReels(): Promise<FinalizeAutoReelsSummary> {
  const summary: FinalizeAutoReelsSummary = {
    checked: 0,
    scheduled: 0,
    still_rendering: 0,
    failed: 0,
  };
  try {
    const supabase = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any;

    const sinceIso = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: rows, error } = await sbAny
      .from("generated_posts")
      .select("id, image_url, customizations, composition_json")
      .eq("template_id", AUTO_REEL_TEMPLATE_ID)
      .eq("media_type", "reel")
      .eq("status", "draft")
      .is("video_url", null)
      .gte("created_at", sinceIso)
      .limit(10);
    if (error) {
      console.error("[auto-reel] finalize query failed:", error.message);
      return summary;
    }
    if (!rows || rows.length === 0) return summary;

    for (const row of rows as Array<{
      id: string;
      image_url: string | null;
      customizations: unknown;
      composition_json: unknown;
    }>) {
      const meta = readMeta(row.customizations);
      if (!meta || !meta.job_id) continue;
      const resubmits = meta.resubmit_count ?? 0;

      // 2026-07-23 — self-heal previously-failed rows when the failure was
      // recoverable (lost job / hung worker), up to MAX_RESUBMITS. A render
      // that FAILED on the worker's side (bad input) stays failed.
      if (meta.failed_at) {
        const retryable = /worker unreachable|job not found|not found|did not finish|HTTP 404/i.test(
          meta.fail_reason ?? "",
        );
        if (!retryable || resubmits >= MAX_RESUBMITS) continue;
        summary.checked += 1;
        if (await resubmitRow(sbAny, row, meta)) {
          summary.still_rendering += 1;
        } else {
          summary.failed += 1;
        }
        continue;
      }
      summary.checked += 1;

      const polled = await fetchRenderJob(meta.job_id);
      if (!polled.ok) {
        if (polled.notFound && resubmits < MAX_RESUBMITS) {
          // Worker restarted/deployed and lost the in-memory job — resubmit.
          if (await resubmitRow(sbAny, row, meta)) {
            summary.still_rendering += 1;
          } else {
            summary.failed += 1;
          }
        } else if (polled.notFound) {
          await markFailed(
            sbAny,
            row.id,
            meta,
            "render job lost and max resubmits reached",
          );
          summary.failed += 1;
        } else if (isStale(meta)) {
          await markFailed(sbAny, row.id, meta, `worker unreachable: ${polled.error}`);
          summary.failed += 1;
        } else {
          // Transient worker hiccup — try again next tick.
          summary.still_rendering += 1;
        }
        continue;
      }

      const job = polled.job;
      if (job.status === "succeeded" && job.video_url && job.video_path) {
        const publishAtMs = Math.max(
          Date.now(),
          (meta.source_posted_at ? Date.parse(meta.source_posted_at) : Date.now()) +
            PUBLISH_DELAY_MS,
        );
        const publishIso = new Date(publishAtMs).toISOString();
        const sched: ScheduledFor = {
          facebook: publishIso,
          instagram: publishIso,
        };
        const nextMeta: AutoReelMeta = {
          ...meta,
          finalized_at: new Date().toISOString(),
        };
        const { error: updErr } = await sbAny
          .from("generated_posts")
          .update({
            video_url: job.video_url,
            video_path: job.video_path,
            reel_duration_ms: job.duration_ms,
            // Real first-frame cover when the worker produced one; the
            // hero PNG placeholder otherwise (IG Reels needs SOME cover).
            image_url: job.cover_url ?? row.image_url,
            scheduled_for: sched as unknown as Json,
            status: "scheduled",
            customizations: { auto_reel: nextMeta } as unknown as Json,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (updErr) {
          console.error(
            `[auto-reel] finalize update failed for ${row.id}: ${updErr.message}`,
          );
        } else {
          summary.scheduled += 1;
          console.log(
            `[auto-reel] ${row.id} rendered — publishing FB+IG at ${publishIso}`,
          );
        }
      } else if (job.status === "failed") {
        await markFailed(sbAny, row.id, meta, job.error ?? "render failed");
        summary.failed += 1;
      } else {
        // queued / processing
        if (isStale(meta)) {
          // A hung job after 30 min: resubmit once/twice before giving up.
          if (resubmits < MAX_RESUBMITS) {
            if (await resubmitRow(sbAny, row, meta)) {
              summary.still_rendering += 1;
            } else {
              summary.failed += 1;
            }
          } else {
            await markFailed(sbAny, row.id, meta, "render did not finish in 30 min");
            summary.failed += 1;
          }
        } else {
          summary.still_rendering += 1;
        }
      }
    }
  } catch (e) {
    console.error(
      "[auto-reel] finalize crashed:",
      e instanceof Error ? e.message : e,
    );
  }
  return summary;
}

function readMeta(customizations: unknown): AutoReelMeta | null {
  if (
    customizations &&
    typeof customizations === "object" &&
    !Array.isArray(customizations) &&
    "auto_reel" in customizations
  ) {
    const m = (customizations as { auto_reel: unknown }).auto_reel;
    if (m && typeof m === "object" && !Array.isArray(m)) {
      return m as unknown as AutoReelMeta;
    }
  }
  return null;
}

function isStale(meta: AutoReelMeta): boolean {
  const t = Date.parse(meta.submitted_at);
  return Number.isNaN(t) ? true : Date.now() - t > JOB_STALE_MS;
}

/**
 * Re-submit a render whose job the worker lost (restart/deploy wiped the
 * in-memory store) or that hung past the stale window. Consumes one
 * resubmit slot and clears any failed_at marker so the normal poll path
 * resumes next tick. Returns true when the row is back in flight.
 *
 * why a failed submit returns true WITHOUT consuming a slot: a transient
 * network error submitting shouldn't burn one of the two heal attempts —
 * the row stays in its current state and the next tick tries again.
 */
async function resubmitRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sbAny: any,
  row: { id: string; composition_json: unknown },
  meta: AutoReelMeta,
): Promise<boolean> {
  if (!row.composition_json) {
    await markFailed(sbAny, row.id, meta, "cannot resubmit: row has no composition_json");
    return false;
  }
  const submitted = await submitRenderJob(row.composition_json);
  if (!submitted.ok) {
    console.warn(
      `[auto-reel] resubmit attempt for ${row.id} could not reach worker (${submitted.error}) — will retry next tick`,
    );
    return true;
  }
  const nextMeta: AutoReelMeta = {
    source_gp_id: meta.source_gp_id,
    job_id: submitted.job_id,
    submitted_at: new Date().toISOString(),
    source_posted_at: meta.source_posted_at,
    resubmit_count: (meta.resubmit_count ?? 0) + 1,
  };
  const { error } = await sbAny
    .from("generated_posts")
    .update({
      customizations: { auto_reel: nextMeta } as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    console.error(`[auto-reel] resubmit meta update failed for ${row.id}: ${error.message}`);
  } else {
    console.log(
      `[auto-reel] resubmitted render for ${row.id}: new job ${submitted.job_id} (attempt ${nextMeta.resubmit_count})`,
    );
  }
  return true;
}

async function markFailed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sbAny: any,
  rowId: string,
  meta: AutoReelMeta,
  reason: string,
): Promise<void> {
  console.error(`[auto-reel] ${rowId} failed: ${reason}`);
  const nextMeta: AutoReelMeta = {
    ...meta,
    failed_at: new Date().toISOString(),
    fail_reason: reason.slice(0, 500),
  };
  const { error } = await sbAny
    .from("generated_posts")
    .update({
      customizations: { auto_reel: nextMeta } as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (error) {
    console.error(`[auto-reel] markFailed update error for ${rowId}: ${error.message}`);
  }
}
