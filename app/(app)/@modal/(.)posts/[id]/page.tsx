import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { fetchGroupDetailBundleForPost } from "@/lib/data/post-detail";
import DetailDrawer from "@/components/DetailDrawer";
import GroupDetailBody from "@/components/GroupDetailBody";

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

  return (
    <DetailDrawer title="Post detail" subtitle={subtitle}>
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
