import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCompanyRollup, type CompanyRollup } from "@/lib/data/company-rollup";

/* ----------------------------------------------------------------------- *
 *  Token lifecycle
 * ----------------------------------------------------------------------- */

/**
 * Idempotently ensure a property has an owner-story `reports` row + token.
 *
 * The auto-row is intentionally thin: only `property_id` and `report_token`
 * are set. The legacy `/r/[token]` Compass report flow needs `kpis`,
 * `audience`, `narrative`, `generated_at` — those are still set by
 * `generateReportAction` when Larissa hits "Generate". The story page
 * doesn't need any of that; it reads live data on every render.
 *
 * Returns the token. Safe to call on every page render — does at most one
 * SELECT + one INSERT.
 *
 * Why this helper exists alongside the `ensure_owner_story_tokens` SQL
 * function: the SQL function is the bulk path (post-sync hook + one-time
 * backfill). This TS helper is the on-demand path for properties created
 * outside the sync (manual add, edge cases). Both paths use the same
 * idempotency rule — INSERT only when no row exists.
 */
export async function getOrCreateStoryTokenForProperty(
  propertyId: string,
): Promise<string | null> {
  if (!propertyId) return null;
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("reports")
    .select("report_token")
    .eq("property_id", propertyId)
    .order("generated_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (existing?.report_token) return existing.report_token;

  const token = (globalThis.crypto as Crypto).randomUUID();
  const { data: inserted, error } = await supabase
    .from("reports")
    .insert({
      property_id: propertyId,
      report_token: token,
    })
    .select("report_token")
    .single();

  if (error || !inserted) {
    // Race: another caller inserted between our SELECT and INSERT. Re-read.
    const { data: retry } = await supabase
      .from("reports")
      .select("report_token")
      .eq("property_id", propertyId)
      .limit(1)
      .maybeSingle();
    return retry?.report_token ?? null;
  }
  return inserted.report_token;
}

/**
 * Data fetcher for the public owner story page at `/home/[token]`.
 *
 * Resolves a `reports.report_token` to a hydrated payload covering:
 *   - the listing (status-aware framing pulls from `properties.status`)
 *   - every linked post (newest-first; highlights pick top 3 by reach)
 *   - the optional personal note rendered above the hero
 *   - company-wide context (30d + 365d windows + total follower audience)
 *
 * Always tolerant: returns null on missing token / property; never throws.
 * The route renders with `force-dynamic`, so this runs on every request.
 *
 * Why a new fetcher (vs. reusing buildReportPayload): the story page reads
 * raw post rows for its timeline + highlights, plus the personal_note + the
 * listing's live `properties.status` for status-adaptive framing. The
 * legacy `buildReportPayload` was built for the Compass /r/[token] shape
 * and aggregates posts into kpis/audience rollups — different surface,
 * different needs.
 */

export type PropertyStatus = "active" | "pending" | "sold" | "expired";

export type Platform = "facebook" | "instagram" | "tiktok";

export interface OwnerStoryPost {
  id: string;
  platform: Platform;
  posted_at: string | null;
  caption: string;
  thumbnail_url: string | null;
  permalink: string | null;
  reach: number;
  engagements: number;
}

export interface OwnerStoryListing {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  listing_date: string | null;
  status: PropertyStatus;
  hero_image_url: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  agent_name: string | null;
  agent_email: string | null;
  /** Raw Paragon office name (e.g. "CENTURY 21 ALLIANCE wc"). UI normalizes. */
  listing_office_name: string | null;
}

export interface OwnerStoryData {
  token: string;
  report_id: string;
  personal_note: string | null;
  listing: OwnerStoryListing;
  posts: OwnerStoryPost[];
  /** Top 3 posts by reach (subset of `posts`). */
  highlights: OwnerStoryPost[];
  totals: {
    reach: number;
    engagements: number;
    post_count: number;
  };
  company: CompanyRollup;
  /** Days since first post landed for this listing (null if no posts). */
  days_since_launch: number | null;
  /** ISO timestamp of the first post for this listing (null if none). */
  first_post_at: string | null;
}

function readNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asPlatform(v: unknown): Platform {
  if (v === "facebook" || v === "instagram" || v === "tiktok") return v;
  return "instagram";
}

function asStatus(v: unknown): PropertyStatus {
  if (v === "active" || v === "pending" || v === "sold" || v === "expired") {
    return v;
  }
  return "active";
}

/**
 * Resolve a token → full story payload, or null when:
 *   - token doesn't match any report
 *   - the report's property is missing (orphaned report)
 *
 * Note: bearer-auth model. The token itself is the access control — any
 * caller holding the token can read. Per the design spec, this is by
 * design (link is meant to be forwardable by the seller to family).
 */
export async function fetchOwnerStoryByToken(
  token: string,
): Promise<OwnerStoryData | null> {
  if (!token || typeof token !== "string") return null;

  const supabase = createAdminClient();

  // 1) Token → report row
  const { data: reportRow, error: reportErr } = await supabase
    .from("reports")
    .select("id, property_id, personal_note")
    .eq("report_token", token)
    .maybeSingle();

  if (reportErr || !reportRow) return null;

  // 2) Property — pull the fields the story chapters need
  const { data: propRow, error: propErr } = await supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, zip, list_price, listing_date, status, hero_image_url, property_type, bedrooms, bathrooms_full, bathrooms_half, agent_name, agent_email, listing_office_name",
    )
    .eq("id", reportRow.property_id)
    .maybeSingle();

  if (propErr || !propRow) return null;

  // 3) Posts — direct link plus group-fallback, mirroring properties-db.
  //    Newest-first; the timeline chapter renders the raw order, highlights
  //    derive top-3 by reach.
  const [postDirect, groupFallback] = await Promise.all([
    supabase
      .from("posts")
      .select(
        "id, platform, posted_at, caption, thumbnail_url, permalink, metrics",
      )
      .eq("property_id", propRow.id)
      .order("posted_at", { ascending: false }),
    supabase
      .from("post_groups")
      .select("id")
      .contains("property_ids", [propRow.id]),
  ]);

  const groupIds = (groupFallback.data ?? [])
    .map((g: { id: string }) => g.id)
    .filter(Boolean);

  type RawPost = {
    id: string;
    platform: string;
    posted_at: string | null;
    caption: string | null;
    thumbnail_url: string | null;
    permalink: string | null;
    metrics: Record<string, unknown> | null;
  };

  let fallbackRows: RawPost[] = [];
  if (groupIds.length > 0) {
    const { data: groupPostRows } = await supabase
      .from("posts")
      .select(
        "id, platform, posted_at, caption, thumbnail_url, permalink, metrics",
      )
      .in("group_id", groupIds)
      .order("posted_at", { ascending: false });
    fallbackRows = (groupPostRows ?? []) as RawPost[];
  }

  const byId = new Map<string, RawPost>();
  for (const r of (postDirect.data ?? []) as RawPost[]) byId.set(r.id, r);
  for (const r of fallbackRows) if (!byId.has(r.id)) byId.set(r.id, r);

  const merged = Array.from(byId.values()).sort((a, b) => {
    const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
    const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
    return tb - ta;
  });

  const posts: OwnerStoryPost[] = merged.map((p) => {
    const m = (p.metrics ?? {}) as Record<string, unknown>;
    const reach = readNum(m.reach) || readNum(m.impressions);
    const engagements =
      readNum(m.likes) +
      readNum(m.comments) +
      readNum(m.shares) +
      readNum(m.saves);
    return {
      id: p.id,
      platform: asPlatform(p.platform),
      posted_at: p.posted_at,
      caption: (p.caption ?? "").trim(),
      thumbnail_url: p.thumbnail_url,
      permalink: p.permalink,
      reach,
      engagements,
    };
  });

  // 4) Highlights — top 3 by reach, ties broken by recency.
  const highlights = [...posts]
    .sort((a, b) => {
      if (b.reach !== a.reach) return b.reach - a.reach;
      const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
      const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 3);

  // 5) Totals
  const totals = posts.reduce(
    (acc, p) => {
      acc.reach += p.reach;
      acc.engagements += p.engagements;
      acc.post_count += 1;
      return acc;
    },
    { reach: 0, engagements: 0, post_count: 0 },
  );

  // 6) Launch moment — earliest posted_at across linked posts.
  let firstPostMs = Number.POSITIVE_INFINITY;
  for (const p of posts) {
    if (!p.posted_at) continue;
    const t = new Date(p.posted_at).getTime();
    if (Number.isFinite(t) && t < firstPostMs) firstPostMs = t;
  }
  const firstPostAt =
    firstPostMs !== Number.POSITIVE_INFINITY
      ? new Date(firstPostMs).toISOString()
      : null;
  const daysSinceLaunch = firstPostAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(firstPostAt).getTime()) / 86_400_000),
      )
    : null;

  // 7) Company rollup — never throws (returns zeros on failure).
  const company = await fetchCompanyRollup();

  return {
    token,
    report_id: reportRow.id,
    personal_note:
      typeof reportRow.personal_note === "string" &&
      reportRow.personal_note.trim().length > 0
        ? reportRow.personal_note
        : null,
    listing: {
      id: propRow.id,
      mls_number: propRow.mls_number,
      address: propRow.address,
      city: propRow.city,
      state: propRow.state,
      zip: propRow.zip,
      list_price:
        propRow.list_price === null || propRow.list_price === undefined
          ? null
          : Number(propRow.list_price),
      listing_date: propRow.listing_date,
      status: asStatus(propRow.status),
      hero_image_url: propRow.hero_image_url,
      property_type: propRow.property_type,
      bedrooms: propRow.bedrooms,
      bathrooms_full: propRow.bathrooms_full,
      bathrooms_half: propRow.bathrooms_half,
      agent_name: propRow.agent_name,
      agent_email: propRow.agent_email,
      listing_office_name: propRow.listing_office_name,
    },
    posts,
    highlights,
    totals,
    company,
    days_since_launch: daysSinceLaunch,
    first_post_at: firstPostAt,
  };
}
