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
  publishToFBPage,
  publishToIG,
  type PublishResult,
} from "@/lib/post-builder/publish";
import { createOutboxRowForPost } from "@/lib/data/agent-outbox-db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

type Platform = "facebook" | "instagram";

interface RequestBody {
  generated_post_id?: string;
  platforms?: Platform[];
}

interface SuccessResponse {
  ok: true;
  results: PublishResult[];
  posted_to: Platform[];
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
    (p): p is Platform => p === "facebook" || p === "instagram",
  );
  if (platforms.length === 0) {
    return NextResponse.json(
      { ok: false, error: "at least one platform required" } satisfies ErrorResponse,
      { status: 400 },
    );
  }

  // Load credentials.
  const creds = await loadMetaCredentials();
  if (!creds) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Meta credentials not configured. Set page_id + page_access_token in /settings.",
      } satisfies ErrorResponse,
      { status: 412 },
    );
  }
  if (platforms.includes("instagram") && !creds.ig_business_account_id) {
    return NextResponse.json(
      {
        ok: false,
        error: "Instagram Business account ID not configured in api_credentials.",
      } satisfies ErrorResponse,
      { status: 412 },
    );
  }

  // Load the generated post + caption + image URL.
  const supabase = createAdminClient();
  const { data: gp, error: gpErr } = await supabase
    .from("generated_posts")
    .select(
      "id, mls_number, caption, hashtags, image_url, posted_to, platform_post_ids, property_id",
    )
    .eq("id", body.generated_post_id)
    .maybeSingle();
  if (gpErr || !gp) {
    return NextResponse.json(
      { ok: false, error: `generated_post not found: ${gpErr?.message ?? "not found"}` } satisfies ErrorResponse,
      { status: 404 },
    );
  }

  // Resolve the caption (caption + hashtags joined, since the FB body wants
  // the full text). Hashtags are already part of caption at download/save
  // time; the param is kept for forward-compat.
  const captionBody = resolveCaption(gp.caption, gp.hashtags);
  if (!captionBody) {
    return NextResponse.json(
      { ok: false, error: "generated_post has no caption" } satisfies ErrorResponse,
      { status: 412 },
    );
  }

  // why: every post in the system is now a single designed image — the
  // fb_multi bundle path was removed on 2026-05-14. Legacy bundle rows
  // (image_url null but bundle_url populated) error out here; the user
  // can rebuild as a single-image post from Studio if they want to repost.
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
  const imageUrls: string[] = [gp.image_url];

  // Fire publish calls in parallel (FB + IG don't depend on each other).
  const tasks: Promise<PublishResult>[] = [];
  if (platforms.includes("facebook")) {
    tasks.push(publishToFBPage({ creds, image_urls: imageUrls, caption: captionBody }));
  }
  if (platforms.includes("instagram")) {
    tasks.push(publishToIG({ creds, image_urls: imageUrls, caption: captionBody }));
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
  const lastError = failureResults.length > 0
    ? failureResults.map((r) => `[${r.platform}] ${r.error}`).join(" | ")
    : null;

  const { error: updateErr } = await supabase
    .from("generated_posts")
    .update({
      posted_to: newPostedTo,
      platform_post_ids: newPlatformPostIds,
      posted_at: successResults.length > 0 ? new Date().toISOString() : null,
      posted_by: successResults.length > 0 ? profile.id : null,
      last_post_error: lastError,
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
  if (successResults.length > 0 && gp.property_id) {
    try {
      const postUrls = successResults
        .filter((r) => r.permalink)
        .map((r) => ({ platform: r.platform, url: r.permalink as string }));
      await createOutboxRowForPost({
        generated_post_id: gp.id,
        property_id: gp.property_id,
        post_urls: postUrls,
        caption: captionBody,
        thumbnail_url: gp.image_url,
      });
    } catch (e) {
      console.error("[post] agent outbox row create failed:", e);
    }
  }

  const response: SuccessResponse = {
    ok: true,
    results,
    posted_to: newPostedTo as Platform[],
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
