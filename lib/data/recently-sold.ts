import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MILESTONE_FLOOR_ISO,
  floorDate,
  floorIso,
  isVisibleOnMilestoneCard,
  compareMilestoneRows,
} from "@/lib/dashboard-window";
import { getListingSkipMarks } from "@/lib/data/listing-skip-marks";
import {
  getAutoPostedPropertyIds,
  getListingPostMarks,
  type MilestonePostType,
} from "@/lib/data/listing-post-marks";
import {
  getListingNoteStates,
  EMPTY_NOTE_STATE,
  type ListingNoteState,
} from "@/lib/data/listing-notes";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-only fetchers for the dashboard's right-column cards:
 *   - getUnderContractListings  → status='pending' (a current state)
 *   - getRecentlySoldListings   → status='sold' AND close_date within window
 *
 * Both mirror the office-filter + result-shape conventions used by
 * `getListingsNeedingPosts` so the dashboard can render them with consistent
 * row layouts. Powered by the Phase 7 RETS sync additions that capture
 * close_date + close_price from Paragon.
 *
 * Neither fetcher applies any "needs coverage" gating — Larissa wants to see
 * every settled / pending listing so she can decide whether to make a post.
 */

type PropertyStatus = Database["public"]["Enums"]["property_status"];
type SourceMls = "cmc" | "sjsr" | "bright" | string | null;

/** Three-state Alliance role on a transaction. */
export type AllianceRole = "listing" | "buyer" | "both";

/** Shared row shape between Recently Sold and Under Contract surfaces. */
export interface ListingMilestone {
  id: string;
  mls_number: string;
  source_mls: SourceMls;
  status: PropertyStatus;
  address: string | null;
  city: string | null;
  state: string | null;
  list_price: number | null;
  /**
   * The price to display prominently. For sold listings this is close_price;
   * for pending listings it's list_price. Callers shouldn't need to branch.
   */
  display_price: number | null;
  /**
   * The date that defines the row's "freshness," and the one printed next to
   * the section's eyebrow label. It must always be the date that DEFINES the
   * milestone, because the label asserts it:
   *   sold    = close_date          → "Sold Aug 4"
   *   pending = status_changed_at   → "Under contract Aug 4"
   *   reduced = changed_at          → "Reduced Aug 4"
   *
   * 2026-08-05 (John): pending used to key off listing_date while the row
   * still said "Under contract", so an Aug 4 contract on an April listing
   * rendered as "Under contract Apr 24" and looked like the Aug 1 floor was
   * broken. The floor was fine; the printed date was the wrong field.
   */
  reference_date: string;
  reference_date_kind:
    | "close_date"
    | "listing_date"
    | "status_changed_at"
    | "updated_at";
  hero_image_url: string | null;
  /** Listing-side agent (Paragon LA1_*). NULL when only buyer-side known. */
  agent_name: string | null;
  office_short_code: string | null;
  /** Phase 8: Alliance buyer-side agent (Paragon SA1_*). Populated when alliance_role IN ('buyer','both'). */
  buyer_agent_name: string | null;
  /** Phase 8: Which side(s) Alliance had on the transaction. */
  alliance_role: AllianceRole;
  /** When the row's STATUS last transitioned (active→pending→sold). Drives
   *  the "fresh in last 24h" dashboard badge. */
  first_seen_at: string;
  /**
   * 2026-08-05 (John) — has a post of THIS milestone's type been made for
   * this listing? True from either a published generated_post of that type or
   * a manual tick in listing_post_marks. Drives the checkbox that now sits on
   * every milestone row.
   */
  post_made: boolean;
  /** True when post_made came from a published post, so the box is locked. */
  post_auto_detected: boolean;
  /** When the manual checkbox was ticked, else null. */
  post_marked_at: string | null;
  /**
   * 2026-08-07 (John) — "not worth a post" for THIS milestone. Skipping counts
   * as handled, so the row drops off once it is also outside the 7-day window.
   * Per milestone: skipping the Just Sold leaves the Price Change alone.
   */
  skipped_at: string | null;
  skip_reason: string | null;
  /**
   * 2026-08-07 (John) — shared team notes on this listing. Only the newest
   * entry travels with the row; the full thread loads when the panel opens.
   * `on_hold` set means "don't post this yet" and paints the HOLD chip.
   * See lib/data/listing-notes.ts.
   */
  notes: ListingNoteState;
}

export interface GetUnderContractOptions {
  office_short_code?: string | null;
  limit?: number;
}

export interface GetRecentlySoldOptions {
  /** Default 30 days. */
  windowDays?: number;
  office_short_code?: string | null;
  limit?: number;
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
  updated_at: string;
  status_changed_at: string;
  close_date: string | null;
  close_price: number | null;
  buyer_agent_name: string | null;
  alliance_role: string;
}

function coerceAllianceRole(value: string | null | undefined): AllianceRole {
  if (value === "buyer" || value === "both") return value;
  return "listing";
}

interface DbOfficeRow {
  id: string;
  short_code: string;
}

/**
 * Resolve a short_code to office_id. Returns null when the code doesn't match
 * a known office (filters out empty result sets cleanly).
 */
async function resolveOfficeFilter(
  supabase: ReturnType<typeof createAdminClient>,
  shortCode: string | null | undefined,
): Promise<{ ok: true; office_id: string | null } | { ok: false }> {
  if (!shortCode) return { ok: true, office_id: null };
  const { data, error } = await supabase
    .from("offices")
    .select("id")
    .eq("short_code", shortCode)
    .maybeSingle();
  if (error || !data) return { ok: false };
  return { ok: true, office_id: data.id };
}

/**
 * Hydrate office short_code labels onto the row set in one bulk query.
 */
async function attachOfficeLabels(
  supabase: ReturnType<typeof createAdminClient>,
  properties: DbPropertyRow[],
): Promise<Map<string, string>> {
  const officeIds = Array.from(
    new Set(
      properties.map((p) => p.office_id).filter((x): x is string => !!x),
    ),
  );
  const result = new Map<string, string>();
  if (officeIds.length === 0) return result;
  const { data: officeRows } = await supabase
    .from("offices")
    .select("id, short_code")
    .in("id", officeIds);
  for (const o of (officeRows ?? []) as DbOfficeRow[]) {
    result.set(o.id, o.short_code);
  }
  return result;
}

/**
 * Convert a DB row to the shared ListingMilestone shape for sold listings.
 * Sold rows display close_price and key off close_date.
 */
function rowToSold(
  p: DbPropertyRow,
  officeShortByID: Map<string, string>,
  marks?: PostMarkLookup,
  noteStates?: Map<string, ListingNoteState>,
  skips?: Map<string, { skipped_at: string; reason: string | null }>,
): ListingMilestone {
  return {
    id: p.id,
    mls_number: p.mls_number,
    source_mls: (p.source_mls as SourceMls) ?? null,
    status: p.status,
    address: p.address,
    city: p.city,
    state: p.state,
    list_price: p.list_price === null ? null : Number(p.list_price),
    display_price:
      p.close_price === null
        ? p.list_price === null
          ? null
          : Number(p.list_price)
        : Number(p.close_price),
    reference_date: p.close_date ?? p.updated_at,
    reference_date_kind: p.close_date ? "close_date" : "updated_at",
    hero_image_url: p.hero_image_url,
    agent_name: p.agent_name,
    office_short_code: p.office_id
      ? officeShortByID.get(p.office_id) ?? null
      : null,
    buyer_agent_name: p.buyer_agent_name,
    alliance_role: coerceAllianceRole(p.alliance_role),
    first_seen_at: p.status_changed_at,
    ...resolvePostMark(p, marks),
    notes: noteStates?.get(p.mls_number) ?? EMPTY_NOTE_STATE,
    skipped_at: skips?.get(p.mls_number)?.skipped_at ?? null,
    skip_reason: skips?.get(p.mls_number)?.reason ?? null,
  };
}

/**
 * Convert a DB row to the shared ListingMilestone shape for pending listings.
 * Pending rows display list_price and key off status_changed_at — the moment
 * the listing flipped to pending, which is both what the "Under contract"
 * label claims AND the column getUnderContractListings filters on, so the
 * card's heading, its filter and every printed date finally agree.
 */
function rowToPending(
  p: DbPropertyRow,
  officeShortByID: Map<string, string>,
  marks?: PostMarkLookup,
  noteStates?: Map<string, ListingNoteState>,
  skips?: Map<string, { skipped_at: string; reason: string | null }>,
): ListingMilestone {
  return {
    id: p.id,
    mls_number: p.mls_number,
    source_mls: (p.source_mls as SourceMls) ?? null,
    status: p.status,
    address: p.address,
    city: p.city,
    state: p.state,
    list_price: p.list_price === null ? null : Number(p.list_price),
    display_price: p.list_price === null ? null : Number(p.list_price),
    reference_date: p.status_changed_at ?? p.listing_date ?? p.updated_at,
    reference_date_kind: p.status_changed_at
      ? "status_changed_at"
      : p.listing_date
        ? "listing_date"
        : "updated_at",
    hero_image_url: p.hero_image_url,
    agent_name: p.agent_name,
    office_short_code: p.office_id
      ? officeShortByID.get(p.office_id) ?? null
      : null,
    buyer_agent_name: p.buyer_agent_name,
    alliance_role: coerceAllianceRole(p.alliance_role),
    first_seen_at: p.status_changed_at,
    ...resolvePostMark(p, marks),
    notes: noteStates?.get(p.mls_number) ?? EMPTY_NOTE_STATE,
    skipped_at: skips?.get(p.mls_number)?.skipped_at ?? null,
    skip_reason: skips?.get(p.mls_number)?.reason ?? null,
  };
}

/**
 * Currently-pending (under contract) listings.
 *
 * 2026-08-05 (John) — this used to have NO date predicate at all: it returned
 * the N newest-listed of every pending row in the book, which is why the card
 * showed listings that went pending months ago. It is now gated on
 * `status_changed_at` (when the listing actually flipped to pending) against
 * the shared milestone floor, and sorted by that same date so the newest
 * transition sits on top. Gating on listing_date instead would be wrong — a
 * listing from March can go under contract today.
 */
export async function getUnderContractListings(
  opts: GetUnderContractOptions = {},
): Promise<ListingMilestone[]> {
  const supabase = createAdminClient();
  const limit = opts.limit ?? 25;

  const officeFilter = await resolveOfficeFilter(supabase, opts.office_short_code);
  if (!officeFilter.ok) return [];

  let query = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, list_price, listing_date, hero_image_url, agent_name, office_id, updated_at, status_changed_at, close_date, close_price, buyer_agent_name, alliance_role",
    )
    .eq("status", "pending")
    .gte("status_changed_at", MILESTONE_FLOOR_ISO)
    .order("status_changed_at", { ascending: false })
    .order("updated_at", { ascending: false })
    // 2026-08-07 — overfetch. Unhandled rows now persist past the 7-day
    // window, so the caller's cap cannot be applied at the DB level any more
    // or an old unposted listing would be cut before the filter ever sees it.
    // The Aug 1 floor bounds this, so the pool stays small.
    .limit(Math.max(limit * 8, 100));

  if (officeFilter.office_id) query = query.eq("office_id", officeFilter.office_id);

  const { data, error } = await query;
  if (error) {
    console.error("getUnderContractListings:", error);
    return [];
  }
  const properties = (data ?? []) as DbPropertyRow[];
  if (properties.length === 0) return [];

  const officeShortByID = await attachOfficeLabels(supabase, properties);
  const [marks, noteStates, skips] = await Promise.all([
    attachPostMarks(properties, "under_contract"),
    getListingNoteStates(properties.map((p) => p.mls_number)),
    getListingSkipMarks(
      properties.map((p) => p.mls_number),
      "under_contract",
    ),
  ]);
  return applyMilestoneWindow(
    properties.map((p) =>
      rowToPending(p, officeShortByID, marks, noteStates, skips),
    ),
    limit,
  );
}

/**
 * Recently sold listings (close_date within the window, default 30 days).
 * Sorted newest-first by close_date. Falls back to updated_at sort for any
 * sold rows that don't carry close_date yet (early-RETS-sync edge case).
 */
export async function getRecentlySoldListings(
  opts: GetRecentlySoldOptions = {},
): Promise<ListingMilestone[]> {
  const supabase = createAdminClient();
  const windowDays = opts.windowDays ?? 30;
  const limit = opts.limit ?? 25;

  const officeFilter = await resolveOfficeFilter(supabase, opts.office_short_code);
  if (!officeFilter.ok) return [];

  // 2026-08-05 — rolling window floored at the shared milestone slate date.
  // Both branches of the OR get the floored value so a sold row with no
  // close_date can't slip through on updated_at alone.
  const rawCutoffIso = new Date(
    Date.now() - windowDays * 86400_000,
  ).toISOString();
  const cutoffIso = floorIso(rawCutoffIso);
  const cutoffDate = floorDate(rawCutoffIso.slice(0, 10));

  // Either close_date is set and within the window, OR close_date is missing
  // and the row was updated within the window (covers listings that just
  // flipped to sold but haven't had close_date populated yet).
  let query = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, list_price, listing_date, hero_image_url, agent_name, office_id, updated_at, status_changed_at, close_date, close_price, buyer_agent_name, alliance_role",
    )
    .eq("status", "sold")
    .or(
      `close_date.gte.${cutoffDate},and(close_date.is.null,updated_at.gte.${cutoffIso})`,
    )
    .order("close_date", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    // Overfetch: see the note in getUnderContractListings.
    .limit(Math.max(limit * 8, 100));

  if (officeFilter.office_id) query = query.eq("office_id", officeFilter.office_id);

  const { data, error } = await query;
  if (error) {
    console.error("getRecentlySoldListings:", error);
    return [];
  }
  const properties = (data ?? []) as DbPropertyRow[];
  if (properties.length === 0) return [];

  const officeShortByID = await attachOfficeLabels(supabase, properties);
  const [marks, noteStates, skips] = await Promise.all([
    attachPostMarks(properties, "just_sold"),
    getListingNoteStates(properties.map((p) => p.mls_number)),
    getListingSkipMarks(
      properties.map((p) => p.mls_number),
      "just_sold",
    ),
  ]);
  return applyMilestoneWindow(
    properties.map((p) =>
      rowToSold(p, officeShortByID, marks, noteStates, skips),
    ),
    limit,
  );
}

/**
 * The shared 7-day rule, applied identically by every milestone card.
 *
 * 2026-08-07 (John): handled rows (posted or skipped) drop off after 7 days.
 * Unhandled rows stay until somebody acts on them, and sort to the top so a
 * growing backlog can never be pushed off the bottom by the row cap.
 */
export function applyMilestoneWindow<
  T extends {
    post_made: boolean;
    skipped_at: string | null;
    reference_date: string | null;
  },
>(rows: T[], limit: number): T[] {
  const withHandled = rows.map((r) => ({
    row: r,
    handled: r.post_made || r.skipped_at !== null,
  }));

  return withHandled
    .filter(({ row, handled }) =>
      isVisibleOnMilestoneCard({
        referenceDate: row.reference_date,
        handled,
      }),
    )
    .sort((a, b) =>
      compareMilestoneRows(
        { handled: a.handled, referenceDate: a.row.reference_date },
        { handled: b.handled, referenceDate: b.row.reference_date },
      ),
    )
    .slice(0, limit)
    .map(({ row }) => row);
}

/**
 * Shared post-mark lookup for the milestone fetchers. One round trip each for
 * the manual ticks and the published-post auto-detection, then handed to the
 * row mappers.
 */
async function attachPostMarks(
  properties: DbPropertyRow[],
  postType: MilestonePostType,
): Promise<PostMarkLookup> {
  const [manual, auto] = await Promise.all([
    getListingPostMarks(
      properties.map((p) => p.mls_number),
      postType,
    ),
    getAutoPostedPropertyIds(
      properties.map((p) => p.id),
      postType,
    ),
  ]);
  return { manual, auto };
}

export interface PostMarkLookup {
  /** mls_number → marked_at */
  manual: Map<string, string>;
  /** property ids with a published post of this type */
  auto: Set<string>;
}

/** Resolve the three post-mark fields for one row. */
function resolvePostMark(
  row: DbPropertyRow,
  marks: PostMarkLookup | undefined,
): Pick<
  ListingMilestone,
  "post_made" | "post_auto_detected" | "post_marked_at"
> {
  const autoDetected = marks?.auto.has(row.id) ?? false;
  const markedAt = marks?.manual.get(row.mls_number) ?? null;
  return {
    post_made: autoDetected || markedAt !== null,
    post_auto_detected: autoDetected,
    post_marked_at: markedAt,
  };
}
