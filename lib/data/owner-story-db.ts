import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAgentHeadshotUrlShared } from "@/lib/data/agent-headshot-resolver";
import { reachOf, engagementsOf, isReachReported } from "@/lib/data/post-metrics";
import { fetchCompanyRollup, type CompanyRollup } from "@/lib/data/company-rollup";
import {
  getBuildingForProperty,
  type BuildingRecord,
} from "@/lib/data/buildings-db";
import {
  fetchBuildingPortalTrafficByBuildingId,
  type BuildingRollup,
} from "@/lib/data/portal-metrics-db";

/* ----------------------------------------------------------------------- *
 *  View tracking
 * ----------------------------------------------------------------------- */

export interface OwnerStoryViewStats {
  total_views: number;
  last_viewed_at: string | null;
  /** Views in the last 7 days — for "recent activity" hints on the admin card. */
  views_last_7d: number;
}

/**
 * Log a single page-view of /home/[token]. Fire-and-forget — caller is
 * expected to NOT await this (use `void logOwnerStoryView(...)`). A failed
 * write should never block the public page from rendering.
 *
 * No PII captured. The user agent is trimmed to 240 chars (defense against
 * abusive headers); the referrer is reduced to host only.
 */
export async function logOwnerStoryView(
  reportId: string,
  userAgent: string | null,
  referrer: string | null,
): Promise<void> {
  if (!reportId) return;

  let referrerHost: string | null = null;
  if (referrer) {
    try {
      referrerHost = new URL(referrer).host || null;
    } catch {
      referrerHost = null;
    }
  }

  const trimmedUa =
    typeof userAgent === "string" && userAgent.length > 0
      ? userAgent.slice(0, 240)
      : null;

  try {
    const supabase = createAdminClient();
    await supabase.from("owner_story_views").insert({
      report_id: reportId,
      user_agent: trimmedUa,
      referrer_host: referrerHost,
    });
  } catch {
    // Swallow — view tracking is not allowed to break the public route.
  }
}

/**
 * Aggregate view stats for one report. Used by the admin card on
 * /properties/[mls] to display "Viewed N times, most recently …".
 *
 * Two queries: a HEAD count for total, a HEAD count for the 7d window, and
 * a 1-row read for `last_viewed_at`. Could be fused into a single SQL
 * function later if it shows up in the dashboard load profile.
 */
export async function fetchOwnerStoryViewStats(
  reportId: string,
): Promise<OwnerStoryViewStats> {
  const empty: OwnerStoryViewStats = {
    total_views: 0,
    last_viewed_at: null,
    views_last_7d: 0,
  };
  if (!reportId) return empty;

  const supabase = createAdminClient();
  const cutoff7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  try {
    const [totalRes, last7dRes, lastViewRes] = await Promise.all([
      supabase
        .from("owner_story_views")
        .select("id", { count: "exact", head: true })
        .eq("report_id", reportId),
      supabase
        .from("owner_story_views")
        .select("id", { count: "exact", head: true })
        .eq("report_id", reportId)
        .gte("viewed_at", cutoff7d),
      supabase
        .from("owner_story_views")
        .select("viewed_at")
        .eq("report_id", reportId)
        .order("viewed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      total_views: totalRes.count ?? 0,
      views_last_7d: last7dRes.count ?? 0,
      last_viewed_at: lastViewRes.data?.viewed_at ?? null,
    };
  } catch {
    return empty;
  }
}

/**
 * Aggregate story-view count across ALL listings within a window. Used by
 * the dashboard's Morning Briefing card to surface "N stories opened by
 * sellers overnight" without needing per-listing detail.
 *
 * Returns just a number — keeps the dashboard fetch lean.
 */
/**
 * Phase 7 — match a listing's `agent_name` against the `brand_assets`
 * table (kind='agent_headshot') to surface a real headshot on the public
 * story page. Returns null when nothing matches; the story view falls back
 * to the initials medallion.
 *
 * Match is by normalized (first + last, lowercased) name. Strips middle
 * initials, punctuation and generational suffixes so "John J. Koch" matches
 * a stored "John Koch" and "Philip Dougherty IV" matches "Philip Dougherty".
 *
 * 2026-08-21 — `normalizeAgentName` and `firstNameMatches` moved to
 * lib/data/agent-name-match.ts. They used to be hand-copied into this file,
 * alliance-dash-agents.ts and agent-roster.ts, each under a comment warning
 * the next reader to change all three. Two of the three had already drifted.
 * One import, one behaviour.
 */

/**
 * Resolve an agent's headshot URL from the Studio library.
 *
 * 2026-08-21 — the cascade moved to lib/data/agent-headshot-resolver.ts,
 * which `brand-asset-resolver.ts` now runs too. This file kept its own copy
 * of the passes for months while the template path ran a different, weaker
 * match, which is how an agent could have a photo on the Open House host
 * block and a blank frame on the very next slide. Same cascade now, one
 * place to change it.
 *
 * Returns null when nothing matches; callers fall back to the initials
 * medallion or an empty frame.
 */
export async function fetchAgentHeadshotUrl(
  agentName: string,
): Promise<string | null> {
  return resolveAgentHeadshotUrlShared(agentName);
}

export async function countOwnerStoryViewsInWindow(
  windowMs: number,
): Promise<number> {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return 0;
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const supabase = createAdminClient();
  try {
    const { count, error } = await supabase
      .from("owner_story_views")
      .select("id", { count: "exact", head: true })
      .gte("viewed_at", cutoff);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

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
  /**
   * False when the platform doesn't report reach for this post at all —
   * today that's static (photo/carousel) Facebook posts, whose reach
   * metrics Meta removed from the API entirely (verified 2026-07-17).
   * Surfaces render "Not reported by FB" instead of a misleading 0.
   */
  reach_reported: boolean;
  engagements: number;
  /** post_groups.id when set — lets the view re-aggregate by campaign. */
  group_id: string | null;
}

export interface OwnerStoryListing {
  id: string;
  mls_number: string;
  /**
   * "cmc" | "sjsr" | null. Drives ListTrac portal-strip lookups on the
   * seller-facing story page; nullable for legacy/manual listings without
   * a Paragon feed origin.
   */
  source_mls: "cmc" | "sjsr" | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  listing_date: string | null;
  status: PropertyStatus;
  /**
   * Most recent transition timestamp on `properties.status_changed_at`.
   * Drives the 72-hour grace window — for a UC/Sold flip in the last 72h
   * the story page renders a softer "transition" framing instead of the
   * full celebration copy, so sellers get a beat to process offline.
   */
  status_changed_at: string;
  hero_image_url: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  agent_name: string | null;
  agent_email: string | null;
  /** Phase 5 column — enables tap-to-text on the public story page. */
  agent_phone: string | null;
  /** Phase 7 — pulled from brand_assets.kind='agent_headshot' by name match. */
  agent_headshot_url: string | null;
  /** Raw Paragon office name (e.g. "CENTURY 21 ALLIANCE wc"). UI normalizes. */
  listing_office_name: string | null;
}

export interface OwnerStoryPhoto {
  url: string;
  caption: string | null;
}

export interface OwnerStoryOpenHouse {
  id: string;
  start_at: string;
  end_at: string | null;
  comments: string | null;
}

export interface OwnerStoryData {
  token: string;
  report_id: string;
  personal_note: string | null;
  listing: OwnerStoryListing;
  posts: OwnerStoryPost[];
  /** Top 3 posts by reach (subset of `posts`). */
  highlights: OwnerStoryPost[];
  /** Additional listing photos beyond the hero, sequence-ordered. */
  photos: OwnerStoryPhoto[];
  /** Open houses (past + future) for this listing, chronological. */
  open_houses: OwnerStoryOpenHouse[];
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
  /**
   * Building consolidation context. Null for single-unit listings (the story
   * behaves exactly as before). When set, every aggregate above (posts,
   * highlights, totals, open_houses, portal) already spans the WHOLE building,
   * deduped by post.id so a building-promo post that links to several units is
   * never double-counted.
   */
  building: {
    id: string;
    display_address: string | null;
    display_city: string | null;
    /** Number of MLS unit-listings rolled into this building. */
    unit_count: number;
    /** Combined ListTrac portal rollup across every unit, or null. */
    portal: BuildingRollup | null;
  } | null;
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

  const PROP_COLUMNS =
    "id, mls_number, source_mls, address, city, state, zip, list_price, listing_date, status, status_changed_at, hero_image_url, property_type, bedrooms, bathrooms_full, bathrooms_half, agent_name, agent_email, agent_phone, listing_office_name";

  // 2) Property — pull the fields the story chapters need
  const { data: tokenPropRow, error: propErr } = await supabase
    .from("properties")
    .select(PROP_COLUMNS)
    .eq("id", reportRow.property_id)
    .maybeSingle();

  if (propErr || !tokenPropRow) return null;

  // 2b) Building consolidation — if this property belongs to a building, the
  //     ENTIRE story (hero, posts, totals, open houses, portal) reframes to
  //     the whole building. The hero/identity property becomes the building's
  //     primary_property_id (earliest listing_date). Every member property_id
  //     and mls_number is collected so the post/photo/open-house gathering
  //     below fans out across all units. For a null building_id we keep the
  //     token's own property and behave exactly as before — no regression.
  let building: BuildingRecord | null = null;
  try {
    building = await getBuildingForProperty(reportRow.property_id);
  } catch {
    building = null;
  }

  // The "hero" / identity property the story is framed around.
  let propRow = tokenPropRow;
  if (
    building &&
    building.primary_property_id &&
    building.primary_property_id !== tokenPropRow.id
  ) {
    const { data: primaryRow } = await supabase
      .from("properties")
      .select(PROP_COLUMNS)
      .eq("id", building.primary_property_id)
      .maybeSingle();
    if (primaryRow) propRow = primaryRow;
  }

  // Property IDs + MLS#s the story aggregates over. Single property when no
  // building; every member when consolidated.
  const memberPropertyIds = building
    ? Array.from(new Set(building.members.map((m) => m.id)))
    : [propRow.id];

  // 3) Posts — three sources merged, newest-first:
  //   (a) Direct link via posts.property_id (the legacy anchor FK)
  //   (b) Join-table link via post_listings.property_id (lets multi-
  //       property carousel posts surface here even when this property
  //       isn't the anchor)
  //   (c) Group-fallback via post_groups.property_ids[] (campaigns whose
  //       member posts may have lost the FK during early ingest)
  //
  // Merged + deduped by post.id. (a) and (b) overlap by design — every
  // primary post_listings row has a matching posts.property_id — but the
  // dedupe makes that harmless. (c) provides resilience for pre-join-
  // table groups.
  // Building-aware: union all three sources across EVERY member property_id.
  // The dedup by post.id below (the `byId` Map) is what enforces the
  // correctness invariant — a single building-promo post that links to many
  // units surfaces once, so its reach/engagement is counted once, never per
  // unit. For a single (non-building) property these are 1-element `.in()`
  // lookups, behaviorally identical to the prior `.eq()` form.
  const [postDirect, postListings, ...groupFallbacks] = await Promise.all([
    supabase
      .from("posts")
      .select(
        "id, platform, posted_at, caption, thumbnail_url, permalink, metrics, media_type, group_id",
      )
      .in("property_id", memberPropertyIds)
      .order("posted_at", { ascending: false }),
    // 2026-05-21 — join-table fan-out. Pulls post IDs for every post
    // linked to any member property (primary AND non-primary) so multi-OH
    // carousels surface in the Owner Story.
    supabase
      .from("post_listings")
      .select("post_id")
      .in("property_id", memberPropertyIds),
    // post_groups.property_ids[] is an array column, so `.contains` matches a
    // single value at a time — fan out one query per member property id.
    ...memberPropertyIds.map((pid) =>
      supabase.from("post_groups").select("id").contains("property_ids", [pid]),
    ),
  ]);

  const groupIds = Array.from(
    new Set(
      groupFallbacks.flatMap((res) =>
        ((res.data ?? []) as Array<{ id: string }>)
          .map((g) => g.id)
          .filter(Boolean),
      ),
    ),
  );

  type RawPost = {
    id: string;
    platform: string;
    posted_at: string | null;
    caption: string | null;
    thumbnail_url: string | null;
    permalink: string | null;
    metrics: Record<string, unknown> | null;
    media_type: string | null;
    group_id: string | null;
  };

  // post_listings IDs we haven't already covered via the direct
  // property_id query — hydrate these from posts.
  const directIds = new Set(
    (postDirect.data ?? []).map((p) => (p as { id: string }).id),
  );
  const joinIds = (postListings.data ?? [])
    .map((r: { post_id: string }) => r.post_id)
    .filter((id) => !directIds.has(id));

  let joinRows: RawPost[] = [];
  if (joinIds.length > 0) {
    const { data: joinPostRows } = await supabase
      .from("posts")
      .select(
        "id, platform, posted_at, caption, thumbnail_url, permalink, metrics, media_type, group_id",
      )
      .in("id", joinIds)
      .order("posted_at", { ascending: false });
    joinRows = (joinPostRows ?? []) as RawPost[];
  }

  let fallbackRows: RawPost[] = [];
  if (groupIds.length > 0) {
    const { data: groupPostRows } = await supabase
      .from("posts")
      .select(
        "id, platform, posted_at, caption, thumbnail_url, permalink, metrics, media_type, group_id",
      )
      .in("group_id", groupIds)
      .order("posted_at", { ascending: false });
    fallbackRows = (groupPostRows ?? []) as RawPost[];
  }

  const byId = new Map<string, RawPost>();
  for (const r of (postDirect.data ?? []) as RawPost[]) byId.set(r.id, r);
  for (const r of joinRows) if (!byId.has(r.id)) byId.set(r.id, r);
  for (const r of fallbackRows) if (!byId.has(r.id)) byId.set(r.id, r);

  const merged = Array.from(byId.values()).sort((a, b) => {
    const ta = a.posted_at ? new Date(a.posted_at).getTime() : 0;
    const tb = b.posted_at ? new Date(b.posted_at).getTime() : 0;
    return tb - ta;
  });

  // Reach + engagements via the shared lib/data/post-metrics helpers so the
  // Owner Story renders the EXACT same numbers as the dashboard post detail
  // and the weekly social email. Don't fork the formula here.
  const posts: OwnerStoryPost[] = merged.map((p) => ({
    id: p.id,
    platform: asPlatform(p.platform),
    posted_at: p.posted_at,
    caption: (p.caption ?? "").trim(),
    thumbnail_url: p.thumbnail_url,
    permalink: p.permalink,
    reach: reachOf(p),
    reach_reported: isReachReported(p),
    engagements: engagementsOf(p),
    group_id: p.group_id,
  }));

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

  // 6b) Phase 7 — agent headshot lookup. Match properties.agent_name
  //     against brand_assets.label (normalized to first+last lowercase).
  //     Returns null when no match — story page falls back to initials.
  const agentHeadshotUrl = propRow.agent_name
    ? await fetchAgentHeadshotUrl(propRow.agent_name)
    : null;

  // 7) Photos + open houses — both keyed differently:
  //    photos by mls_number (Paragon-native key)
  //    open_houses by property_id (already linked locally)
  //    Run in parallel with the company rollup below.
  const [{ data: photoRows }, { data: ohRows }, company] = await Promise.all([
    // Photos still come from the hero/primary property only — the building
    // hero is the primary unit's photos. Showing every unit's gallery would
    // muddle the seller's page.
    supabase
      .from("listing_photos")
      .select("url, caption, sequence")
      .eq("mls_number", propRow.mls_number)
      .order("sequence", { ascending: true }),
    // Open houses span every member property so the seller sees the whole
    // building's open-house schedule.
    supabase
      .from("open_houses")
      .select("id, start_at, end_at, comments")
      .in("property_id", memberPropertyIds)
      .order("start_at", { ascending: true }),
    fetchCompanyRollup(),
  ]);

  // 7b) Portal traffic — for a building, roll up ListTrac across every unit
  //     using the primary MLS as the anchor. Non-fatal: a portal hiccup must
  //     never break the story page.
  let buildingPortal: BuildingRollup | null = null;
  if (building) {
    try {
      buildingPortal = await fetchBuildingPortalTrafficByBuildingId(
        propRow.mls_number,
      );
    } catch {
      buildingPortal = null;
    }
  }

  // Skip the hero photo (sequence=1) — story page already shows it large
  // at the top, so the gallery is the *additional* photos only.
  const photos: OwnerStoryPhoto[] = ((photoRows ?? []) as Array<{
    url: string | null;
    caption: string | null;
    sequence: number | null;
  }>)
    .filter((p) => (p.sequence ?? 0) !== 1 && p.url)
    .map((p) => ({ url: p.url as string, caption: p.caption }));

  const openHouses: OwnerStoryOpenHouse[] = ((ohRows ?? []) as Array<{
    id: string;
    start_at: string;
    end_at: string | null;
    comments: string | null;
  }>).map((oh) => ({
    id: oh.id,
    start_at: oh.start_at,
    end_at: oh.end_at,
    comments: oh.comments,
  }));

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
      source_mls:
        typeof propRow.source_mls === "string"
          ? (propRow.source_mls as OwnerStoryListing["source_mls"])
          : null,
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
      status_changed_at: propRow.status_changed_at,
      hero_image_url: propRow.hero_image_url,
      property_type: propRow.property_type,
      bedrooms: propRow.bedrooms,
      bathrooms_full: propRow.bathrooms_full,
      bathrooms_half: propRow.bathrooms_half,
      agent_name: propRow.agent_name,
      agent_email: propRow.agent_email,
      agent_phone: propRow.agent_phone,
      agent_headshot_url: agentHeadshotUrl,
      listing_office_name: propRow.listing_office_name,
    },
    posts,
    highlights,
    photos,
    open_houses: openHouses,
    totals,
    company,
    days_since_launch: daysSinceLaunch,
    first_post_at: firstPostAt,
    building: building
      ? {
          id: building.id,
          display_address: building.display_address ?? propRow.address,
          display_city: building.display_city ?? propRow.city,
          unit_count: building.members.length,
          portal: buildingPortal,
        }
      : null,
  };
}
