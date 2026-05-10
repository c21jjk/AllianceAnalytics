import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fetchGroupDetailBundleForPost } from "@/lib/data/post-detail";
import GroupDetailBody from "@/components/GroupDetailBody";
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
