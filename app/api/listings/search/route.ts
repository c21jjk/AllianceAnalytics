import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { searchListings } from "@/lib/listings";

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
    const rows = await searchListings(q, { limit: 8 });
    const results = rows.map((r) => ({
      mls_number: r.mls_number,
      address: r.address,
      city: r.city,
      state: r.state,
      list_price: r.list_price,
      status: r.status,
      hero_image_url: r.hero_image_url,
    }));
    return NextResponse.json({ results });
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
