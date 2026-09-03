import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { MILESTONE_FLOOR_ISO } from "@/lib/dashboard-window";
import {
  getAutoPostedMarks,
  getListingPostMarks,
} from "@/lib/data/listing-post-marks";
import {
  getListingNoteStates,
  EMPTY_NOTE_STATE,
} from "@/lib/data/listing-notes";
import { getListingSkipMarks } from "@/lib/data/listing-skip-marks";
import {
  applyMilestoneWindow,
  type AllianceRole,
  type ListingMilestone,
} from "@/lib/data/recently-sold";
import type { Database } from "@/lib/supabase/types";

/**
 * Dashboard "Price Changes" fetcher — 2026-08-05 (John).
 *
 * A price change here means a REDUCTION: the current list price came down from
 * the original or the previous list price.
 *
 * Source of truth is `listing_price_changes`, written by the
 * `trg_record_listing_price_change` trigger on properties. The trigger fires
 * for ANY writer (both RETS feeds, manual edits, backfills), so it survives
 * the sync functions' blind batch upserts.
 *
 * Deliberately NOT derived from `original_list_price > list_price`: that would
 * surface reductions that happened before we started recording them, and John's
 * clean-slate rule says nothing prior to Aug 1 should appear. The consequence
 * is that this section starts empty and fills as reductions land, same as
 * Recently Sold.
 *
 * One row per property — the most recent reduction wins, with the count of
 * reductions since the floor carried alongside so a listing that dropped twice
 * reads as "2 reductions".
 */

type PropertyStatus = Database["public"]["Enums"]["property_status"];
type SourceMls = "cmc" | "sjsr" | "bright" | string | null;

export interface PriceChangeMilestone extends ListingMilestone {
  /** Price immediately before the most recent reduction. */
  previous_price: number | null;
  /** Price after it, i.e. the current list price at the time of the change. */
  new_price: number | null;
  /** Original list price on file, for the "originally $X" context line. */
  original_list_price: number | null;
  /** Dollar amount of the most recent drop (positive number). */
  drop_amount: number | null;
  /** Percentage of the most recent drop, rounded to one decimal. */
  drop_percent: number | null;
  /** How many reductions this listing has had since the milestone floor. */
  reduction_count: number;
}

export interface GetPriceChangesOptions {
  office_short_code?: string | null;
  limit?: number;
}

interface PriceChangeRow {
  property_id: string;
  mls_number: string;
  old_price: number | null;
  new_price: number | null;
  changed_at: string;
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
  original_list_price: number | null;
  listing_date: string | null;
  hero_image_url: string | null;
  is_coming_soon: boolean | null;
  agent_name: string | null;
  office_id: string | null;
  updated_at: string;
  status_changed_at: string;
  buyer_agent_name: string | null;
  alliance_role: string;
}

function coerceAllianceRole(value: string | null | undefined): AllianceRole {
  if (value === "buyer" || value === "both") return value;
  return "listing";
}

export async function getPriceChanges(
  opts: GetPriceChangesOptions = {},
): Promise<PriceChangeMilestone[]> {
  const supabase = createAdminClient();
  const limit = opts.limit ?? 25;

  // Resolve the office filter first so a bad short_code short-circuits.
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

  // listing_price_changes isn't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  // Overfetch: one property can have several reductions and we collapse to the
  // latest per property below.
  const { data: changeRows, error: changeErr } = await untyped
    .from("listing_price_changes")
    .select("property_id, mls_number, old_price, new_price, changed_at")
    .gte("changed_at", MILESTONE_FLOOR_ISO)
    .order("changed_at", { ascending: false })
    .limit(limit * 10);

  if (changeErr) {
    console.error("getPriceChanges: listing_price_changes error", changeErr);
    return [];
  }

  const rows = (changeRows ?? []) as PriceChangeRow[];
  // Reductions only. An increase is not a "price change" for marketing.
  const reductions = rows.filter(
    (r) =>
      r.old_price !== null &&
      r.new_price !== null &&
      Number(r.new_price) < Number(r.old_price),
  );
  if (reductions.length === 0) return [];

  // Collapse to the most recent reduction per property, counting the rest.
  const latestByProperty = new Map<string, PriceChangeRow>();
  const countByProperty = new Map<string, number>();
  for (const r of reductions) {
    countByProperty.set(
      r.property_id,
      (countByProperty.get(r.property_id) ?? 0) + 1,
    );
    // rows arrive newest-first, so the first one we see per property wins
    if (!latestByProperty.has(r.property_id)) {
      latestByProperty.set(r.property_id, r);
    }
  }

  const propertyIds = Array.from(latestByProperty.keys());
  let propQuery = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, list_price, original_list_price, listing_date, hero_image_url, is_coming_soon, agent_name, office_id, updated_at, status_changed_at, buyer_agent_name, alliance_role",
    )
    .in("id", propertyIds)
    // A reduction only matters while the listing is still on the market.
    .eq("status", "active");
  if (officeFilterId) propQuery = propQuery.eq("office_id", officeFilterId);

  const { data: propRows, error: propErr } = await propQuery;
  if (propErr) {
    console.error("getPriceChanges: properties error", propErr);
    return [];
  }
  const properties = (propRows ?? []) as unknown as DbPropertyRow[];
  if (properties.length === 0) return [];

  // Office labels.
  const officeIds = Array.from(
    new Set(properties.map((p) => p.office_id).filter((x): x is string => !!x)),
  );
  const officeShortByID = new Map<string, string>();
  if (officeIds.length > 0) {
    const { data: officeRows } = await supabase
      .from("offices")
      .select("id, short_code")
      .in("id", officeIds);
    for (const o of (officeRows ?? []) as Array<{
      id: string;
      short_code: string;
    }>) {
      officeShortByID.set(o.id, o.short_code);
    }
  }

  const [manualMarks, autoPosted, noteStates, skips] = await Promise.all([
    getListingPostMarks(
      properties.map((p) => p.mls_number),
      "price_reduction",
    ),
    getAutoPostedMarks(
      properties.map((p) => p.id),
      "price_reduction",
    ),
    getListingNoteStates(properties.map((p) => p.mls_number)),
    getListingSkipMarks(
      properties.map((p) => p.mls_number),
      "price_reduction",
    ),
  ]);

  const out: PriceChangeMilestone[] = properties.map((p) => {
    const change = latestByProperty.get(p.id)!;
    const oldPrice = change.old_price === null ? null : Number(change.old_price);
    const newPrice = change.new_price === null ? null : Number(change.new_price);
    const drop =
      oldPrice !== null && newPrice !== null ? oldPrice - newPrice : null;
    const dropPct =
      drop !== null && oldPrice !== null && oldPrice > 0
        ? Math.round((drop / oldPrice) * 1000) / 10
        : null;
    const autoMark = autoPosted.get(p.id) ?? null;
    const autoDetected = autoMark !== null;
    const manualMark = manualMarks.get(p.mls_number) ?? null;
    const markedAt = manualMark?.marked_at ?? null;

    return {
      id: p.id,
      mls_number: p.mls_number,
      source_mls: (p.source_mls as SourceMls) ?? null,
      status: p.status,
      address: p.address,
      city: p.city,
      state: p.state,
      list_price: p.list_price === null ? null : Number(p.list_price),
      display_price: newPrice ?? (p.list_price === null ? null : Number(p.list_price)),
      reference_date: change.changed_at,
      reference_date_kind: "updated_at",
      hero_image_url: p.hero_image_url,
      is_coming_soon: p.is_coming_soon === true,
      agent_name: p.agent_name,
      office_short_code: p.office_id
        ? officeShortByID.get(p.office_id) ?? null
        : null,
      buyer_agent_name: p.buyer_agent_name,
      alliance_role: coerceAllianceRole(p.alliance_role),
      first_seen_at: change.changed_at,
      post_made: autoDetected || markedAt !== null,
      post_auto_detected: autoDetected,
      post_marked_at: markedAt,
      post_posted_at: autoMark?.posted_at ?? null,
      post_posted_by: autoMark?.posted_by_name ?? null,
      post_created_by: autoMark?.created_by_name ?? null,
      post_marked_by: manualMark?.marked_by_name ?? null,
      notes: noteStates.get(p.mls_number) ?? EMPTY_NOTE_STATE,
      skipped_at: skips.get(p.mls_number)?.skipped_at ?? null,
      skip_reason: skips.get(p.mls_number)?.reason ?? null,
      previous_price: oldPrice,
      new_price: newPrice,
      original_list_price:
        p.original_list_price === null ? null : Number(p.original_list_price),
      drop_amount: drop,
      drop_percent: dropPct,
      reduction_count: countByProperty.get(p.id) ?? 1,
    };
  });

  // 2026-08-07 — the shared rule replaces the plain newest-first sort + cap:
  // handled rows (posted or skipped) drop off after 7 days, unhandled rows
  // persist and sort to the top. See lib/dashboard-window.ts.
  return applyMilestoneWindow(out, limit);
}
