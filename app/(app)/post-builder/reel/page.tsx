import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import PageHeader from "@/components/PageHeader";
import ReelStudioClient from "./ReelStudioClient";

export const metadata = { title: "Reel Studio — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Reel Studio — native 7-second-Reel composition workspace.
 *
 * Server component. Gates on auth, pre-fetches eligible active listings,
 * then hands off to the client component. Mirrors the multi-OH page shape
 * (server-fetch → client-workspace) so the route lifecycle matches the
 * rest of post-builder.
 *
 * Reels are typically composed for ACTIVE listings (the agent wants to
 * generate buzz around a property that's on the market). We pass
 * `post_type: "just_listed"` to the fetcher because that's the variant
 * whose eligibility filter ("active + recent listing_date") most closely
 * matches the population of listings a Reel would target. Day 7+ we can
 * widen this to also surface "open_house" and "price_reduction" if Larissa
 * wants Reels for those flows.
 */
interface ReelPageSearchParams {
  /** Optional pre-selected listing MLS number (deep-link from a listing card). */
  mls?: string;
}

export default async function ReelStudioPage({
  searchParams,
}: {
  // why: Next.js 15 made searchParams a Promise. Multi-OH uses the same shape.
  searchParams?: Promise<ReelPageSearchParams>;
}) {
  await requireUser();

  const params = (await searchParams) ?? {};
  const preSelectedMls =
    typeof params.mls === "string" && params.mls.trim().length > 0
      ? params.mls.trim()
      : null;

  // why: same fetcher Post Builder uses for active inventory. Returns
  // status='active' listings with a hero photo — the minimum a Reel needs.
  const listings = await fetchListingsForPostBuilder({ post_type: "just_listed" });

  return (
    <div>
      <PageHeader
        eyebrow="Native 7-second Reel composer"
        title="Reel Studio"
        description="Compose a vertical 9:16 Reel from this listing's hero design plus its photos. Pick a listing, tune motion + transitions, then ship to IG / FB Reels."
        phaseTag="Phase 6 · Day 3"
      />
      <ReelStudioClient listings={listings} preSelectedMls={preSelectedMls} />
    </div>
  );
}
