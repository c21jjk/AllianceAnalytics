import { redirect } from "next/navigation";

/**
 * 2026-08-05 (John) — Maintenance folded into Settings.
 *
 * This was a whole top-level route, a nav entry and a two-column grid layout
 * wrapped around exactly one card (the thumbnail cache backfill). The card now
 * lives as a section at the bottom of /settings.
 *
 * Redirect kept so bookmarks still land somewhere useful. The card component
 * and its server actions stay in this folder — Settings imports them from here
 * rather than moving files around for no functional gain.
 */
export default function MaintenancePage() {
  redirect("/settings");
}
