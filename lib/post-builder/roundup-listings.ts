import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchListingsForPostBuilder } from "./listings";
import type { PostBuilderListingWithOH } from "./listing-html-utils";
import type { RoundupType } from "./types";
import { ROLLING_WINDOW_DAYS } from "@/lib/dashboard-window";
import { getAutoPostedPropertyIds } from "@/lib/data/listing-post-marks";

/**
 * 2026-08-19 — data layer for the weekly milestone roundups (John:
 * company-wide multi-property posts for Under Contract + Price Reduced,
 * replacing per-property singles for those two milestones).
 *
 * The roundup wizard needs two things the standard Post Builder listing
 * fetcher doesn't provide:
 *
 *   1. The WEEK'S occurrences, not the whole eligible pool. "New under
 *      contracts" = status='pending' with status_changed_at inside the
 *      dashboard's rolling window; "new price reductions" = a
 *      listing_price_changes row (new < old) inside the same window on a
 *      still-active listing. Both share the dashboard's
 *      ROLLING_WINDOW_DAYS so the wizard and the dashboard cards agree
 *      about what "this week" means.
 *
 *   2. Per-property milestone metadata for the hero card + captions: the
 *      occurrence date, and for reductions the old/new price pair. The
 *      shared PostBuilderListing shape deliberately doesn't carry these
 *      (dozens of consumers would inherit dead fields), so they ride in a
 *      side map keyed by mls_number.
 */

export interface RoundupPropertyMeta {
  /** ISO timestamp of the milestone occurrence (status change / price cut). */
  event_date: string | null;
  /** price_reduction only — price before the cut. */
  price_old: number | null;
  /** price_reduction only — price after the cut. */
  price_new: number | null;
  /**
   * True when a PUBLISHED post of this milestone type already covers the
   * property (anchor or linked_property_ids). The picker shows these
   * unticked with a "posted" tag instead of pre-selecting them.
   */
  already_posted: boolean;
}

export interface RoundupListingsResult {
  /** Week's eligible listings, most recent occurrence first. */
  listings: PostBuilderListingWithOH[];
  /** Milestone metadata per listing, keyed by mls_number. */
  metaByMls: Record<string, RoundupPropertyMeta>;
}

const WINDOW_MS = ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export async function fetchRoundupListings(
  kind: Exclude<RoundupType, "open_house">,
): Promise<RoundupListingsResult> {
  const cutoffIso = new Date(Date.now() - WINDOW_MS).toISOString();
  return kind === "under_contract"
    ? fetchUnderContractRoundup(cutoffIso)
    : fetchPriceReductionRoundup(cutoffIso);
}

async function fetchUnderContractRoundup(
  cutoffIso: string,
): Promise<RoundupListingsResult> {
  // Base pool: the same pending-status bucket the Post Builder used for
  // single UC posts (hero photo required, office meta attached).
  // limit 500 (default is 200): the week's rows must never fall off the
  // pool bottom just because company-wide pending inventory grew.
  const pool = await fetchListingsForPostBuilder({
    post_type: "under_contract",
    limit: 500,
  });
  if (pool.length === 0) return { listings: [], metaByMls: {} };

  // status_changed_at isn't on the shared listing shape — one batched
  // lookup for the pool, then filter to the rolling window.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("properties")
    .select("mls_number, status_changed_at")
    .in(
      "mls_number",
      pool.map((l) => l.mls_number),
    );
  if (error) {
    console.error(
      "[roundup-listings] status_changed_at lookup failed:",
      error.message,
    );
    return { listings: [], metaByMls: {} };
  }
  const changedAtByMls = new Map<string, string | null>();
  for (const row of (data ?? []) as Array<{
    mls_number: string;
    status_changed_at: string | null;
  }>) {
    changedAtByMls.set(row.mls_number, row.status_changed_at);
  }

  // why Date.parse instead of ISO string compare: Postgres timestamps can
  // serialize with "+00:00" while our cutoff uses "Z" — lexicographic
  // comparison breaks on the suffix for same-second values.
  const cutoffMs = Date.parse(cutoffIso);
  const listings = pool.filter((l) => {
    const changed = changedAtByMls.get(l.mls_number);
    if (typeof changed !== "string") return false;
    const t = Date.parse(changed);
    return Number.isFinite(t) && t >= cutoffMs;
  });
  // Pool order is already status_changed_at DESC (see listings.ts), so
  // "most recent first" holds without a re-sort.

  const metaByMls = await buildMeta(
    "under_contract",
    listings,
    (mls) => ({
      event_date: changedAtByMls.get(mls) ?? null,
      price_old: null,
      price_new: null,
    }),
  );
  return { listings, metaByMls };
}

async function fetchPriceReductionRoundup(
  cutoffIso: string,
): Promise<RoundupListingsResult> {
  // The week's reductions, from the dated history table the DB trigger
  // maintains (same source as the dashboard's Price Reduced card — see
  // lib/data/price-changes.ts for why original_list_price comparison was
  // rejected). Latest cut per property wins.
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;
  const { data, error } = await untyped
    .from("listing_price_changes")
    .select("mls_number, old_price, new_price, changed_at")
    .gte("changed_at", cutoffIso)
    .order("changed_at", { ascending: false });
  if (error) {
    console.error(
      "[roundup-listings] price change lookup failed:",
      error.message,
    );
    return { listings: [], metaByMls: {} };
  }
  const latestByMls = new Map<
    string,
    { old_price: number | null; new_price: number | null; changed_at: string }
  >();
  for (const row of (data ?? []) as Array<{
    mls_number: string | null;
    old_price: number | null;
    new_price: number | null;
    changed_at: string;
  }>) {
    if (!row.mls_number) continue;
    // Reductions only — the trigger records every change, increases
    // included.
    if (
      typeof row.old_price !== "number" ||
      typeof row.new_price !== "number" ||
      row.new_price >= row.old_price
    ) {
      continue;
    }
    // Rows arrive newest-first; the first hit per property is the latest.
    if (!latestByMls.has(row.mls_number)) {
      latestByMls.set(row.mls_number, {
        old_price: row.old_price,
        new_price: row.new_price,
        changed_at: row.changed_at,
      });
    }
  }
  if (latestByMls.size === 0) return { listings: [], metaByMls: {} };

  // Join to the active-listing pool (hero photo required, office meta
  // attached) and keep only properties with a reduction this week.
  // limit 500 (default 200): price cuts skew toward OLDER listings, which
  // sort to the bottom of the pool's listing_date DESC ordering — a 200
  // cap could silently drop a real reduction once active inventory grows.
  const pool = await fetchListingsForPostBuilder({
    post_type: "price_reduction",
    limit: 500,
  });
  const listings = pool
    .filter((l) => latestByMls.has(l.mls_number))
    .sort((a, b) => {
      const at = latestByMls.get(a.mls_number)?.changed_at ?? "";
      const bt = latestByMls.get(b.mls_number)?.changed_at ?? "";
      return bt.localeCompare(at); // most recent cut first
    });

  const metaByMls = await buildMeta("price_reduction", listings, (mls) => {
    const change = latestByMls.get(mls);
    return {
      event_date: change?.changed_at ?? null,
      price_old: change?.old_price ?? null,
      price_new: change?.new_price ?? null,
    };
  });
  return { listings, metaByMls };
}

/** Attach the already_posted flag (published post of this milestone type
 *  covering the property, anchor or linked) to each listing's meta. */
async function buildMeta(
  kind: Exclude<RoundupType, "open_house">,
  listings: PostBuilderListingWithOH[],
  baseFor: (mls: string) => Omit<RoundupPropertyMeta, "already_posted">,
): Promise<Record<string, RoundupPropertyMeta>> {
  const postedIds = await getAutoPostedPropertyIds(
    listings.map((l) => l.id),
    kind,
  ).catch((e) => {
    console.error("[roundup-listings] posted lookup failed:", e);
    return new Set<string>();
  });
  const out: Record<string, RoundupPropertyMeta> = {};
  for (const l of listings) {
    out[l.mls_number] = {
      ...baseFor(l.mls_number),
      already_posted: postedIds.has(l.id),
    };
  }
  return out;
}
