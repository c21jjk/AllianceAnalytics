/**
 * POST /api/post-builder/custom-feature
 * Body: { listing: PostBuilderListing }
 *
 * Returns an AI-suggested "Custom Feature" string for the FB Hero Card —
 * the third stat shown in the bottom strip (e.g. "SUNSET VIEWS",
 * "BEACHBLOCK"). User can override the suggestion before rendering.
 *
 * Returns { ok: true, suggestion: string | null }. A null suggestion
 * means Anthropic isn't configured OR no compelling feature surfaced
 * from the MLS remarks — UI should fall back to PROPERTY TYPE.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { suggestCustomFeature } from "@/lib/post-builder/custom-feature";
import type { PostBuilderListing } from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  listing?: PostBuilderListing;
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body.listing || typeof body.listing !== "object") {
    return NextResponse.json(
      { ok: false, error: "listing required" },
      { status: 400 },
    );
  }

  const suggestion = await suggestCustomFeature(body.listing);
  return NextResponse.json({ ok: true, suggestion });
}
