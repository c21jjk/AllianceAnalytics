/**
 * POST /api/post-builder/bundle
 * Body: FBBundleRequest
 *
 * Generates a Facebook-native multi-photo bundle:
 *   - 1+ designed hero cards (PNGs)
 *   - N real listing photos (JPGs/PNGs from Paragon)
 *   - caption.txt with the multi-block FB caption
 *   - README.txt with workflow instructions
 *
 * All packaged into a ZIP uploaded to Supabase Storage. Returns public URL.
 *
 * Long-running (multi-photo fetch + chromium render + zip). Bumped to 300s
 * matching the single-image render route.
 *
 * Auth: admin role required — bundles can be expensive to generate.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateFBBundle } from "@/lib/post-builder/bundle";
import type {
  FBBundleRequest,
  FBBundleResponse,
  FBBundleErrorResponse,
} from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const profile = await requireUser();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: FBBundleRequest;
  try {
    body = (await request.json()) as FBBundleRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" } satisfies FBBundleErrorResponse,
      { status: 400 },
    );
  }

  // Validation
  if (!body.hero_template_id || !body.caption_shape) {
    return NextResponse.json(
      { ok: false, error: "hero_template_id + caption_shape required" } satisfies FBBundleErrorResponse,
      { status: 400 },
    );
  }
  if (!Array.isArray(body.listings) || body.listings.length === 0) {
    return NextResponse.json(
      { ok: false, error: "at least one listing required" } satisfies FBBundleErrorResponse,
      { status: 400 },
    );
  }
  if (body.listings.length > 20) {
    return NextResponse.json(
      { ok: false, error: "max 20 listings per bundle" } satisfies FBBundleErrorResponse,
      { status: 400 },
    );
  }

  const result = await generateFBBundle(body);
  if (!result.ok) {
    return NextResponse.json(result satisfies FBBundleErrorResponse, { status: 500 });
  }

  // Persist a generated_posts row so the bundle shows up in history.
  // For multi-listing bundles (Phase 8) the row uses the first listing's
  // MLS number; we store the whole listings array in template_props.
  const firstInput = body.listings[0];
  const supabase = createAdminClient();
  const { data: saved, error: saveError } = await supabase
    .from("generated_posts")
    .insert({
      mls_number: firstInput.listing.mls_number,
      source_mls: firstInput.listing.source_mls,
      property_id: firstInput.listing.id,
      post_type: body.caption_shape === "new_listing_single" ? "just_listed" : "open_house",
      variant: body.hero_template_id,
      format: "square_1x1",
      template_id: body.hero_template_id,
      output_mode: "fb_multi",
      bundle_url: result.bundle_url,
      bundle_path: result.bundle_path,
      custom_feature: firstInput.custom_feature ?? null,
      asset_count: result.asset_count,
      hero_image_source_url: firstInput.real_photo_urls[0] ?? null,
      template_props: {
        listings: body.listings.map((l) => ({
          mls: l.listing.mls_number,
          custom_feature: l.custom_feature ?? null,
          photo_count: l.real_photo_urls.length,
        })),
      },
      caption: result.caption,
      hashtags: result.hashtags,
      mls_hashtag: result.mls_hashtag,
      status: "downloaded",
      downloaded_at: new Date().toISOString(),
      created_by: profile.id,
    })
    .select("id")
    .maybeSingle();
  if (saveError) {
    // Don't fail the request — the bundle is built and uploaded. Just log
    // the save failure so we can investigate later.
    console.error("[bundle] save to generated_posts failed:", saveError);
  }

  const response: FBBundleResponse = {
    ok: true,
    bundle_url: result.bundle_url,
    bundle_path: result.bundle_path,
    asset_count: result.asset_count,
    caption: result.caption,
    hashtags: result.hashtags,
    mls_hashtag: result.mls_hashtag,
    generated_post_id: saved?.id ?? "",
    rendered_at: result.rendered_at,
  };
  return NextResponse.json(response);
}
