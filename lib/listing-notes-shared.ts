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
  /**
   * Names actually emailed, so the panel can confirm "Emailed Cheryl" instead
   * of leaving the writer wondering whether the notification went out.
   */
  notified?: string[];
}

/** A teammate who can be ticked in the notify row under the note box. */
export interface NotifiableTeammate {
  id: string;
  name: string;
  /** First name, lowercased. Used for the pre-tick scan of the note body. */
  first_name: string;
}

export interface LoadNoteThreadResult {
  ok: boolean;
  error?: string;
  entries?: ClientNoteEntry[];
  held?: boolean;
  hold_label?: string | null;
  /** Everyone the signed-in user could notify, i.e. the team minus themselves. */
  teammates?: NotifiableTeammate[];
}

/**
 * Which teammates a note body appears to be addressed to. Used ONLY to
 * pre-tick the notify checkboxes, never to send on its own: a silent
 * notification nobody chose is worse than a missed one they can see.
 *
 * Word-boundary match so "Cheryl" hits but "Cheryls" and a mid-word run of
 * letters do not. Case-insensitive.
 */
export function detectMentionedTeammates(
  body: string,
  teammates: NotifiableTeammate[],
): string[] {
  const text = (body ?? "").toLowerCase();
  if (!text.trim()) return [];
  const out: string[] = [];
  for (const mate of teammates) {
    const first = mate.first_name;
    if (!first || first.length < 2) continue;
    // Escape anything regex-significant in a name before building the pattern.
    const safe = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9])@?${safe}([^a-z0-9]|$)`, "i").test(text)) {
      out.push(mate.id);
    }
  }
  return out;
}
