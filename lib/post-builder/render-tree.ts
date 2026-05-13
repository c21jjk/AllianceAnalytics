import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { screenshotHtml } from "./chromium";
import { layerTreeToSvg, wrapSvgInHtml } from "./layers/svg-renderer";
import type { LayerTree } from "./layers/types";

/**
 * Path B — render a layer tree to a PNG and upload to Storage.
 *
 * Flow:
 *   1. Layer tree → SVG (pure string, no I/O)
 *   2. SVG → minimal HTML wrapper (also string, no I/O)
 *   3. Chromium screenshot at the tree's native dimensions
 *   4. Upload PNG to post-builder-renders bucket; return public URL
 *
 * The tree is the authoritative representation. Re-rendering the same
 * tree yields the same PNG (modulo Google Fonts CDN flakes). Any layer
 * referencing an external image URL gets fetched by Chromium during
 * the setContent → screenshot cycle.
 *
 * For now we don't pre-inline image data URIs (the existing render.ts
 * pre-fetches and inlines hero photos). That made sense when there were
 * 1–3 photos per template; the layer editor can reference 5–15 layers,
 * and pre-fetching them all would be wasteful when most are likely
 * cached at the CDN edge already. We'll revisit if cold-start render
 * time gets bad.
 */

const STORAGE_BUCKET = "post-builder-renders";

export interface RenderTreeInput {
  tree: LayerTree;
  /** Path scope under the bucket. Defaults to "edited/{tree.source.template_id ?? 'custom'}/{stamp}". */
  storage_path_prefix?: string;
}

export interface RenderTreeOk {
  ok: true;
  image_url: string;
  image_path: string;
  width: number;
  height: number;
  rendered_at: string;
}

export interface RenderTreeErr {
  ok: false;
  error: string;
}

export type RenderTreeResult = RenderTreeOk | RenderTreeErr;

export async function renderLayerTree(input: RenderTreeInput): Promise<RenderTreeResult> {
  const { tree } = input;

  if (!tree || tree.schema_version !== 1 || !Array.isArray(tree.layers)) {
    return { ok: false, error: "Invalid layer tree" };
  }
  if (typeof tree.width !== "number" || typeof tree.height !== "number") {
    return { ok: false, error: "Layer tree missing width/height" };
  }
  if (tree.width <= 0 || tree.height <= 0 || tree.width > 4096 || tree.height > 4096) {
    return { ok: false, error: `Invalid tree dimensions: ${tree.width}×${tree.height}` };
  }

  // Pure string assembly — fast, no failure modes.
  const svg = layerTreeToSvg(tree);
  const html = wrapSvgInHtml(svg, tree.width, tree.height);

  let pngBytes: Buffer;
  try {
    pngBytes = await screenshotHtml({
      html,
      width: tree.width,
      height: tree.height,
      log_label: "render-tree",
    });
  } catch (e) {
    return {
      ok: false,
      error: `Render failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const supabase = createAdminClient();
  const renderedAt = new Date().toISOString();
  const stamp = Date.now();
  const sourceId = tree.source?.template_id ?? "custom";
  const path = input.storage_path_prefix
    ? `${input.storage_path_prefix}/${stamp}.png`
    : `edited/${sourceId}/${stamp}.png`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, pngBytes, {
      contentType: "image/png",
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  return {
    ok: true,
    image_url: pub.publicUrl,
    image_path: path,
    width: tree.width,
    height: tree.height,
    rendered_at: renderedAt,
  };
}
