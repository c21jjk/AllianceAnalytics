import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-only fetcher for the dashboard "needs Larissa's attention" strip.
 *
 * Returns active CMC + SJSR + Bright listings that:
 *   - Are within the recency window (listing_date OR created_at within N days)
 *   - Have NOT been manually dismissed (`promotion_dismissed_at IS NULL`)
 *   - Are missing a DEDICATED post on at least one of FB / IG / TT. A
 *     dedicated post is a single-listing spotlight for THIS listing that
 *     isn't an Open House or Just Sold post — so an OH roundup or a
 *     multi-listing carousel no longer counts as coverage (per John,
 *     2026-07-17). Reels count the same as stills.
 *
 * Each row carries the per-platform post count so the card can render gap
 * chips ("Need IG · TT") with precision instead of a generic "needs a post"
 * label.
 *
 * Optional office filter — when an office short_code is supplied the strip
 * only shows that office's listings. Matches the dashboard's office filter
 * behavior.
 */

type PostPlatform = Database["public"]["Enums"]["post_platform"];
type PropertyStatus = Database["public"]["Enums"]["property_status"];
type SourceMls = "cmc" | "sjsr" | "bright" | string | null;

/** Three-state listing promotion status. */
export type ListingPromotionStatus = "needs_post" | "posted" | "dismissed";

export interface ListingNeedingPosts {
  /** Property uuid in AllianceAnalytics. */
  id: string;
  /** Canonical MLS hashtag form, e.g. "#NJBL2078123" / "#CMC230456" / "#SJSR571832". */
  mls_hashtag: string;
  /** Raw MLS number on file. */
  mls_number: string;
  source_mls: SourceMls;
  status: PropertyStatus;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  /** Whichever date drives the "X days since listed" pill. listing_date when present, else created_at. */
  reference_date: string;
  reference_date_kind: "listing_date" | "created_at";
  hero_image_url: string | null;
  agent_name: string | null;
  /** Office short code (e.g. "WWC", "OCN") or null when unmapped. */
  office_short_code: string | null;
  /** Per-platform DEDICATED-post counts (single-listing spotlights for this
   *  listing, excluding Open House + Just Sold). Zero ⇒ no dedicated post on
   *  that platform yet. */
  post_counts: Record<PostPlatform, number>;
  /**
   * Per-platform manual confirmations from properties.posts_confirmed_platforms[].
   * Layered on top of post_counts to derive missing_platforms below.
   */
  manual_confirmed_platforms: PostPlatform[];
  /**
   * Convenience: platforms with neither an auto-linked post NOR a manual
   * confirmation. Drives the "click to mark" badge UI.
   */
  missing_platforms: PostPlatform[];
  /** Three-state rollup — drives the ribbon overlay on the listing card. */
  promotion_status: ListingPromotionStatus;
  /** When set, the admin marked this listing as "posted, stop reminding me". */
  posts_confirmed_at: string | null;
  /** When set, Alliance has dismissed this one ("won't promote"). */
  promotion_dismissed_at: string | null;
  /** Reason chip slug or free text from the dismissal flow. Null when not dismissed. */
  promotion_dismissed_reason: string | null;
  /** When this listing first landed in our DB. Used for the "fresh in last
   *  24h" badge on the dashboard card. */
  first_seen_at: string;
}

export interface GetListingsNeedingPostsOptions {
  /** Default 14 days. Caller can pass 7 / 30 / etc. */
  windowDays?: number;
  /** Office short_code filter (e.g. "WWC"). Null/undefined returns all offices. */
  office_short_code?: string | null;
  /** Max rows. Defaults to 25. */
  limit?: number;
  /**
   * Which states to return. Defaults to "needs_only" for backward compat.
   * Pass "all" to include posted + dismissed listings (with their banners),
   * which the dashboard "Recent listings" view uses for the All-states tab.
   */
  status_filter?: "needs_only" | "all";
}

/**
 * Build the Bright/CMC/SJSR canonical hashtag form from `(mls_number, source_mls)`.
 * Matches the regex tiers in `run_auto_linker()` so the chip Larissa copies
 * round-trips back to the auto-linker once she pastes it into a caption.
 */
function toHashtag(
  mlsNumber: string,
  sourceMls: SourceMls,
): string {
  const normalized = mlsNumber.replace(/^#/, "").trim();
  if (sourceMls === "cmc") return `#CMC${normalized}`;
  if (sourceMls === "sjsr") return `#SJSR${normalized}`;
  // Bright (NJxx#######): the natural form already starts with NJ
  if (sourceMls === "bright" || /^NJ[A-Z]{2}\d+$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  // Fallback — return the raw form prefixed with #
  return `#${normalized}`;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  source_mls: string | null;
  status: PropertyStatus;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  listing_date: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  office_id: string | null;
  created_at: string;
  posts_confirmed_at: string | null;
  promotion_dismissed_at: string | null;
  promotion_dismissed_reason: string | null;
  posts_confirmed_platforms: string[] | null;
}

/**
 * Intents that do NOT count as a dedicated post for a listing.
 * - open_house: an Open House post spotlights the weekend event, not the
 *   individual listing (per John, 2026-07-17). A listing that only ever
 *   appeared in an OH roundup still needs its own dedicated post.
 * - just_sold: a different milestone; the marketing job for that listing is
 *   done. (Active listings shouldn't have one anyway.)
 * Everything else on a SINGLE-listing post — new_listing, coming_soon,
 * price_change, and creative-caption spotlights that classify as `other` —
 * counts, and reels count the same as stills.
 */
const NON_DEDICATED_INTENTS = new Set<string>(["open_house", "just_sold"]);

interface DbOfficeRow {
  id: string;
  short_code: string;
}

export async function getListingsNeedingPosts(
  opts: GetListingsNeedingPostsOptions = {},
): Promise<ListingNeedingPosts[]> {
  const supabase = createAdminClient();
  const windowDays = opts.windowDays ?? 14;
  const limit = opts.limit ?? 25;
  const statusFilter = opts.status_filter ?? "needs_only";

  // Resolve office filter → office_id once.
  let officeFilterId: string | null = null;
  if (opts.office_short_code) {
    const { data: officeRow, error: officeErr } = await supabase
      .from("offices")
      .select("id")
      .eq("short_code", opts.office_short_code)
      .maybeSingle();
    if (officeErr || !officeRow) return [];
    officeFilterId = officeRow.id;
  }

  const cutoffIso = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const cutoffDate = cutoffIso.slice(0, 10);

  // Recency rule:
  //   - When listing_date IS set, that's the source of truth (matches MLS).
  //   - When listing_date IS NULL (rare — only happens before the first
  //     successful RETS sync), fall back to created_at so newly-synced rows
  //     still surface.
  // Using OR with a nested AND keeps both branches in a single query.
  //
  // In "all" mode we keep dismissed listings; in "needs_only" we drop them
  // upstream so they never make it into the result set.
  let query = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, list_price, listing_date, hero_image_url, agent_name, office_id, created_at, posts_confirmed_at, promotion_dismissed_at, promotion_dismissed_reason, posts_confirmed_platforms",
    )
    .eq("status", "active")
    .or(
      `listing_date.gte.${cutoffDate},and(listing_date.is.null,created_at.gte.${cutoffIso})`,
    )
    .order("listing_date", { ascending: false, nullsFirst: false })
    .limit(statusFilter === "needs_only" ? limit * 2 : limit * 3);
  // overfetch — we'll filter post-query

  if (statusFilter === "needs_only") {
    query = query.is("promotion_dismissed_at", null);
  }
  if (officeFilterId) query = query.eq("office_id", officeFilterId);

  const { data: propertyRows, error: propErr } = await query;
  if (propErr) {
    console.error("getListingsNeedingPosts: properties error", propErr);
    return [];
  }
  const properties = (propertyRows ?? []) as DbPropertyRow[];
  if (properties.length === 0) return [];

  // Per-property, per-platform DEDICATED-post coverage.
  //
  // "Dedicated" = a live post that features THIS listing and only this listing
  // (a single-listing spotlight), and isn't an Open House or Just Sold post.
  // This is the fix for OH roundups and multi-listing carousels falsely
  // marking a listing "posted": those link many listings (not dedicated) and
  // classify as open_house, so they no longer count. Reel or still, doesn't
  // matter. Coverage is read from the synced `posts` feed (what actually went
  // live, including externally-created posts) via post_listings, the same
  // source of truth the OH badge uses.
  const propertyIds = properties.map((p) => p.id);
  // listing_intent isn't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  // 1) Candidate posts = any post that links one of our listings, via the
  //    post_listings join table OR posts.property_id.
  const [{ data: plForProps }, { data: postsByPropId }] = await Promise.all([
    untyped.from("post_listings").select("post_id").in("property_id", propertyIds),
    untyped.from("posts").select("id").in("property_id", propertyIds),
  ]);
  const candidatePostIds = Array.from(
    new Set<string>([
      ...((plForProps ?? []) as Array<{ post_id: string }>).map((r) => r.post_id),
      ...((postsByPropId ?? []) as Array<{ id: string }>).map((r) => r.id),
    ]),
  );

  const counts = new Map<string, Record<PostPlatform, number>>();
  for (const id of propertyIds) {
    counts.set(id, { facebook: 0, instagram: 0, tiktok: 0 });
  }

  if (candidatePostIds.length > 0) {
    // 2) The candidate posts' platform + intent + own property_id.
    const { data: candPosts } = await untyped
      .from("posts")
      .select("id, platform, listing_intent, property_id")
      .in("id", candidatePostIds);
    // 3) EVERY listing each candidate post links (to size the listing set).
    const { data: candLinks } = await untyped
      .from("post_listings")
      .select("post_id, property_id")
      .in("post_id", candidatePostIds);

    // Build each post's full listing set (post_listings ∪ posts.property_id).
    const listingSet = new Map<string, Set<string>>();
    const meta = new Map<string, { platform: PostPlatform; intent: string | null }>();
    for (const p of (candPosts ?? []) as Array<{
      id: string;
      platform: PostPlatform;
      listing_intent: string | null;
      property_id: string | null;
    }>) {
      meta.set(p.id, { platform: p.platform, intent: p.listing_intent });
      const set = listingSet.get(p.id) ?? new Set<string>();
      if (p.property_id) set.add(p.property_id);
      listingSet.set(p.id, set);
    }
    for (const l of (candLinks ?? []) as Array<{
      post_id: string;
      property_id: string | null;
    }>) {
      if (!l.property_id) continue;
      const set = listingSet.get(l.post_id) ?? new Set<string>();
      set.add(l.property_id);
      listingSet.set(l.post_id, set);
    }

    // 4) Credit a listing only when a DEDICATED (single-listing) post that
    //    isn't OH/Just-Sold features it.
    for (const [postId, set] of listingSet) {
      if (set.size !== 1) continue; // multi-listing carousel / OH roundup
      const m = meta.get(postId);
      if (!m) continue;
      if (m.intent && NON_DEDICATED_INTENTS.has(m.intent)) continue;
      const [pid] = Array.from(set);
      const bucket = counts.get(pid);
      if (!bucket) continue;
      bucket[m.platform] = (bucket[m.platform] ?? 0) + 1;
    }
  }

  // Office short_code lookup so card can show which market this is.
  const officeIds = Array.from(
    new Set(
      properties.map((p) => p.office_id).filter((x): x is string => !!x),
    ),
  );
  const officeShortByID = new Map<string, string>();
  if (officeIds.length > 0) {
    const { data: officeRows } = await supabase
      .from("offices")
      .select("id, short_code")
      .in("id", officeIds);
    for (const o of (officeRows ?? []) as DbOfficeRow[]) {
      officeShortByID.set(o.id, o.short_code);
    }
  }

  // Compute three-state status + shape the result.
  const out: ListingNeedingPosts[] = [];
  for (const p of properties) {
    const c = counts.get(p.id) ?? {
      facebook: 0,
      instagram: 0,
      tiktok: 0,
    };

    // Manual per-platform confirmations from posts_confirmed_platforms[].
    // Filter to known platforms in case the column ever has stale data.
    const manualConfirmed: PostPlatform[] = (
      (p.posts_confirmed_platforms ?? []) as string[]
    ).filter((plat): plat is PostPlatform =>
      plat === "facebook" || plat === "instagram" || plat === "tiktok",
    );

    // A platform is covered when it has an auto-linked post OR is in the
    // manual confirmation array OR posts_confirmed_at is set (the global
    // "all done" shortcut).
    const allMarkedDone = !!p.posts_confirmed_at;
    const isCovered = (plat: PostPlatform): boolean =>
      allMarkedDone ||
      (c[plat] ?? 0) > 0 ||
      manualConfirmed.includes(plat);

    const missing: PostPlatform[] = (
      ["facebook", "instagram", "tiktok"] as PostPlatform[]
    ).filter((plat) => !isCovered(plat));

    let promotionStatus: ListingPromotionStatus;
    if (p.promotion_dismissed_at) {
      promotionStatus = "dismissed";
    } else if (missing.length === 0) {
      // All three platforms covered — by auto-link, manual mark, or "all done"
      promotionStatus = "posted";
    } else {
      promotionStatus = "needs_post";
    }

    if (statusFilter === "needs_only" && promotionStatus !== "needs_post") {
      continue;
    }

    const referenceDate = p.listing_date ?? p.created_at;
    out.push({
      id: p.id,
      mls_hashtag: toHashtag(p.mls_number, p.source_mls as SourceMls),
      mls_number: p.mls_number,
      source_mls: (p.source_mls as SourceMls) ?? null,
      status: p.status,
      address: p.address,
      city: p.city,
      state: p.state,
      list_price: p.list_price === null ? null : Number(p.list_price),
      reference_date: referenceDate,
      reference_date_kind: p.listing_date ? "listing_date" : "created_at",
      hero_image_url: p.hero_image_url,
      agent_name: p.agent_name,
      office_short_code: p.office_id
        ? officeShortByID.get(p.office_id) ?? null
        : null,
      post_counts: c,
      manual_confirmed_platforms: manualConfirmed,
      missing_platforms: missing,
      promotion_status: promotionStatus,
      posts_confirmed_at: p.posts_confirmed_at,
      promotion_dismissed_at: p.promotion_dismissed_at,
      promotion_dismissed_reason: p.promotion_dismissed_reason,
      first_seen_at: p.created_at,
    });

    if (out.length >= limit) break;
  }

  return out;
}
