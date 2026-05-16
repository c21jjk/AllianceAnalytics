"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import type {
  PostFormat,
  PostType,
  PostVariant,
  ReelRenderJob,
  ReelRenderStatus,
  SaveGeneratedPostInput,
  SaveGeneratedPostResult,
  SaveGeneratedPostErrorResult,
  ScheduledFor,
  SchedulablePlatform,
  SourceMls,
  VideoComposition,
} from "@/lib/post-builder/types";

// Mirrors STORAGE_BUCKET in app/api/post-builder/canvas-save/route.ts +
// lib/post-builder/render.ts — same bucket, same naming, so a single delete
// path here covers both V1 renders and Path C saves.
const POST_RENDER_STORAGE_BUCKET = "post-builder-renders";

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
      // Phase D — per-platform caption variants. Empty object when the
      // caller didn't pass any; the publish route then falls back to the
      // legacy `caption` column for every platform.
      captions_by_platform: (input.captions_by_platform ?? {}) as unknown as Json,
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

// ---------------------------------------------------------------------------
// Studio save — single canonical insert-or-update path
// ---------------------------------------------------------------------------

/**
 * `upsertGeneratedPostFromStudioAction` — the new single entry point for
 * every Studio save (Path C canvas editor).
 *
 * Why this replaces the prior "insert on Generate Post, update on Studio save"
 * split: every Studio save should produce exactly ONE persistent row,
 * regardless of whether the user clicked "Generate Post" first. That row
 * becomes the source of truth for:
 *
 *   • Per-listing "Created Posts" strip on the property detail page
 *   • Global /saved-posts library page
 *   • Resume-editing (load layer_tree back into Studio later)
 *
 * Storage cleanup rule (Option B): when we're updating an existing row, we
 * delete the OLD image_path from Storage *after* the row update succeeds.
 * If the delete fails, the row already points at the new image — we just
 * surface a non-fatal warning instead of orphaning the row.
 */

export interface UpsertStudioPostInput {
  /** When provided, UPDATE that row. When null/undefined, INSERT a new row. */
  id: string | null;
  mls_number: string;
  source_mls: SourceMls;
  property_id: string | null;
  post_type: PostType;
  variant: PostVariant;
  format: PostFormat;
  template_id: string;
  /** Fresh image URL from canvas-save endpoint. */
  image_url: string;
  /** Fresh image storage path from canvas-save endpoint. */
  image_path: string;
  /** Listing's hero photo URL — for diagnostics + future "reset to source". */
  hero_image_source_url: string | null;
  /**
   * Serialized post-hydration template schema. Persisting this enables
   * "resume editing" later — the editor rehydrates from this JSON instead
   * of re-running the listing → template mapper.
   */
  layer_tree: Json | null;
  /**
   * Carousel slides 1..N (slide 0 is the hero image_url itself). Null or
   * empty array = single-image post. Persisted to generated_posts.additional_images
   * so the publish route can build the full image_urls array at post time.
   *
   * Optional in this interface because not every existing call site has
   * been updated to pass it yet — the action body coerces null/undefined
   * to an empty array, matching the DB column's NOT NULL DEFAULT '[]'.
   * Tighten to `Json | null` (required) once every caller passes it.
   */
  additional_images?: Json | null;
  /**
   * Parallel array to additional_images. Each entry carries the per-slide
   * source metadata Studio needs to re-open an individual slide for edit —
   * see `SlideMetadata` in lib/post-builder/types.ts. Only multi-OH posts
   * currently populate this; single-image and user-composed carousels pass
   * undefined/null and the action coerces to `[]`.
   */
  slide_metadata?: Json | null;
  /**
   * Phase D — per-platform caption variants. Shape:
   *   { instagram: { caption, hashtags }, facebook: {...}, tiktok: {...} }
   * Passed verbatim into the `captions_by_platform` jsonb column.
   * Optional because not every save path has been updated to pass it
   * (e.g. download-PNG path uses the legacy single-caption save action).
   * Action body coerces null/undefined to '{}' so the column NOT NULL
   * DEFAULT '{}' constraint is always satisfied.
   */
  captions_by_platform?: Json | null;
}

export interface UpsertStudioPostOk {
  ok: true;
  id: string;
  /**
   * Whether we inserted a new row (true) or updated an existing one (false).
   * The client uses this to know whether to stash the id in component state.
   */
  inserted: boolean;
  /**
   * Whether the old image_path was cleaned up from Storage. False is
   * non-fatal — the row is correct, but a stale file lingers.
   */
  prior_storage_cleaned: boolean;
}

export interface UpsertStudioPostErr {
  ok: false;
  error: string;
}

export async function upsertGeneratedPostFromStudioAction(
  input: UpsertStudioPostInput,
): Promise<UpsertStudioPostOk | UpsertStudioPostErr> {
  const profile = await requireUser();

  if (
    !input.mls_number ||
    !input.template_id ||
    !input.image_url ||
    !input.image_path
  ) {
    return { ok: false, error: "missing required fields" };
  }

  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  // ---- UPDATE path: row exists, swap image + clean Storage ----
  if (input.id) {
    // why: fetch the old image_path BEFORE the update so we know what to
    // delete from Storage after. Doing the fetch first also gives us a
    // 404-equivalent (row not found / belongs to another user) before any
    // mutation runs.
    const { data: existing, error: fetchError } = await supabase
      .from("generated_posts")
      .select("id, image_path, created_by")
      .eq("id", input.id)
      .maybeSingle();

    if (fetchError) {
      return { ok: false, error: `lookup_failed: ${fetchError.message}` };
    }
    if (!existing) {
      return { ok: false, error: "row not found" };
    }
    // why: created_by check matches updateGeneratedPostImageAction — admin
    // client bypasses RLS, so we gate intent here. Larissa shouldn't see /
    // delete John's drafts and vice versa.
    if (existing.created_by !== profile.id) {
      return { ok: false, error: "not owner" };
    }

    const priorImagePath = existing.image_path;

    const { error: updError } = await supabase
      .from("generated_posts")
      .update({
        image_url: input.image_url,
        image_path: input.image_path,
        // Re-stamp the structural fields too in case the user changed
        // variant/format mid-edit (e.g., switched from portrait → story).
        template_id: input.template_id,
        post_type: input.post_type,
        variant: input.variant,
        format: input.format,
        layer_tree: input.layer_tree ?? null,
        // why: default to `[]` (not null) so the column matches its NOT NULL
        // constraint and downstream readers (publish route, resume) never
        // have to null-branch — empty array always means "single-image post".
        additional_images: input.additional_images ?? [],
        // why: same NOT NULL DEFAULT '[]' rule as additional_images — the
        // column is parallel to it; legacy / single-image posts simply carry
        // an empty array here.
        slide_metadata: input.slide_metadata ?? [],
        // Phase D — per-platform caption variants. Empty object means
        // "use the legacy `caption` column for every platform". The publish
        // route's resolvePerPlatformCaption helper handles that fallback.
        captions_by_platform: input.captions_by_platform ?? {},
        updated_at: nowIso,
      })
      .eq("id", input.id)
      .eq("created_by", profile.id);

    if (updError) {
      return { ok: false, error: `update_failed: ${updError.message}` };
    }

    // why: delete the old file from Storage only when the path actually
    // changed. canvas-save uses a timestamp in the path, so this is
    // typically true on every save — but a same-path update is possible
    // in future flows (e.g., re-saving the same image after a metadata
    // edit) and we shouldn't delete the file we just pointed at.
    let priorStorageCleaned = false;
    if (priorImagePath && priorImagePath !== input.image_path) {
      const { error: delError } = await supabase.storage
        .from(POST_RENDER_STORAGE_BUCKET)
        .remove([priorImagePath]);
      // why: non-fatal — the row is correct, the user's edit is saved.
      // We just leave a Storage orphan that a future cleanup sweep can
      // collect. Logging keeps the orphan rate visible in prod.
      if (delError) {
        console.warn(
          "[upsertGeneratedPostFromStudioAction] storage cleanup failed:",
          delError.message,
        );
      } else {
        priorStorageCleaned = true;
      }
    }

    revalidatePath("/post-builder");
    revalidatePath("/saved-posts");
    return {
      ok: true,
      id: input.id,
      inserted: false,
      prior_storage_cleaned: priorStorageCleaned,
    };
  }

  // ---- INSERT path: no id yet, create a draft row ----
  const { data, error: insError } = await supabase
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
      // why: empty template_props + customizations on a fresh Studio draft
      // — the canvas editor doesn't use Path A customizations. The Generate
      // flow fills these in when the user runs caption generation.
      template_props: {} as Json,
      customizations: {} as Json,
      caption: null,
      hashtags: null,
      mls_hashtag: null,
      layer_tree: input.layer_tree ?? null,
      // why: same default-to-`[]` rule as the UPDATE path — the column is
      // NOT NULL, and a fresh draft starts as a single-image post until the
      // user adds carousel slides in Studio.
      additional_images: input.additional_images ?? [],
      // why: parallel to additional_images. Single-image / user-composed
      // carousels start with an empty array; multi-OH wizard posts fill
      // this via the multi-oh-generate route (NOT via this action).
      slide_metadata: input.slide_metadata ?? [],
      // Phase D — see UPDATE branch for rationale. Fresh drafts almost
      // always pass {} here (the user hits Save before running Generate
      // for captions); when Generate has run, the client passes the
      // per-platform map and we persist it.
      captions_by_platform: input.captions_by_platform ?? {},
      // status='draft' so the user knows it hasn't been posted yet. The
      // existing Post Now flow can flip this to 'posted' or 'scheduled'.
      status: "draft",
      created_by: profile.id,
    })
    .select("id")
    .maybeSingle();

  if (insError) {
    return { ok: false, error: `insert_failed: ${insError.message}` };
  }
  if (!data || typeof data.id !== "string") {
    return { ok: false, error: "insert returned no row" };
  }

  revalidatePath("/post-builder");
  revalidatePath("/saved-posts");
  return {
    ok: true,
    id: data.id,
    inserted: true,
    prior_storage_cleaned: false,
  };
}

// ---------------------------------------------------------------------------
// Per-slide edit save — Multi-OH carousel "Edit slide N in Studio"
// ---------------------------------------------------------------------------

/**
 * Input for `updateGeneratedPostSlideAction`. Called when the user clicks
 * Edit on an individual slide thumbnail in the Studio carousel strip,
 * edits the slide in Studio, and saves.
 *
 * Behavior contract — see action body for the why on each step:
 *   1. Auth-gate + ownership check on the row.
 *   2. Validate `slide_index` is in bounds for the row's additional_images.
 *   3. Replace additional_images[slide_index].url with new_image_url and
 *      preserve the slide's other CarouselSlide fields (id, source,
 *      listingPhotoSequence) so React keys remain stable.
 *   4. Replace slide_metadata[slide_index].layer_tree with new_layer_tree.
 *   5. Persist both columns atomically (one UPDATE statement).
 *   6. Best-effort delete the OLD slide image from Storage. Failure is
 *      logged but non-fatal — the row already points at the new image.
 */
export interface UpdateGeneratedPostSlideInput {
  generated_post_id: string;
  /** 0-based index into the row's additional_images array. */
  slide_index: number;
  /** Public URL of the newly-rendered slide PNG (from canvas-save). */
  new_image_url: string;
  /** Storage path of the new slide PNG — used for delete cleanup later. */
  new_image_path: string;
  /**
   * The post-hydration canvas-editor schema for the edited slide. Written
   * to slide_metadata[slide_index].layer_tree so re-opening the same slide
   * later restores the user's edits rather than re-deriving the factory
   * template.
   */
  new_layer_tree: Json | null;
}

export interface UpdateGeneratedPostSlideOk {
  ok: true;
  /** True when the prior slide image was cleaned up from Storage. */
  prior_storage_cleaned: boolean;
}

export interface UpdateGeneratedPostSlideErr {
  ok: false;
  error: string;
}

/**
 * Replace one slide's image + saved schema on a multi-OH carousel row.
 *
 * The hero (image_url / image_path / layer_tree) is left alone — that's
 * the parent post's design and is edited via `upsertGeneratedPostFromStudioAction`.
 * This action is exclusively for slide 1..N inside additional_images.
 */
export async function updateGeneratedPostSlideAction(
  input: UpdateGeneratedPostSlideInput,
): Promise<UpdateGeneratedPostSlideOk | UpdateGeneratedPostSlideErr> {
  const profile = await requireUser();

  if (
    !input.generated_post_id ||
    !input.new_image_url ||
    !input.new_image_path
  ) {
    return { ok: false, error: "missing required fields" };
  }
  if (
    typeof input.slide_index !== "number" ||
    !Number.isInteger(input.slide_index) ||
    input.slide_index < 0
  ) {
    return { ok: false, error: "slide_index must be a non-negative integer" };
  }

  const supabase = createAdminClient();

  // why: fetch the row first so we can (a) ownership-check, (b) bounds-check
  // slide_index, and (c) capture the prior slide image path for cleanup.
  const { data: existing, error: fetchError } = await supabase
    .from("generated_posts")
    .select(
      "id, created_by, additional_images, slide_metadata",
    )
    .eq("id", input.generated_post_id)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: `lookup_failed: ${fetchError.message}` };
  }
  if (!existing) {
    return { ok: false, error: "row not found" };
  }
  if (existing.created_by !== profile.id) {
    return { ok: false, error: "not owner" };
  }

  // why: additional_images / slide_metadata are typed `Json` at the DB
  // boundary — narrow to readable arrays defensively. A malformed row
  // (manual edit, legacy data) should error cleanly, not throw on indexing.
  const additionalImages = existing.additional_images;
  if (!Array.isArray(additionalImages)) {
    return {
      ok: false,
      error: "additional_images is not an array — row is malformed",
    };
  }
  if (input.slide_index >= additionalImages.length) {
    return {
      ok: false,
      error: `slide_index ${input.slide_index} out of bounds (additional_images length=${additionalImages.length})`,
    };
  }

  // why: capture the OLD slide entry so we can preserve its CarouselSlide
  // fields (id, source, listingPhotoSequence) while only swapping the url.
  // Keeping id stable prevents the React key change that would otherwise
  // cause a thumbnail re-mount + flicker after save.
  const priorSlide = additionalImages[input.slide_index];
  let priorImagePathFromUrl: string | null = null;
  let priorSlideId: string | null = null;
  let priorSource: "listing" | "upload" = "listing";
  let priorSequence: number | undefined = undefined;
  if (
    priorSlide &&
    typeof priorSlide === "object" &&
    !Array.isArray(priorSlide)
  ) {
    const p = priorSlide as Record<string, unknown>;
    if (typeof p.id === "string") priorSlideId = p.id;
    if (p.source === "upload") priorSource = "upload";
    if (typeof p.listingPhotoSequence === "number") {
      priorSequence = p.listingPhotoSequence;
    }
    if (typeof p.url === "string") {
      // why: derive the Storage path from the prior public URL so we can
      // delete it after the update. Same trick used in the canvas-save
      // route — the Storage public URL embeds the path after the bucket
      // segment. Failure to derive is non-fatal; we just skip cleanup.
      priorImagePathFromUrl = extractStoragePathFromPublicUrl(p.url);
    }
  }

  // why: build the new slide entry. Preserve id/source/sequence so the
  // thumbnail's React key + provenance survive the edit.
  const nextSlide = {
    id: priorSlideId ?? crypto.randomUUID(),
    url: input.new_image_url,
    source: priorSource,
    ...(priorSequence !== undefined
      ? { listingPhotoSequence: priorSequence }
      : {}),
  };

  // why: build the new additional_images array. Avoid in-place mutation —
  // the DB column is jsonb and we want a clean replacement value.
  const nextAdditionalImages = additionalImages.slice();
  nextAdditionalImages[input.slide_index] = nextSlide as unknown as Json;

  // why: build the new slide_metadata array. If the row's slide_metadata
  // is missing / malformed (e.g., a pre-migration row), back-fill an empty
  // entry up to slide_index so the indexes line up with additional_images.
  const existingMetadata = Array.isArray(existing.slide_metadata)
    ? (existing.slide_metadata as unknown[])
    : [];
  const nextSlideMetadata: unknown[] = existingMetadata.slice();
  while (nextSlideMetadata.length < additionalImages.length) {
    // why: pad with empty objects rather than null so consumers can read
    // `entry.layer_tree` without a null check. The shape mirrors
    // SlideMetadata's optional fields — all undefined.
    nextSlideMetadata.push({});
  }
  const priorMeta = nextSlideMetadata[input.slide_index];
  const mergedMeta =
    priorMeta && typeof priorMeta === "object" && !Array.isArray(priorMeta)
      ? { ...(priorMeta as Record<string, unknown>) }
      : {};
  mergedMeta.layer_tree = input.new_layer_tree;
  nextSlideMetadata[input.slide_index] = mergedMeta;

  // ---- Atomic update: additional_images + slide_metadata in one statement ----
  const { error: updError } = await supabase
    .from("generated_posts")
    .update({
      additional_images: nextAdditionalImages as unknown as Json,
      slide_metadata: nextSlideMetadata as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.generated_post_id)
    .eq("created_by", profile.id);

  if (updError) {
    return { ok: false, error: `update_failed: ${updError.message}` };
  }

  // ---- Best-effort Storage cleanup of the prior slide image ----
  let priorStorageCleaned = false;
  if (priorImagePathFromUrl && priorImagePathFromUrl !== input.new_image_path) {
    const { error: delError } = await supabase.storage
      .from(POST_RENDER_STORAGE_BUCKET)
      .remove([priorImagePathFromUrl]);
    if (delError) {
      // why: same non-fatal contract as the hero swap — the row is correct,
      // the user's edit is saved; a stale file is just disk usage. Log so
      // the orphan rate stays visible in prod logs.
      console.warn(
        "[updateGeneratedPostSlideAction] storage cleanup failed:",
        delError.message,
      );
    } else {
      priorStorageCleaned = true;
    }
  }

  revalidatePath("/post-builder");
  revalidatePath("/saved-posts");
  return { ok: true, prior_storage_cleaned: priorStorageCleaned };
}

/**
 * Extract the Storage object path from a Supabase public URL. Supabase
 * public URLs look like:
 *
 *   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
 *
 * We split on `/object/public/<bucket>/` and return whatever follows. If
 * the URL doesn't match that shape (e.g., a third-party CDN URL), return
 * null so the caller skips the cleanup attempt.
 */
function extractStoragePathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${POST_RENDER_STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const tail = url.slice(idx + marker.length);
  // why: strip any querystring (cache-busting params, signed-url tokens)
  // before returning — Storage.remove() takes the bare path only.
  const q = tail.indexOf("?");
  return q === -1 ? tail : tail.slice(0, q);
}

// ---------------------------------------------------------------------------
// Delete a saved Studio post — row + Storage file
// ---------------------------------------------------------------------------

export interface DeleteGeneratedPostInput {
  id: string;
}

export interface DeleteGeneratedPostOk {
  ok: true;
  /** True when the Storage file was also cleaned up. False = row gone, file orphaned. */
  storage_cleaned: boolean;
}

export interface DeleteGeneratedPostErr {
  ok: false;
  error: string;
}

/**
 * Hard-delete a generated_posts row AND its Storage image. Used by:
 *   • Per-listing Created Posts strip (trash icon on hover)
 *   • Global /saved-posts library (single + bulk delete)
 *
 * Auth-gated to the row's `created_by`. Admin client bypasses RLS so we
 * enforce ownership explicitly. Returns ok even if the Storage cleanup
 * fails, since the row is the canonical record — a stale Storage file
 * without a referring row is just disk usage.
 */
export async function deleteGeneratedPostAction(
  input: DeleteGeneratedPostInput,
): Promise<DeleteGeneratedPostOk | DeleteGeneratedPostErr> {
  const profile = await requireUser();
  if (!input.id) {
    return { ok: false, error: "id required" };
  }

  const supabase = createAdminClient();

  // why: pull the row's image_path + created_by first. We need the path to
  // queue the Storage delete, and the ownership check has to happen before
  // we hit Storage (otherwise we could delete someone else's file even if
  // the row delete is later blocked).
  const { data: existing, error: fetchError } = await supabase
    .from("generated_posts")
    .select("id, image_path, created_by")
    .eq("id", input.id)
    .maybeSingle();
  if (fetchError) {
    return { ok: false, error: `lookup_failed: ${fetchError.message}` };
  }
  if (!existing) {
    // why: idempotent — deleting an already-gone row should not error,
    // matches REST semantics + lets the UI fire-and-forget without a
    // pre-check.
    return { ok: true, storage_cleaned: false };
  }
  if (existing.created_by !== profile.id) {
    return { ok: false, error: "not owner" };
  }

  const { error: delError } = await supabase
    .from("generated_posts")
    .delete()
    .eq("id", input.id)
    .eq("created_by", profile.id);
  if (delError) {
    return { ok: false, error: `delete_failed: ${delError.message}` };
  }

  let storageCleaned = false;
  if (existing.image_path) {
    const { error: storageError } = await supabase.storage
      .from(POST_RENDER_STORAGE_BUCKET)
      .remove([existing.image_path]);
    if (storageError) {
      console.warn(
        "[deleteGeneratedPostAction] storage cleanup failed:",
        storageError.message,
      );
    } else {
      storageCleaned = true;
    }
  }

  revalidatePath("/post-builder");
  revalidatePath("/saved-posts");
  return { ok: true, storage_cleaned: storageCleaned };
}

// ---------------------------------------------------------------------------
// Manual brand-asset sync — fires the same Edge Function the nightly cron uses
// ---------------------------------------------------------------------------

/**
 * Report shape returned by the `sync-brand-assets` Edge Function. Mirrors the
 * SyncReport interface in supabase/functions/sync-brand-assets/index.ts;
 * widened to `unknown` on the errors field because we don't need the
 * structured per-file error type on the client — surfacing the count is
 * enough for the panel's success/error toast.
 */
export interface BrandSyncReport {
  ok: boolean;
  durationMs: number;
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  /**
   * Rows whose drive_file_id was not seen on this run → flipped to
   * status='archived'. Added 2026-05-16 alongside the drift fix; the Edge
   * Function now sweeps stale rows out of the active set on every run.
   */
  archived?: number;
  skipped: number;
  errors: unknown[];
}

export interface SyncBrandAssetsOk {
  ok: true;
  report: BrandSyncReport;
}

export interface SyncBrandAssetsErr {
  ok: false;
  error: string;
}

/**
 * Most-recent-sync metadata for the Brand panel + Agent panel header pill.
 * Mirrors the shape persisted by the sync-brand-assets Edge Function into
 * `api_credentials.credentials` (platform='google_drive'). When the
 * function has never run successfully, both fields can be null.
 */
export interface BrandSyncStatusResult {
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

/**
 * Reads the last-sync metadata that the sync-brand-assets Edge Function
 * writes back into `api_credentials.credentials` after every run. Used by
 * the Studio Brand + Agent panel headers to render a "Synced 12m ago" /
 * "Last sync failed Nm ago" pill so users can self-diagnose drift.
 *
 * Why a server action (not a client query):
 *   - The `api_credentials` table is service-role-only (RLS denies anon +
 *     authenticated reads on every column, including non-secret metadata).
 *     A client read would return 0 rows. Routing through a server action
 *     with the admin client lets us return ONLY the two timestamps, no
 *     secrets.
 *   - Single-shot fetch keeps the canvas editor's mount-time network cost
 *     bounded: one extra request alongside the existing brand_assets +
 *     offices fetches.
 *
 * Returns null timestamps when the row doesn't exist or the function has
 * never run (instead of throwing) — the panel renders "Never synced" in
 * that case.
 */
export async function getBrandSyncStatusAction(): Promise<BrandSyncStatusResult> {
  // why: gated to authenticated users only — the metadata isn't a secret
  // but there's no reason to expose it to anon visitors.
  await requireUser();

  const supabase = createAdminClient();

  // why: select only the credentials column; we'll pull lastSyncAt /
  // lastSyncError out of the JSONB here so the action's return type
  // stays minimal and we don't accidentally leak service_account_json
  // back to the client.
  const { data, error } = await supabase
    .from("api_credentials")
    .select("credentials")
    .eq("platform", "google_drive")
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    return { lastSyncedAt: null, lastSyncError: null };
  }

  const creds = (data.credentials ?? {}) as {
    lastSyncAt?: string;
    lastSyncError?: string | null;
  };

  return {
    lastSyncedAt: typeof creds.lastSyncAt === "string" ? creds.lastSyncAt : null,
    lastSyncError:
      typeof creds.lastSyncError === "string" && creds.lastSyncError.length > 0
        ? creds.lastSyncError
        : null,
  };
}

/**
 * Manually trigger the `sync-brand-assets` Edge Function — Larissa hits the
 * Sync button in the Brand or Agents sidebar when she's just dropped a new
 * logo / headshot into the Drive folder and doesn't want to wait for the
 * nightly cron at 3 AM ET to pick it up.
 *
 * Auth-gated to any signed-in Alliance user — the Edge Function is the same
 * one the cron uses, so it's safe to expose to non-admins. The work is
 * idempotent (unchanged files return `unchanged` and skip the download), so
 * accidental double-clicks are cheap.
 *
 * We use `supabase.functions.invoke` on the admin client, which signs the
 * request with the service role key — same auth the Edge Function expects.
 *
 * Timing: a real sync usually finishes in 20–60s. The Edge Function has a
 * 150s ceiling on Supabase's Free + Pro tiers, so we trust that ceiling
 * rather than imposing our own timeout here.
 */
export async function syncBrandAssetsAction(): Promise<
  SyncBrandAssetsOk | SyncBrandAssetsErr
> {
  await requireUser();

  const supabase = createAdminClient();

  try {
    // why: empty body — the function reads its config from api_credentials
    // (platform=google_drive) and walks the configured Drive folders. No
    // per-invocation input is needed.
    const { data, error } = await supabase.functions.invoke<BrandSyncReport>(
      "sync-brand-assets",
      { body: {} },
    );
    if (error) {
      return {
        ok: false,
        error: `invoke_failed: ${error.message ?? String(error)}`,
      };
    }
    if (!data) {
      return { ok: false, error: "empty response from sync function" };
    }
    // why: the Edge Function returns `{ ok: false, errors: [...] }` on
    // partial failure. Treat any !ok response as an error so the UI can
    // surface it — even if some files synced, the user wants to know
    // something went wrong.
    if (!data.ok) {
      const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
      return {
        ok: false,
        error: `sync reported failure (${errCount} per-file errors)`,
      };
    }

    // why: refresh any page that reads brand_assets so the new rows show
    // up without a hard reload. /post-builder is the immediate caller; the
    // dashboard surfaces brand counts too.
    revalidatePath("/post-builder");
    revalidatePath("/");

    return { ok: true, report: data };
  } catch (e) {
    return {
      ok: false,
      error: `threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Scheduled posting — Phase 5C (2026-05-16)
// ---------------------------------------------------------------------------
//
// schedulePostAction merges the requested {platform: ISO} map into the row's
// scheduled_for jsonb, validates each ISO is a real future timestamp, and
// flips status to "scheduled" so the row shows up under the Scheduled chip
// on /saved-posts. unschedulePostAction removes specific platform keys; if
// the row has no remaining schedules AND no successful posts yet, status
// drops back to "draft".

export interface SchedulePostInput {
  generated_post_id: string;
  /**
   * Map of platform → ISO 8601 UTC timestamp. Pass `undefined` for any
   * platform you don't want to schedule. The action merges with whatever's
   * already on the row, so passing only { instagram } leaves an existing
   * { facebook } schedule alone.
   */
  scheduled_for: ScheduledFor;
}

export interface SchedulePostOk {
  ok: true;
  /** Merged scheduled_for after the write — the client uses this to update
   *  its local row state without a re-fetch. */
  scheduled_for: ScheduledFor;
}

export interface SchedulePostErr {
  ok: false;
  error: string;
}

export type SchedulePostResult = SchedulePostOk | SchedulePostErr;

/**
 * Schedule (or re-schedule) a generated_posts row to publish to one or more
 * platforms at specific UTC timestamps. The cron route at
 * /api/cron/publish-scheduled drains due rows every 5 minutes.
 *
 * Validation rules:
 *   • Each ISO must parse to a real Date.
 *   • Each timestamp must be at least 1 minute in the future. Anything in
 *     the past or in the next 60s would race the cron tick and behave
 *     surprisingly.
 *   • Caller must own the row (created_by check).
 *   • At least one platform key must be present (no-op schedules are
 *     rejected so the UI button-state always reflects real intent).
 */
export async function schedulePostAction(
  input: SchedulePostInput,
): Promise<SchedulePostResult> {
  const profile = await requireUser();
  if (!input.generated_post_id) {
    return { ok: false, error: "generated_post_id required" };
  }

  const incoming = input.scheduled_for ?? {};
  const platformsRequested = (
    Object.keys(incoming) as readonly SchedulablePlatform[]
  ).filter((k) => k === "facebook" || k === "instagram" || k === "tiktok");
  if (platformsRequested.length === 0) {
    return { ok: false, error: "at least one platform must be scheduled" };
  }

  // why: validate every supplied ISO is parseable AND at least 60s in the
  // future. The cron route runs every 5 minutes, so anything inside that
  // window is effectively "post now"; force the user to either pick a real
  // future window or use the Post Now button instead.
  const now = Date.now();
  const minFutureMs = 60_000;
  const validated: ScheduledFor = {};
  for (const platform of platformsRequested) {
    const iso = incoming[platform];
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) {
      return {
        ok: false,
        error: `invalid timestamp for ${platform}: ${iso}`,
      };
    }
    if (t - now < minFutureMs) {
      return {
        ok: false,
        error: `scheduled time must be in the future (${platform})`,
      };
    }
    // Re-serialize to canonical UTC ISO so the DB always stores normalized
    // values regardless of what shape the client sent.
    validated[platform] = new Date(t).toISOString();
  }

  const supabase = createAdminClient();

  // why: pull the existing row to (a) ownership-check and (b) merge into the
  // existing scheduled_for map instead of overwriting it. Larissa might
  // schedule IG today, then later open the same row to ALSO schedule FB —
  // we must not blow away the IG entry.
  const { data: existing, error: fetchError } = await supabase
    .from("generated_posts")
    .select("id, created_by, status, scheduled_for")
    .eq("id", input.generated_post_id)
    .maybeSingle();
  if (fetchError) {
    return { ok: false, error: `lookup_failed: ${fetchError.message}` };
  }
  if (!existing) {
    return { ok: false, error: "row not found" };
  }
  if (existing.created_by !== profile.id) {
    return { ok: false, error: "not owner" };
  }

  // why: existing.scheduled_for is Json (per supabase types). Narrow it to
  // ScheduledFor defensively — any unrecognized key is preserved verbatim
  // through the merge, but only platform keys make it onto the returned
  // object the client uses to update its in-memory state.
  const existingMap: ScheduledFor = isScheduledForObject(
    existing.scheduled_for,
  )
    ? (existing.scheduled_for as ScheduledFor)
    : {};
  const merged: ScheduledFor = { ...existingMap, ...validated };

  // Flip status to "scheduled" if the row was previously in a non-terminal
  // state (draft / downloaded). Don't override "posted" — a row that's
  // already gone out to one platform can still get future schedules for
  // OTHER platforms, but we leave the status alone so the row remains in
  // the "Posted" filter view.
  const shouldFlipStatus =
    existing.status === "draft" || existing.status === "downloaded";

  const { error: updError } = await supabase
    .from("generated_posts")
    .update({
      scheduled_for: merged as unknown as Json,
      ...(shouldFlipStatus ? { status: "scheduled" as const } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.generated_post_id)
    .eq("created_by", profile.id);

  if (updError) {
    return { ok: false, error: `update_failed: ${updError.message}` };
  }

  revalidatePath("/post-builder");
  revalidatePath("/saved-posts");
  return { ok: true, scheduled_for: merged };
}

export interface UnschedulePostInput {
  generated_post_id: string;
  /** Platforms to clear from scheduled_for. Other platform keys are left intact. */
  platforms: readonly SchedulablePlatform[];
}

export interface UnschedulePostOk {
  ok: true;
  /** scheduled_for after the removal. Empty {} means fully unscheduled. */
  scheduled_for: ScheduledFor;
  /** True when the row's status was reverted to "draft" because no schedules remain. */
  status_reverted: boolean;
}

export interface UnschedulePostErr {
  ok: false;
  error: string;
}

export type UnschedulePostResult = UnschedulePostOk | UnschedulePostErr;

/**
 * Remove specific platform keys from a row's scheduled_for. When the row
 * has no remaining schedules AND status is "scheduled", revert status to
 * "draft" so the row falls back into the regular drafts view. Used by the
 * Studio "Unschedule" affordance + bulk actions on /saved-posts.
 */
export async function unschedulePostAction(
  input: UnschedulePostInput,
): Promise<UnschedulePostResult> {
  const profile = await requireUser();
  if (!input.generated_post_id) {
    return { ok: false, error: "generated_post_id required" };
  }
  if (!input.platforms || input.platforms.length === 0) {
    return { ok: false, error: "at least one platform required" };
  }

  const supabase = createAdminClient();
  const { data: existing, error: fetchError } = await supabase
    .from("generated_posts")
    .select("id, created_by, status, scheduled_for")
    .eq("id", input.generated_post_id)
    .maybeSingle();
  if (fetchError) {
    return { ok: false, error: `lookup_failed: ${fetchError.message}` };
  }
  if (!existing) return { ok: false, error: "row not found" };
  if (existing.created_by !== profile.id) {
    return { ok: false, error: "not owner" };
  }

  const existingMap: ScheduledFor = isScheduledForObject(
    existing.scheduled_for,
  )
    ? (existing.scheduled_for as ScheduledFor)
    : {};
  const next: ScheduledFor = { ...existingMap };
  for (const p of input.platforms) {
    delete next[p];
  }

  const noSchedulesLeft = Object.keys(next).length === 0;
  const shouldRevertStatus =
    noSchedulesLeft && existing.status === "scheduled";

  const { error: updError } = await supabase
    .from("generated_posts")
    .update({
      scheduled_for: next as unknown as Json,
      ...(shouldRevertStatus ? { status: "draft" as const } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.generated_post_id)
    .eq("created_by", profile.id);

  if (updError) {
    return { ok: false, error: `update_failed: ${updError.message}` };
  }

  revalidatePath("/post-builder");
  revalidatePath("/saved-posts");
  return {
    ok: true,
    scheduled_for: next,
    status_reverted: shouldRevertStatus,
  };
}

/**
 * Narrow a jsonb-typed value into a plausible ScheduledFor map. Only the
 * shape is checked — individual ISO strings are validated upstream when the
 * map is consumed (e.g. in the cron route's filter pass).
 */
function isScheduledForObject(value: unknown): value is ScheduledFor {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reel render — Phase 6, Day 6 (2026-05-16)
// ---------------------------------------------------------------------------
//
// Three actions wrap the Reel render worker (Fly.io service in worker/) so
// the Studio's Generate button can submit a composition, poll for status,
// and persist the resulting MP4 to generated_posts.
//
// Why server actions vs. an /api route: keeps the worker auth token off the
// client (it's a server-only env var) and lets the actions share the same
// requireUser() gate every other Studio mutation uses. The Reel Studio
// client invokes these directly via Next 15's server-action calling
// convention — no fetch boilerplate.
//
// Env vars consumed:
//   REEL_WORKER_URL          — base URL of the worker, e.g. https://alliance-reel-render.fly.dev
//   REEL_WORKER_AUTH_TOKEN   — bearer token matching the worker's WORKER_AUTH_TOKEN
//
// Both are required. Missing values surface a clear error from the action
// itself so a misconfigured deploy points at the actual cause instead of a
// generic "fetch failed" further down the stack.

/**
 * Pull the worker's base URL + auth token out of the environment. Returns
 * a tagged result so the calling action can early-return with a descriptive
 * error message before any fetch is attempted.
 *
 * why this lives in a helper: both triggerReelRenderAction and
 * getReelRenderStatusAction need the same two env vars + the same error
 * shape, and we want one place to fix if the var names change.
 */
function readReelWorkerEnv():
  | { ok: true; baseUrl: string; token: string }
  | { ok: false; error: string } {
  const baseUrl = process.env.REEL_WORKER_URL;
  const token = process.env.REEL_WORKER_AUTH_TOKEN;
  if (!baseUrl || baseUrl.length === 0) {
    return {
      ok: false,
      error:
        "REEL_WORKER_URL is not set — configure it in Vercel (production) or .env.local (dev) before generating Reels.",
    };
  }
  if (!token || token.length === 0) {
    return {
      ok: false,
      error:
        "REEL_WORKER_AUTH_TOKEN is not set — configure it in Vercel (production) or .env.local (dev) before generating Reels.",
    };
  }
  // why: strip trailing slash so concatenations like `${baseUrl}/render` never
  // produce a double-slashed URL (some hosting providers normalize, others
  // don't — safer to canonicalize here).
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return { ok: true, baseUrl: normalized, token };
}

// ---- triggerReelRenderAction ---------------------------------------------

export interface TriggerReelRenderOk {
  ok: true;
  job_id: string;
  /** Echo of the idempotency key — the client can stash this for retry/debug. */
  idempotency_key: string;
}

export interface TriggerReelRenderErr {
  ok: false;
  error: string;
}

export type TriggerReelRenderResult =
  | TriggerReelRenderOk
  | TriggerReelRenderErr;

/**
 * Worker's POST /render response shape (success). Mirrors the body in
 * worker/src/routes/render.ts — the worker returns 202 with this body.
 */
interface WorkerRenderSubmitResponse {
  job_id: string;
  status: ReelRenderStatus;
  poll_url: string;
}

/**
 * Submit a VideoComposition to the render worker. Returns the job_id the
 * client polls with getReelRenderStatusAction.
 *
 * Error contract: distinguishes worker-down (network throw, AbortError) from
 * worker-rejected (HTTP 4xx/5xx with a body) so the UI can render a useful
 * message instead of "fetch failed".
 *
 * @param composition - The composition document the worker will render. We
 *   trust the client's shape here — the worker re-validates with zod and
 *   400s on drift, so any malformed payload surfaces as a worker-rejected
 *   error rather than a silent miss.
 */
export async function triggerReelRenderAction(
  composition: VideoComposition,
): Promise<TriggerReelRenderResult> {
  await requireUser();

  const env = readReelWorkerEnv();
  if (!env.ok) return { ok: false, error: env.error };

  // why: client-generated idempotency key. The worker dedupes by this within
  // a 24h window, so a flaky network retry of the same Generate click can't
  // burn a second render-pass-worth of CPU.
  const idempotencyKey = crypto.randomUUID();

  try {
    const res = await fetch(`${env.baseUrl}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.token}`,
      },
      body: JSON.stringify({
        composition,
        idempotency_key: idempotencyKey,
      }),
      // why: 30s is generous for a submit-only call — the worker should
      // 202 nearly instantly since the actual render is fire-and-forget.
      // Cap exists so a hung worker doesn't pin the action indefinitely.
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      // why: try to surface the worker's structured error body first
      // (zod issues, auth failures); fall back to status text if the body
      // isn't JSON. Either way we get a message that points at the real
      // problem instead of a generic "submit failed".
      let workerMessage = `HTTP ${res.status}`;
      try {
        const body: unknown = await res.json();
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error: unknown }).error === "string"
        ) {
          workerMessage = (body as { error: string }).error;
        }
      } catch {
        // why: ignore JSON parse failures — the status code alone is
        // enough context for the user when the body isn't structured.
      }
      return {
        ok: false,
        error: `Worker rejected the render: ${workerMessage}`,
      };
    }

    const body: unknown = await res.json();
    if (!isWorkerSubmitResponse(body)) {
      return {
        ok: false,
        error: "Worker returned an unexpected response shape",
      };
    }

    return {
      ok: true,
      job_id: body.job_id,
      idempotency_key: idempotencyKey,
    };
  } catch (e) {
    // why: AbortError lands here when the timeout fires. Network errors
    // (DNS, TCP, TLS) also throw from fetch — we treat all of these as
    // "worker unreachable" so the UI message points at infrastructure
    // rather than implying a bad request was sent.
    const message =
      e instanceof Error
        ? e.name === "TimeoutError" || e.name === "AbortError"
          ? "Worker did not respond within 30 seconds — check that REEL_WORKER_URL points at a running worker."
          : `Worker unreachable: ${e.message}`
        : "Worker unreachable: unknown error";
    return { ok: false, error: message };
  }
}

/**
 * Narrow the worker's submit response. The worker returns extra fields like
 * `deduped` on idempotency hits — we ignore those here but accept any shape
 * that has the three required fields.
 */
function isWorkerSubmitResponse(
  value: unknown,
): value is WorkerRenderSubmitResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.job_id === "string" &&
    typeof v.status === "string" &&
    typeof v.poll_url === "string"
  );
}

// ---- getReelRenderStatusAction -------------------------------------------

export interface GetReelRenderStatusOk {
  ok: true;
  job: ReelRenderJob;
}

export interface GetReelRenderStatusErr {
  ok: false;
  error: string;
}

export type GetReelRenderStatusResult =
  | GetReelRenderStatusOk
  | GetReelRenderStatusErr;

/**
 * Poll the worker for the current state of a render job. Called repeatedly
 * by the Studio's Generate flow at ~1.5s intervals until status is
 * "succeeded" or "failed".
 *
 * 10s timeout — a single poll should resolve almost instantly; if the
 * worker is so loaded it can't return a status in 10s, treat that as an
 * error so the client can surface it (and potentially keep polling).
 */
export async function getReelRenderStatusAction(
  jobId: string,
): Promise<GetReelRenderStatusResult> {
  await requireUser();

  if (!jobId || typeof jobId !== "string") {
    return { ok: false, error: "jobId required" };
  }

  const env = readReelWorkerEnv();
  if (!env.ok) return { ok: false, error: env.error };

  try {
    const res = await fetch(
      `${env.baseUrl}/render/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${env.token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!res.ok) {
      let workerMessage = `HTTP ${res.status}`;
      try {
        const body: unknown = await res.json();
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error: unknown }).error === "string"
        ) {
          workerMessage = (body as { error: string }).error;
        }
      } catch {
        // ignore
      }
      return {
        ok: false,
        error: `Worker rejected the status poll: ${workerMessage}`,
      };
    }

    const body: unknown = await res.json();
    if (!isReelRenderJob(body)) {
      return {
        ok: false,
        error: "Worker returned an unexpected job shape",
      };
    }
    // why: normalize cover_url/cover_path so the union type holds at the
    // boundary. A worker version that pre-dates the cover-frame feature
    // will omit these keys; coerce undefined → null so consumers read a
    // consistent `string | null` instead of `string | null | undefined`.
    const normalized: ReelRenderJob = {
      ...body,
      cover_url: body.cover_url ?? null,
      cover_path: body.cover_path ?? null,
    };
    return { ok: true, job: normalized };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.name === "TimeoutError" || e.name === "AbortError"
          ? "Status poll timed out after 10s"
          : `Worker unreachable: ${e.message}`
        : "Worker unreachable: unknown error";
    return { ok: false, error: message };
  }
}

/**
 * Structurally narrow an unknown payload into a ReelRenderJob. Defensive —
 * the worker is our own code so drift is unlikely, but treating it like an
 * external API means a future worker change can't crash the client.
 */
function isReelRenderJob(value: unknown): value is ReelRenderJob {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.job_id !== "string") return false;
  if (
    v.status !== "queued" &&
    v.status !== "processing" &&
    v.status !== "succeeded" &&
    v.status !== "failed"
  ) {
    return false;
  }
  if (typeof v.progress_pct !== "number") return false;
  // video_url / video_path / duration_ms / cover_url / cover_path / error
  // are nullable; only check they exist as the right kind when non-null.
  if (v.video_url !== null && typeof v.video_url !== "string") return false;
  if (v.video_path !== null && typeof v.video_path !== "string") return false;
  if (v.duration_ms !== null && typeof v.duration_ms !== "number") return false;
  // why: cover_url + cover_path are tolerated as `undefined` too — a worker
  // version that predates the cover-frame feature would simply omit the
  // fields rather than send null. Both shapes narrow to ReelRenderJob's
  // `string | null` because the persist action treats undefined like null.
  if (
    v.cover_url !== undefined &&
    v.cover_url !== null &&
    typeof v.cover_url !== "string"
  ) {
    return false;
  }
  if (
    v.cover_path !== undefined &&
    v.cover_path !== null &&
    typeof v.cover_path !== "string"
  ) {
    return false;
  }
  if (v.error !== null && typeof v.error !== "string") return false;
  if (typeof v.created_at !== "string") return false;
  if (typeof v.updated_at !== "string") return false;
  return true;
}

// ---- persistRenderedReelAction -------------------------------------------

export interface PersistRenderedReelInput {
  /** The composition that was rendered — persisted verbatim so re-edit
   *  rehydrates the exact document the user submitted. */
  composition: VideoComposition;
  /** Public Storage URL of the rendered MP4 (from the succeeded job). */
  video_url: string;
  /** Internal Storage path of the MP4 (used for later cleanup / re-render). */
  video_path: string;
  /** MP4 duration in ms. Persisted so the UI can read it without parsing the video. */
  duration_ms: number;
  /**
   * Cover frame URL — used as image_url on the row + as the IG Reels cover.
   *
   * As of 2026-05-16 the canonical source is the worker's `job.cover_url`
   * (a PNG of the literal first frame of the rendered video). Callers
   * SHOULD prefer that value when non-null. When the worker degrades —
   * older worker version, cover upload failed, missing first frame — the
   * caller falls back to the listing's hero photo so a Reel never
   * persists without a cover.
   */
  cover_image_url: string;
  /** Optional caption draft. */
  caption?: string | null;
  /** Optional hashtags. */
  hashtags?: string[] | null;
}

export interface PersistRenderedReelOk {
  ok: true;
  generated_post_id: string;
}

export interface PersistRenderedReelErr {
  ok: false;
  error: string;
}

export type PersistRenderedReelResult =
  | PersistRenderedReelOk
  | PersistRenderedReelErr;

/**
 * Insert a NEW generated_posts row for a freshly-rendered Reel.
 *
 * why always INSERT (never update): Reel re-generations create siblings,
 * never overwrite the previous version. The previous Reel may already be
 * scheduled or posted; the user re-rendering is producing a NEW asset, not
 * editing the old one. Studio surfaces both rows under the listing.
 *
 * Required fields derived from the composition:
 *   • mls_number — from composition.sourceListingMls (must be set)
 *
 * Fixed-value fields for Reels in MVP:
 *   • media_type = "reel"
 *   • template_id = "reel_v1" (synthetic — future versions can carry variants)
 *   • post_type = "just_listed" (Reels default; future: derive from listing status)
 *   • variant = "v1"
 *   • format = "story_9x16" (Reels are always 9:16)
 *   • status = "draft"
 *   • image_path = null (cover is a source URL, not a path we own)
 */
export async function persistRenderedReelAction(
  input: PersistRenderedReelInput,
): Promise<PersistRenderedReelResult> {
  const profile = await requireUser();

  // why: pre-validate so the user sees the real cause if the composition
  // is missing its source listing — without this they'd get a generic
  // NOT NULL violation from Postgres.
  if (!input.composition.sourceListingMls) {
    return {
      ok: false,
      error: "composition.sourceListingMls is required to persist a Reel",
    };
  }
  if (!input.video_url || !input.video_path) {
    return { ok: false, error: "video_url and video_path are required" };
  }
  if (typeof input.duration_ms !== "number" || input.duration_ms <= 0) {
    return { ok: false, error: "duration_ms must be a positive number" };
  }
  if (!input.cover_image_url) {
    return { ok: false, error: "cover_image_url is required" };
  }

  const supabase = createAdminClient();

  // Phase D guard — synthesize a deterministic caption when the caller
  // doesn't pass one. Without this, /api/post-builder/post 412s on
  // "generated_post has no caption" the first time the user tries to
  // publish a freshly-rendered Reel — and Reel Studio's Generate flow
  // today doesn't pass a caption through. Look up the listing for its
  // address (best-effort — if the join fails we still emit a generic
  // caption so the publish path isn't blocked).
  const mlsForCaption = input.composition.sourceListingMls;
  let captionLegacy = input.caption ?? null;
  let hashtagsLegacy = input.hashtags ?? null;
  let mlsHashtag: string | null = null;
  let captionsByPlatform: Record<
    SchedulablePlatform,
    { caption: string; hashtags: string[] }
  > | null = null;
  if (!captionLegacy) {
    const { data: listing } = await supabase
      .from("properties")
      .select("address, city, source_mls")
      .eq("mls_number", mlsForCaption)
      .maybeSingle();
    const synthesized = synthesizeReelCaption({
      mls_number: mlsForCaption,
      source_mls: (listing?.source_mls as SourceMls) ?? null,
      address: listing?.address ?? null,
      city: listing?.city ?? null,
    });
    captionLegacy = synthesized.legacy.caption;
    hashtagsLegacy = synthesized.legacy.hashtags;
    mlsHashtag = synthesized.legacy.mls_hashtag;
    captionsByPlatform = synthesized.captions;
  }

  const { data, error } = await supabase
    .from("generated_posts")
    .insert({
      mls_number: input.composition.sourceListingMls,
      // why: source_mls / property_id are unknown at this layer — the Reel
      // wizard works off the slim PostBuilderListing on the client. The
      // listing row joins on mls_number, so leaving these null is safe;
      // downstream readers fall through to listings.source_mls.
      source_mls: null,
      property_id: null,
      post_type: "just_listed",
      variant: "v1",
      format: "story_9x16",
      template_id: "reel_v1",
      media_type: "reel",
      // why: image_url doubles as the Reels cover/thumbnail. IG's Reels API
      // requires a cover frame URL on publish; reusing the listing's hero
      // photo for MVP keeps the path uniform with static posts. A future
      // day may render a proper "first frame of the MP4" cover.
      image_url: input.cover_image_url,
      // why: the cover image isn't a Storage path we own — it's the source
      // listing photo URL — so we don't have a path to clean up later.
      image_path: null,
      // why: hero_image_source_url mirrors the same source the cover came
      // from. Useful for diagnostics ("which photo became the cover?").
      hero_image_source_url: input.cover_image_url,
      video_url: input.video_url,
      video_path: input.video_path,
      // why: cast through `unknown` because the schema's `template: unknown`
      // discriminated-union member doesn't structurally line up with Json's
      // recursive shape. The runtime value is JSON-serializable (the worker
      // already parsed it from JSON), so the cast is safe.
      composition_json: input.composition as unknown as Json,
      reel_duration_ms: input.duration_ms,
      // why: empty template_props + customizations — those are Path A
      // concepts that don't apply to Reels. Caption / hashtags default to
      // null until the user generates them in Studio.
      template_props: {} as Json,
      customizations: {} as Json,
      // Phase D — caption + per-platform map. When the caller passed a
      // caption, we trust it; otherwise the synthesized values above
      // produce a usable default the user can edit in Studio.
      caption: captionLegacy,
      hashtags: hashtagsLegacy,
      mls_hashtag: mlsHashtag,
      captions_by_platform: (captionsByPlatform ?? {}) as unknown as Json,
      status: "draft",
      created_by: profile.id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: `insert_failed: ${error.message}` };
  }
  if (!data || typeof data.id !== "string") {
    return { ok: false, error: "insert returned no row" };
  }

  revalidatePath("/post-builder");
  revalidatePath("/saved-posts");
  return { ok: true, generated_post_id: data.id };
}

// ---------------------------------------------------------------------------
// triggerCanvasImageRenderAction — server-side canvas-editor PNG render
// ---------------------------------------------------------------------------
//
// why this action exists (2026-05-16):
//   Today, canvas-editor templates render via Fabric in the BROWSER (Path C
//   editor's onSave produces the PNG locally and uploads via canvas-save).
//   The Reel worker has its own Fabric-in-Chromium renderer for video
//   frames. The Multi-OH wizard uses the V1 Chromium HTML pipeline — a
//   THIRD code path for the same conceptual operation.
//
//   This action calls the worker's NEW synchronous /render-image endpoint
//   to unify everything onto the same Fabric machinery. The endpoint
//   takes a CanvasTemplateSchema + an MLSListingPayload and returns a
//   public Storage URL to the rendered PNG.
//
//   It's foundation work — none of the existing consumers (Path C editor,
//   Multi-OH wizard) are migrated yet. Phase 6+ builds will switch them
//   over one at a time so we can validate parity per consumer instead of
//   risking a big-bang regression.
//
// Behavior contract:
//   • requireUser() gate (same as every Studio mutation).
//   • Reads REEL_WORKER_URL + REEL_WORKER_AUTH_TOKEN from env. Same vars
//     as triggerReelRenderAction — one worker, two endpoints.
//   • Generates a client-side idempotency_key (UUID).
//   • POSTs to /render-image with bearer auth.
//   • 60s timeout — longer than triggerReelRenderAction's 30s because the
//     render itself runs synchronously on the worker (vs. fire-and-
//     forget for video). The worker target is ~2-3s; 60s leaves headroom
//     for cold-start and bucket upload latency.

export interface TriggerCanvasImageRenderInput {
  /**
   * Structurally a CanvasTemplateSchema. Typed `unknown` because this
   * action is the boundary into the worker, which doesn't share the
   * main app's type graph. Server actions in Next 15 JSON-serialize
   * args, so the runtime value must already be JSON-safe (no Dates,
   * no functions, no symbols).
   */
  template: unknown;
  /** Structurally an MLSListingPayload. Same boundary rationale as template. */
  listing: unknown;
}

export interface TriggerCanvasImageRenderOk {
  ok: true;
  /** Public Storage URL of the rendered PNG. */
  url: string;
  /** Internal Storage path of the PNG — used by future cleanup paths. */
  path: string;
}

export interface TriggerCanvasImageRenderErr {
  ok: false;
  error: string;
}

export type TriggerCanvasImageRenderResult =
  | TriggerCanvasImageRenderOk
  | TriggerCanvasImageRenderErr;

/** Worker /render-image success response. Mirrors RenderImageOk in
 *  worker/src/types.ts. */
interface WorkerRenderImageResponse {
  ok: true;
  url: string;
  path: string;
}

/**
 * Submit a single canvas-editor template to the worker's synchronous
 * /render-image endpoint. Returns the public Storage URL of the
 * rendered PNG.
 *
 * Future migration path (Phase 6+ — do NOT change yet):
 *   • Path C editor save: replace client-side toDataURL + canvas-save
 *     route with this action. Avoids running Fabric in the user's
 *     browser when the worker can do it in 2-3s.
 *   • Multi-OH wizard hero + per-property renders: replace the V1
 *     Chromium HTML pipeline with template-driven renders through this
 *     action. Brings the wizard onto the same template authoring system
 *     as every other post type.
 *
 * Today every consumer is unchanged — this action exists only so the
 * migration can land incrementally without coordinating a big-bang cutover.
 */
export async function triggerCanvasImageRenderAction(
  input: TriggerCanvasImageRenderInput,
): Promise<TriggerCanvasImageRenderResult> {
  await requireUser();

  if (!input.template || typeof input.template !== "object") {
    return { ok: false, error: "template is required and must be an object" };
  }
  if (!input.listing || typeof input.listing !== "object") {
    return { ok: false, error: "listing is required and must be an object" };
  }

  const env = readReelWorkerEnv();
  if (!env.ok) return { ok: false, error: env.error };

  // why: same idempotency-key generation as triggerReelRenderAction. The
  // worker uses this as the storage filename (overwrite-on-retry is safe;
  // the render is deterministic from the inputs).
  const idempotencyKey = crypto.randomUUID();

  try {
    const res = await fetch(`${env.baseUrl}/render-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.token}`,
      },
      body: JSON.stringify({
        template: input.template,
        listing: input.listing,
        idempotency_key: idempotencyKey,
      }),
      // why: 60s — longer than triggerReelRenderAction's 30s because
      // /render-image runs the full render synchronously inside the
      // request (vs. /render which 202s immediately and runs async).
      // Realistic target is ~2-3s; 60s allows for a cold Chromium
      // launch + upload variance.
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      let workerMessage = `HTTP ${res.status}`;
      try {
        const body: unknown = await res.json();
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error: unknown }).error === "string"
        ) {
          workerMessage = (body as { error: string }).error;
        }
      } catch {
        // ignore — status code alone is enough context
      }
      return {
        ok: false,
        error: `Worker rejected the image render: ${workerMessage}`,
      };
    }

    const body: unknown = await res.json();
    if (!isWorkerRenderImageResponse(body)) {
      return {
        ok: false,
        error: "Worker returned an unexpected /render-image response shape",
      };
    }

    return { ok: true, url: body.url, path: body.path };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.name === "TimeoutError" || e.name === "AbortError"
          ? "Worker did not respond within 60 seconds — check that REEL_WORKER_URL points at a running worker."
          : `Worker unreachable: ${e.message}`
        : "Worker unreachable: unknown error";
    return { ok: false, error: message };
  }
}

/** Structural narrowing for the worker's /render-image success body. */
function isWorkerRenderImageResponse(
  value: unknown,
): value is WorkerRenderImageResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.ok === true &&
    typeof v.url === "string" &&
    typeof v.path === "string"
  );
}

// ---------------------------------------------------------------------------
// AI Magic Design — Phase C.1
// ---------------------------------------------------------------------------
//
// One-click "let Claude design this post" entry point. The UI hands us a
// listing + optional office profile + the listing's photo gallery; we hand
// back a complete (post_type, variant, format, hero_photo_index, caption,
// hashtags, rationale) recommendation. The Studio overlay opens with all of
// that state pre-applied so Larissa can tweak + ship instead of building
// from a blank picker.

import { runMagicDesign } from "@/lib/post-builder/magic-design";
import type {
  MagicDesignInput as MagicDesignInternalInput,
  MagicDesignOfficeProfile,
  MagicDesignRecommendation,
} from "@/lib/post-builder/magic-design";
import { isAnthropicConfigured } from "@/lib/ai/anthropic";
import type { PostBuilderListing } from "@/lib/post-builder/types";

/**
 * Server-action input shape — mirrors the internal runMagicDesign() input
 * but is re-declared here to keep the action surface explicit (no
 * server-only types leaking through internal renames).
 */
export interface MagicDesignInput {
  listing: PostBuilderListing;
  officeProfile?: MagicDesignOfficeProfile | null;
  availablePhotos: string[];
}

export type MagicDesignResult =
  | { ok: true; recommendation: MagicDesignRecommendation }
  | { ok: false; error: string };

/**
 * Trigger AI Magic Design for a single listing. Auth-gated; safe to call
 * from any client surface that already requires a signed-in user. Returns
 * a complete post recommendation OR a typed error the UI can surface.
 *
 * Idempotent: each invocation produces a fresh recommendation. Larissa's
 * "Re-roll" button just calls this again — Sonnet is non-deterministic so
 * the second pass produces a different (post_type, variant, format,
 * caption) bundle.
 *
 * Why this is a thin pass-through to runMagicDesign:
 *   - Server actions need to live in `app/` directories per Next.js 15.
 *   - The core logic + SYSTEM_PROMPT live in `lib/post-builder/magic-design.ts`
 *     so they're reachable from non-action contexts (future API routes,
 *     batch jobs, scripts) without dragging the entire actions.ts file in.
 *   - Auth + the isAnthropicConfigured() probe belong at the action boundary
 *     so the internal module stays free of Next.js-specific plumbing.
 */
export async function triggerMagicDesignAction(
  input: MagicDesignInput,
): Promise<MagicDesignResult> {
  // why: requireUser() throws → upstream caller catches and renders a
  // signed-out toast. Same gating contract as every other action here.
  await requireUser();

  // why: short-circuit BEFORE building the prompt or making any network
  // call. Saves a couple hundred ms when Anthropic isn't configured (e.g.
  // local dev without an API key paste in /settings) so the UI surfaces a
  // clear "not configured" message instantly.
  const configured = await isAnthropicConfigured();
  if (!configured) {
    return { ok: false, error: "Anthropic not configured" };
  }

  if (!input.listing || !input.listing.mls_number) {
    return { ok: false, error: "missing listing" };
  }
  if (!Array.isArray(input.availablePhotos)) {
    return { ok: false, error: "missing photos array" };
  }

  const internal: MagicDesignInternalInput = {
    listing: input.listing,
    officeProfile: input.officeProfile ?? null,
    availablePhotos: input.availablePhotos,
  };

  return runMagicDesign(internal);
}

// Re-export the recommendation shape so client components can import it
// from a single canonical location alongside the action they're calling.
export type { MagicDesignRecommendation, MagicDesignOfficeProfile };

// ---------------------------------------------------------------------------
// synthesizeReelCaption — deterministic caption + per-platform fallback for
// freshly-rendered Reels
// ---------------------------------------------------------------------------
//
// Phase D — Reel Studio doesn't run the caption pipeline as part of its
// Generate flow; the user lands back in Post Builder where they can hit
// Generate to fill in captions. But if they try Post Now before that,
// the publish route 412s on "no caption". This helper produces a
// minimal usable caption + per-platform map so the publish path always
// has something to publish. Users overwrite via the Studio caption pane
// before posting.
//
// Mirrors the per-platform style + hashtag-cap rules from
// `lib/post-builder/captions.ts` — IG long form, FB conversational
// short, TikTok punchy hook, IG cap 30 / FB 6 / TT 5, canonical MLS
// hashtag preserved on every platform.
function synthesizeReelCaption(args: {
  mls_number: string;
  source_mls: SourceMls;
  address: string | null;
  city: string | null;
}): {
  legacy: { caption: string; hashtags: string[]; mls_hashtag: string };
  captions: Record<
    SchedulablePlatform,
    { caption: string; hashtags: string[] }
  >;
} {
  const addr = args.address?.trim() || "this listing";
  const city = args.city?.trim();
  const locationSuffix = city ? ` in ${city}` : "";
  const mlsHashtag = canonicalMlsHashtag(args.mls_number, args.source_mls);

  const igBody =
    `Walk through ${addr}${locationSuffix} in this short Reel. ` +
    `If anything catches your eye, DM for the full tour or to schedule a private showing.`;
  const fbBody =
    `Quick tour of ${addr}${locationSuffix}. Reach out if it's a fit and we'll set up a time to walk through in person.`;
  const ttBody = `Inside ${addr}${locationSuffix}. Full tour — link in bio.`;

  const brand = [
    "#Century21Alliance",
    "#C21Alliance",
    "#SouthJerseyRealEstate",
  ];
  const postType = ["#JustListed", "#NewListing", "#ForSale"];
  const baseTags = [...postType, ...brand, mlsHashtag].filter(
    (t) => t.length > 1,
  );

  const cap = (tags: readonly string[], limit: number): string[] => {
    const slice = tags.slice(0, limit);
    return slice.includes(mlsHashtag)
      ? slice
      : [mlsHashtag, ...slice.slice(0, limit - 1)];
  };

  const igTags = cap(baseTags, 30);
  const fbTags = cap(baseTags, 6);
  const ttTags = cap(baseTags, 5);

  return {
    legacy: {
      caption: igBody,
      hashtags: igTags,
      mls_hashtag: mlsHashtag,
    },
    captions: {
      instagram: { caption: igBody, hashtags: igTags },
      facebook: { caption: fbBody, hashtags: fbTags },
      tiktok: { caption: ttBody, hashtags: ttTags },
    },
  };
}

/**
 * Inline canonical MLS hashtag generator — duplicated from captions.ts
 * to keep this action file self-contained (no AI module dep dragged in
 * just to compute a hashtag). If the convention changes, sync both
 * copies — the auto-linker keys on this.
 */
function canonicalMlsHashtag(
  mls_number: string,
  source_mls: SourceMls,
): string {
  const normalized = mls_number.replace(/^#/, "").trim();
  if (!normalized) return "";
  if (source_mls === "cmc") return `#CMC${normalized}`;
  if (source_mls === "sjsr") return `#SJSR${normalized}`;
  if (source_mls === "bright" || /^NJ[A-Z]{2}\d+$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return `#${normalized}`;
}
