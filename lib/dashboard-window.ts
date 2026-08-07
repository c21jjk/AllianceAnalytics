/**
 * Shared milestone floor date for the dashboard.
 *
 * 2026-08-05 (John): "clear the slate and we're going to start fresh for new
 * posts from Aug 1st forward. I don't want to go back to previously listed,
 * sold, pending or reduced prior to Aug 1st."
 *
 * Every milestone section on the dashboard (Recently Listed, Under Contract,
 * Recently Sold, Price Changes) filters to activity on or after this date, on
 * top of whatever rolling window it already had. Open Houses is deliberately
 * NOT gated — it looks forward at upcoming events, not backward at history.
 *
 * Each section applies the floor to the date that actually defines its
 * milestone:
 *   Recently Listed → listing_date (created_at when the MLS date is missing)
 *   Under Contract  → status_changed_at (when it flipped to pending)
 *   Recently Sold   → close_date
 *   Price Changes   → listing_price_changes.changed_at
 *
 * To retire the slate later, either move this date or set it to null and the
 * helpers below become no-ops.
 */

/** ISO date (YYYY-MM-DD) before which no milestone activity is shown. */
export const MILESTONE_FLOOR_DATE = "2026-08-01";

/** Same instant as an ISO timestamp, for timestamptz columns. */
export const MILESTONE_FLOOR_ISO = `${MILESTONE_FLOOR_DATE}T00:00:00.000Z`;

/**
 * Pick the later of the floor and a rolling-window cutoff, as a YYYY-MM-DD
 * string. Sections keep their own window (e.g. "last 14 days") and the floor
 * simply wins whenever it is more recent, which it is until the window grows
 * past the slate date.
 */
export function floorDate(rollingCutoffDate: string): string {
  return rollingCutoffDate > MILESTONE_FLOOR_DATE
    ? rollingCutoffDate
    : MILESTONE_FLOOR_DATE;
}

/** Timestamp flavour of {@link floorDate}. */
export function floorIso(rollingCutoffIso: string): string {
  return rollingCutoffIso > MILESTONE_FLOOR_ISO
    ? rollingCutoffIso
    : MILESTONE_FLOOR_ISO;
}

/**
 * Human copy for the empty states. Every milestone card says the same thing
 * when it is empty purely because of the slate, so Larissa doesn't read an
 * empty section as a broken one.
 */
/**
 * 2026-08-05 (John): trimmed from a full explanation ("The dashboard starts
 * fresh from Aug 1, 2026 — anything older is intentionally hidden") down to
 * four words. Every card heading already reads "· since Aug 1", so the long
 * version explained the same fact a second time. The card subtitles that also
 * printed this string are gone now — that pairing is what made Price Changes
 * say the whole sentence twice in a row.
 */
export const MILESTONE_FLOOR_LABEL = "Aug 1";
export const MILESTONE_FLOOR_EMPTY_COPY = "Nothing since Aug 1.";
