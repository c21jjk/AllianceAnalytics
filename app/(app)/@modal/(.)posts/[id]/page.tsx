import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { fetchGroupDetailBundleForPost } from "@/lib/data/post-detail";
import { fetchPortalStrip } from "@/lib/data/portal-metrics-db";
import { createAdminClient } from "@/lib/supabase/admin";
import DetailDrawer from "@/components/DetailDrawer";
import GroupDetailBody from "@/components/GroupDetailBody";
import PortalMetricsStrip from "@/components/portal-metrics/PortalMetricsStrip";

/**
 * Intercepting route for the @modal parallel slot.
 *
 * The "(.)" segment matches sibling routes — when the user clicks a Link to
 * `/posts/[id]` from anywhere in (app), this renders into the @modal slot
 * (drawer overlay) while the underlying page stays mounted.
 *
 * On hard navigation (refresh, paste-link, direct hit), this file is NOT
 * used — the standalone `app/(app)/posts/[id]/page.tsx` renders the full
 * page instead. Both routes share <GroupDetailBody /> so the UI is identical
 * either way.
 *
 * Note: the drawer intentionally does NOT expose a "View full page" link
 * anymore. Everything the user needs lives inline in this body.
 */
interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InterceptedPostDetailPage({ params }: PageProps) {
  await requireUser();
  const { id } = await params;
  const bundle = await fetchGroupDetailBundleForPost(id);
  if (!bundle) notFound();

  const platformCount = bundle.group.postings.length;
  const subtitle =
    platformCount > 1
      ? `Merged across ${platformCount} platforms`
      : "Single-platform post";

  // Mirror the standalone page: fetch portal strip when the post is linked
  // to an Alliance-feed property. Non-fatal on failure.
  let portalStripData = null;
  if (bundle.group.property?.mls) {
    const admin = createAdminClient();
    const { data: propRow } = await admin
      .from("properties")
      .select("source_mls, listing_date")
      .eq("mls_number", bundle.group.property.mls)
      .maybeSingle();
    if (
      propRow &&
      (propRow.source_mls === "cmc" || propRow.source_mls === "sjsr")
    ) {
      try {
        portalStripData = await fetchPortalStrip(
          bundle.group.property.mls,
          propRow.source_mls,
          { since: propRow.listing_date ?? undefined },
        );
      } catch (e) {
        console.warn("portal strip fetch failed:", (e as Error).message);
      }
    }
  }

  return (
    <DetailDrawer title="Post detail" subtitle={subtitle}>
      {portalStripData?.has_data ? (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-white shadow-card p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Portal traffic since listing
            </h3>
            <span className="text-[10px] text-neutral-500 tabular-nums">
              {portalStripData.total_views.toLocaleString()} views ·{" "}
              {portalStripData.window_days}d
            </span>
          </div>
          <PortalMetricsStrip strip={portalStripData} variant="card" />
        </div>
      ) : null}
      <GroupDetailBody
        group={bundle.group}
        posts={bundle.posts}
        offices={bundle.offices}
        initialOfficeId={bundle.initialOfficeId}
        listingAgent={bundle.listingAgent}
        combinedDaily={bundle.combinedDaily}
        combinedAudience={bundle.combinedAudience}
        primaryPostId={id}
      />
    </DetailDrawer>
  );
}
