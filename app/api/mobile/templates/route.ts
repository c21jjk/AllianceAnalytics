import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { listTemplatesForPostType } from "@/lib/template-builder";
import type { PostFormat, PostType } from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";

/**
 * Mobile quick-create — published DB templates for a post type + format.
 *
 * GET /api/mobile/templates?post_type=just_listed&format=square_1x1
 *
 * Wraps the server-only listTemplatesForPostType registry call. The
 * returned TemplateMeta list is slim (id, name, is_default, preview) —
 * exactly what the mobile picker needs; the render route resolves the
 * full schema by id at render time.
 */

const VALID_POST_TYPES: readonly PostType[] = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
];

const VALID_FORMATS: readonly PostFormat[] = ["square_1x1", "story_9x16"];

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const postTypeRaw = url.searchParams.get("post_type") ?? "";
  const formatRaw = url.searchParams.get("format") ?? "square_1x1";

  const post_type = VALID_POST_TYPES.find((t) => t === postTypeRaw);
  if (!post_type) {
    return NextResponse.json(
      { ok: false, error: `invalid post_type: ${postTypeRaw}` },
      { status: 400 },
    );
  }
  const format = VALID_FORMATS.find((f) => f === formatRaw);
  if (!format) {
    return NextResponse.json(
      { ok: false, error: `invalid format: ${formatRaw}` },
      { status: 400 },
    );
  }

  try {
    const templates = await listTemplatesForPostType(post_type, format);
    return NextResponse.json({ ok: true, templates });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mobile/templates] fetch failed:", message);
    return NextResponse.json(
      { ok: false, error: "failed to load templates" },
      { status: 500 },
    );
  }
}
