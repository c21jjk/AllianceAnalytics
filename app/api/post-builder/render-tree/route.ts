/**
 * POST /api/post-builder/render-tree
 * Body: { tree: LayerTree }
 *
 * Path B — render a layer tree to a PNG and return the public URL.
 * Used by the Post Editor when the user clicks "Save" / "Apply changes".
 *
 * Auth: signed-in user (matches /render).
 *
 * The actual Chromium screenshotting happens in lib/post-builder/render-tree.ts.
 * This route is just request validation + the renderLayerTree() call.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { renderLayerTree } from "@/lib/post-builder/render-tree";
import type { LayerTree } from "@/lib/post-builder/layers/types";
import { isLayerTree } from "@/lib/post-builder/layers/types";

export const dynamic = "force-dynamic";
// Same generous ceiling as /render — Chromium cold start can be 90s+ on
// a fresh function instance, and we don't want to fail mid-edit-save.
export const maxDuration = 300;
export const runtime = "nodejs";

interface RequestBody {
  tree?: LayerTree;
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

  if (!body.tree || !isLayerTree(body.tree)) {
    return NextResponse.json(
      { ok: false, error: "tree required (must match LayerTree schema v1)" },
      { status: 400 },
    );
  }

  const result = await renderLayerTree({ tree: body.tree });
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
