import "server-only";
import { getPostById } from "@/lib/data";
import { listOffices } from "@/lib/data/offices";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Post } from "@/lib/types/post";

/**
 * Fetch everything the post-detail surfaces (full page AND drawer) need in
 * one call. Saves duplicating the office_id lookup + office options fetch
 * across `app/(app)/posts/[id]/page.tsx` and the `@modal` slot.
 */
export interface PostDetailBundle {
  post: Post;
  offices: Array<{ id: string; short_code: string; name: string }>;
  /** posts.office_id at fetch time — feeds the Classify panel's initial state. */
  initialOfficeId: string | null;
}

export async function fetchPostDetailBundle(
  id: string,
): Promise<PostDetailBundle | null> {
  const post = await getPostById(id);
  if (!post) return null;

  const [officesRows, postOfficeRow] = await Promise.all([
    listOffices({ active_only: true }),
    (async () => {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("posts")
        .select("office_id")
        .eq("id", id)
        .maybeSingle();
      return data ?? null;
    })(),
  ]);

  return {
    post,
    offices: officesRows.map((o) => ({
      id: o.id,
      short_code: o.short_code,
      name: o.name,
    })),
    initialOfficeId: postOfficeRow?.office_id ?? null,
  };
}
