import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { PostFormat, PostType, PostVariant, SourceMls } from "@/lib/post-builder/types";

/**
 * Created Posts data source — the read-side of the Studio save pipeline.
 *
 * Reads `public.generated_posts` rows that originated in (or were saved into)
 * the canvas editor. Used by:
 *
 *   • Per-listing "Created Posts" strip on /properties/[mls]
 *   • Global /posts/created library
 *
 * Sort order is most-recently-edited first (updated_at desc) — matches how
 * a user thinks about "what did I work on last?". Falls back to created_at
 * when updated_at is null (older rows that pre-date the column default).
 */

/**
 * The lean row shape these UIs need. Deliberately narrower than the full
 * `generated_posts` Row type — keeps the surface area of "what the strip
 * depends on" small so column additions don't ripple into every consumer.
 */
export interface CreatedPostRow {
  id: string;
  mls_number: string;
  property_id: string | null;
  source_mls: SourceMls;
  post_type: PostType;
  variant: PostVariant;
  format: PostFormat;
  template_id: string;
  image_url: string | null;
  caption: string | null;
  status: string;
  /** ISO timestamp — UI uses this to sort + show "edited 3h ago" labels. */
  updated_at: string;
  created_at: string;
  /**
   * True when the row has been published to at least one platform. We
   * surface this as a "Posted" badge in the strip so the user can tell
   * drafts apart from live posts at a glance.
   */
  is_posted: boolean;
}

/**
 * Fetch all saved Studio posts for one listing (by MLS number).
 *
 * Used by the per-listing strip on /properties/[mls]. Returns at most 50
 * rows — the strip is a horizontal scroll, not a search surface, so a
 * generous cap is plenty. If a listing somehow accumulates 100+ saved
 * variants, the global /posts/created page is the right surface to use.
 */
export async function fetchCreatedPostsByMls(
  mlsNumber: string,
): Promise<CreatedPostRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("generated_posts")
    .select(
      "id, mls_number, property_id, source_mls, post_type, variant, format, template_id, image_url, caption, status, updated_at, created_at, posted_at",
    )
    .eq("mls_number", mlsNumber)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) {
    console.error("[fetchCreatedPostsByMls] query failed:", error.message);
    return [];
  }
  if (!data) return [];

  return data.map((row) => ({
    id: row.id,
    mls_number: row.mls_number,
    property_id: row.property_id,
    source_mls: row.source_mls as SourceMls,
    post_type: row.post_type as PostType,
    variant: row.variant as PostVariant,
    format: row.format as PostFormat,
    template_id: row.template_id,
    image_url: row.image_url,
    caption: row.caption,
    status: row.status,
    updated_at: row.updated_at ?? row.created_at,
    created_at: row.created_at,
    is_posted: Boolean(row.posted_at),
  }));
}

/**
 * Resume-edit fetch — used by /post-builder?gp=<id> to rehydrate the Studio
 * editor with the saved layer_tree + the row's selection state.
 *
 * Returns null if the row doesn't exist or doesn't belong to the caller.
 * (The caller is the page handler, which already requireUser()-gated, but
 * we still scope by created_by here so a manual URL with someone else's
 * gp= id can't sneak past.)
 */
export interface CreatedPostResumeRow {
  id: string;
  mls_number: string;
  property_id: string | null;
  source_mls: SourceMls;
  post_type: PostType;
  variant: PostVariant;
  format: PostFormat;
  template_id: string;
  image_url: string | null;
  image_path: string | null;
  hero_image_source_url: string | null;
  /**
   * Serialized post-hydration CanvasTemplateSchema. Stored as Json in the
   * DB; the editor casts to CanvasTemplateSchema before handing to Fabric.
   * Null for older rows that pre-date the layer_tree column being filled.
   */
  layer_tree: unknown | null;
}

export async function fetchCreatedPostResume(
  id: string,
  userId: string,
): Promise<CreatedPostResumeRow | null> {
  if (!id || !userId) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("generated_posts")
    .select(
      "id, mls_number, property_id, source_mls, post_type, variant, format, template_id, image_url, image_path, hero_image_source_url, layer_tree, created_by",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[fetchCreatedPostResume] failed:", error.message);
    return null;
  }
  if (!data) return null;
  if (data.created_by !== userId) return null;

  return {
    id: data.id,
    mls_number: data.mls_number,
    property_id: data.property_id,
    source_mls: data.source_mls as SourceMls,
    post_type: data.post_type as PostType,
    variant: data.variant as PostVariant,
    format: data.format as PostFormat,
    template_id: data.template_id,
    image_url: data.image_url,
    image_path: data.image_path,
    hero_image_source_url: data.hero_image_source_url,
    layer_tree: data.layer_tree,
  };
}

/**
 * Filter input for the global library page. All fields optional — the page
 * sends only the fields the user has actively picked, so omitting a filter
 * means "no constraint on this dimension". Pagination is offset/limit; not
 * cursor-based because the user-facing UI is page-numbered, not infinite-
 * scroll.
 */
export interface CreatedPostsLibraryQuery {
  /** Text search across mls_number + caption. */
  q?: string;
  /** Filter by post_type (one or many). */
  postTypes?: PostType[];
  /** Filter by status ("draft" | "posted" | "scheduled" | ...). */
  statuses?: string[];
  /** Filter by source MLS (cmc / sjsr / bright / manual). */
  sourceMls?: SourceMls[];
  /** ISO date string (inclusive lower bound on updated_at). */
  updatedSince?: string;
  /** Page size; default 24 (3 × 8 grid). */
  pageSize?: number;
  /** Zero-indexed page number; default 0. */
  page?: number;
}

export interface CreatedPostsLibraryResult {
  rows: CreatedPostRow[];
  /** Total rows matching the filter — UI uses this for the page count. */
  total: number;
  pageSize: number;
  page: number;
}

/**
 * Filterable + paginated fetch for the global library. Returns rows + a
 * count(*) so the UI can render "Page 2 of 8". We use a separate count query
 * rather than `.select(..., { count: "exact" })` because the latter is
 * dramatically slower on large tables; today the table is small enough
 * either way, but the split keeps it cheap as it grows.
 */
export async function fetchCreatedPostsLibrary(
  query: CreatedPostsLibraryQuery,
): Promise<CreatedPostsLibraryResult> {
  const supabase = createAdminClient();
  const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 24));
  const page = Math.max(0, query.page ?? 0);
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // why: Build the row query and the count query side-by-side so the same
  // filters apply to both. Supabase has no "fork builder" helper, so we
  // assemble them imperatively.
  let rowsQ = supabase
    .from("generated_posts")
    .select(
      "id, mls_number, property_id, source_mls, post_type, variant, format, template_id, image_url, caption, status, updated_at, created_at, posted_at",
    );
  let countQ = supabase
    .from("generated_posts")
    .select("id", { count: "exact", head: true });

  if (query.q && query.q.trim().length > 0) {
    const term = `%${query.q.trim()}%`;
    rowsQ = rowsQ.or(`mls_number.ilike.${term},caption.ilike.${term}`);
    countQ = countQ.or(`mls_number.ilike.${term},caption.ilike.${term}`);
  }
  if (query.postTypes && query.postTypes.length > 0) {
    rowsQ = rowsQ.in("post_type", query.postTypes);
    countQ = countQ.in("post_type", query.postTypes);
  }
  if (query.statuses && query.statuses.length > 0) {
    rowsQ = rowsQ.in("status", query.statuses);
    countQ = countQ.in("status", query.statuses);
  }
  if (query.sourceMls && query.sourceMls.length > 0) {
    // Drop nulls from the filter — Supabase .in() doesn't allow them.
    const sm = query.sourceMls.filter((s): s is Exclude<SourceMls, null> => s !== null);
    if (sm.length > 0) {
      rowsQ = rowsQ.in("source_mls", sm);
      countQ = countQ.in("source_mls", sm);
    }
  }
  if (query.updatedSince) {
    rowsQ = rowsQ.gte("updated_at", query.updatedSince);
    countQ = countQ.gte("updated_at", query.updatedSince);
  }

  rowsQ = rowsQ
    .order("updated_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  const [{ data, error }, { count, error: countError }] = await Promise.all([
    rowsQ,
    countQ,
  ]);

  if (error) {
    console.error("[fetchCreatedPostsLibrary] rows failed:", error.message);
    return { rows: [], total: 0, pageSize, page };
  }
  if (countError) {
    console.warn(
      "[fetchCreatedPostsLibrary] count failed (UI may show wrong total):",
      countError.message,
    );
  }

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    mls_number: row.mls_number,
    property_id: row.property_id,
    source_mls: row.source_mls as SourceMls,
    post_type: row.post_type as PostType,
    variant: row.variant as PostVariant,
    format: row.format as PostFormat,
    template_id: row.template_id,
    image_url: row.image_url,
    caption: row.caption,
    status: row.status,
    updated_at: row.updated_at ?? row.created_at,
    created_at: row.created_at,
    is_posted: Boolean(row.posted_at),
  }));

  return {
    rows,
    total: count ?? rows.length,
    pageSize,
    page,
  };
}
