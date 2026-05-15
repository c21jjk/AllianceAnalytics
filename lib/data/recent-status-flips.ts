import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "Wins to celebrate" — Phase 6 dashboard fetcher.
 *
 * Returns listings whose status flipped to `pending` (under contract) or
 * `sold` within the last N days. Ordered by status_changed_at DESC so the
 * freshest wins float to the top.
 *
 * Distinct from `getUnderContractListings` (which returns ALL pending
 * inventory) and `getRecentlySoldListings` (which keys off close_date):
 * this one keys off the *transition timestamp*, which is the right cut
 * for "did we celebrate this recently?" prompts.
 *
 * Powers the wins card + the post-publish status-flip notification flow
 * in `lib/data/agent-outbox-db.ts` (Phase 6 status-flip notifications).
 */

export type StatusFlipKind = "pending" | "sold";

export interface RecentStatusFlip {
  property_id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  list_price: number | null;
  close_price: number | null;
  display_price: number | null;
  status: StatusFlipKind;
  /** ISO timestamp of the most recent status change. */
  status_changed_at: string;
  /** Hours since the flip. Cheap to compute on the fetch and useful for UI. */
  hours_since_flip: number;
  /** Days since the flip, rounded down. */
  days_since_flip: number;
  /** Whether we've already posted a celebration about this flip. */
  has_celebration_post: boolean;
}

interface DbRow {
  id: string;
  mls_number: string;
  address: string | null;
  city: string | null;
  state: string | null;
  hero_image_url: string | null;
  agent_name: string | null;
  list_price: number | null;
  close_price: number | null;
  status: "active" | "pending" | "sold" | "expired";
  status_changed_at: string;
}

export interface RecentStatusFlipsOptions {
  /** Default 3 days. */
  daysBack?: number;
  /** Optional office filter (uses properties.office_id → offices.short_code). */
  office_short_code?: string | null;
  limit?: number;
}

export async function getRecentStatusFlips(
  opts: RecentStatusFlipsOptions = {},
): Promise<RecentStatusFlip[]> {
  const supabase = createAdminClient();
  const daysBack = opts.daysBack ?? 3;
  const limit = opts.limit ?? 25;
  const cutoffIso = new Date(Date.now() - daysBack * 86_400_000).toISOString();

  // Optional office filter — resolve to office_id once so the query can hit
  // an index on properties.office_id instead of a join.
  let officeId: string | null = null;
  if (opts.office_short_code) {
    const { data: off } = await supabase
      .from("offices")
      .select("id")
      .eq("short_code", opts.office_short_code)
      .maybeSingle();
    if (!off) return [];
    officeId = off.id;
  }

  let query = supabase
    .from("properties")
    .select(
      "id, mls_number, address, city, state, hero_image_url, agent_name, list_price, close_price, status, status_changed_at",
    )
    .in("status", ["pending", "sold"])
    .gte("status_changed_at", cutoffIso)
    .order("status_changed_at", { ascending: false })
    .limit(limit);

  if (officeId) query = query.eq("office_id", officeId);

  const { data, error } = await query;
  if (error || !data) return [];

  const propertyIds = (data as DbRow[]).map((r) => r.id);

  // Has-celebration-post check: a generated_post in the just_sold or
  // under_contract post_type for this property in the last `daysBack` window.
  const celebratedBy = new Set<string>();
  if (propertyIds.length > 0) {
    const { data: gpRows } = await supabase
      .from("generated_posts")
      .select("property_id, post_type, posted_at, created_at")
      .in("property_id", propertyIds)
      .in("post_type", ["just_sold", "under_contract"])
      .gte("created_at", cutoffIso);
    for (const g of (gpRows ?? []) as Array<{
      property_id: string | null;
      post_type: string;
    }>) {
      if (g.property_id) celebratedBy.add(g.property_id);
    }
  }

  const now = Date.now();
  return (data as DbRow[]).map((r) => {
    const flippedAt = new Date(r.status_changed_at).getTime();
    const hours = Number.isFinite(flippedAt)
      ? Math.max(0, Math.floor((now - flippedAt) / 3_600_000))
      : 0;
    const days = Math.floor(hours / 24);
    const status = r.status === "sold" ? "sold" : "pending";
    return {
      property_id: r.id,
      mls_number: r.mls_number,
      address: r.address,
      city: r.city,
      state: r.state,
      hero_image_url: r.hero_image_url,
      agent_name: r.agent_name,
      list_price: r.list_price === null ? null : Number(r.list_price),
      close_price: r.close_price === null ? null : Number(r.close_price),
      display_price:
        status === "sold"
          ? r.close_price === null
            ? r.list_price === null
              ? null
              : Number(r.list_price)
            : Number(r.close_price)
          : r.list_price === null
            ? null
            : Number(r.list_price),
      status,
      status_changed_at: r.status_changed_at,
      hours_since_flip: hours,
      days_since_flip: days,
      has_celebration_post: celebratedBy.has(r.id),
    };
  });
}
