import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Dashboard-wide post search.
 *
 * Backed by `public.posts.search_text` — a trigger-maintained concatenation
 * of caption + hashtags + mls_number_parsed, indexed via the GIN expression
 * index `posts_search_text_idx` on `to_tsvector('english', search_text)`.
 *
 * The PostgREST `.textSearch(column, query, { type: 'websearch' })` call
 * compiles to:
 *   `to_tsvector('english', search_text) @@ websearch_to_tsquery('english', $1)`
 * which is the exact predicate the GIN index matches against, so the
 * planner uses the index even on the 600+ row table.
 *
 * `websearch_to_tsquery` accepts natural-language input ("cape may
 * waterfront", "-condo NJBL"), so this is the right operator for the
 * top-nav inline dropdown + the list-view query box.
 *
 * Used by:
 *   - app/api/posts/search/route.ts — top-nav inline dropdown (limit=10)
 *   - app/(app)/page.tsx ?view=list&q=… — full filtered list (limit=200)
 *
 * Returns a lightweight shape (no daily series, no audience) — callers
 * that need the full Post can fetch it via fetchPostById afterwards.
 */

export interface SearchPostsArgs {
  q: string;
  platforms?: Array<"facebook" | "instagram" | "tiktok">;
  /** ISO date (YYYY-MM-DD or full ISO). Filter posts.posted_at >= dateFrom. */
  dateFrom?: string;
  /** ISO date. Filter posts.posted_at <= dateTo (end of day inclusive — append T23:59:59Z if date-only). */
  dateTo?: string;
  /** Max rows. Default 10 (top-nav dropdown). Pass higher for the list view. */
  limit?: number;
}

export interface SearchPostResult {
  id: string;
  platform: "facebook" | "instagram" | "tiktok";
  posted_at: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  permalink: string | null;
  reach: number;
  engagements: number;
  /** Linked listing badge — null when the post isn't linked. */
  listing: {
    mls_number: string;
    address: string | null;
  } | null;
}

export interface SearchPostsResponse {
  results: SearchPostResult[];
  /** Total matches for pagination/"See all N" labels. */
  totalCount: number;
}

const EMPTY: SearchPostsResponse = { results: [], totalCount: 0 };

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Append end-of-day to bare YYYY-MM-DD so .lte is inclusive. */
function normalizeDateTo(input: string | undefined): string | undefined {
  if (!input) return undefined;
  // If it parses cleanly as YYYY-MM-DD (no time component), bump to end of day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return `${input}T23:59:59Z`;
  }
  return input;
}

export async function searchPosts(
  args: SearchPostsArgs,
): Promise<SearchPostsResponse> {
  const q = (args.q ?? "").trim();
  const platforms = args.platforms ?? [];
  const dateFrom = args.dateFrom;
  const dateTo = normalizeDateTo(args.dateTo);
  const limit = Math.max(1, Math.min(args.limit ?? 10, 500));

  // Nothing to search by — bail before hitting the DB.
  if (q.length === 0 && platforms.length === 0 && !dateFrom && !dateTo) {
    return EMPTY;
  }

  try {
    const supabase = createAdminClient();

    /**
     * Build the row query and a parallel count query. Using `count: 'exact',
     * head: true` on a separate request gives us the unbounded total without
     * scanning the rows twice; the row query stays cheap with .limit applied.
     */
    function applyFilters<T extends { textSearch: Function }>(builder: T): T {
      let b: any = builder;
      if (q.length > 0) {
        b = b.textSearch("search_text", q, { type: "websearch" });
      }
      if (platforms.length > 0) {
        b = b.in("platform", platforms);
      }
      if (dateFrom) {
        b = b.gte("posted_at", dateFrom);
      }
      if (dateTo) {
        b = b.lte("posted_at", dateTo);
      }
      return b as T;
    }

    const rowQuery = applyFilters(
      supabase
        .from("posts")
        .select(
          "id, platform, posted_at, caption, thumbnail_url, media_url, permalink, property_id, metrics",
        ),
    )
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    const countQuery = applyFilters(
      supabase.from("posts").select("id", { count: "exact", head: true }),
    );

    const [rowRes, countRes] = await Promise.all([rowQuery, countQuery]);

    if (rowRes.error) {
      console.error("searchPosts row query error:", rowRes.error);
      return EMPTY;
    }
    if (countRes.error) {
      // Non-fatal — return rows with count fallback to results length.
      console.error("searchPosts count query error:", countRes.error);
    }

    const rows = (rowRes.data ?? []) as Array<{
      id: string;
      platform: "facebook" | "instagram" | "tiktok";
      posted_at: string | null;
      caption: string | null;
      thumbnail_url: string | null;
      media_url: string | null;
      permalink: string | null;
      property_id: string | null;
      metrics: Record<string, unknown> | null;
    }>;

    // Hydrate linked listing in one bulk query (clearer than nested embed).
    const propertyIds = Array.from(
      new Set(rows.map((r) => r.property_id).filter((v): v is string => !!v)),
    );
    const propertyMap = new Map<
      string,
      { mls_number: string; address: string | null }
    >();
    if (propertyIds.length > 0) {
      const { data: props, error: propsErr } = await supabase
        .from("properties")
        .select("id, mls_number, address")
        .in("id", propertyIds);
      if (propsErr) {
        console.error("searchPosts properties query error:", propsErr);
      }
      for (const p of (props ?? []) as Array<{
        id: string;
        mls_number: string;
        address: string | null;
      }>) {
        propertyMap.set(p.id, {
          mls_number: p.mls_number,
          address: p.address,
        });
      }
    }

    const results: SearchPostResult[] = rows.map((r) => {
      const m = r.metrics ?? {};
      const reach = readNum(m.reach) || readNum(m.impressions) || 0;
      const engagements =
        readNum(m.likes) +
        readNum(m.comments) +
        readNum(m.shares) +
        readNum(m.saves);
      const listing = r.property_id ? propertyMap.get(r.property_id) ?? null : null;
      return {
        id: r.id,
        platform: r.platform,
        posted_at: r.posted_at,
        caption: r.caption,
        thumbnail_url: r.thumbnail_url,
        media_url: r.media_url,
        permalink: r.permalink,
        reach,
        engagements,
        listing,
      };
    });

    const totalCount =
      typeof countRes.count === "number" ? countRes.count : results.length;

    return { results, totalCount };
  } catch (e) {
    console.error("searchPosts unexpected error:", e);
    return EMPTY;
  }
}
