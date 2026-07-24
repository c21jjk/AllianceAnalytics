import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import type { PostType } from "@/lib/post-builder/types";

export const dynamic = "force-dynamic";

/**
 * Mobile quick-create — listings feed.
 *
 * GET /api/mobile/listings?post_type=just_listed
 *
 * Thin authenticated wrapper around fetchListingsForPostBuilder (the same
 * server fetcher the desktop Post Builder page uses) so the mobile client
 * can swap post types without a full page load. Returns the
 * PostBuilderListingWithOH shape untouched — the client passes listings
 * straight through to the caption + render endpoints, which expect it.
 */

const VALID_POST_TYPES: readonly PostType[] = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
];

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const postTypeRaw = url.searchParams.get("post_type") ?? "just_listed";
  const post_type = VALID_POST_TYPES.find((t) => t === postTypeRaw);
  if (!post_type) {
    return NextResponse.json(
      { ok: false, error: `invalid post_type: ${postTypeRaw}` },
      { status: 400 },
    );
  }

  try {
    const listings = await fetchListingsForPostBuilder({ post_type });
    return NextResponse.json({ ok: true, listings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mobile/listings] fetch failed:", message);
    return NextResponse.json(
      { ok: false, error: "failed to load listings" },
      { status: 500 },
    );
  }
}
