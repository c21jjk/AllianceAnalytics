import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fetchGroupDetailBundleForPost } from "@/lib/data/post-detail";
import { fetchPortalStrip } from "@/lib/data/portal-metrics-db";
import { createAdminClient } from "@/lib/supabase/admin";
import GroupDetailBody from "@/components/GroupDetailBody";
import PortalMetricsStrip from "@/components/portal-metrics/PortalMetricsStrip";
import { platformLabel } from "@/components/PlatformBadge";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const bundle = await fetchGroupDetailBundleForPost(id);
  if (!bundle) return { title: "Post — Alliance Social" };
  const platforms = bundle.group.postings.map((p) => platformLabel(p.platform));
  const platformLine =
    platforms.length > 1
      ? `${platforms.join(" + ")} campaign`
      : `${platforms[0] ?? "Post"}`;
  return {
    title: `${platformLine} — Alliance Social`,
  };
}

/**
 * Standalone full page for /posts/[id]. Shares its body with the drawer
 * overlay (`@modal/(.)posts/[id]`), so refreshing the URL renders the
 * exact same campaign view — no information is hidden behind drawer chrome.
 */
export default async function PostDetailPage({ params }: PageProps) {
  await requireUser();
  const { id } = await params;
  const bundle = await fetchGroupDetailBundleForPost(id);
  if (!bundle) notFound();

  const platformCount = bundle.group.postings.length;

  // Resolve the property's source_mls + listing_date so we can show the
  // 5-portal strip ("portal traffic during this listing's life"). Per the
  // ListTrac integration this comes from the AllianceAnalytics properties
  // table — falls through to no strip when the post isn't linked to a
  // property we synced from RETS.
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
        // Non-fatal — strip is purely supplemental. Surface in server logs
        // and continue rendering the post detail.
        console.warn("portal strip fetch failed:", (e as Error).message);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2 text-neutral-500">
          <Link href="/" className="hover:text-neutral-800">
            Dashboard
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-neutral-700 truncate max-w-xs">
            {platformCount > 1
              ? `Merged campaign (${platformCount} platforms)`
              : "Post detail"}
          </span>
        </div>
      </div>

      {/* Portal traffic for the linked listing — shown above the post body
          so reviewers can quickly see the broader exposure context. Hidden
          when no property is linked or no portal data is available. */}
      {portalStripData?.has_data ? (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-card p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Portal traffic since this listing went live
            </h3>
            <span className="text-[11px] text-neutral-500 tabular-nums">
              {portalStripData.total_views.toLocaleString()} total views ·{" "}
              {portalStripData.window_days}d
            </span>
          </div>
          <PortalMetricsStrip strip={portalStripData} variant="card" />
        </div>
      ) : null}

      <div className="rounded-2xl border border-neutral-200 bg-white shadow-card">
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
      </div>
    </div>
  );
}
