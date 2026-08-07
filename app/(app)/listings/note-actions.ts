"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getListingNoteThread } from "@/lib/data/listing-notes";
// NOTE: a "use server" module may export ONLY async functions, so the length
// cap and the result types live in a plain module. See lib/listing-notes-shared.ts.
import {
  MAX_NOTE_LENGTH,
  type LoadNoteThreadResult,
  type NoteActionResult,
} from "@/lib/listing-notes-shared";

/**
 * 2026-08-07 (John) — shared per-listing notes + the "hold, don't post yet"
 * flag. See lib/data/listing-notes.ts for the why behind the data model.
 *
 * Deliberately its own file rather than more lines on
 * app/(app)/listings/actions.ts — that file is already ~24KB and covers a
 * different concern (listing CRUD + promotion dismissal).
 */

/**
 * Fetch the full thread when the panel opens, rather than shipping every note
 * for every listing with the dashboard payload. The collapsed row only ever
 * needs the newest entry + a count, which the milestone fetchers already carry.
 */
export async function loadListingNoteThreadAction(
  mlsNumber: string,
): Promise<LoadNoteThreadResult> {
  const profile = await requireAdmin();
  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }

  const { entries, on_hold } = await getListingNoteThread(mlsNumber);

  return {
    ok: true,
    entries: entries.map((e) => ({
      id: e.id,
      body: e.body,
      created_at: e.created_at,
      author_name: e.author.name,
      is_mine: e.author.id === profile.id,
    })),
    held: Boolean(on_hold),
    hold_label: on_hold ? on_hold.set_by_name : null,
  };
}

/**
 * Every surface that can show a note has to be revalidated together, or a note
 * added from the dashboard won't appear on the property page (and vice versa).
 * Cheap — these are all force-dynamic routes anyway.
 */
function revalidateNoteSurfaces(mlsNumber: string): void {
  revalidatePath("/");
  revalidatePath("/properties");
  revalidatePath(`/properties/${encodeURIComponent(mlsNumber)}`);
  revalidatePath("/post-builder");
}

/** Append one entry to a listing's note thread. Never edits an existing one. */
export async function addListingNoteAction(
  mlsNumber: string,
  body: string,
): Promise<NoteActionResult> {
  const profile = await requireAdmin();

  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }
  const trimmed = (body ?? "").trim();
  if (!trimmed) return { ok: false, error: "Write something first." };
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `Keep it under ${MAX_NOTE_LENGTH} characters.`,
    };
  }

  const supabase = createAdminClient();
  // listing_notes isn't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const { error } = await untyped.from("listing_notes").insert({
    mls_number: mlsNumber,
    body: trimmed,
    author_id: profile.id,
  });
  if (error) return { ok: false, error: error.message };

  revalidateNoteSurfaces(mlsNumber);
  return { ok: true };
}

/**
 * Remove one entry. Authors can delete their own notes only — this is a
 * typo-eraser, not moderation. Everyone on the team is an admin, so the role
 * check alone wouldn't restrict anything; the author_id match is the real gate.
 */
export async function deleteListingNoteAction(
  noteId: string,
  mlsNumber: string,
): Promise<NoteActionResult> {
  const profile = await requireAdmin();

  if (!noteId || typeof noteId !== "string") {
    return { ok: false, error: "Missing note id." };
  }

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const { data, error } = await untyped
    .from("listing_notes")
    .delete()
    .eq("id", noteId)
    .eq("author_id", profile.id)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "You can only delete your own notes." };
  }

  revalidateNoteSurfaces(mlsNumber);
  return { ok: true };
}

/**
 * Toggle the hold flag. Upsert on, delete off — idempotent both ways, so a
 * double-click can't produce a half state.
 *
 * `noteId` optionally records which note explains the hold, so the UI can
 * point at it later. Null is fine: a hold with no explanation still shows.
 */
export async function setListingHoldAction(
  mlsNumber: string,
  held: boolean,
  noteId?: string | null,
): Promise<NoteActionResult> {
  const profile = await requireAdmin();

  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  if (held) {
    const { error } = await untyped.from("listing_holds").upsert(
      {
        mls_number: mlsNumber,
        note_id: noteId ?? null,
        set_by: profile.id,
        set_at: new Date().toISOString(),
      },
      { onConflict: "mls_number" },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await untyped
      .from("listing_holds")
      .delete()
      .eq("mls_number", mlsNumber);
    if (error) return { ok: false, error: error.message };
  }

  revalidateNoteSurfaces(mlsNumber);
  return { ok: true };
}

/**
 * Save a note and set/clear the hold in one motion — what the panel's "Save
 * note" button calls when the hold checkbox state differs from what's stored.
 * Keeps the two writes from racing each other's revalidation.
 */
export async function saveListingNoteAndHoldAction(
  mlsNumber: string,
  body: string,
  held: boolean,
): Promise<NoteActionResult> {
  const profile = await requireAdmin();

  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }

  const trimmed = (body ?? "").trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `Keep it under ${MAX_NOTE_LENGTH} characters.` };
  }

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  let insertedNoteId: string | null = null;

  if (trimmed) {
    const { data, error } = await untyped
      .from("listing_notes")
      .insert({
        mls_number: mlsNumber,
        body: trimmed,
        author_id: profile.id,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    insertedNoteId = (data as { id: string } | null)?.id ?? null;
  }

  if (held) {
    const { error } = await untyped.from("listing_holds").upsert(
      {
        mls_number: mlsNumber,
        // Point the hold at the note just written, when there is one. An
        // existing hold keeps its old note_id if this save was text-only.
        ...(insertedNoteId ? { note_id: insertedNoteId } : {}),
        set_by: profile.id,
        set_at: new Date().toISOString(),
      },
      { onConflict: "mls_number" },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await untyped
      .from("listing_holds")
      .delete()
      .eq("mls_number", mlsNumber);
    if (error) return { ok: false, error: error.message };
  }

  revalidateNoteSurfaces(mlsNumber);
  return { ok: true };
}
