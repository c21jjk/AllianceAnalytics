import { redirect } from "next/navigation";

/**
 * 2026-08-05 (John) — "Can the two Template sections be merged, or do they
 * handle two totally different things?"
 *
 * Same thing, sliced two ways. This page listed template_definitions filtered
 * to source='studio' and offered rename / set-default / archive. The admin
 * Template Builder already listed EVERY row in that table with the state
 * pills, reordering, lifecycle editing and the canvas editor, so this was a
 * weaker second window onto the same data and a second entry in the Admin
 * menu for it.
 *
 * Template Builder now has a Source filter, so the view this page provided is
 * one pill click there. Redirecting rather than deleting keeps old bookmarks
 * working. Every account on this install is admin, so nobody loses access.
 *
 * Safe to delete once nothing points here. CustomTemplatesTable.tsx is left in
 * place for now in case any of its per-row actions are worth folding into the
 * Template Builder rows later.
 */
export default function ManageTemplatesPage() {
  redirect("/admin/templates?source=studio");
}
