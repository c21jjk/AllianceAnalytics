"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import type {
  PostFormat,
  PostType,
  PostVariant,
  SaveGeneratedPostInput,
  SaveGeneratedPostResult,
  SaveGeneratedPostErrorResult,
  ScheduledFor,
  SchedulablePlatform,
  SourceMls,
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
