import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Property data source for the analytics-side `/properties` index.
 *
 * Reads `public.properties` (the AllianceAnalytics-side mirror, replicated
 * from the Listings DB on save) plus rolls up post counts + reach + engagement
 * per property in a single bulk query.
 *
 * Sorting and office filtering happen at the database for correctness;
 * post rollups are computed in-memory afterwards (one bulk query, ~21 rows
 * today, fine to scale to a few thousand).
 *
 * The /properties detail page (`/properties/[mls]`) is still on fixtures —
 * out of scope for this fetcher. When that page moves to live data, this
 * module can grow a per-mls fetcher.
 */

export type PropertySortKey =
  | "newest"
  | "oldest"
  | "price_desc"
  | "price_asc"
  | "office_asc"
  | "dom_desc";

export interface PropertySummary {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  listing_date: string | null;
  agent_name: string | null;
  hero_image_url: string | null;
  status: "active" | "pending" | "sold" | "expired";
  source_mls: string | null;
  /** Raw Paragon LO1_OrganizationName (e.g. "CENTURY 21 ALLIANCE wc"). UI normalizes. */
  listing_office_name: string | null;
  dom_days: number | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  public_remarks: string | null;
  /** Total posts linked to this property. */
  post_count: number;
  /** Sum of reach across all linked posts. */
  total_reach: number;
  /** Sum of likes + comments + shares + saves across all linked posts. */
  total_engagements: number;
  updated_at: string;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  listing_date: string | null;
  agent_name: string | null;
  hero_image_url: string | null;
  status: "active" | "pending" | "sold" | "expired";
  source_mls: string | null;
  listing_office_name: string | null;
  dom_days: number | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  public_remarks: string | null;
  updated_at: string;
}

interface DbPostMetricsRow {
  property_id: string | null;
  metrics: Record<string, unknown> | null;
}

function readNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export interface FetchPropertiesOptions {
  sort?: PropertySortKey;
  /**
   * Filter by NORMALIZED office display label (e.g. "Wildwood Crest"). The
   * fetcher normalizes the raw `listing_office_name` and matches in code,
   * since the same office shows up in CMC and SJSR with slightly different
   * raw strings.
   */
  office?: string | null;
}

/**
 * Fetch all properties + per-property post rollups.
 *
 * Default order: newest listed first (with a fallback to updated_at when
 * listing_date is missing).
 */
export async function fetchProperties(
  opts: FetchPropertiesOptions = {},
): Promise<PropertySummary[]> {
  const supabase = createAdminClient();

  // Order at the DB layer — listing_date is the canonical sort field, with
  // a fallback through updated_at for rows missing it. We re-sort in JS for
  // sort keys that depend on derived data (office display label).
  let query = supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, zip, list_price, listing_date, agent_name, hero_image_url, status, source_mls, listing_office_name, dom_days, property_type, bedrooms, bathrooms_full, bathrooms_half, public_remarks, updated_at",
    )
    .limit(500);

  switch (opts.sort) {
    case "oldest":
      query = query.order("listing_date", { ascending: true, nullsFirst: false });
      break;
    case "price_desc":
      query = query.order("list_price", { ascending: false, nullsFirst: false });
      break;
    case "price_asc":
      query = query.order("list_price", { ascending: true, nullsFirst: false });
      break;
    case "dom_desc":
      query = query.order("dom_days", { ascending: false, nullsFirst: false });
      break;
    case "office_asc":
      query = query.order("listing_office_name", { ascending: true, nullsFirst: false });
      break;
    case "newest":
    default:
      query = query
        .order("listing_date", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false });
  }

  const { data: rows, error } = await query;
  if (error || !rows) {
    console.error("fetchProperties:", error);
    return [];
  }

  let properties = rows as DbPropertyRow[];
  if (properties.length === 0) return [];

  // Office filter (post-normalization).
  if (opts.office) {
    const target = opts.office;
    properties = properties.filter(
      (p) => normalizeOfficeName(p.listing_office_name) === target,
    );
  }

  // Bulk fetch post metrics for all linked posts at once and aggregate.
  const propertyIds = properties.map((p) => p.id);
  const { data: postRows } = propertyIds.length
    ? await supabase
        .from("posts")
        .select("property_id, metrics")
        .in("property_id", propertyIds)
    : { data: [] };

  const rollup = new Map<
    string,
    { post_count: number; total_reach: number; total_engagements: number }
  >();
  for (const r of (postRows ?? []) as DbPostMetricsRow[]) {
    if (!r.property_id) continue;
    const m = r.metrics ?? {};
    const reach = readNum(m.reach) || readNum(m.impressions) || readNum(m.plays);
    const engagements =
      readNum(m.likes) +
      readNum(m.comments) +
      readNum(m.shares) +
      readNum(m.saves);
    const cur = rollup.get(r.property_id) ?? {
      post_count: 0,
      total_reach: 0,
      total_engagements: 0,
    };
    cur.post_count += 1;
    cur.total_reach += reach;
    cur.total_engagements += engagements;
    rollup.set(r.property_id, cur);
  }

  return properties.map((p) => {
    const r = rollup.get(p.id) ?? {
      post_count: 0,
      total_reach: 0,
      total_engagements: 0,
    };
    return {
      id: p.id,
      mls_number: p.mls_number,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      list_price: p.list_price,
      listing_date: p.listing_date,
      agent_name: p.agent_name,
      hero_image_url: p.hero_image_url,
      status: p.status,
      source_mls: p.source_mls,
      listing_office_name: p.listing_office_name,
      dom_days: p.dom_days,
      property_type: p.property_type,
      bedrooms: p.bedrooms,
      bathrooms_full: p.bathrooms_full,
      bathrooms_half: p.bathrooms_half,
      public_remarks: p.public_remarks,
      post_count: r.post_count,
      total_reach: r.total_reach,
      total_engagements: r.total_engagements,
      updated_at: p.updated_at,
    };
  });
}

/**
 * Normalize the raw Paragon `LO1_OrganizationName` into a clean display
 * label. The same Alliance office appears with different raw strings across
 * CMC and SJSR (e.g. "CENTURY 21 ALLIANCE wc" and "CENTURY 21 ALLIANCE-104A"
 * both refer to the Wildwood Crest office). This function strips the
 * "Century 21 Alliance" prefix, drops trailing Paragon-internal codes, and
 * expands known short codes into their full office names.
 */
/**
 * Maps Paragon office suffix codes to Alliance office display names.
 *
 * - CMC suffixes (wc, oc, ncm) come from the human-readable raw string.
 * - SJSR suffixes (S104B, S104L, O1O4J, …) are Paragon's internal IDs.
 *   We pin them by cross-checking listings that appear in BOTH feeds — when
 *   one CMC row says "NCM" and the SJSR row for the same property says
 *   "S104L", the SJSR code resolves to North Cape May.
 *
 * Any code not in the map falls through to a title-cased version of the
 * raw suffix (`AllianceUnknownLabel`). Better to surface "Alliance 104A"
 * than guess wrong — Egg Harbor Township is a listing LOCATION, not an
 * Alliance office.
 */
const OFFICE_CODE_MAP: Record<string, string> = {
  // CMC raw suffixes
  wc: "Wildwood Crest",
  oc: "Ocean City",
  ncm: "North Cape May",
  // SJSR Paragon codes — only entries verified by cross-feed match
  s104l: "North Cape May", // verified via 10 Empire Dr (CMC: NCM, SJSR: S104L)
  s104b: "Wildwood Crest",  // verified via 236 Roseann Ave (CMC: wc, SJSR: S104B)
  o1o4j: "Ocean City",      // verified via 430 S Shore Rd (CMC: oc, SJSR: O1O4J)
};

export function normalizeOfficeName(raw: string | null | undefined): string {
  if (!raw) return "Unknown office";
  // Strip "Century 21 Alliance" prefix in any casing/spacing.
  let cleaned = raw
    .replace(/century\s*21\s*alliance/i, "")
    .trim();
  // Strip leading separators (- — / : · spaces)
  cleaned = cleaned.replace(/^[-—\/:·\s]+/, "").trim();
  if (!cleaned) return "Alliance (HQ)";

  const lower = cleaned.toLowerCase().replace(/[\s_-]/g, "");
  if (OFFICE_CODE_MAP[lower]) return OFFICE_CODE_MAP[lower];

  // Drop a Paragon-style trailing code like "S104B" / "O1O4J" / "104A"
  // (kept here for fallback when not in the map).
  const stripped = cleaned.replace(/[-\s]?[A-Z]?\d+[A-Z]*$/i, "").trim();
  const candidate = stripped.length > 0 ? stripped : cleaned;

  // Title-case the leftover.
  return candidate.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
  );
}

/**
 * Distinct normalized office labels for the filter chip strip. Sorted alpha.
 */
export async function listDistinctOfficeLabels(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("properties")
    .select("listing_office_name")
    .eq("status", "active")
    .not("listing_office_name", "is", null);
  const set = new Set<string>();
  for (const r of (data ?? []) as { listing_office_name: string | null }[]) {
    if (r.listing_office_name) set.add(normalizeOfficeName(r.listing_office_name));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Single-property fetch for the /properties/[mls] detail page.
// ---------------------------------------------------------------------------

export interface LinkedPost {
  id: string;
  platform: "facebook" | "instagram" | "tiktok";
  posted_at: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  reach: number;
  total_engagements: number;
}

export interface PropertyDetail extends PropertySummary {
  /** Ordered newest-first. */
  posts: LinkedPost[];
}

/**
 * Fetch a single property by mls_number, including its linked posts. Returns
 * null when the property isn't in the live `properties` table. Used by the
 * detail page to fall back gracefully from the fixture-based legacy view.
 *
 * Case-insensitive match — the URL may carry the MLS in mixed case but the
 * DB stores the canonical form.
 */
export async function fetchPropertyByMls(
  mls: string,
): Promise<PropertyDetail | null> {
  const supabase = createAdminClient();
  const trimmed = mls.trim();
  if (!trimmed) return null;

  const { data: propRow, error } = await supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, zip, list_price, listing_date, agent_name, hero_image_url, status, source_mls, listing_office_name, dom_days, property_type, bedrooms, bathrooms_full, bathrooms_half, public_remarks, updated_at",
    )
    .ilike("mls_number", trimmed)
    .maybeSingle();
  if (error || !propRow) return null;

  const row = propRow as DbPropertyRow;

  const { data: postRows } = await supabase
    .from("posts")
    .select("id, platform, posted_at, caption, thumbnail_url, permalink, metrics")
    .eq("property_id", row.id)
    .order("posted_at", { ascending: false });

  const posts: LinkedPost[] = ((postRows ?? []) as Array<{
    id: string;
    platform: "facebook" | "instagram" | "tiktok";
    posted_at: string | null;
    caption: string | null;
    thumbnail_url: string | null;
    permalink: string | null;
    metrics: Record<string, unknown> | null;
  }>).map((p) => {
    const m = (p.metrics ?? {}) as Record<string, unknown>;
    const reach = Number(m.reach ?? 0) || 0;
    const eng =
      (Number(m.likes ?? 0) || 0) +
      (Number(m.comments ?? 0) || 0) +
      (Number(m.shares ?? 0) || 0) +
      (Number(m.saves ?? 0) || 0);
    return {
      id: p.id,
      platform: p.platform,
      posted_at: p.posted_at,
      caption: p.caption,
      thumbnail_url: p.thumbnail_url,
      permalink: p.permalink,
      reach,
      total_engagements: eng,
    };
  });

  const totalReach = posts.reduce((s, p) => s + p.reach, 0);
  const totalEngagements = posts.reduce((s, p) => s + p.total_engagements, 0);

  return {
    id: row.id,
    mls_number: row.mls_number,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    list_price:
      row.list_price === null ? null : Number(row.list_price),
    listing_date: row.listing_date,
    agent_name: row.agent_name,
    hero_image_url: row.hero_image_url,
    status: row.status,
    source_mls: row.source_mls,
    listing_office_name: row.listing_office_name,
    dom_days: row.dom_days,
    property_type: row.property_type,
    bedrooms: row.bedrooms,
    bathrooms_full: row.bathrooms_full,
    bathrooms_half: row.bathrooms_half,
    public_remarks: row.public_remarks,
    post_count: posts.length,
    total_reach: totalReach,
    total_engagements: totalEngagements,
    updated_at: row.updated_at,
    posts,
  };
}
