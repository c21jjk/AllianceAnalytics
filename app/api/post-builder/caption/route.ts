/**
 * POST /api/post-builder/caption
 * Body: { listing: PostBuilderListing, post_type: PostType }
 *
 * Generates a caption + hashtag set for a Post Builder render. Always returns
 * a usable result — falls back to a deterministic caption if Anthropic isn't
 * configured.
 *
 * Auth: requires a signed-in Alliance user.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { generateCaption } from "@/lib/post-builder/captions";
import type { PostBuilderListing, PostType } from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

const VALID_POST_TYPES: readonly PostType[] = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
] as const;

interface CaptionRequestBody {
  listing?: PostBuilderListing;
  post_type?: string;
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: CaptionRequestBody;
  try {
    body = (await request.json()) as CaptionRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  if (!body.listing || typeof body.listing !== "object") {
    return NextResponse.json(
      { ok: false, error: "listing required" },
      { status: 400 },
    );
  }
  if (
    !body.post_type ||
    typeof body.post_type !== "string" ||
    !(VALID_POST_TYPES as readonly string[]).includes(body.post_type)
  ) {
    return NextResponse.json(
      { ok: false, error: "valid post_type required" },
      { status: 400 },
    );
  }

  const result = await generateCaption({
    listing: body.listing,
    post_type: body.post_type as PostType,
  });

  if (!result) {
    return NextResponse.json(
      { ok: false, error: "caption_generation_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    caption: result.caption,
    hashtags: result.hashtags,
    mls_hashtag: result.mls_hashtag,
  });
}
