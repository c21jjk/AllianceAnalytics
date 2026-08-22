import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchListingsForPostBuilder } from "./listings";
import type { PostBuilderListingWithOH } from "./listing-html-utils";
import type { RoundupType } from "./types";
import { MILESTONE_FLOOR_ISO, ROLLING_WINDOW_DAYS } from "@/lib/dashboard-window";
import {
  getAutoPostedPropertyIds,
  getListingPostMarks,
} from "@/lib/data/listing-post-marks";
import { getListingSkipMarks } from "@/lib/data/listing-skip-marks";

/**
 * 2026-08-19 — data layer for the weekly milestone roundups (John:
 * company-wide multi-property posts for Under Contract + Price Reduced,
 * replacing per-property singles for those two milestones).
 *
 * The roundup wizard needs two things the standard Post Builder listing
 * fetcher doesn't provide:
 *
 *   1. The eligible occurrences. "New under contracts" = status='pending'
 *      with a recent status_changed_at; "new price reductions" = a
 *      listing_price_changes row (new < old) on a still-active listing.
 *
 *      2026-08-22 (John) — "8 are showing in the list, but when I click
 *      to build the carousel only 6 show up." The picker used a strict
 *      7-day window while the dashboard cards keep UNHANDLED rows visible
 *      until someone acts on them (the 8/07 worklist rule) — so a listing
 *      the dashboard said still needed a post could be unreachable from
 *      the only tool that can post it. The picker now follows the SAME
 *      rule as the cards: everything inside the rolling window, PLUS any
 *      older occurrence since the Aug 1 floor that is neither posted
 *      (published post of this type, or a manual dashboard tick) nor
 *      skipped. Handled rows still age out after 7 days.
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
   * True when the property already reads as posted for this milestone: a
   * PUBLISHED post of this type covers it (anchor or linked_property_ids),
   * or someone ticked the dashboard's Posted checkbox. The picker shows
   * these unticked with a "posted" tag instead of pre-selecting them.
   */
  already_posted: boolean;
  /**
   * 2026-08-22 — true when the occurrence falls inside the rolling window
   * ("this week"). Drives pre-selection: the wizard pre-ticks only the
   * week's unposted rows; the older unposted backlog is offered unticked.
   */
  in_window: boolean;
}

export interface RoundupListingsResult {
  /** Eligible listings, most recent occurrence first. */
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

/**
 * Handled-state lookups for a candidate set, mirroring the dashboard
 * cards: published post of the milestone type (anchor or linked), manual
 * Posted tick, per-milestone skip. Three batched round trips.
 */
async function fetchHandledState(
  kind: Exclude<RoundupType, "open_house">,
  listings: readonly PostBuilderListingWithOH[],
): Promise<{
  isPosted: (l: PostBuilderListingWithOH) => boolean;
  isSkipped: (l: PostBuilderListingWithOH) => boolean;
}> {
  const [autoPosted, manualMarks, skips] = await Promise.all([
    getAutoPostedPropertyIds(
      listings.map((l) => l.id),
      kind,
    ).catch((e) => {
      console.error("[roundup-listings] posted lookup failed:", e);
      return new Set<string>();
    }),
    getListingPostMarks(
      listings.map((l) => l.mls_number),
      kind,
    ).catch((e) => {
      console.error("[roundup-listings] manual mark lookup failed:", e);
      return new Map<string, { marked_at: string; marked_by_name: string | null }>();
    }),
    getListingSkipMarks(
      listings.map((l) => l.mls_number),
      kind,
    ).catch((e) => {
      console.error("[roundup-listings] skip lookup failed:", e);
      return new Map<string, { skipped_at: string; reason: string | null }>();
    }),
  ]);
  return {
    isPosted: (l) => autoPosted.has(l.id) || manualMarks.has(l.mls_number),
    isSkipped: (l) => skips.has(l.mls_number),
  };
}

async function fetchUnderContractRoundup(
  cutoffIso: string,
): Promise<RoundupListingsResult> {
  // Base pool: the same pending-status bucket the Post Builder used for
  // single UC posts (hero photo required, office meta attached).
  // limit 500 (default is 200): the eligible rows must never fall off the
  // pool bottom just because company-wide pending inventory grew.
  const pool = await fetchListingsForPostBuilder({
    post_type: "under_contract",
    limit: 500,
  });
  if (pool.length === 0) return { listings: [], metaByMls: {} };

  // status_changed_at isn't on the shared listing shape — one batched
  // lookup for the pool.
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
  const floorMs = Date.parse(MILESTONE_FLOOR_ISO);
  // Candidates: everything that flipped to pending since the Aug 1 floor.
  // The floor mirrors the dashboard card; without it, "unhandled rows stay"
  // would drag every pre-slate pending listing into the picker.
  const candidates = pool.filter((l) => {
    const changed = changedAtByMls.get(l.mls_number);
    if (typeof changed !== "string") return false;
    const t = Date.parse(changed);
    return Number.isFinite(t) && t >= floorMs;
  });
  if (candidates.length === 0) return { listings: [], metaByMls: {} };

  const handled = await fetchHandledState("under_contract", candidates);
  const listings = candidates.filter((l) => {
    const t = Date.parse(changedAtByMls.get(l.mls_number) ?? "");
    const inWindow = Number.isFinite(t) && t >= cutoffMs;
    // The dashboard rule: inside the window, or not yet handled.
    return inWindow || (!handled.isPosted(l) && !handled.isSkipped(l));
  });
  // Pool order is already status_changed_at DESC (see listings.ts), so
  // "most recent first" holds without a re-sort — the week's rows lead and
  // the older unposted backlog trails.

  const metaByMls: Record<string, RoundupPropertyMeta> = {};
  for (const l of listings) {
    const changed = changedAtByMls.get(l.mls_number) ?? null;
    const t = changed ? Date.parse(changed) : NaN;
    metaByMls[l.mls_number] = {
      event_date: changed,
      price_old: null,
      price_new: null,
      already_posted: handled.isPosted(l),
      in_window: Number.isFinite(t) && t >= cutoffMs,
    };
  }
  return { listings, metaByMls };
}

async function fetchPriceReductionRoundup(
  cutoffIso: string,
): Promise<RoundupListingsResult> {
  // Reductions since the Aug 1 floor, from the dated history table the DB
  // trigger maintains (same source as the dashboard's Price Reduced card —
  // see lib/data/price-changes.ts for why original_list_price comparison
  // was rejected). Latest cut per property wins; the 7-day window is
  // applied later as the in_window flag, not as a fetch bound, so an older
  // unposted cut stays reachable (2026-08-22, see header note).
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;
  const { data, error } = await untyped
    .from("listing_price_changes")
    .select("mls_number, old_price, new_price, changed_at")
    .gte("changed_at", MILESTONE_FLOOR_ISO)
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
  // attached) and keep only properties with a recorded reduction.
  // limit 500 (default 200): price cuts skew toward OLDER listings, which
  // sort to the bottom of the pool's listing_date DESC ordering — a 200
  // cap could silently drop a real reduction once active inventory grows.
  const pool = await fetchListingsForPostBuilder({
    post_type: "price_reduction",
    limit: 500,
  });
  const candidates = pool.filter((l) => latestByMls.has(l.mls_number));
  if (candidates.length === 0) return { listings: [], metaByMls: {} };

  const cutoffMs = Date.parse(cutoffIso);
  const handled = await fetchHandledState("price_reduction", candidates);
  const listings = candidates
    .filter((l) => {
      const t = Date.parse(latestByMls.get(l.mls_number)?.changed_at ?? "");
      const inWindow = Number.isFinite(t) && t >= cutoffMs;
      return inWindow || (!handled.isPosted(l) && !handled.isSkipped(l));
    })
    .sort((a, b) => {
      const at = latestByMls.get(a.mls_number)?.changed_at ?? "";
      const bt = latestByMls.get(b.mls_number)?.changed_at ?? "";
      return bt.localeCompare(at); // most recent cut first
    });

  const metaByMls: Record<string, RoundupPropertyMeta> = {};
  for (const l of listings) {
    const change = latestByMls.get(l.mls_number);
    const t = change ? Date.parse(change.changed_at) : NaN;
    metaByMls[l.mls_number] = {
      event_date: change?.changed_at ?? null,
      price_old: change?.old_price ?? null,
      price_new: change?.new_price ?? null,
      already_posted: handled.isPosted(l),
      in_window: Number.isFinite(t) && t >= cutoffMs,
    };
  }
  return { listings, metaByMls };
}
