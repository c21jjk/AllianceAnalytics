import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { searchListings } from "@/lib/listings";
import { resolveBuildingMembership } from "@/lib/data/buildings-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/listings/search?q=PARK
 *
 * Lightweight search-as-you-type endpoint for the per-post Classify panel.
 * Auth-gated to signed-in Alliance users (not admin-only — staff agents need
 * to be able to link their own posts to their own listings).
 */
export async function GET(request: Request) {
  await requireUser();
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }
  try {
    // Search the Listings DB, then collapse multi-unit buildings into one
    // master result. We over-fetch (limit*4) because collapsing a building's
    // units into one row shrinks the result count; we re-slice to 8 after.
    const rows = await searchListings(q, { limit: 32 });

    // Resolve building membership for every matched MLS# (Social DB lookup).
    const membership = await resolveBuildingMembership(
      rows.map((r) => r.mls_number),
    );

    type SearchResult = {
      mls_number: string;
      address: string;
      city: string | null;
      state: string | null;
      list_price: number | null;
      status: string;
      hero_image_url: string | null;
      /** Present when this row is a consolidated building (master listing). */
      building_id?: string;
      /** Every member MLS# the link should write. Building rows only. */
      member_mls?: string[];
      /** Unit count for the building badge. Building rows only. */
      unit_count?: number;
    };

    const results: SearchResult[] = [];
    const seenBuildings = new Set<string>();

    for (const r of rows) {
      const m = membership.get(r.mls_number);
      if (!m) {
        // Standalone listing — pass through unchanged.
        results.push({
          mls_number: r.mls_number,
          address: r.address,
          city: r.city,
          state: r.state,
          list_price: r.list_price,
          status: r.status,
          hero_image_url: r.hero_image_url,
        });
        continue;
      }
      // Building member — emit one master row per building, deduped.
      if (seenBuildings.has(m.building_id)) continue;
      seenBuildings.add(m.building_id);
      results.push({
        // The master row's mls_number is the building primary (or this row's
        // MLS as a fallback) so existing single-MLS UI paths still have a key.
        mls_number: m.primary_mls ?? r.mls_number,
        address: m.display_address ?? r.address,
        city: m.display_city ?? r.city,
        state: r.state,
        list_price: r.list_price,
        status: r.status,
        hero_image_url: r.hero_image_url,
        building_id: m.building_id,
        member_mls: m.member_mls,
        unit_count: m.unit_count,
      });
    }

    return NextResponse.json({ results: results.slice(0, 8) });
  } catch (e) {
    return NextResponse.json(
      {
        results: [],
        error: e instanceof Error ? e.message : "search failed",
      },
      { status: 500 },
    );
  }
}
