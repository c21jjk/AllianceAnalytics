"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import type {
  SaveGeneratedPostInput,
  SaveGeneratedPostResult,
  SaveGeneratedPostErrorResult,
  SaveLayerTreeInput,
} from "@/lib/post-builder/types";

/**
 * Persists a generated post to the `generated_posts` table. Called from the
 * Post Builder client when the user clicks "Download PNG" — gives us history,
 * dedup, and a foundation for the v2 push-to-IG/FB workflow.
 *
 * Returns { ok: true, id } on success, { ok: false, error } on failure.
 */
export async function saveGeneratedPostAction(
  input: SaveGeneratedPostInput,
): Promise<SaveGeneratedPostResult | SaveGeneratedPostErrorResult> {
  const profile = await requireUser();

  if (!input.mls_number || !input.template_id || !input.image_url) {
    return { ok: false, error: "missing required fields" };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("generated_posts")
    .insert({
      mls_number: input.mls_number,
      source_mls: input.source_mls,
      property_id: input.property_id,
      post_type: input.post_type,
      variant: input.variant,
      format: input.format,
      template_id: input.template_id,
      image_url: input.image_url,
      image_path: input.image_path,
      hero_image_source_url: input.hero_image_source_url,
      template_props: input.template_props as Json,
      caption: input.caption,
      hashtags: input.hashtags,
      mls_hashtag: input.mls_hashtag,
      // Path A — store the user-applied customizations so we can rebuild
      // an editor session from this row later. Empty object when defaults.
      customizations: (input.customizations ?? {}) as Json,
      // Path B — store the layer tree (when the post passed through the
      // editor). Lets the editor reopen the post with all per-layer state
      // intact. Null when the post is a vanilla template render.
      layer_tree: (input.layer_tree ?? null) as Json | null,
      status: "downloaded",
      downloaded_at: new Date().toISOString(),
      created_by: profile.id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data || typeof data.id !== "string") {
    return { ok: false, error: "insert returned no row" };
  }

  revalidatePath("/post-builder");
  return { ok: true, id: data.id };
}

/**
 * Path B — Persist a layer-tree edit onto an existing generated_posts row.
 * Called by the Post Editor's Save flow after the render-tree endpoint has
 * produced an updated PNG. We update the row in place rather than insert a
 * new one — the editor is editing THIS post.
 *
 * Returns { ok: true, id } on success, { ok: false, error } on failure.
 */
export async function saveLayerTreeAction(
  input: SaveLayerTreeInput,
): Promise<SaveGeneratedPostResult | SaveGeneratedPostErrorResult> {
  const profile = await requireUser();

  if (!input.generated_post_id || !input.image_url || !input.image_path) {
    return { ok: false, error: "missing required fields" };
  }
  if (!input.layer_tree || typeof input.layer_tree !== "object") {
    return { ok: false, error: "layer_tree required" };
  }

  // Caller is authenticated; the row update is gated by RLS + admin client
  // mirroring the insert path. We don't track per-edit author yet — the
  // generated_posts table only has `created_by` today. If we later need an
  // edit-history audit trail, add an `edit_log` table rather than mutating
  // the source row's author column.
  void profile;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("generated_posts")
    .update({
      layer_tree: input.layer_tree as Json,
      image_url: input.image_url,
      image_path: input.image_path,
      // Bump status back to "downloaded" if it was somehow elsewhere, and
      // refresh the timestamp so leadership reports show the latest edit.
      status: "downloaded",
      downloaded_at: new Date().toISOString(),
    })
    .eq("id", input.generated_post_id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data || typeof data.id !== "string") {
    return { ok: false, error: "update returned no row — id may not exist" };
  }

  revalidatePath("/post-builder");
  return { ok: true, id: data.id };
}
