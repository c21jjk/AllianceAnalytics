/**
 * Shared constants + wire types for the listing-notes feature.
 *
 * 2026-08-07 — this file exists ONLY because a "use server" module may export
 * nothing but async functions. `MAX_NOTE_LENGTH` and the client-facing result
 * shapes originally lived in app/(app)/listings/note-actions.ts and broke the
 * Vercel build ("Only async functions are allowed to be exported in a 'use
 * server' file"). `npx tsc --noEmit` does NOT catch this — it's an SWC rule
 * enforced at build time, not a type error.
 *
 * Deliberately plain: no "use server", no "server-only". Both the server
 * actions and the client component import from here.
 */

/** Hard cap on a single note body. Enforced in the action AND in the textarea. */
export const MAX_NOTE_LENGTH = 500;

/** One thread entry as the client panel renders it. */
export interface ClientNoteEntry {
  id: string;
  body: string;
  created_at: string;
  author_name: string;
  /**
   * Whether the signed-in user wrote this. Computed server-side so the panel
   * shows a delete affordance only where the delete would actually succeed —
   * the action itself still enforces it.
   */
  is_mine: boolean;
}

export interface NoteActionResult {
  ok: boolean;
  error?: string;
}

export interface LoadNoteThreadResult {
  ok: boolean;
  error?: string;
  entries?: ClientNoteEntry[];
  held?: boolean;
  hold_label?: string | null;
}
