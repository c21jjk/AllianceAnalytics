/**
 * TEMPORARY one-week pause on the Monday leadership + owner-story email blasts.
 *
 * Why: John was removed from the FB/IG Pages on 2026-06-11 (Meta 190/492
 * page-role/2FA error), so FB + IG reach/engagement stopped syncing and the
 * numbers in both weekly emails are stale/under-counted. Holding the
 * 2026-06-15 send so managers and agents don't receive wrong data.
 *
 * Resumes automatically on Monday 2026-06-22 (America/New_York). Once the
 * Meta re-auth is done and this date has passed, this file + its two call
 * sites can be deleted.
 */

/** Inclusive: skip sends while the NY date is before this. */
const PAUSE_UNTIL_NY = "2026-06-22";

/** Current date in America/New_York as YYYY-MM-DD (lexicographically comparable). */
function nyDateString(): string {
  // en-CA renders as YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** True while the weekly email blasts are paused (before PAUSE_UNTIL_NY). */
export function weeklyEmailsPaused(): boolean {
  return nyDateString() < PAUSE_UNTIL_NY;
}

export { PAUSE_UNTIL_NY };
