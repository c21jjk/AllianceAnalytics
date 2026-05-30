/**
 * POST /api/post-builder/preview-html — RETIRED 2026-05-30.
 *
 * This endpoint served HTML preview thumbnails for the legacy V1 template
 * primitives. The V1 system was removed; previews now come from saved
 * template preview PNGs (`template_definitions.preview_image_url`) rendered
 * directly in the picker. The route is kept as a stable 410 so any stale
 * client gets a clear signal instead of a hard crash.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    {
      ok: false,
      error:
        "preview-html is retired — template previews now use saved preview images.",
    },
    { status: 410 },
  );
}
