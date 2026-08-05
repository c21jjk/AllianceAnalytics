import { redirect } from "next/navigation";

/**
 * 2026-08-05 (John) — Owner Stories folded into Reports.
 *
 * Stories and Reports were two halves of one idea: both answered "what did
 * the seller get". They each held a slot in a seven-tab nav, which was one of
 * the reasons the bar read as unclear. The index table now lives at
 * /reports?view=stories.
 *
 * This route stays as a redirect so existing links, bookmarks and any emailed
 * deep links keep working. Safe to delete once nothing points here.
 */
export default function StoriesPage() {
  redirect("/reports?view=stories");
}
