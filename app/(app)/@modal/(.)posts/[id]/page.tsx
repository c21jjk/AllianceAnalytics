import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { fetchPostDetailBundle } from "@/lib/data/post-detail";
import PostDetailDrawer from "@/components/PostDetailDrawer";
import PostDetailDrawerBody from "@/components/PostDetailDrawerBody";

/**
 * Intercepting route for the @modal parallel slot.
 *
 * The "(.)" segment matches sibling routes — when the user clicks a Link to
 * `/posts/[id]` from anywhere in (app), this renders into the @modal slot
 * (drawer overlay) while the underlying page (Dashboard) stays mounted.
 *
 * On hard navigation (refresh, paste-link, direct hit), this file is NOT
 * used — the standalone `app/(app)/posts/[id]/page.tsx` renders the full
 * page instead.
 */
interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InterceptedPostDetailPage({ params }: PageProps) {
  await requireUser();
  const { id } = await params;
  const bundle = await fetchPostDetailBundle(id);
  if (!bundle) notFound();

  return (
    <PostDetailDrawer postId={bundle.post.id}>
      <PostDetailDrawerBody
        post={bundle.post}
        offices={bundle.offices}
        initialOfficeId={bundle.initialOfficeId}
      />
    </PostDetailDrawer>
  );
}
