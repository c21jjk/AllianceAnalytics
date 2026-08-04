/**
 * POST /api/post-builder/post
 * Body: { generated_post_id: string, platforms: ('facebook'|'instagram')[] }
 *
 * Phase 5A — publish a previously-generated single-image post to Facebook
 * Page and/or Instagram Business via the Meta Graph API. Admin-only
 * (publishing is a high-trust action).
 *
 * The FB multi-photo bundle path was removed on 2026-05-14 — every post is
 * now one designed image. Legacy fb_multi rows in the table still load but
 * will return an error when the user tries to re-publish them.
 *
 * Returns per-platform results so the UI can show "FB succeeded, IG failed"
 * partial-success states. Updates posted_to[], platform_post_ids{},
 * posted_at, last_post_error on the generated_posts row.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
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
  type PublishResult,
} from "@/lib/post-builder/publish";
import { notifyListingAgentsForPost } from "@/lib/email/agent-post-notification";
import { openHousePublishGuard } from "@/lib/post-builder/oh-publish-guard";
import {
  ensureSupabaseHostedImages,
  rewriteAdditionalImages,
} from "@/lib/post-builder/rehost-images";
import { notifyAdmins } from "@/lib/push/send";
import { maybeKickoffAutoReel } from "@/lib/post-builder/auto-reel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

type Platform = "facebook" | "instagram" | "tiktok";

interface RequestBody {
  generated_post_id?: string;
  platforms?: Platform[];
  /**
   * 2026-07-24 — explicit escape hatch for the stale open-house guard.
   * When true, the "every open house in this post has already ended"
   * block is skipped (e.g. an intentional recap). Defaults to false.
   */
  allow_past_open_house?: boolean;
}

interface SuccessResponse {
  ok: true;
  results: PublishResult[];
  posted_to: Platform[];
  /**
   * 2026-07-23 — platforms that were requested but skipped because this row
   * already published to them. Lets the UI say "already posted to Facebook"
   * instead of silently double-posting (which is what used to happen when a
   * partial-failure retry re-sent every checked platform).
   */
  skipped_already_posted?: Platform[];
}

interface ErrorResponse {
  ok: false;
  error: string;
}

export async function POST(request: Request) {
  // Admin-only — publishing is irreversible from our side.
  const profile = await requireAdmin();

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" } satisfies ErrorResponse,
      { status: 400 },
    );
  }

  if (!body.generated_post_id) {
    return NextResponse.json(
      { ok: false, error: "generated_post_id required" } satisfies ErrorResponse,
      { status: 400 },
    );
  }
  const platforms: Platform[] = (body.platforms ?? []).filter(
    (p): p is Platform =>
      p === "facebook" || p === "instagram" || p === "tiktok",
  );
  if (platforms.length === 0) {
    return NextResponse.json(
      { ok: false, error: "at least one platform required" } satisfies ErrorResponse,
      { status: 400 },
    );
  }

  // Load credentials. Meta covers FB + IG; TikTok is a separate row in
  // api_credentials with its own access_token.
  const needsMeta =
    platforms.includes("facebook") || platforms.includes("instagram");
  const needsTikTok = platforms.includes("tiktok");

  const creds = needsMeta ? await loadMetaCredentials() : null;
  if (needsMeta && !creds) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Meta credentials not configured. Set page_id + page_access_token in /settings.",
      } satisfies ErrorResponse,
      { status: 412 },
    );
  }
  if (
    needsMeta &&
    creds &&
    platforms.includes("instagram") &&
    !creds.ig_business_account_id
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Instagram Business account ID not configured in api_credentials.",
      } satisfies ErrorResponse,
      { status: 412 },
    );
  }

  const ttCreds = needsTikTok ? await loadTikTokCredentials() : null;
  if (needsTikTok && !ttCreds) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "TikTok credentials not configured. Connect TikTok in /settings before publishing to TikTok.",
      } satisfies ErrorResponse,
      { status: 412 },
    );
  }

  // Load the generated post + caption + image URL.
  const supabase = createAdminClient();
  const { data: gp, error: gpErr } = await supabase
    .from("generated_posts")
    .select(
      // why: media_type + video_url added Day 1; reel_duration_ms kept on
      // the SELECT for future analytics even though publish doesn't use it.
      // Phase D — captions_by_platform added so each platform receives
      // its tuned caption variant; falls back to the legacy `caption`
      // when a platform's entry is missing.
      // 2026-05-27 — template_id added so the publish path can detect
      // multi-OH events (prefix `multi_oh_event_`) and suppress the hero
      // image from the published carousel; the hero is a Studio-only
      // visual preview, not a slide.
      // 2026-05-28 — posted_at + posted_by added so a partial-success RETRY
      // preserves a prior successful publish's timestamp/author instead of
      // nulling them when the current attempt has zero successes.
      // 2026-07-29 — scheduled_for added so Post Now can consume the schedule
      // keys of the platforms it just published; without this a scheduled
      // row that was manually posted early stayed "due" and the cron
      // re-published it on the next tick (double post).
      "id, mls_number, caption, hashtags, captions_by_platform, image_url, posted_to, posted_at, posted_by, platform_post_ids, property_id, additional_images, scheduled_for, media_type, video_url, reel_duration_ms, test_mode, template_id, post_type",
    )
    .eq("id", body.generated_post_id)
    .maybeSingle();
  if (gpErr || !gp) {
    return NextResponse.json(
      { ok: false, error: `generated_post not found: ${gpErr?.message ?? "not found"}` } satisfies ErrorResponse,
      { status: 404 },
    );
  }

  // 2026-07-24 — stale open-house guard. Block publishing an open-house
  // post when EVERY open house across its properties has already ended
  // (a late Post Now would advertise a past event). Posts with at least
  // one upcoming/running window pass; lookup failures fail open; the
  // body's allow_past_open_house flag is the intentional-recap escape
  // hatch. See lib/post-builder/oh-publish-guard.ts.
  if (body.allow_past_open_house !== true) {
    const ohGuard = await openHousePublishGuard({
      generated_post_id: gp.id,
      property_id: gp.property_id,
      post_type: gp.post_type,
      template_id: gp.template_id,
    });
    if (ohGuard.applicable && !ohGuard.upcoming) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Every open house in this post has already ended, so publishing it now would advertise a past event. If this is an intentional recap, retry with allow_past_open_house set.",
        } satisfies ErrorResponse,
        { status: 412 },
      );
    }
  }

  // 2026-07-23 — never double-post. Platforms this row already published to
  // are removed from the requested set instead of being re-published. Before
  // this, a retry after a partial failure (e.g. FB ok, IG "Media ID is not
  // available") re-sent every checked platform and produced a duplicate FB
  // post. Skipped platforms are surfaced in the response so the UI can say
  // "already posted" rather than showing a fresh success.
  const alreadyPostedTo = (gp.posted_to ?? []) as Platform[];
  const skippedAlreadyPosted = platforms.filter((p) =>
    alreadyPostedTo.includes(p),
  );
  const platformsToPublish = platforms.filter(
    (p) => !alreadyPostedTo.includes(p),
  );
  if (platformsToPublish.length === 0) {
    return NextResponse.json({
      ok: true,
      results: [],
      posted_to: alreadyPostedTo,
      skipped_already_posted: skippedAlreadyPosted,
    } satisfies SuccessResponse);
  }

  // Phase D — per-platform captions. Each platform reads its tuned
  // variant from `captions_by_platform`, falling back to the legacy
  // single `caption` column when the per-platform map is empty or
  // missing the requested platform (older rows, or rows saved before
  // this migration). `captionBody` keeps the legacy variable name as
  // the IG default so non-platform-specific paths (outbox row, error
  // message) read the same value they did before.
  const captionBody = resolveCaption(gp.caption, gp.hashtags);
  const captionByPlatform = {
    facebook: resolvePerPlatformCaption(
      gp.caption,
      gp.captions_by_platform,
      "facebook",
    ),
    instagram: resolvePerPlatformCaption(
      gp.caption,
      gp.captions_by_platform,
      "instagram",
    ),
    tiktok: resolvePerPlatformCaption(
      gp.caption,
      gp.captions_by_platform,
      "tiktok",
    ),
  } as const;
  // why: gate on ANY available caption source — legacy column OR any
  // per-platform variant. Previously this only checked the legacy
  // column, which rejected rows that had per-platform captions set but
  // an empty legacy column (e.g., posts saved before the user ran
  // Generate Captions, or rows where only the per-platform map was
  // populated).
  const hasAnyCaption =
    captionBody !== "" ||
    captionByPlatform.facebook !== "" ||
    captionByPlatform.instagram !== "" ||
    captionByPlatform.tiktok !== "";
  if (!hasAnyCaption) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "generated_post has no caption on any platform. Open it in the Post Builder, generate or paste a caption, then try again.",
      } satisfies ErrorResponse,
      { status: 412 },
    );
  }

  // why: Build publish task list. Branching depends on media_type:
  //   - 'reel'  → publishReelToIG / publishVideoToFB / publishVideoToTikTok
  //               (native short-form video on all three platforms — same
  //                MP4, each platform's own publish endpoint + caption).
  //   - 'image' → image/carousel path (unchanged from V1).
  //
  // 2026-05-22 — the previous comment claimed TikTok video publishing
  // wasn't implemented; that's stale. `publishVideoToTikTok` ships the
  // MP4 to TT's /v2/post/publish/video/init endpoint exactly the way
  // Meta receives it, so a single Reel render fans out to IG + FB + TT
  // in parallel.
  //
  // Each platform call is independent; we await all in parallel. The TT
  // call uses its own access token; Meta uses the page token. Calls that
  // weren't requested are skipped before this point via the `needs*` flags.
  // why: test_mode is per-row. true → publishers route through hidden/
  // draft paths. The system_config global flag is ONLY used as the
  // default at row-creation time; at publish time the row value wins.
  const test_mode = gp.test_mode === true;

  const tasks: Promise<PublishResult>[] = [];

  if (gp.media_type === "reel") {
    // ============ Reel branch — video publishing ============

    // why: FB Page videos only require the MP4 URL. No cover required —
    // FB pulls a poster automatically (and we don't expose a cover picker
    // for FB videos anyway).
    if (platformsToPublish.includes("facebook") && creds) {
      if (!gp.video_url) {
        tasks.push(
          Promise.resolve({
            ok: false,
            platform: "facebook" as const,
            error: "Reel row has no video_url — render may have failed.",
          }),
        );
      } else {
        tasks.push(
          publishVideoToFB({
            creds,
            video_url: gp.video_url,
            caption: captionByPlatform.facebook,
            test_mode,
          }),
        );
      }
    }

    // why: IG Reels require both video_url AND cover_url. The cover is
    // gp.image_url (the rendered cover frame produced by the worker on
    // Day 2). Without it Meta will pull frame[0] which is usually a
    // blank / black frame for ours.
    if (platformsToPublish.includes("instagram") && creds) {
      if (!gp.video_url) {
        tasks.push(
          Promise.resolve({
            ok: false,
            platform: "instagram" as const,
            error: "Reel row has no video_url.",
          }),
        );
      } else if (!gp.image_url) {
        tasks.push(
          Promise.resolve({
            ok: false,
            platform: "instagram" as const,
            error: "Reel row has no cover image_url.",
          }),
        );
      } else {
        tasks.push(
          publishReelToIG({
            creds,
            video_url: gp.video_url,
            cover_url: gp.image_url,
            caption: captionByPlatform.instagram,
            test_mode,
          }),
        );
      }
    }

    // why: TikTok video publishing goes through publishVideoToTikTok —
    // mirrors the Meta video flow: validate video_url, dispatch to the
    // /v2/post/publish/video/init/ endpoint, poll status with a 60s
    // deadline. The TT credential lookup already ran; if it's null we
    // just skip silently like the other branches.
    if (platformsToPublish.includes("tiktok") && ttCreds) {
      if (!gp.video_url) {
        tasks.push(
          Promise.resolve({
            ok: false,
            platform: "tiktok" as const,
            error: "Reel row has no video_url — render may have failed.",
          }),
        );
      } else {
        tasks.push(
          publishVideoToTikTok({
            creds: ttCreds,
            video_url: gp.video_url,
            caption: captionByPlatform.tiktok,
            test_mode,
          }),
        );
      }
    }
  } else {
    // ============ Image / carousel branch — UNCHANGED ============

    // why: every image-mode post in the system is now a single designed
    // image — the fb_multi bundle path was removed on 2026-05-14. Legacy
    // bundle rows (image_url null but bundle_url populated) error out
    // here; the user can rebuild as a single-image post from Studio if
    // they want to repost. This check only applies to image media — the
    // Reel branch above does its own per-platform image_url validation.
    if (!gp.image_url) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "generated_post has no image_url — looks like a legacy FB bundle. Rebuild as a single-image post in Studio before publishing.",
        } satisfies ErrorResponse,
        { status: 412 },
      );
    }

    // why: Build the full carousel image array — slide 0 is always the
    // designed hero (gp.image_url), slides 1..N come from
    // gp.additional_images (jsonb array of CarouselSlide objects, see
    // lib/post-builder/canvas-editor/types.ts). Each element is shape
    // `{ id: string, url: string, source: "listing" | "upload",
    //    listingPhotoSequence?: number }`, but we only need `url` here.
    //
    // Validation is defensive: bad rows (missing url, malformed entry) are
    // skipped with a console.warn rather than failing the whole publish —
    // one bad slide should not block a successful post. The total slide
    // count is capped at IG's limit of 10 (publish.ts publishToIG enforces
    // the same ceiling, but logging a warning here is friendlier when the
    // mistake is in the saved row, not the publish flow).
    const IG_MAX_SLIDES = 10;
    const validatedAdditionalUrls: string[] = [];
    const rawAdditional: unknown = gp.additional_images;
    if (Array.isArray(rawAdditional)) {
      for (let i = 0; i < rawAdditional.length; i++) {
        const entry: unknown = rawAdditional[i];
        if (
          entry !== null &&
          typeof entry === "object" &&
          "url" in entry &&
          typeof (entry as { url: unknown }).url === "string" &&
          (entry as { url: string }).url.trim().length > 0
        ) {
          validatedAdditionalUrls.push((entry as { url: string }).url);
        } else {
          console.warn(
            `[post] skipping invalid additional_images[${i}] on gp ${gp.id}:`,
            entry,
          );
        }
      }
    }
    // 2026-05-27 — Multi-OH posts: the hero image is an event-summary
    // graphic used as a visual preview / Studio thumbnail. ALL the event
    // details (addresses, dates, times) live in the caption itself, so
    // the hero is NOT published as a carousel slide — only the per-property
    // slides go out. Detection mirrors the synthetic `template_id` prefix
    // written by /api/post-builder/multi-oh-generate.
    //
    // Defensive fallback: if a multi-OH row somehow has no per-property
    // slides (failed generation, manual DB edit), we still publish the hero
    // so the post doesn't fail with zero images — the publish helpers all
    // require at least one image.
    const isMultiOhEvent =
      typeof gp.template_id === "string" &&
      gp.template_id.startsWith("multi_oh_event_");
    let imageUrls: string[] =
      isMultiOhEvent && validatedAdditionalUrls.length > 0
        ? validatedAdditionalUrls
        : [gp.image_url, ...validatedAdditionalUrls];
    // 2026-07-24 — actually TRIM to IG's 10-image cap. publishToIG hard
    // ERRORS above 10 (it never trimmed, despite this comment's previous
    // claim), so an 11-image carousel (hero + 10 Studio slides) failed
    // the IG publish outright. Trailing slides are dropped with a warn;
    // the Studio picker is also capped at 9 now so this is a backstop.
    if (imageUrls.length > IG_MAX_SLIDES) {
      console.warn(
        `[post] gp ${gp.id} has ${imageUrls.length} slides; trimming to IG's cap of ${IG_MAX_SLIDES} (dropping ${imageUrls.length - IG_MAX_SLIDES}).`,
      );
      imageUrls = imageUrls.slice(0, IG_MAX_SLIDES);
    }

    // 2026-08-03 — mirror MLS-CDN slides into our storage before publishing.
    // Paragon's CDN (zimg.paragon.ice.com) serves Meta's fetcher an HTML 403
    // instead of the image, which killed the IG publish with "Only photo or
    // video can be accepted as media type" (gp c4d892f9). Fail-open inside
    // the helper: a mirror hiccup publishes the original URL. The rewritten
    // slide URLs are persisted best-effort so future retries and the cron
    // skip the mirror work.
    const rehost = await ensureSupabaseHostedImages(imageUrls, gp.id);
    imageUrls = rehost.urls;
    const rewrittenAdditional = rewriteAdditionalImages(
      gp.additional_images,
      rehost.replaced,
    );
    if (rewrittenAdditional) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rwErr } = await (supabase as any)
        .from("generated_posts")
        .update({ additional_images: rewrittenAdditional })
        .eq("id", gp.id);
      if (rwErr) {
        console.warn(
          `[post] persisting mirrored slide URLs failed for gp ${gp.id} (publishing continues):`,
          rwErr.message,
        );
      }
    }

    if (platformsToPublish.includes("facebook") && creds) {
      tasks.push(
        publishToFBPage({
          creds,
          image_urls: imageUrls,
          caption: captionByPlatform.facebook,
          test_mode,
        }),
      );
    }
    if (platformsToPublish.includes("instagram") && creds) {
      tasks.push(
        publishToIG({
          creds,
          image_urls: imageUrls,
          caption: captionByPlatform.instagram,
          test_mode,
        }),
      );
    }
    if (platformsToPublish.includes("tiktok") && ttCreds) {
      tasks.push(
        publishToTikTok({
          creds: ttCreds,
          image_urls: imageUrls,
          caption: captionByPlatform.tiktok,
          test_mode,
        }),
      );
    }
  }

  const results = await Promise.all(tasks);

  // Update generated_posts with what succeeded.
  const successResults = results.filter((r): r is Extract<PublishResult, { ok: true }> => r.ok);
  const failureResults = results.filter((r): r is Extract<PublishResult, { ok: false }> => !r.ok);

  const newPostedTo = Array.from(
    new Set([...(gp.posted_to ?? []), ...successResults.map((r) => r.platform)]),
  );
  const existingIds = (gp.platform_post_ids ?? {}) as Record<string, string>;
  const newPlatformPostIds = { ...existingIds };
  for (const r of successResults) {
    newPlatformPostIds[r.platform] = r.platform_post_id;
  }
  // Capture each platform's public permalink. The sync ingest joins a synced
  // post back to this builder row by permalink (stable, identical on both
  // sides), which is what links Open House posts (no MLS# in caption) to their
  // homes. Stored on platform_permalinks (jsonb), keyed by platform.
  //
  // 2026-07-23 — MERGE with the existing permalinks instead of overwriting.
  // Before this, an IG-only retry after a partial failure wiped the stored
  // FB permalink (the update wrote only the current attempt's links).
  // platform_permalinks isn't in the generated Database types yet, so it's
  // read through an untyped client — same pattern as the update below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAnyRead = supabase as any;
  const { data: permRow } = await sbAnyRead
    .from("generated_posts")
    .select("platform_permalinks")
    .eq("id", gp.id)
    .maybeSingle();
  const existingPermalinks = (permRow?.platform_permalinks ?? {}) as Record<
    string,
    string
  >;
  const newPermalinks: Record<string, string> = { ...existingPermalinks };
  for (const r of successResults) {
    if (r.permalink) newPermalinks[r.platform] = r.permalink;
  }
  const lastError = failureResults.length > 0
    ? failureResults.map((r) => `[${r.platform}] ${r.error}`).join(" | ")
    : null;

  // 2026-07-29 — consume schedule keys for every platform this row has now
  // published to (newPostedTo covers this attempt's successes PLUS any
  // earlier publishes). scheduled_for is a jsonb map {platform: ISO}; the
  // cron's due scan selects rows via `.neq("scheduled_for", "{}")` plus a
  // per-key timestamp OR-predicate, so an all-keys-consumed map must be
  // written as {} (not null) to fall out of that scan. Keys for platforms
  // that have NOT published (e.g. a future TikTok schedule) are preserved
  // untouched, and the update below only includes scheduled_for when a key
  // was actually removed so we never clobber a concurrent schedule edit.
  const existingSched: Record<string, string> =
    gp.scheduled_for &&
    typeof gp.scheduled_for === "object" &&
    !Array.isArray(gp.scheduled_for)
      ? { ...(gp.scheduled_for as Record<string, string>) }
      : {};
  const remainingSched: Record<string, string> = { ...existingSched };
  for (const p of newPostedTo) delete remainingSched[p];
  const schedChanged =
    Object.keys(remainingSched).length !== Object.keys(existingSched).length;

  // platform_permalinks isn't in the generated Database types yet; use a
  // permissive client for this update (mirrors the untyped-client pattern
  // used elsewhere for new columns).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { error: updateErr } = await sbAny
    .from("generated_posts")
    .update({
      posted_to: newPostedTo,
      platform_post_ids: newPlatformPostIds,
      platform_permalinks: newPermalinks,
      // 2026-05-28 — posted_at marks the FIRST successful publish and must
      // never be cleared by a later attempt. Previously this nulled both
      // fields whenever the CURRENT attempt had no successes, so retrying a
      // failed platform on an already-published post (e.g. IG up, TikTok
      // retry fails) wiped the real publish timestamp + author. Now: keep an
      // existing value untouched; only stamp now()/profile on the first
      // success; leave null only when the post has never published.
      posted_at:
        gp.posted_at ?? (successResults.length > 0 ? new Date().toISOString() : null),
      posted_by:
        gp.posted_by ?? (successResults.length > 0 ? profile.id : null),
      last_post_error: lastError,
      // 2026-07-29 — flip status to "posted" (the exact value the cron
      // writes on its path) once the row has published anywhere: either
      // this attempt succeeded or a prior publish already stamped
      // posted_at. Post Now previously never wrote status, so a published
      // row stayed filed under Draft/Scheduled on /saved-posts forever.
      // Omitted entirely when the row has never published, leaving
      // whatever status it already has untouched.
      ...(successResults.length > 0 || gp.posted_at
        ? { status: "posted" }
        : {}),
      // 2026-07-29 — see remainingSched above: strip published platforms
      // from the schedule map so the cron cannot re-publish them.
      ...(schedChanged ? { scheduled_for: remainingSched } : {}),
      // 2026-07-29 — bump updated_at whenever we consumed a schedule key.
      // The cron claims due rows with an optimistic-concurrency guard on
      // updated_at; flipping the token here makes any cron tick that
      // SELECTed this row before Post Now finished lose its claim and
      // bail instead of double publishing.
      ...(schedChanged ? { updated_at: new Date().toISOString() } : {}),
    })
    .eq("id", gp.id);
  if (updateErr) {
    // Don't fail the request — posts went up. Just log so we know.
    console.error("[post] generated_posts update failed:", updateErr.message);
  }

  // Phase 5 — Agent Activation Loop. After a successful publish, drop a row
  // into the agent_post_outbox so the listing agent can be notified to
  // reshare. Idempotent per generated_post_id, so re-publishing the same
  // post (e.g. retry after partial failure) doesn't stack notifications.
  // Failure here NEVER fails the publish — the posts went up, the agent
  // notification is best-effort scaffolding for the post-publish workflow.
  //
  // 2026-08-04 — !test_mode gate. A test-mode publish puts the post up hidden
  // (draft/private on-platform), so telling real agents to go like and reshare
  // it points them at something they cannot see. Same rationale as the
  // auto-reel guard below. notifyAdmins (our own push) stays ungated.
  if (successResults.length > 0 && gp.property_id && !test_mode) {
    try {
      const postUrls = successResults
        .filter((r) => r.permalink)
        .map((r) => ({ platform: r.platform, url: r.permalink as string }));
      // 2026-07-23 — engagement seeding for EVERY listing agent in the post
      // (anchor + linked properties; a multi-OH weekend post notifies all
      // featured agents, deduped per agent). Outbox rows + emails are both
      // handled inside; best-effort — never blocks the publish response.
      await notifyListingAgentsForPost({
        generated_post_id: gp.id,
        anchor_property_id: gp.property_id,
        post_urls: postUrls,
        caption: captionBody,
        thumbnail_url: gp.image_url,
        send_emails: true,
      });
    } catch (e) {
      console.error("[post] agent notification failed:", e);
    }
  }

  // 2026-07-24 — Mobile push (Phase D). Ping the admins' phones the moment
  // the post is live / failed, alongside the agent email hook. Best-effort:
  // a notification problem never affects the publish response.
  try {
    const prettyPlatform = (p: string) =>
      p === "facebook" ? "Facebook" : p === "instagram" ? "Instagram" : "TikTok";
    if (successResults.length > 0) {
      const livePlatforms = successResults.map((r) => prettyPlatform(r.platform));
      const firstPermalink =
        successResults.find((r) => r.permalink)?.permalink ?? null;
      await notifyAdmins({
        type: "publish_result",
        title: `Post live on ${livePlatforms.join(" + ")}`,
        body: `${gp.mls_number} — ${(captionBody || "").slice(0, 120)}`,
        url: firstPermalink ?? "/m/track",
        tag: `publish-${gp.id}`,
        metadata: {
          generated_post_id: gp.id,
          mls_number: gp.mls_number,
          platforms: successResults.map((r) => r.platform),
          url: firstPermalink ?? "/m/track",
        },
      });
    }
    if (failureResults.length > 0) {
      await notifyAdmins({
        type: "publish_failure",
        title: `Publish failed on ${failureResults.map((r) => prettyPlatform(r.platform)).join(" + ")}`,
        body: `${gp.mls_number} — ${failureResults.map((r) => r.error).join(" · ").slice(0, 160)}`,
        url: "/saved-posts",
        tag: `publish-fail-${gp.id}`,
        metadata: {
          generated_post_id: gp.id,
          mls_number: gp.mls_number,
          errors: failureResults.map((r) => ({ platform: r.platform, error: r.error })),
          url: "/saved-posts",
        },
      });
    }
  } catch (e) {
    console.error("[post] admin push notification failed:", e);
  }

  // 2026-07-23 — Auto-Reel pipeline (John: "fully automatic, no extra steps
  // for Larissa"). Every successfully-published standard image post spawns a
  // ~45-min-delayed Reel of the same card + photos for FB + IG, because
  // API photo-album posts get poor personal-feed distribution while video
  // gets FB's best. All guards (image-only, not test, not multi-OH, has
  // photos, once per source post) live inside maybeKickoffAutoReel; it
  // never throws. Awaited (not fire-and-forget) because Vercel may freeze
  // the function right after the response is returned.
  if (successResults.length > 0 && gp.media_type !== "reel" && !test_mode) {
    await maybeKickoffAutoReel(gp.id);
  }

  const response: SuccessResponse = {
    ok: true,
    results,
    posted_to: newPostedTo as Platform[],
    ...(skippedAlreadyPosted.length > 0
      ? { skipped_already_posted: skippedAlreadyPosted }
      : {}),
  };
  return NextResponse.json(response);
}

function resolveCaption(caption: string | null, hashtags: string[] | null): string {
  const cap = (caption ?? "").trim();
  if (!cap) return "";
  // Hashtags are joined into caption at download/save time; the param
  // is kept for forward-compat (e.g. per-platform hashtag tweaks later).
  return cap;
  void hashtags;
}

/**
 * Phase D — resolve the platform-specific caption to publish. Reads
 * `captions_by_platform[platform]` and joins its caption + hashtags
 * fields into a single string the publisher consumes. Falls back to the
 * legacy `caption` column when:
 *   • the captions_by_platform map is absent or empty (older rows
 *     written before this migration)
 *   • the requested platform key isn't present (e.g. Larissa cleared
 *     the FB tab to use the legacy default)
 *   • the platform entry's caption is empty
 *
 * Returns "" only when both the per-platform value AND the legacy
 * caption are empty. The publish flow gates on the legacy value
 * upstream, so this function is safe to call without further checks.
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
  // Fallback: the legacy single caption column. Already includes any
  // hashtags that were baked in at save time (joinCaptionAndTags).
  return (legacy ?? "").trim();
}
