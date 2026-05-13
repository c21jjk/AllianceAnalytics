/**
 * GET /api/post-builder/photos?mls=261231
 *
 * Returns the full photo set for a listing, ordered by Paragon sequence.
 * Reads from the `listing_photos` table populated by the mls-rets-sync
 * edge function (Phase 11).
 *
 * Auth: requires a signed-in Alliance user.
 *
 * Caching: in-memory Map keyed by mls_number, 5-min TTL. Photos rarely
 * change between syncs and the picker UI calls this on every listing
 * selection — caching kills the per-pick DB roundtrip.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { readListingPhotos, type ListingPhoto } from "@/lib/post-builder/photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CacheEntry {
  photos: ListingPhoto[];
  expires: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function readCache(mls: string): ListingPhoto[] | null {
  const hit = cache.get(mls);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(mls);
    return null;
  }
  return hit.photos;
}

function writeCache(mls: string, photos: ListingPhoto[]) {
  cache.set(mls, { photos, expires: Date.now() + CACHE_TTL_MS });
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const mls = (url.searchParams.get("mls") ?? "").trim();
  if (!mls) {
    return NextResponse.json(
      { ok: false, error: "mls query param required" },
      { status: 400 },
    );
  }

  const cached = readCache(mls);
  if (cached) {
    return NextResponse.json({ ok: true, photos: cached, cached: true });
  }

  const photos = await readListingPhotos(mls);
  writeCache(mls, photos);
  return NextResponse.json({ ok: true, photos, cached: false });
}
