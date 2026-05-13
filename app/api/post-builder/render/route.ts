/**
 * POST /api/post-builder/render
 * Body: { template_id: string, listing: PostBuilderListing, hero_image_url: string }
 *
 * Renders a Post Builder template to a PNG via headless Chromium and uploads
 * to Supabase Storage. Returns the public image URL.
 *
 * Long-running by design — Chromium spin-up + render is 4-10s typical. Vercel
 * function timeout bumped to 60s in vercel.json (or maxDuration export below).
 *
 * Auth: requires a signed-in Alliance user (any role).
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { renderTemplate } from "@/lib/post-builder/render";
import type { PostBuilderListing, PostCustomizations } from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
// 300s ceiling for cold-start safety — the @sparticuz/chromium-min binary
// downloads from GitHub release (~50MB) on first invocation per function
// instance, which we measured at 90s+ on production. Once Path B (Supabase-
// hosted binary, same region) lands this can drop back to 60s. Fluid Compute
// on Pro allows up to 800s; 300 is a safety belt.
export const maxDuration = 300;
export const runtime = "nodejs";

interface RenderRequestBody {
  template_id?: string;
  listing?: PostBuilderListing;
  hero_image_url?: string;
  /** Multi-photo variants (v4/v5) send an ordered list. Single-photo variants can still send hero_image_url. */
  hero_image_urls?: string[];
  /** Path A — optional user customizations baked into this render. */
  customizations?: PostCustomizations;
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: RenderRequestBody;
  try {
    body = (await request.json()) as RenderRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  if (!body.template_id || typeof body.template_id !== "string") {
    return NextResponse.json(
      { ok: false, error: "template_id required" },
      { status: 400 },
    );
  }
  if (!body.listing || typeof body.listing !== "object") {
    return NextResponse.json(
      { ok: false, error: "listing required" },
      { status: 400 },
    );
  }
  const hasArray = Array.isArray(body.hero_image_urls) && body.hero_image_urls.length > 0;
  const hasSingle = typeof body.hero_image_url === "string" && body.hero_image_url.length > 0;
  if (!hasArray && !hasSingle) {
    return NextResponse.json(
      { ok: false, error: "hero_image_url or hero_image_urls required" },
      { status: 400 },
    );
  }

  const result = await renderTemplate({
    template_id: body.template_id,
    listing: body.listing,
    hero_image_url: body.hero_image_url,
    hero_image_urls: body.hero_image_urls,
    customizations: body.customizations,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
