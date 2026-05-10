import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-only fetcher for the dashboard "needs Larissa's attention" strip.
 *
 * Returns active CMC + SJSR + Bright listings that:
 *   - Are within the recency window (listing_date OR created_at within N days)
 *   - Have NOT been manually dismissed (`promotion_dismissed_at IS NULL`)
 *   - Are missing at least one platform's coverage (zero linked posts on at
 *     least one of FB / IG / TT)
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
  /** Per-platform post counts. Zero ⇒ that platform is missing for this listing. */
  post_counts: Record<PostPlatform, number>;
  /** Convenience: derived gaps (platforms with zero posts). */
  missing_platforms: PostPlatform[];
}

export interface GetListingsNeedingPostsOptions {
  /** Default 14 days. Caller can pass 7 / 30 / etc. */
  windowDays?: number;
  /** Office short_code filter (e.g. "WWC"). Null/undefined returns all offices. */
  office_short_code?: string | null;
  /** Max rows. Defaults to 25. */
  limit?: number;
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
}

interface DbPostCountRow {
  property_id: string | null;
  platform: PostPlatform;
}

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

  // Pull eligible properties. We OR the date conditions because some
  // CMC/SJSR rows haven't had `listing_date` populated by the RETS sync yet
  // — falling back to created_at means new listings still surface the day
  // they're synced.
  let query = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, list_price, listing_date, hero_image_url, agent_name, office_id, created_at",
    )
    .eq("status", "active")
    .is("promotion_dismissed_at", null)
    .or(`listing_date.gte.${cutoffDate},created_at.gte.${cutoffIso}`)
    .order("listing_date", { ascending: false, nullsFirst: false })
    .limit(limit * 2); // overfetch — we'll filter to "missing platforms" in code

  if (officeFilterId) query = query.eq("office_id", officeFilterId);

  const { data: propertyRows, error: propErr } = await query;
  if (propErr) {
    console.error("getListingsNeedingPosts: properties error", propErr);
    return [];
  }
  const properties = (propertyRows ?? []) as DbPropertyRow[];
  if (properties.length === 0) return [];

  // Per-property post counts by platform. One trip — we count in JS.
  const propertyIds = properties.map((p) => p.id);
  const { data: postRows } = await supabase
    .from("posts")
    .select("property_id, platform")
    .in("property_id", propertyIds);

  const counts = new Map<string, Record<PostPlatform, number>>();
  for (const id of propertyIds) {
    counts.set(id, { facebook: 0, instagram: 0, tiktok: 0 });
  }
  for (const row of (postRows ?? []) as DbPostCountRow[]) {
    if (!row.property_id) continue;
    const bucket = counts.get(row.property_id);
    if (!bucket) continue;
    bucket[row.platform] = (bucket[row.platform] ?? 0) + 1;
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

  // Filter to listings missing at least one platform, shape the result.
  const out: ListingNeedingPosts[] = [];
  for (const p of properties) {
    const c = counts.get(p.id) ?? {
      facebook: 0,
      instagram: 0,
      tiktok: 0,
    };
    const missing: PostPlatform[] = (
      ["facebook", "instagram", "tiktok"] as PostPlatform[]
    ).filter((plat) => (c[plat] ?? 0) === 0);
    if (missing.length === 0) continue; // fully covered → no prompt

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
      missing_platforms: missing,
    });

    if (out.length >= limit) break;
  }

  return out;
}
