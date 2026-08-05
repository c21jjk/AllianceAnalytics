import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * listing_post_marks — the "we made this post" flag, per (listing, post type).
 *
 * 2026-08-05 (John): the dashboard's four milestone sections each get one
 * simple checkbox instead of the old three per-platform chips. The previous
 * marker lived on `properties.posts_confirmed_at` / `posts_confirmed_platforms`,
 * which is per PROPERTY — so a listing that moves Just Listed → Under Contract
 * → Just Sold carried one shared checkmark across all three milestones and the
 * later sections inherited a checkmark they never earned.
 *
 * A row here means "a post of THIS type has been made for THIS listing".
 * The legacy properties columns are untouched and still readable elsewhere.
 */

export type MilestonePostType =
  | "just_listed"
  | "under_contract"
  | "just_sold"
  | "price_reduction"
  | "open_house";

export const MILESTONE_POST_TYPES: MilestonePostType[] = [
  "just_listed",
  "under_contract",
  "just_sold",
  "price_reduction",
  "open_house",
];

/**
 * Fetch the manual marks for a set of listings and one post type.
 * Returns a Map of mls_number → marked_at ISO string.
 *
 * Batched on purpose: the dashboard renders four sections in one pass, so each
 * section does exactly one round trip instead of one per row.
 */
export async function getListingPostMarks(
  mlsNumbers: string[],
  postType: MilestonePostType,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (mlsNumbers.length === 0) return out;

  const supabase = createAdminClient();
  // listing_post_marks isn't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;
  const { data, error } = await untyped
    .from("listing_post_marks")
    .select("mls_number, marked_at")
    .eq("post_type", postType)
    .in("mls_number", mlsNumbers);

  if (error) {
    console.error(
      `[listing-post-marks] fetch failed (${postType}):`,
      error.message,
    );
    return out;
  }
  for (const row of (data ?? []) as Array<{
    mls_number: string;
    marked_at: string;
  }>) {
    out.set(row.mls_number, row.marked_at);
  }
  return out;
}

/**
 * Auto-detection companion to {@link getListingPostMarks}: which of these
 * properties already have a PUBLISHED post of this type built in the app?
 *
 * Reads generated_posts (the Post Builder's own record) rather than the synced
 * social feed, because it is the only source that knows a post's milestone
 * type. `posted_at IS NOT NULL` is the "actually went live" gate — drafts and
 * scheduled rows don't count. Returns a Set of property ids.
 *
 * The checkbox renders locked when a listing is in this set: you shouldn't be
 * able to untick a post that demonstrably went out.
 */
export async function getAutoPostedPropertyIds(
  propertyIds: string[],
  postType: MilestonePostType,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (propertyIds.length === 0) return out;

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;
  const { data, error } = await untyped
    .from("generated_posts")
    .select("property_id")
    .eq("post_type", postType)
    .not("posted_at", "is", null)
    .in("property_id", propertyIds);

  if (error) {
    console.error(
      `[listing-post-marks] auto-detect failed (${postType}):`,
      error.message,
    );
    return out;
  }
  for (const row of (data ?? []) as Array<{ property_id: string | null }>) {
    if (row.property_id) out.add(row.property_id);
  }
  return out;
}
