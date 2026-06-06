"use server";

/**
 * Admin server actions for the Audio Library.
 *
 * Every action requires admin role (requireAdmin) and uses the service-role
 * admin client. Audio files are uploaded to the existing public `reel-music`
 * Storage bucket at:
 *   meta-sound-collection/{track_id}/{clean-track-name}.{mp3|wav}
 *
 * All Meta Sound Collection defaults (audio_source, license_scope,
 * platform_allowed, platform_blocked) are stamped server-side so the admin
 * can't accidentally clear them.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PostType } from "@/lib/post-builder/types";
import {
  AUDIO_BUCKET,
  AUDIO_POST_TYPES,
  AUDIO_SOURCE_DEFAULT,
  LICENSE_SCOPE_DEFAULT,
  PLATFORM_ALLOWED_DEFAULT,
  PLATFORM_BLOCKED_DEFAULT,
  buildAudioStoragePath,
  type AudioTrackInsert,
} from "@/lib/audio-library/types";

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const MAX_AUDIO_BYTES = 30 * 1024 * 1024; // matches the bucket's 30MB cap
const VALID_POST_TYPES = new Set<PostType>(AUDIO_POST_TYPES);

function sanitizePostTypes(raw: unknown): PostType[] {
  if (!Array.isArray(raw)) return [];
  const out: PostType[] = [];
  for (const v of raw) {
    if (typeof v === "string" && VALID_POST_TYPES.has(v as PostType)) {
      out.push(v as PostType);
    }
  }
  return out;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function optStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v.length > 0 ? v : null;
}

function optNum(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (v.length === 0) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Infer mp3/wav from the file's MIME type, falling back to its name. */
function inferExt(file: File): "mp3" | "wav" {
  const type = (file.type || "").toLowerCase();
  if (type.includes("wav")) return "wav";
  if (file.name.toLowerCase().endsWith(".wav")) return "wav";
  return "mp3";
}

function contentTypeFor(ext: "mp3" | "wav"): string {
  return ext === "wav" ? "audio/wav" : "audio/mpeg";
}

/**
 * Upload a new audio track: push the file to Storage, then insert the row.
 * The row id and the storage path's {track_id} segment are the SAME uuid so
 * the file is trivially locatable from the row.
 */
export async function uploadAudioTrackAction(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const track_name = str(formData, "track_name");
  if (track_name.length === 0) {
    return { ok: false, error: "Track name is required." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an audio file to upload." };
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return { ok: false, error: "Audio file is larger than the 30MB limit." };
  }

  const ext = inferExt(file);
  const trackId = crypto.randomUUID();
  const filePath = buildAudioStoragePath(trackId, track_name, ext);

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: "Could not read the uploaded file." };
  }

  const supabase = createAdminClient();

  const { error: uploadErr } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(filePath, bytes, {
      contentType: contentTypeFor(ext),
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadErr) {
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  const row: AudioTrackInsert = {
    id: trackId,
    track_name,
    artist: optStr(formData, "artist"),
    genre: optStr(formData, "genre"),
    mood: optStr(formData, "mood"),
    duration: optNum(formData, "duration"),
    file_path: filePath,
    license_notes: optStr(formData, "license_notes"),
    post_type: sanitizePostTypes(formData.getAll("post_types")),
    // Meta Sound Collection defaults — stamped server-side, never client-set.
    audio_source: AUDIO_SOURCE_DEFAULT,
    license_scope: LICENSE_SCOPE_DEFAULT,
    platform_allowed: [...PLATFORM_ALLOWED_DEFAULT],
    platform_blocked: [...PLATFORM_BLOCKED_DEFAULT],
    is_active: true,
  };

  const { error: insertErr } = await supabase.from("audio_tracks").insert(row);
  if (insertErr) {
    // Roll back the orphaned file so a failed insert doesn't leave litter.
    await supabase.storage.from(AUDIO_BUCKET).remove([filePath]).catch(() => {});
    return { ok: false, error: `Save failed: ${insertErr.message}` };
  }

  revalidatePath("/admin/audio-library");
  return { ok: true, id: trackId };
}

/** Patch a track's editable metadata (not the file). */
export async function updateAudioTrackAction(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return { ok: false, error: "Missing track id." };

  const track_name = str(formData, "track_name");
  if (track_name.length === 0) {
    return { ok: false, error: "Track name can't be empty." };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("audio_tracks")
    .update({
      track_name,
      artist: optStr(formData, "artist"),
      genre: optStr(formData, "genre"),
      mood: optStr(formData, "mood"),
      duration: optNum(formData, "duration"),
      license_notes: optStr(formData, "license_notes"),
      post_type: sanitizePostTypes(formData.getAll("post_types")),
    })
    .eq("id", id);
  if (error) return { ok: false, error: `Update failed: ${error.message}` };

  revalidatePath("/admin/audio-library");
  return { ok: true, id };
}

/** Toggle active/inactive (archive = set inactive). */
export async function setAudioTrackActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return { ok: false, error: "Missing track id." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("audio_tracks")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { ok: false, error: `Update failed: ${error.message}` };

  revalidatePath("/admin/audio-library");
  return { ok: true, id };
}

/** Hard delete: remove the row and its Storage file. */
export async function deleteAudioTrackAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return { ok: false, error: "Missing track id." };

  const supabase = createAdminClient();

  const { data: row } = await supabase
    .from("audio_tracks")
    .select("file_path")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("audio_tracks").delete().eq("id", id);
  if (error) return { ok: false, error: `Delete failed: ${error.message}` };

  // Best-effort file cleanup — a failed remove leaves an orphan but the row
  // (the source of truth) is gone, so the track no longer appears anywhere.
  if (row?.file_path) {
    await supabase.storage.from(AUDIO_BUCKET).remove([row.file_path]).catch(() => {});
  }

  revalidatePath("/admin/audio-library");
  return { ok: true, id };
}
