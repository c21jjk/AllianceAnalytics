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
 * The date a milestone fetcher should query back to.
 *
 * 2026-08-08 — this used to return the LATER of the slate date and the
 * caller's own rolling window (14 days for Recently Listed, 30 for Recently
 * Sold), which reads sensibly and is a time bomb. The slate is fixed at Aug 1
 * while the rolling cutoff moves forward every day, so on Aug 16 the 14-day
 * window overtakes it and on Aug 31 the 30-day one does. After that an
 * unhandled listing older than the window is filtered out by the SQL and
 * never reaches isVisibleOnMilestoneCard, which is the only thing that knows
 * it was never posted. A listing nobody dealt with would have quietly
 * disappeared, which is precisely what the 7-day rule exists to prevent.
 *
 * So: the query goes back to the slate, and nothing further. Visibility is
 * decided downstream by isVisibleOnMilestoneCard, which CAN see the handled
 * flag — published rows age out after 7 days, unhandled ones stay until
 * someone posts or skips them.
 *
 * The `rollingCutoffDate` argument is kept so call sites read the same and to
 * document what the caller thought it wanted; it is deliberately unused.
 */
export function floorDate(rollingCutoffDate: string): string {
  void rollingCutoffDate;
  return MILESTONE_FLOOR_DATE;
}

/** Timestamp flavour of {@link floorDate}. */
export function floorIso(rollingCutoffIso: string): string {
  void rollingCutoffIso;
  return MILESTONE_FLOOR_ISO;
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

/* -------------------------------------------------------------------------- */
/* Rolling window — 2026-08-07                                                */
/* -------------------------------------------------------------------------- */

/**
 * 2026-08-07 (John): "I'm thinking we can use a 7 day rolling period... 7 day
 * drop off only for published properties, but also add skip control to all
 * statuses (except open houses). 7 days for all statuses."
 *
 * Before this, every card used a different window and no two agreed: Recently
 * Listed was 14 days, Recently Sold 30, and Under Contract and Price Changes
 * had no rolling window at all, leaning entirely on the Aug 1 floor. Nobody
 * could have told you that by looking at the screen.
 */
export const ROLLING_WINDOW_DAYS = 7;

/** Heading copy. Every milestone card prints the same phrase. */
export const ROLLING_WINDOW_LABEL = "last 7 days";

/**
 * The one visibility question, asked identically by all four milestone cards.
 *
 * A row shows when EITHER:
 *   - its milestone date is inside the rolling window, or
 *   - it has not been handled yet (no post made, not skipped)
 *
 * The second clause is the important one. A plain rolling window drops rows
 * whether or not anything was done about them, so a week of sick leave erases
 * a week of work with no trace. Pinning unhandled rows keeps each card a
 * worklist. Skip is what lets a listing nobody intends to promote leave anyway.
 *
 * The Aug 1 floor still applies underneath this, enforced in each fetcher's
 * query. It is NOT redundant: without it, "unhandled rows stay" would drag
 * every unposted listing from before the slate back onto the dashboard.
 */
export function isVisibleOnMilestoneCard(args: {
  /** The date that defines this row's milestone (ISO date or timestamp). */
  referenceDate: string | null;
  /** True when a post of this milestone type exists, or the row was skipped. */
  handled: boolean;
  now?: number;
}): boolean {
  if (!args.handled) return true;

  const t = args.referenceDate ? Date.parse(args.referenceDate) : NaN;
  // Unparseable date on a handled row: keep it rather than vanish it. A row
  // that lingers is a visible annoyance; one that disappears is a silent bug.
  if (!Number.isFinite(t)) return true;

  const cutoff =
    (args.now ?? Date.now()) - ROLLING_WINDOW_DAYS * 24 * 3600_000;
  return t >= cutoff;
}

/**
 * Sort comparator for milestone rows: anything still needing action first,
 * then newest-first inside each group.
 *
 * Without this, a growing backlog of unhandled rows sorts by date among the
 * handled ones and can be pushed off the bottom by the row cap, which would
 * hide exactly the work the card exists to surface.
 */
export function compareMilestoneRows(
  a: { handled: boolean; referenceDate: string | null },
  b: { handled: boolean; referenceDate: string | null },
): number {
  if (a.handled !== b.handled) return a.handled ? 1 : -1;
  const at = a.referenceDate ? Date.parse(a.referenceDate) : 0;
  const bt = b.referenceDate ? Date.parse(b.referenceDate) : 0;
  return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
}
