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
 * 2026-08-19 (John) — "I also want to show who created and posted the post
 * (me, larissa or Cheryl) and when it was posted. This will help us keep
 * track of things." Both lookups below now carry WHO alongside WHEN, resolved
 * to display names via the profiles table in one batched query.
 */

/** A manual dashboard tick: when it happened and who did it. */
export interface ManualPostMark {
  marked_at: string;
  /** Display name from profiles ("John" / "Larissa" / "Cheryl"), else null. */
  marked_by_name: string | null;
}

/** A published in-app post: when it went live and who built/published it. */
export interface AutoPostedMark {
  posted_at: string;
  posted_by_name: string | null;
  created_by_name: string | null;
}

/**
 * Batched profile-id → display-name resolver. Same fallback chain the notes
 * feature uses (lib/data/listing-notes.ts authorName): full_name, then the
 * email local-part, then null so callers can render nothing.
 */
async function resolveProfileNames(
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return out;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unique);
  if (error) {
    console.error("[listing-post-marks] profile lookup failed:", error.message);
    return out;
  }
  for (const row of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    const full = (row.full_name ?? "").trim();
    if (full) {
      out.set(row.id, full);
      continue;
    }
    const email = (row.email ?? "").trim();
    if (email) out.set(row.id, email.split("@")[0]);
  }
  return out;
}

/**
 * Fetch the manual marks for a set of listings and one post type.
 * Returns a Map of mls_number → {marked_at, marked_by_name}.
 *
 * Batched on purpose: the dashboard renders four sections in one pass, so each
 * section does exactly one round trip (plus one shared profiles lookup)
 * instead of one per row.
 */
export async function getListingPostMarks(
  mlsNumbers: string[],
  postType: MilestonePostType,
): Promise<Map<string, ManualPostMark>> {
  const out = new Map<string, ManualPostMark>();
  if (mlsNumbers.length === 0) return out;

  const supabase = createAdminClient();
  // listing_post_marks isn't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;
  const { data, error } = await untyped
    .from("listing_post_marks")
    .select("mls_number, marked_at, marked_by")
    .eq("post_type", postType)
    .in("mls_number", mlsNumbers);

  if (error) {
    console.error(
      `[listing-post-marks] fetch failed (${postType}):`,
      error.message,
    );
    return out;
  }
  const rows = (data ?? []) as Array<{
    mls_number: string;
    marked_at: string;
    marked_by: string | null;
  }>;
  const names = await resolveProfileNames(
    rows.map((r) => r.marked_by).filter((x): x is string => !!x),
  );
  for (const row of rows) {
    out.set(row.mls_number, {
      marked_at: row.marked_at,
      marked_by_name: row.marked_by
        ? names.get(row.marked_by) ?? null
        : null,
    });
  }
  return out;
}

/**
 * Auto-detection companion to {@link getListingPostMarks}: which of these
 * properties already have a PUBLISHED post of this type built in the app —
 * and when / by whom it went out.
 *
 * Reads generated_posts (the Post Builder's own record) rather than the synced
 * social feed, because it is the only source that knows a post's milestone
 * type. `posted_at IS NOT NULL` is the "actually went live" gate — drafts and
 * scheduled rows don't count. Returns a Map of property id → attribution;
 * when a property has several published posts of the type, the newest wins.
 *
 * The checkbox renders locked when a listing is in this map: you shouldn't be
 * able to untick a post that demonstrably went out.
 *
 * 2026-08-19 — roundup awareness: a weekly Under Contract / Price Reduced
 * roundup carries ONE anchor property_id but covers every property in its
 * linked_property_ids array. Matching only the anchor left all the other
 * featured properties reading "not posted" on the dashboard, which is
 * exactly the redundancy the roundups were built to remove. The query now
 * ORs an overlaps() on linked_property_ids so every featured property
 * counts as posted (and inherits the roundup's who/when attribution).
 */
export async function getAutoPostedMarks(
  propertyIds: string[],
  postType: MilestonePostType,
): Promise<Map<string, AutoPostedMark>> {
  const out = new Map<string, AutoPostedMark>();
  if (propertyIds.length === 0) return out;

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;
  // why the .or() string form: linked_property_ids isn't in the generated
  // types, and PostgREST's or= filter is the one way to express
  // (property_id IN … OR linked_property_ids && …) in a single query.
  // UUID values are hex + hyphens only (validated at write time in the
  // multi-oh-generate route), so embedding them in the filter string is
  // injection-safe.
  const idList = propertyIds.join(",");
  const { data, error } = await untyped
    .from("generated_posts")
    .select("property_id, linked_property_ids, posted_at, posted_by, created_by")
    .eq("post_type", postType)
    .not("posted_at", "is", null)
    .or(
      `property_id.in.(${idList}),linked_property_ids.ov.{${idList}}`,
    );

  if (error) {
    console.error(
      `[listing-post-marks] auto-detect failed (${postType}):`,
      error.message,
    );
    return out;
  }
  const rows = (data ?? []) as Array<{
    property_id: string | null;
    linked_property_ids: string[] | null;
    posted_at: string;
    posted_by: string | null;
    created_by: string | null;
  }>;
  const names = await resolveProfileNames(
    rows
      .flatMap((r) => [r.posted_by, r.created_by])
      .filter((x): x is string => !!x),
  );

  const wanted = new Set(propertyIds);
  const credit = (id: string, row: (typeof rows)[number]) => {
    if (!wanted.has(id)) return;
    const existing = out.get(id);
    // Newest published post of the type wins the attribution line.
    if (existing && existing.posted_at >= row.posted_at) return;
    out.set(id, {
      posted_at: row.posted_at,
      posted_by_name: row.posted_by ? names.get(row.posted_by) ?? null : null,
      created_by_name: row.created_by
        ? names.get(row.created_by) ?? null
        : null,
    });
  };
  for (const row of rows) {
    if (row.property_id) credit(row.property_id, row);
    if (Array.isArray(row.linked_property_ids)) {
      for (const id of row.linked_property_ids) {
        if (typeof id === "string") credit(id, row);
      }
    }
  }
  return out;
}

/**
 * Set-shaped wrapper kept for callers that only ask "posted or not?"
 * (the roundup wizard's pre-tick filter). Same query, no attribution.
 */
export async function getAutoPostedPropertyIds(
  propertyIds: string[],
  postType: MilestonePostType,
): Promise<Set<string>> {
  const marks = await getAutoPostedMarks(propertyIds, postType);
  return new Set(marks.keys());
}
