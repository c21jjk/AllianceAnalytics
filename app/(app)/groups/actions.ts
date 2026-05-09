"use server";

/**
 * Server actions for the post-group merge UI on the homepage.
 *
 * Both actions are admin-gated. Manual groups are marked is_locked=true and
 * group_method='manual' so the SQL run_post_grouper() never re-touches them
 * (the auto-grouper only operates on posts where group_id IS NULL anyway,
 * but the lock is belt-and-suspenders for any future logic that scans
 * existing groups).
 */
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface MergeActionResult {
  ok: boolean;
  merged_post_id?: string;
  error?: string;
}

export interface UnmergeActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Merge a candidate post INTO the target group.
 *
 * Steps:
 *   1. Verify the target group exists.
 *   2. Verify the candidate post exists; capture its current group_id.
 *   3. Update posts.group_id to the target groupId.
 *   4. If the candidate was in a different (non-locked) group AND that
 *      group is now empty, best-effort delete it.
 *   5. Mark the target group as manual + locked.
 *   6. Revalidate the homepage.
 */
export async function mergeIntoGroupAction(
  groupId: string,
  candidatePostId: string,
): Promise<MergeActionResult> {
  await requireAdmin();

  if (!groupId || groupId.startsWith("solo-")) {
    return { ok: false, error: "Cannot merge into a singleton group." };
  }
  if (!candidatePostId) {
    return { ok: false, error: "Missing candidate post id." };
  }

  const supabase = createAdminClient();

  // 1. Target group must exist.
  const { data: targetGroup, error: tgErr } = await supabase
    .from("post_groups")
    .select("id")
    .eq("id", groupId)
    .maybeSingle();
  if (tgErr || !targetGroup) {
    return { ok: false, error: "Target group not found." };
  }

  // 2. Candidate post must exist.
  const { data: candidate, error: cErr } = await supabase
    .from("posts")
    .select("id, group_id")
    .eq("id", candidatePostId)
    .maybeSingle();
  if (cErr || !candidate) {
    return { ok: false, error: "Candidate post not found." };
  }

  if (candidate.group_id === groupId) {
    return {
      ok: false,
      error: "That post is already in this group.",
    };
  }

  const previousGroupId = candidate.group_id;

  // 3. Reassign the candidate.
  const { error: upErr } = await supabase
    .from("posts")
    .update({
      group_id: groupId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", candidatePostId);
  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  // 4. Best-effort cleanup: if the candidate was in another group and that
  //    group is now empty, delete it. Locked manual groups are left alone
  //    (we don't move posts out of them in the first place, but be safe).
  if (previousGroupId && previousGroupId !== groupId) {
    try {
      const { data: prevGroup } = await supabase
        .from("post_groups")
        .select("id, is_locked")
        .eq("id", previousGroupId)
        .maybeSingle();
      if (prevGroup && !prevGroup.is_locked) {
        const { count } = await supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("group_id", previousGroupId);
        if ((count ?? 0) === 0) {
          await supabase.from("post_groups").delete().eq("id", previousGroupId);
        }
      }
    } catch (e) {
      // Non-fatal — orphan group is benign.
      console.error("mergeIntoGroupAction: prev-group cleanup failed —", e);
    }
  }

  // 5. Lock the target group as manual.
  const { error: lockErr } = await supabase
    .from("post_groups")
    .update({
      group_method: "manual",
      is_locked: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId);
  if (lockErr) {
    // Post move already succeeded; surface the lock error but don't roll back.
    console.error("mergeIntoGroupAction: lock failed —", lockErr);
  }

  revalidatePath("/");
  return { ok: true, merged_post_id: candidatePostId };
}

/**
 * Unmerge a single post from a group. Sets posts.group_id = null.
 *
 * If the group has fewer than 2 posts left after the move, delete it so the
 * remaining post (if any) shows up as a singleton again on the homepage.
 */
export async function unmergeFromGroupAction(
  groupId: string,
  postId: string,
): Promise<UnmergeActionResult> {
  await requireAdmin();

  if (!groupId || groupId.startsWith("solo-")) {
    return { ok: false, error: "Cannot unmerge from a singleton group." };
  }
  if (!postId) {
    return { ok: false, error: "Missing post id." };
  }

  const supabase = createAdminClient();

  // Detach the post.
  const { error: upErr } = await supabase
    .from("posts")
    .update({
      group_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)
    .eq("group_id", groupId);
  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  // If the group now has < 2 members, drop it; remaining orphan goes back to
  // singleton handling in the data layer.
  try {
    const { count } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId);
    if ((count ?? 0) < 2) {
      // Detach any straggler first (unlikely, but keeps FKs clean).
      if ((count ?? 0) === 1) {
        await supabase
          .from("posts")
          .update({ group_id: null, updated_at: new Date().toISOString() })
          .eq("group_id", groupId);
      }
      await supabase.from("post_groups").delete().eq("id", groupId);
    }
  } catch (e) {
    console.error("unmergeFromGroupAction: cleanup failed —", e);
  }

  revalidatePath("/");
  return { ok: true };
}
