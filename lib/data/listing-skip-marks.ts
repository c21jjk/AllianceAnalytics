import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MilestonePostType } from "@/lib/data/listing-post-marks";

/**
 * The milestones a listing can be skipped for. Deliberately NOT
 * MilestonePostType: open_house is excluded, matching the DB check
 * constraint. Open-house rows expire on their own 6 hours after the event
 * starts, so a skip would be a control with nothing to do.
 */
export type SkippablePostType = Exclude<MilestonePostType, "open_house">;

/**
 * listing_skip_marks — the "not worth a post" flag, per (listing, milestone).
 *
 * 2026-08-07 (John): "7 day drop off only for published properties, but also
 * add skip control to all statuses (except open houses)."
 *
 * The dashboard's visibility rule is now:
 *
 *     show a row when it is inside the 7-day window
 *     OR it is neither posted nor skipped
 *
 * which makes each card a worklist rather than a feed: a busy week cannot
 * silently swallow work. Skip is the release valve that lets a listing nobody
 * intends to promote leave the card anyway.
 *
 * Keyed on mls_number + post_type, mirroring listing_post_marks. The older
 * properties.promotion_dismissed_at column is PROPERTY-wide, so it could not
 * express "skip the Just Sold but still post the Price Change". It is still
 * honoured on read for just_listed so nothing already skipped reappears, but
 * nothing new is ever written to it.
 */

export interface ListingSkipMark {
  skipped_at: string;
  reason: string | null;
}

/**
 * Batched skip lookup for one milestone. One round trip per dashboard card,
 * same shape as getListingPostMarks.
 *
 * Returns a Map of mls_number → mark.
 */
export async function getListingSkipMarks(
  mlsNumbers: string[],
  postType: MilestonePostType,
): Promise<Map<string, ListingSkipMark>> {
  const out = new Map<string, ListingSkipMark>();
  const unique = Array.from(new Set(mlsNumbers.filter(Boolean)));
  if (unique.length === 0) return out;

  const supabase = createAdminClient();
  // listing_skip_marks isn't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const { data, error } = await untyped
    .from("listing_skip_marks")
    .select("mls_number, skipped_at, reason")
    .eq("post_type", postType)
    .in("mls_number", unique);

  if (error) {
    console.error(
      `[listing-skip-marks] fetch failed (${postType}):`,
      error.message,
    );
    return out;
  }

  for (const row of (data ?? []) as Array<{
    mls_number: string;
    skipped_at: string;
    reason: string | null;
  }>) {
    out.set(row.mls_number, {
      skipped_at: row.skipped_at,
      reason: row.reason,
    });
  }
  return out;
}

/**
 * Every skip on record, newest first, for the /settings/promotions undo page.
 * Capped because that page is a review surface, not an archive.
 */
export async function listAllListingSkipMarks(limit = 200): Promise<
  Array<{
    mls_number: string;
    post_type: SkippablePostType;
    reason: string | null;
    skipped_at: string;
    skipped_by: string | null;
  }>
> {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  // 2026-08-08 — skipped_by is written on every skip (skip-actions.ts) and
  // was never selected, so the audit page could only ever show attribution
  // for the legacy property-wide dismissals. A new skip looked anonymous.
  const { data, error } = await untyped
    .from("listing_skip_marks")
    .select("mls_number, post_type, reason, skipped_at, skipped_by")
    .order("skipped_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[listing-skip-marks] list failed:", error.message);
    return [];
  }
  return (data ?? []) as Array<{
    mls_number: string;
    post_type: SkippablePostType;
    reason: string | null;
    skipped_at: string;
    skipped_by: string | null;
  }>;
}
