import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PostBuilderListing, PostType } from "./types";
import type { PostBuilderListingWithOH } from "./templates/primitives/_shared";

/**
 * Status-aware listing fetcher for the Post Builder UI.
 *
 * Each post_type has different "what counts as eligible" logic:
 *   - just_listed     → status='active', recent listing_date (default 60d)
 *   - just_sold       → status='sold', recent close_date (default 60d)
 *   - under_contract  → status='pending'
 *   - open_house      → status='active' AND has open_houses row in next 14d
 *
 * All return the same PostBuilderListingWithOH shape so the UI doesn't
 * need to branch on post_type for rendering.
 *
 * Hero photo is required (no point picking a listing we can't render).
 */

interface FetchOptions {
  post_type: PostType;
  /** How far back to look for listing_date / close_date. Default 60 days. */
  windowDays?: number;
  /** Cap on returned rows. Default 200 — Alliance inventory is well under this. */
  limit?: number;
}

interface PropertyRow {
  id: string;
  mls_number: string;
  source_mls: string | null;
  status: "active" | "pending" | "sold" | "expired";
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  close_price: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  property_type: string | null;
  public_remarks: string | null;
  hero_image_url: string | null;
  listing_office_name: string | null;
  agent_name: string | null;
  listing_date: string | null;
  close_date: string | null;
}

export async function fetchListingsForPostBuilder(
  opts: FetchOptions,
): Promise<PostBuilderListingWithOH[]> {
  const supabase = createAdminClient();
  const windowDays = opts.windowDays ?? 60;
  const limit = opts.limit ?? 200;

  // Build base query — same field set for all post types.
  let q = supabase
    .from("properties")
    .select(
      "id, mls_number, source_mls, status, address, city, state, zip, list_price, close_price, bedrooms, bathrooms_full, bathrooms_half, property_type, public_remarks, hero_image_url, listing_office_name, agent_name, listing_date, close_date",
    )
    .not("hero_image_url", "is", null)
    .limit(limit);

  switch (opts.post_type) {
    case "just_listed": {
      const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      q = q
        .eq("status", "active")
        .gte("listing_date", cutoff)
        .order("listing_date", { ascending: false });
      break;
    }
    case "just_sold": {
      const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      q = q
        .eq("status", "sold")
        .gte("close_date", cutoff)
        .order("close_date", { ascending: false });
      break;
    }
    case "under_contract": {
      q = q.eq("status", "pending").order("status_changed_at", { ascending: false });
      break;
    }
    case "open_house": {
      q = q.eq("status", "active").order("listing_date", { ascending: false });
      break;
    }
  }

  const { data, error } = await q;
  if (error) {
    console.error("[post-builder/listings] fetch error:", error);
    return [];
  }
  const rows = (data ?? []) as PropertyRow[];

  let listings: PostBuilderListingWithOH[] = rows.map((r) => toListing(r));

  // Open House: filter to listings with an upcoming open_houses row, and
  // attach the soonest one's start_at + end_at.
  if (opts.post_type === "open_house" && listings.length > 0) {
    const mlsNumbers = listings.map((l) => l.mls_number);
    const { data: ohRows, error: ohError } = await supabase
      .from("open_houses")
      .select("mls_number, start_at, end_at")
      .in("mls_number", mlsNumbers)
      .gte("start_at", new Date().toISOString())
      .lte(
        "start_at",
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      )
      .order("start_at", { ascending: true });
    if (ohError) {
      console.error("[post-builder/listings] open_houses fetch error:", ohError);
      return [];
    }
    const nextOhByMls = new Map<string, { start_at: string; end_at: string | null }>();
    for (const oh of ohRows ?? []) {
      if (!nextOhByMls.has(oh.mls_number)) {
        nextOhByMls.set(oh.mls_number, { start_at: oh.start_at, end_at: oh.end_at });
      }
    }
    listings = listings
      .filter((l) => nextOhByMls.has(l.mls_number))
      .map((l) => {
        const oh = nextOhByMls.get(l.mls_number);
        return oh
          ? { ...l, oh_start_at: oh.start_at, oh_end_at: oh.end_at }
          : l;
      });
  }

  return listings;
}

function toListing(r: PropertyRow): PostBuilderListingWithOH {
  return {
    id: r.id,
    mls_number: r.mls_number,
    source_mls: (r.source_mls as PostBuilderListing["source_mls"]) ?? null,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    list_price: r.list_price,
    close_price: r.close_price,
    bedrooms: r.bedrooms,
    bathrooms_full: r.bathrooms_full,
    bathrooms_half: r.bathrooms_half,
    property_type: r.property_type,
    public_remarks: r.public_remarks,
    hero_image_url: r.hero_image_url,
    listing_office_name: r.listing_office_name,
    agent_name: r.agent_name,
    listing_date: r.listing_date,
    status: r.status,
  };
}
