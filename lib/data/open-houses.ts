import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getListingNoteStates,
  EMPTY_NOTE_STATE,
  type ListingNoteState,
} from "@/lib/data/listing-notes";

/**
 * Server-only fetchers for the dashboard "Open Houses" card and the listing
 * detail page's per-listing OH section. Backed by the public.open_houses
 * table, populated by the mls-rets-sync Edge Function's OpenHouse pass.
 *
 * Window default: 7 days forward + just-ended (last 6 hours), so an OH that
 * wrapped up an hour ago still surfaces on Larissa's afternoon review. Past
 * OHs older than 6 hours drop out of upcoming-listings views.
 *
 * 2026-08-06 — the dashboard card now passes windowDays: 14 explicitly to
 * match the Multi-OH wizard's listing fetcher (lib/post-builder/listings.ts).
 * The two disagreed at 7 vs 14, so an open house 9 days out appeared in the
 * wizard but not on the dashboard. The default here stays 7 for the
 * per-listing callers; move both call sites together if that horizon changes.
 */

export interface UpcomingOpenHouse {
  id: string;
  mls_number: string;
  start_at: string;
  end_at: string | null;
  comments: string | null;
  /** Joined from properties — null when the OH arrived before the property
   *  replicated (rare; resolves on next sync). */
  address: string | null;
  /** Condo/townhouse/lot identifier (e.g. "Unit 207"). Joined from
   *  properties; null for single-family homes. Surfaced on the dashboard
   *  OH list so consumers can tell which unit to visit. */
  unit_number: string | null;
  city: string | null;
  state: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  list_price: number | null;
  /** Office short_code from the listing's office record (e.g. "WWC"). */
  office_short_code: string | null;
  /** Division the listing's office belongs to (e.g. "shore" | "south_jersey").
   *  Drives the dashboard OH card's division batching. Null when the office
   *  has no division set or the office couldn't be resolved. */
  division: string | null;
  /** When this OH was first inserted into our DB. Drives the dashboard's
   *  "fresh in last 24h" badge. */
  first_seen_at: string;
  /**
   * 2026-08-07 (John) — shared team notes for the LISTING this open house
   * belongs to. See lib/data/listing-notes.ts.
   */
  notes: ListingNoteState;
  /**
   * 2026-08-07 (John) — when a published open-house post exists for THIS
   * occurrence, the ISO timestamp it went out. Null otherwise.
   *
   * Scoped to the occurrence, not the property: a listing that holds an open
   * house every weekend gets a fresh, untagged row each time. See
   * getOpenHousePostMarks below for why that resets with no expiry logic.
   */
  post_made_at: string | null;
  /** Building consolidation: set when this entry represents a multi-unit
   *  building (collapsed from several units' open houses). Undefined for a
   *  standalone single-unit listing. */
  building_id?: string;
  /** Building consolidation: the building's display address (master label).
   *  Undefined for a standalone listing. */
  building_address?: string | null;
  /** Building consolidation: every member MLS# whose open houses this entry
   *  represents. One element for a standalone listing; N for a building. */
  building_member_mls?: string[];
  /** Building consolidation: count of distinct open-house events across all
   *  member units, so the UI can show "3 open houses this weekend". 1 for a
   *  standalone single-OH listing. */
  building_oh_count?: number;
}

interface DbOpenHouseRow {
  id: string;
  mls_number: string;
  property_id: string | null;
  start_at: string;
  end_at: string | null;
  comments: string | null;
  created_at: string;
}

interface DbPropertyRow {
  id: string;
  mls_number: string;
  address: string | null;
  unit_number: string | null;
  city: string | null;
  state: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  list_price: number | null;
  office_id: string | null;
  building_id: string | null;
}

interface DbOfficeRow {
  id: string;
  short_code: string;
  division: string | null;
}

export interface GetUpcomingOpenHousesOptions {
  /** Default 7 days. */
  windowDays?: number;
  /** Office short_code filter. Null/undefined returns all offices. */
  office_short_code?: string | null;
  /** Max rows. Default 25. */
  limit?: number;
}

/**
 * Return the next batch of Alliance Open Houses within the window. Joined
 * to properties for address + agent + hero photo. Sorted chronologically.
 * Past OHs that ended more than 6 hours ago are filtered out.
 */
export async function getUpcomingOpenHouses(
  opts: GetUpcomingOpenHousesOptions = {},
): Promise<UpcomingOpenHouse[]> {
  const supabase = createAdminClient();
  // `properties.building_id` + the `buildings` table aren't in the generated
  // Database type yet (building-consolidation feature). Use a permissive
  // client for those reads; see lib/data/buildings-db.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untypedSupabase = supabase as any;
  const windowDays = opts.windowDays ?? 7;
  const limit = opts.limit ?? 25;

  // Lower bound: 6 hours ago — keeps just-ended OHs visible briefly so
  // Larissa can still see today's earlier OHs on a 4pm review.
  const startCutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const endCutoff = new Date(
    Date.now() + windowDays * 86400_000,
  ).toISOString();

  const { data: ohRows, error: ohErr } = await supabase
    .from("open_houses")
    .select("id, mls_number, property_id, start_at, end_at, comments, created_at")
    .gte("start_at", startCutoff)
    .lte("start_at", endCutoff)
    .order("start_at", { ascending: true })
    .limit(limit);

  if (ohErr) {
    console.error("getUpcomingOpenHouses:", ohErr);
    return [];
  }
  const ohList = (ohRows ?? []) as DbOpenHouseRow[];
  if (ohList.length === 0) return [];

  // Hydrate property rows. property_id may be null on freshly-arrived OHs
  // — fall back to mls_number lookup so the row still renders.
  const propertyIds = Array.from(
    new Set(
      ohList.map((o) => o.property_id).filter((x): x is string => !!x),
    ),
  );
  const mlsNumbers = Array.from(new Set(ohList.map((o) => o.mls_number)));

  const propertyById = new Map<string, DbPropertyRow>();
  const propertyByMls = new Map<string, DbPropertyRow>();
  if (propertyIds.length > 0) {
    const { data: byId } = await untypedSupabase
      .from("properties")
      .select(
        "id, mls_number, address, unit_number, city, state, hero_image_url, agent_name, list_price, office_id, building_id",
      )
      .in("id", propertyIds);
    for (const p of (byId ?? []) as DbPropertyRow[]) {
      propertyById.set(p.id, p);
      propertyByMls.set(p.mls_number, p);
    }
  }
  // Any OH rows still missing property_id — look up by mls_number.
  const missingMls = ohList
    .filter((o) => !o.property_id || !propertyById.has(o.property_id))
    .map((o) => o.mls_number);
  if (missingMls.length > 0) {
    const { data: byMls } = await untypedSupabase
      .from("properties")
      .select(
        "id, mls_number, address, unit_number, city, state, hero_image_url, agent_name, list_price, office_id, building_id",
      )
      .in("mls_number", Array.from(new Set(missingMls)));
    for (const p of (byMls ?? []) as DbPropertyRow[]) {
      propertyByMls.set(p.mls_number, p);
    }
  }

  // Office short_code hydration.
  const officeIds = Array.from(
    new Set(
      Array.from(propertyByMls.values())
        .map((p) => p.office_id)
        .filter((x): x is string => !!x),
    ),
  );
  const officeShortByID = new Map<string, string>();
  const officeDivisionByID = new Map<string, string | null>();
  if (officeIds.length > 0) {
    const { data: officeRows } = await supabase
      .from("offices")
      .select("id, short_code, division")
      .in("id", officeIds);
    for (const o of (officeRows ?? []) as DbOfficeRow[]) {
      officeShortByID.set(o.id, o.short_code);
      officeDivisionByID.set(o.id, o.division ?? null);
    }
  }

  let scopedMlsNumbers: Set<string> | null = null;
  if (opts.office_short_code) {
    // Build the set of MLS numbers whose office matches the filter.
    scopedMlsNumbers = new Set();
    for (const [mls, p] of propertyByMls.entries()) {
      if (
        p.office_id &&
        officeShortByID.get(p.office_id) === opts.office_short_code
      ) {
        scopedMlsNumbers.add(mls);
      }
    }
  }

  // Building consolidation: resolve display addresses for every building
  // referenced by these OH properties, so a multi-unit building collapses
  // into one entry labeled with the building address.
  const buildingAddressById = new Map<string, string>();
  const ohBuildingIds = Array.from(
    new Set(
      Array.from(propertyByMls.values())
        .map((p) => p.building_id)
        .filter((b): b is string => typeof b === "string" && b.length > 0),
    ),
  );
  if (ohBuildingIds.length > 0) {
    const { data: bRows } = await untypedSupabase
      .from("buildings")
      .select("id, display_address, display_city")
      .in("id", ohBuildingIds);
    for (const b of (bRows ?? []) as Array<{
      id: string;
      display_address: string | null;
      display_city: string | null;
    }>) {
      const label = [b.display_address, b.display_city]
        .filter(Boolean)
        .join(", ");
      if (label) buildingAddressById.set(b.id, label);
    }
  }

  // 2026-08-06 (John) — the "posted coverage" lookups that lived here are
  // gone, along with the "✓ Posted <day>" badge they fed.
  //
  // They were added 2026-07-17 to answer "which of this morning's open houses
  // still need a post", which quietly assumed a property gets promoted once.
  // John: "There are several properties that will have Open Houses every
  // weekend, so it will be common to have multiple OH posts for the same
  // Property." A post from last weekend says nothing about whether THIS
  // weekend's open house has been promoted, so the badge was at best noise and
  // at worst a reason to skip building a post that was genuinely needed.
  //
  // Removing them drops two round trips per dashboard load: one against
  // generated_posts (builder-published OH posts) and one against post_listings
  // joined to posts (the synced social feed). The 2026-08-05 narrowing that
  // made the tracker query require listing_intent = 'open_house' went with
  // them — it was fixing the accuracy of a signal that should not exist.
  //
  // If a "needs a post this weekend" signal is ever wanted again, it has to be
  // scoped to the specific open-house OCCURRENCE (open_houses.id or the
  // start_at date), not to the property.

  // 2026-08-07 (John) — shared team notes, one batched round trip for the
  // whole card. Notes are per LISTING, not per open-house occurrence: "build
  // the reel but don't post it" is a fact about the property, and a weekly
  // open house shouldn't make you retype it every Saturday.
  // 2026-08-07 (John) — the "posted" tag is back, scoped to the occurrence.
  // Both lookups are one batched round trip for the whole card.
  const [noteStates, ohPostMarks] = await Promise.all([
    getListingNoteStates(ohList.map((oh) => oh.mls_number)),
    getOpenHousePostMarks(ohList.map((oh) => oh.id)),
  ]);

  const rows: Array<UpcomingOpenHouse & { _building_id: string | null }> = [];
  for (const oh of ohList) {
    if (scopedMlsNumbers && !scopedMlsNumbers.has(oh.mls_number)) continue;
    const property =
      (oh.property_id && propertyById.get(oh.property_id)) ||
      propertyByMls.get(oh.mls_number) ||
      null;
    rows.push({
      id: oh.id,
      mls_number: oh.mls_number,
      start_at: oh.start_at,
      end_at: oh.end_at,
      comments: oh.comments,
      address: property?.address ?? null,
      unit_number: property?.unit_number ?? null,
      city: property?.city ?? null,
      state: property?.state ?? null,
      hero_image_url: property?.hero_image_url ?? null,
      agent_name: property?.agent_name ?? null,
      list_price:
        property?.list_price === null || property?.list_price === undefined
          ? null
          : Number(property.list_price),
      office_short_code:
        property?.office_id
          ? officeShortByID.get(property.office_id) ?? null
          : null,
      division:
        property?.office_id
          ? officeDivisionByID.get(property.office_id) ?? null
          : null,
      first_seen_at: oh.created_at,
      notes: noteStates.get(oh.mls_number) ?? EMPTY_NOTE_STATE,
      post_made_at: ohPostMarks.get(oh.id) ?? null,
      _building_id: property?.building_id ?? null,
    });
  }

  // Collapse multi-unit buildings into ONE entry. Standalone listings (no
  // building_id) pass through unchanged. For a building, the soonest OH row
  // is the representative (rows are already start_at-ascending), and we attach
  // the full member MLS list + total OH count across its units, so picking the
  // building entry = promoting the whole building's open houses at once.
  const out: UpcomingOpenHouse[] = [];
  const buildingIndex = new Map<string, number>();
  for (const r of rows) {
    const { _building_id, ...row } = r;
    if (!_building_id) {
      out.push(row);
      continue;
    }
    const existing = buildingIndex.get(_building_id);
    if (existing === undefined) {
      buildingIndex.set(_building_id, out.length);
      out.push({
        ...row,
        building_id: _building_id,
        building_address: buildingAddressById.get(_building_id) ?? row.address,
        building_member_mls: [row.mls_number],
        building_oh_count: 1,
      });
    } else {
      const entry = out[existing];
      const members = entry.building_member_mls ?? [];
      if (!members.includes(row.mls_number)) members.push(row.mls_number);
      entry.building_member_mls = members;
      entry.building_oh_count = (entry.building_oh_count ?? 1) + 1;
      // Keep the freshest first_seen_at across the building's OHs so the
      // dashboard "new in last 24h" badge fires when ANY unit's OH is new.
      if (row.first_seen_at > entry.first_seen_at) {
        entry.first_seen_at = row.first_seen_at;
      }
    }
  }
  return out;
  // mlsNumbers var is unused below — keep for future debug uses.
  void mlsNumbers;
}

/* -------------------------------------------------------------------------- */
/* Open-house post coverage — 2026-08-07                                      */
/* -------------------------------------------------------------------------- */

/**
 * How far apart two open houses can be and still count as the same event for
 * tagging purposes. One post normally promotes a whole Sat + Sun weekend, so
 * marking only the Saturday occurrence would leave Sunday reading as "still
 * needs a post" when it doesn't.
 *
 * 72 hours rather than calendar-weekend logic on purpose: Sat 10am covers Sun
 * 10am (24h), two separate weekends stay independent (168h), and there is no
 * timezone or Fri-vs-Sat edge case to get subtly wrong.
 */
export const OH_SAME_EVENT_WINDOW_MS = 72 * 3600_000;

/**
 * Which open-house occurrences a post for this listing should be stamped
 * against: the soonest upcoming one, plus any other occurrence for the same
 * listing starting within {@link OH_SAME_EVENT_WINDOW_MS} of it.
 *
 * Called at SAVE time, so it works whether the user deep-linked from the
 * dashboard or picked the listing by hand in the builder. Returns [] when the
 * listing has no upcoming open house, which is the correct no-op: a post with
 * no occurrence to attach to simply never lights a tag.
 */
export async function resolveOpenHouseIdsForListing(
  mlsNumber: string,
): Promise<string[]> {
  if (!mlsNumber) return [];
  const supabase = createAdminClient();

  // Same 6-hour grace as the dashboard card: an open house running right now
  // is still the one a post published this morning was promoting.
  const startCutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("open_houses")
    .select("id, start_at")
    .eq("mls_number", mlsNumber)
    .gte("start_at", startCutoff)
    .order("start_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error("[open-houses] resolve for stamping failed:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{ id: string; start_at: string }>;
  if (rows.length === 0) return [];

  const anchor = Date.parse(rows[0].start_at);
  if (!Number.isFinite(anchor)) return [rows[0].id];

  return rows
    .filter((r) => {
      const t = Date.parse(r.start_at);
      return (
        Number.isFinite(t) && t - anchor >= 0 && t - anchor <= OH_SAME_EVENT_WINDOW_MS
      );
    })
    .map((r) => r.id);
}

/**
 * "Which of these open houses already have a published post?"
 *
 * Reads generated_posts ONLY. The pre-8/06 version unioned this with the
 * synced social feed (posts joined through post_listings), and that feed has
 * no idea what a post was ABOUT, so a Just Listed or Price Reduction post lit
 * the open-house tag. That union is not coming back.
 *
 * posted_at IS NOT NULL is the "actually went live" gate, so a draft or a
 * scheduled-but-unfired row doesn't tag anything.
 *
 * Returns a Map of open_houses.id → posted_at ISO.
 */
export async function getOpenHousePostMarks(
  openHouseIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(openHouseIds.filter(Boolean)));
  if (unique.length === 0) return out;

  const supabase = createAdminClient();
  // open_house_ids isn't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const { data, error } = await untyped
    .from("generated_posts")
    .select("open_house_ids, posted_at")
    .not("posted_at", "is", null)
    .overlaps("open_house_ids", unique);

  if (error) {
    console.error("[open-houses] post-mark lookup failed:", error.message);
    return out;
  }

  const wanted = new Set(unique);
  for (const row of (data ?? []) as Array<{
    open_house_ids: string[] | null;
    posted_at: string;
  }>) {
    for (const id of row.open_house_ids ?? []) {
      if (!wanted.has(id)) continue;
      // Keep the EARLIEST publish for an occurrence: "posted Aug 5" should
      // mean when it first went out, not when it was last re-posted.
      const existing = out.get(id);
      if (!existing || row.posted_at < existing) out.set(id, row.posted_at);
    }
  }
  return out;
}

/**
 * Per-listing OH lookup for the property detail page. Returns OHs from
 * 6 hours ago through 90 days out for a single property — useful for
 * seeing a listing's full near-term OH schedule.
 */
export async function getOpenHousesForProperty(
  propertyId: string,
): Promise<UpcomingOpenHouse[]> {
  if (!propertyId) return [];
  const supabase = createAdminClient();
  const startCutoff = new Date(Date.now() - 6 * 3600_000).toISOString();
  const endCutoff = new Date(Date.now() + 90 * 86400_000).toISOString();

  const { data: ohRows, error } = await supabase
    .from("open_houses")
    .select("id, mls_number, property_id, start_at, end_at, comments, created_at")
    .eq("property_id", propertyId)
    .gte("start_at", startCutoff)
    .lte("start_at", endCutoff)
    .order("start_at", { ascending: true });
  if (error) {
    console.error("getOpenHousesForProperty:", error);
    return [];
  }
  const ohList = (ohRows ?? []) as DbOpenHouseRow[];
  if (ohList.length === 0) return [];

  // Single-property fetch — pull just this property's metadata.
  const { data: p } = await supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, hero_image_url, agent_name, list_price, office_id",
    )
    .eq("id", propertyId)
    .maybeSingle();
  const property = (p ?? null) as DbPropertyRow | null;
  let officeShortCode: string | null = null;
  let division: string | null = null;
  if (property?.office_id) {
    const { data: o } = await supabase
      .from("offices")
      .select("short_code, division")
      .eq("id", property.office_id)
      .maybeSingle();
    officeShortCode = (o?.short_code as string | undefined) ?? null;
    division = (o?.division as string | undefined) ?? null;
  }

  return ohList.map((oh) => ({
    id: oh.id,
    mls_number: oh.mls_number,
    start_at: oh.start_at,
    end_at: oh.end_at,
    comments: oh.comments,
    address: property?.address ?? null,
    unit_number: property?.unit_number ?? null,
    city: property?.city ?? null,
    state: property?.state ?? null,
    hero_image_url: property?.hero_image_url ?? null,
    agent_name: property?.agent_name ?? null,
    list_price:
      property?.list_price === null || property?.list_price === undefined
        ? null
        : Number(property.list_price),
    office_short_code: officeShortCode,
    division,
    first_seen_at: oh.created_at,
    // The property detail page renders the note thread in its own card, so
    // the per-OH rows here don't need to carry it.
    notes: EMPTY_NOTE_STATE,
    // The posted tag is a dashboard-card affordance; the property page shows
    // the listing's full post history separately.
    post_made_at: null,
  }));
}

/**
 * Best-effort backfill of generated_posts.open_house_ids at publish time.
 *
 * 2026-08-08 — the occurrence "Posted" tag reads this column via
 * getOpenHousePostMarks. Only saveGeneratedPostAction and the multi-OH
 * generate route write it, so a row created by the Studio upsert (Open House
 * -> Edit in Studio -> Save) or by mobile Quick Create published with an empty
 * array and never lit the tag. Publish is the one point every path passes
 * through, so the backfill lives here instead of a fourth call site.
 *
 * Deliberately narrow. It only acts when:
 *   - the post is an open_house post,
 *   - it is NOT a multi-property event (those already carry the full id list;
 *     resolving from a single mls_number would be wrong for them),
 *   - and the column is still empty, so a correct stamp is never overwritten.
 *
 * Never throws and never blocks publishing: a missing dashboard tag is a far
 * smaller problem than a publish that fails after the post is already live.
 */
export async function backfillOpenHouseIdsForPublishedPost(args: {
  generatedPostId: string;
  mlsNumber: string | null | undefined;
  postType: string | null | undefined;
  templateId: string | null | undefined;
}): Promise<void> {
  try {
    if (args.postType !== "open_house") return;
    if (!args.mlsNumber) return;
    if (
      typeof args.templateId === "string" &&
      args.templateId.startsWith("multi_oh_event_")
    ) {
      return;
    }

    const supabase = createAdminClient();
    // open_house_ids isn't in the generated Database type yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const untyped = supabase as any;

    const { data: row } = await untyped
      .from("generated_posts")
      .select("open_house_ids")
      .eq("id", args.generatedPostId)
      .maybeSingle();

    const existing = (row?.open_house_ids ?? []) as string[];
    if (existing.length > 0) return;

    const ids = await resolveOpenHouseIdsForListing(args.mlsNumber);
    if (ids.length === 0) return;

    const { error } = await untyped
      .from("generated_posts")
      .update({ open_house_ids: ids })
      .eq("id", args.generatedPostId);
    if (error) {
      console.warn(
        "[open-houses] open_house_ids backfill failed for",
        args.generatedPostId,
        error.message,
      );
    }
  } catch (e) {
    console.warn(
      "[open-houses] open_house_ids backfill threw for",
      args.generatedPostId,
      e instanceof Error ? e.message : String(e),
    );
  }
}
