import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side helper for the Post Builder photo picker.
 *
 * Reads from the `listing_photos` table populated by the mls-rets-sync
 * edge function. One row per (mls_number, sequence). Sequence is 1-based,
 * with sequence=1 being the hero photo.
 *
 * Returns a stable, sequence-ordered array. Empty when sync hasn't yet
 * populated photos for this listing (e.g. brand-new listing or backfill
 * still running) — caller should fall back to the listing's hero_image_url.
 */

export interface ListingPhoto {
  url: string;
  sequence: number;
  source: "paragon" | "storage";
  caption: string | null;
}

export async function readListingPhotos(mls_number: string): Promise<ListingPhoto[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("listing_photos")
    .select("url, sequence, source, caption")
    .eq("mls_number", mls_number)
    .order("sequence", { ascending: true });
  if (error) {
    console.error("[post-builder/photos] read error:", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    url: r.url,
    sequence: r.sequence,
    source: (r.source === "storage" ? "storage" : "paragon") as "paragon" | "storage",
    caption: r.caption,
  }));
}
