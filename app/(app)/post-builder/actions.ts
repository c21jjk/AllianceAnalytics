"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import type {
  SaveGeneratedPostInput,
  SaveGeneratedPostResult,
  SaveGeneratedPostErrorResult,
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
 * Update an existing generated_posts row's rendered image. Used by "Edit in
 * Studio" save — the canvas editor uploads the edited PNG to Storage and
 * then calls this to swap the row's pointer so the post is now the edited
 * version everywhere it surfaces.
 *
 * We deliberately do NOT touch the row's caption / hashtags / customizations
 * — Studio edits are visual-only. If we add caption editing inside Studio
 * later, extend this action to accept those fields.
 *
 * Returns { ok: true } when the row updated successfully, { ok: false } when
 * the row doesn't exist or the update fails.
 */
export interface UpdateGeneratedPostImageInput {
  id: string;
  image_url: string;
  image_path: string;
}

export interface UpdateGeneratedPostImageOk {
  ok: true;
}

export interface UpdateGeneratedPostImageErr {
  ok: false;
  error: string;
}

export async function updateGeneratedPostImageAction(
  input: UpdateGeneratedPostImageInput,
): Promise<UpdateGeneratedPostImageOk | UpdateGeneratedPostImageErr> {
  const profile = await requireUser();

  if (!input.id || !input.image_url || !input.image_path) {
    return { ok: false, error: "missing required fields" };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("generated_posts")
    .update({
      image_url: input.image_url,
      image_path: input.image_path,
      // why: bump updated_at so the listing detail page can sort by
      // "most recently edited" if we want that view later. Trigger on the
      // table also auto-updates this, but we set explicitly to be sure.
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    // why: scope to the user who owns the row — RLS would catch a stray
    // foreign update, but a created_by predicate gives a clearer error and
    // prevents the admin client from silently bypassing intent.
    .eq("created_by", profile.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/post-builder");
  return { ok: true };
}
