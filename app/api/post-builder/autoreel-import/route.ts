/**
 * /api/post-builder/autoreel-import — AutoReel (autoreelapp.com) integration
 * ---------------------------------------------------------------------------
 *
 * AutoReel has no public API (confirmed 2026-08-05: learn.autoreelapp.com
 * documents nothing, auth is Clerk session cookies). What IS stable:
 * finished renders live on a public, unauthenticated CDN —
 * https://media.autoreelapp.com/renders/{id}/out.mp4 — so importing a
 * finished reel only needs that URL, which the user grabs via right-click →
 * "Copy Video Address" (or the Download link) on the AutoReel project page.
 *
 * GET  ?mls=X       → { listing, project }  — single-listing lookup for the panel
 * GET  ?q=park      → { results }           — property search (address / MLS)
 * POST { action: "save_project_link", mls_number, project_url }
 *                   → records the AutoReel project URL for a listing
 * POST { action: "import", mls_number, video_url }
 *                   → downloads the render, mirrors it into the
 *                     post-builder-reels bucket, generates captions from the
 *                     listing, and inserts a DRAFT generated_posts reel row.
 *                     Larissa reviews + publishes it from Saved Posts through
 *                     the existing reel pipeline (FB + IG, outbox, agent
 *                     emails — nothing new to learn).
 *
 * why draft, not scheduled: unlike the automatic post-publish reels, an
 * imported AutoReel video hasn't been seen next to its caption yet. Larissa
 * gets one review stop; publishing stays the standard flow.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCaption } from "@/lib/post-builder/captions";
import { ensureSupabaseHostedImages } from "@/lib/post-builder/rehost-images";
import {
  getAutoReelProject,
  upsertAutoReelProject,
  isAutoReelRenderUrl,
  isAutoReelShareLink,
  isValidAutoReelProjectUrl,
} from "@/lib/data/autoreel-db";
import type {
  PostBuilderListing,
  PostType,
  SourceMls,
} from "@/lib/post-builder/types";
import type { Json } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
// why 300: the render download is ~80MB for a 45s video; leave headroom for
// slow CDN reads + the storage re-upload on top of caption generation.
export const maxDuration = 300;
export const runtime = "nodejs";

/** template_id stamped on every imported AutoReel reel row. */
export const AUTOREEL_IMPORT_TEMPLATE_ID = "autoreel_import_v1";

/** Bucket for mirrored renders — public, 100MB per-file limit (checked
 *  2026-08-05), which fits observed AutoReel renders (~78MB @ 45s). */
const REELS_BUCKET = "post-builder-reels";

/** Refuse downloads bigger than this — protects function memory. Renders
 *  larger than the bucket cap fall back to the source URL anyway. */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

interface PropertyRow {
  id: string;
  mls_number: string;
  source_mls: string | null;
  status: "active" | "pending" | "sold" | "expired";
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  close_price: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  square_feet: number | null;
  property_type: string | null;
  public_remarks: string | null;
  hero_image_url: string | null;
  listing_office_name: string | null;
  agent_name: string | null;
  listing_date: string | null;
  unit_number: string | null;
}

const PROPERTY_COLUMNS =
  "id, mls_number, source_mls, status, address, city, state, zip, list_price, close_price, bedrooms, bathrooms_full, bathrooms_half, square_feet, property_type, public_remarks, hero_image_url, listing_office_name, agent_name, listing_date, unit_number";

function toListing(r: PropertyRow): PostBuilderListing {
  return {
    id: r.id,
    mls_number: r.mls_number,
    source_mls: (r.source_mls as SourceMls) ?? null,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    list_price: r.list_price,
    close_price: r.close_price,
    bedrooms: r.bedrooms,
    bathrooms_full: r.bathrooms_full,
    bathrooms_half: r.bathrooms_half,
    square_feet: r.square_feet,
    property_type: r.property_type,
    public_remarks: r.public_remarks,
    hero_image_url: r.hero_image_url,
    listing_office_name: r.listing_office_name,
    agent_name: r.agent_name,
    listing_date: r.listing_date,
    status: r.status,
    unit_number: r.unit_number,
  };
}

/** Status → the post type whose caption tone fits an imported listing reel. */
function postTypeForStatus(status: PropertyRow["status"]): PostType {
  switch (status) {
    case "pending":
      return "under_contract";
    case "sold":
      return "just_sold";
    default:
      return "just_listed";
  }
}

async function fetchProperty(mls: string): Promise<PropertyRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("properties")
    .select(PROPERTY_COLUMNS)
    .ilike("mls_number", mls.trim())
    .maybeSingle();
  if (error || !data) return null;
  return data as PropertyRow;
}

// ---------------------------------------------------------------------------
// GET — panel lookups
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const mls = (searchParams.get("mls") ?? "").trim();
  const q = (searchParams.get("q") ?? "").trim();

  if (mls) {
    const property = await fetchProperty(mls);
    if (!property) {
      return NextResponse.json(
        { ok: false, error: `No listing found for MLS ${mls}` },
        { status: 404 },
      );
    }
    const project = await getAutoReelProject(property.mls_number);
    return NextResponse.json({ ok: true, listing: summarize(property), project });
  }

  if (q.length >= 2) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("properties")
      .select(PROPERTY_COLUMNS)
      .or(`address.ilike.%${q.replace(/[,%()]/g, " ")}%,mls_number.ilike.%${q.replace(/[,%()]/g, " ")}%`)
      .order("updated_at", { ascending: false })
      .limit(8);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      results: ((data ?? []) as PropertyRow[]).map(summarize),
    });
  }

  return NextResponse.json({ ok: true, results: [] });
}

function summarize(p: PropertyRow) {
  return {
    mls_number: p.mls_number,
    source_mls: p.source_mls,
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    status: p.status,
    list_price: p.list_price,
    bedrooms: p.bedrooms,
    bathrooms_full: p.bathrooms_full,
    bathrooms_half: p.bathrooms_half,
    hero_image_url: p.hero_image_url,
    public_remarks: p.public_remarks,
  };
}

// ---------------------------------------------------------------------------
// POST — save project link / import a finished render
// ---------------------------------------------------------------------------

interface PostBody {
  action?: string;
  mls_number?: string;
  project_url?: string;
  video_url?: string;
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const mls = (body.mls_number ?? "").trim();
  if (!mls) {
    return NextResponse.json(
      { ok: false, error: "mls_number required" },
      { status: 400 },
    );
  }
  const property = await fetchProperty(mls);
  if (!property) {
    return NextResponse.json(
      { ok: false, error: `No listing found for MLS ${mls}` },
      { status: 404 },
    );
  }

  if (body.action === "save_project_link") {
    const url = (body.project_url ?? "").trim();
    if (!isValidAutoReelProjectUrl(url)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "That doesn't look like an AutoReel project link. Copy the address bar URL from the project page (autoreelapp.com/listings/...).",
        },
        { status: 400 },
      );
    }
    const project = await upsertAutoReelProject({
      mls_number: property.mls_number,
      source_mls: property.source_mls,
      project_url: url,
      created_by: profile.id,
    });
    if (!project) {
      return NextResponse.json(
        { ok: false, error: "Could not save the project link." },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, project });
  }

  if (body.action === "import") {
    return importRender({ property, videoUrl: (body.video_url ?? "").trim(), userId: profile.id });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}

async function importRender(args: {
  property: PropertyRow;
  videoUrl: string;
  userId: string;
}): Promise<NextResponse> {
  const { property, videoUrl, userId } = args;

  if (!videoUrl) {
    return NextResponse.json(
      { ok: false, error: "video_url required" },
      { status: 400 },
    );
  }
  if (!isAutoReelRenderUrl(videoUrl)) {
    // Share/project links need an AutoReel login our server doesn't have —
    // verified 2026-08-05: they 302 to /sign-in. Tell the user exactly how
    // to get the URL that works.
    const hint = isAutoReelShareLink(videoUrl)
      ? "That's an AutoReel page link, which needs a login to open. In AutoReel, right-click the video and choose \"Copy Video Address\" — the link should start with media.autoreelapp.com."
      : "Paste the AutoReel video link — right-click the video in AutoReel and choose \"Copy Video Address\". It should start with media.autoreelapp.com and end in .mp4.";
    return NextResponse.json({ ok: false, error: hint }, { status: 400 });
  }

  // ---- idempotency: one import per render URL per listing ---------------
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { data: dupe } = await sbAny
    .from("generated_posts")
    .select("id")
    .eq("template_id", AUTOREEL_IMPORT_TEMPLATE_ID)
    .eq("mls_number", property.mls_number)
    .eq("customizations->autoreel_import->>source_video_url", videoUrl)
    .limit(1)
    .maybeSingle();
  if (dupe) {
    return NextResponse.json({
      ok: true,
      gp_id: (dupe as { id: string }).id,
      already_imported: true,
    });
  }

  // ---- download the render ---------------------------------------------
  let videoBytes: ArrayBuffer | null = null;
  try {
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `AutoReel's CDN returned HTTP ${res.status} for that link. Re-copy the video address and try again.`,
        },
        { status: 502 },
      );
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_DOWNLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: "That video is over 200MB — too large to import." },
        { status: 413 },
      );
    }
    videoBytes = await res.arrayBuffer();
    if (videoBytes.byteLength > MAX_DOWNLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: "That video is over 200MB — too large to import." },
        { status: 413 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: `Could not download the video: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 },
    );
  }

  // ---- mirror into our storage -----------------------------------------
  // why mirror: AutoReel could expire renders; our own public URL keeps the
  // published reel's source stable. Fail open to the source URL — it's
  // public S3 and Meta can ingest it directly, so an oversized file or a
  // storage hiccup never blocks the import.
  let finalVideoUrl = videoUrl;
  let videoPath: string | null = null;
  try {
    const path = `autoreel/${property.mls_number}-${Date.now()}.mp4`;
    const { error: upErr } = await supabase.storage
      .from(REELS_BUCKET)
      .upload(path, videoBytes, { contentType: "video/mp4", upsert: true });
    if (upErr) {
      console.warn(
        `[autoreel-import] storage mirror failed (${upErr.message}) — publishing from the AutoReel CDN URL`,
      );
    } else {
      const { data: pub } = supabase.storage.from(REELS_BUCKET).getPublicUrl(path);
      finalVideoUrl = pub.publicUrl;
      videoPath = path;
    }
  } catch (e) {
    console.warn(
      "[autoreel-import] storage mirror crashed — publishing from the AutoReel CDN URL:",
      e instanceof Error ? e.message : e,
    );
  }

  // ---- captions from listing data --------------------------------------
  const listing = toListing(property);
  const postType = postTypeForStatus(property.status);
  const generated = await generateCaption({ listing, post_type: postType });
  if (!generated) {
    return NextResponse.json(
      { ok: false, error: "Caption generation failed — try again." },
      { status: 500 },
    );
  }

  // ---- insert the draft reel row ---------------------------------------
  const gpId = crypto.randomUUID();

  // Cover: IG Reels wants SOME https cover image. The listing hero is the
  // natural one; run it through the rehost helper so a Paragon/Bright CDN
  // URL (which serves Meta an HTML 403 — see rehost-images.ts) becomes a
  // Supabase URL first. Fail open to the raw hero URL.
  let coverUrl = property.hero_image_url ?? "";
  if (coverUrl) {
    try {
      const rehosted = await ensureSupabaseHostedImages([coverUrl], gpId);
      coverUrl = rehosted.urls[0] ?? coverUrl;
    } catch {
      // keep raw URL
    }
  }

  const { error: insErr } = await sbAny.from("generated_posts").insert({
    id: gpId,
    mls_number: property.mls_number,
    source_mls: property.source_mls,
    property_id: property.id,
    post_type: postType,
    variant: "v1",
    format: "story_9x16",
    template_id: AUTOREEL_IMPORT_TEMPLATE_ID,
    media_type: "reel",
    image_url: coverUrl || null,
    image_path: null,
    hero_image_source_url: coverUrl || null,
    video_url: finalVideoUrl,
    video_path: videoPath,
    template_props: {} as Json,
    caption: generated.caption,
    hashtags: generated.hashtags,
    captions_by_platform: generated.captions as unknown as Json,
    customizations: {
      autoreel_import: {
        source_video_url: videoUrl,
        imported_at: new Date().toISOString(),
        imported_by: userId,
        mirrored: videoPath !== null,
      },
    } as unknown as Json,
    status: "draft",
    test_mode: false,
    created_by: userId,
  });
  if (insErr) {
    return NextResponse.json(
      { ok: false, error: `Could not save the reel: ${insErr.message}` },
      { status: 500 },
    );
  }

  await upsertAutoReelProject({
    mls_number: property.mls_number,
    source_mls: property.source_mls,
    status: "video_imported",
    source_video_url: videoUrl,
    generated_post_id: gpId,
    created_by: userId,
  });

  return NextResponse.json({ ok: true, gp_id: gpId });
}
