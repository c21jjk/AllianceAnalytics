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

// ---------------------------------------------------------------------------
// Right-rail housekeeping: multi-MLS linkage + audience scope.
// ---------------------------------------------------------------------------

export interface SetGroupPropertiesResult {
  ok: boolean;
  unmatched_mls?: string[];
  error?: string;
}

/**
 * Replace post_groups.property_ids with the resolved property uuids for the
 * given list of MLS numbers. Multi-MLS support for Open House campaigns.
 *
 * Each input string is normalized + parsed via parseCanonicalMls (handles
 * `#NJBL...` / `#CMC...` / `#SJSR...` / raw forms). Unknown MLS numbers
 * (no row in `properties`) are returned in `unmatched_mls` for the UI to
 * surface — they don't block the save.
 *
 * Pass an empty array to clear the multi-property linkage (the card falls
 * back to the single auto-linked property).
 */
export async function setGroupPropertiesAction(
  groupId: string,
  rawMlsNumbers: string[],
): Promise<SetGroupPropertiesResult> {
  await requireAdmin();

  if (!groupId || groupId.startsWith("solo-")) {
    return {
      ok: false,
      error:
        "Cannot edit a singleton group. Merge it into a real group first.",
    };
  }

  // Normalize: strip "#", uppercase, dedupe, drop empties.
  const cleaned = Array.from(
    new Set(
      rawMlsNumbers
        .map((s) => (s ?? "").trim().replace(/^#/, "").toUpperCase())
        .filter((s) => s.length > 0),
    ),
  );

  const supabase = createAdminClient();

  // Resolve to uuids via mls_number lookup.
  const propertyIds: string[] = [];
  const unmatched: string[] = [];

  if (cleaned.length > 0) {
    const { data, error } = await supabase
      .from("properties")
      .select("id, mls_number")
      .in("mls_number", cleaned);
    if (error) return { ok: false, error: error.message };

    const byMls = new Map<string, string>();
    for (const r of (data ?? []) as { id: string; mls_number: string }[]) {
      byMls.set(r.mls_number.toUpperCase(), r.id);
    }
    for (const m of cleaned) {
      const id = byMls.get(m);
      if (id) propertyIds.push(id);
      else unmatched.push(m);
    }
  }

  // Singular property_id mirrors the first entry of property_ids[] so the
  // post-detail loader (which reads group.property_id) and the report
  // builder (which reads posts.property_id) both see the link without
  // refactoring their query shapes.
  const primaryPropertyId: string | null = propertyIds[0] ?? null;

  const { data: updated, error: updateErr } = await supabase
    .from("post_groups")
    .update({
      property_ids: propertyIds,
      property_id: primaryPropertyId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId)
    .select("id");

  if (updateErr) return { ok: false, error: updateErr.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Group not found." };
  }

  // Cascade the link to every post in the group so per-post readers stay
  // consistent. Sets link_method='manual' when linking (overrides any prior
  // auto-link), clears both fields when unlinking.
  const nowIso = new Date().toISOString();
  const cascadePatch: {
    property_id: string | null;
    link_method: "manual" | null;
    updated_at: string;
  } = primaryPropertyId
    ? { property_id: primaryPropertyId, link_method: "manual", updated_at: nowIso }
    : { property_id: null, link_method: null, updated_at: nowIso };

  const { error: cascadeErr } = await supabase
    .from("posts")
    .update(cascadePatch)
    .eq("group_id", groupId);
  if (cascadeErr) {
    // Non-fatal: the group-level link is saved. Surface a soft warning via
    // the unmatched channel so the UI shows something happened.
    console.error(
      "setGroupPropertiesAction: post cascade failed —",
      cascadeErr,
    );
  }

  revalidatePath("/");
  revalidatePath("/posts");
  return {
    ok: true,
    unmatched_mls: unmatched.length > 0 ? unmatched : undefined,
  };
}

export interface SetGroupAudienceScopeResult {
  ok: boolean;
  error?: string;
}

/**
 * Set the audience scope for a campaign. Accepts:
 *   null               → unscoped (clears the column)
 *   "company"          → whole Alliance NJ
 *   "division:<slug>"  → e.g. "division:shore", "division:south_jersey"
 *   "office:<short>"   → uses offices.short_code (e.g. "office:wildwood",
 *                        "office:north_cape_may") — lowercase snake_case to
 *                        match the offices table.
 *
 * The DB has a CHECK constraint matching these patterns; the action
 * validates client-side too so we surface a clean error.
 */
export async function setGroupAudienceScopeAction(
  groupId: string,
  scope: string | null,
): Promise<SetGroupAudienceScopeResult> {
  await requireAdmin();

  if (!groupId || groupId.startsWith("solo-")) {
    return {
      ok: false,
      error: "Cannot scope a singleton group. Merge it first.",
    };
  }

  if (scope !== null) {
    const valid =
      scope === "company" ||
      /^division:[a-z][a-z0-9_]*$/.test(scope) ||
      /^office:[a-z][a-z0-9_]*$/.test(scope);
    if (!valid) {
      return {
        ok: false,
        error: `Invalid audience scope: "${scope}".`,
      };
    }
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("post_groups")
    .update({
      audience_scope: scope,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Group not found." };
  }

  revalidatePath("/");
  revalidatePath("/posts");
  return { ok: true };
}
