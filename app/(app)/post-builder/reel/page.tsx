import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import { fetchReelResume } from "@/lib/data/created-posts-db";
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
  /**
   * Optional saved-Reel id. When present, the page loads the row's
   * composition_json from `generated_posts` and hands it to ReelStudioClient
   * via `initialResume` — same resume pattern the image canvas-editor uses
   * via `?gp=` on /post-builder. Routes here from Created Posts strip /
   * /saved-posts when the row's media_type === "reel".
   */
  gp?: string;
}

export default async function ReelStudioPage({
  searchParams,
}: {
  // why: Next.js 15 made searchParams a Promise. Multi-OH uses the same shape.
  searchParams?: Promise<ReelPageSearchParams>;
}) {
  const profile = await requireUser();

  const params = (await searchParams) ?? {};
  const preSelectedMls =
    typeof params.mls === "string" && params.mls.trim().length > 0
      ? params.mls.trim()
      : null;
  const gpId =
    typeof params.gp === "string" && params.gp.trim().length > 0
      ? params.gp.trim()
      : null;

  // 2026-08-05 — imported AutoReel reels must NEVER open in Reel Studio.
  // They carry a finished video, not a composition; the Studio would build a
  // fresh native composition from listing photos and its Re-generate could
  // overwrite the imported video (observed in the live test). Hard-redirect
  // to the dedicated review + publish surface instead.
  if (gpId) {
    const { data: gpRow } = await createAdminClient()
      .from("generated_posts")
      .select("template_id")
      .eq("id", gpId)
      .maybeSingle();
    if (
      gpRow &&
      (gpRow as { template_id: string | null }).template_id ===
        "autoreel_import_v1"
    ) {
      redirect(`/post-builder/autoreel-review?gp=${gpId}`);
    }
  }

  // why: when `?gp=<id>` is present, fetch the Reel row server-side so the
  // client lands on a fully-hydrated workspace. Returns null when the row
  // doesn't exist OR belongs to another user OR is an image post (the
  // fetcher gates on media_type === "reel"). In any of those cases the
  // workspace shows the fresh-start listing picker as if `?gp=` weren't set.
  const initialResume = gpId
    ? await fetchReelResume(gpId, profile.id)
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
        phaseTag="Phase 6 · Day 7"
      />
      <ReelStudioClient
        listings={listings}
        preSelectedMls={preSelectedMls}
        initialResume={initialResume}
      />
    </div>
  );
}
