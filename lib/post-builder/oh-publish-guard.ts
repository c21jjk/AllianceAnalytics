/**
 * lib/post-builder/oh-publish-guard.ts (2026-07-24)
 * ---------------------------------------------------------------------------
 *
 * Stale open-house publish guard, shared by the Post Now route and the
 * publish-scheduled cron.
 *
 * WHY: nothing previously verified that an open house was still UPCOMING
 * at publish time. A scheduled post that fired late (render backlog, cron
 * gap, wrong date picked) happily advertised open houses that had already
 * ended. This module answers one question right before publishing: does at
 * least one property in this post still have an open_houses row whose
 * end_at is in the future?
 *
 * Semantics:
 *   - Applies ONLY to open-house content (post_type "open_house" or a
 *     multi-OH event template). Everything else returns applicable: false.
 *   - A post is publishable while ANY of its open houses is upcoming or
 *     currently running ("open today until 2pm" is still useful mid-window).
 *   - FAIL-OPEN on lookup errors: a transient DB hiccup must never block a
 *     legitimate publish. We only block on a confident "every window has
 *     ended" answer.
 *
 * Caveat (documented, accepted): open_houses rows can change after the
 * carousel was rendered. This guard checks the properties' CURRENT windows,
 * not the exact windows baked into the slides, so a property whose OH moved
 * to next weekend still passes. Catching that would require persisting the
 * rendered windows on the row; today's guard stops the worst failure
 * (advertising a fully-past event), which is the case John flagged.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface OhGuardResult {
  /** True when the row is open-house content the guard applies to. */
  applicable: boolean;
  /** True when at least one open house is still upcoming/running (or the
   *  guard could not verify and failed open). Only trust this when
   *  applicable is true. */
  upcoming: boolean;
  /** Human-readable detail for logs / error surfaces. */
  detail: string;
}

export async function openHousePublishGuard(args: {
  generated_post_id: string;
  property_id: string | null;
  post_type: string | null;
  template_id: string | null;
}): Promise<OhGuardResult> {
  const isMultiOhEvent =
    typeof args.template_id === "string" &&
    args.template_id.startsWith("multi_oh_event_");
  const applicable = args.post_type === "open_house" || isMultiOhEvent;
  if (!applicable) {
    return { applicable: false, upcoming: true, detail: "not an open-house post" };
  }

  try {
    const supabase = createAdminClient();
    // linked_property_ids is not in the generated types yet — same untyped
    // read pattern as the publish routes + agent notification module.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any;

    const propertyIds: string[] = [];
    if (args.property_id) propertyIds.push(args.property_id);
    const { data: gp } = await sbAny
      .from("generated_posts")
      .select("linked_property_ids")
      .eq("id", args.generated_post_id)
      .maybeSingle();
    if (gp && Array.isArray(gp.linked_property_ids)) {
      for (const pid of gp.linked_property_ids) {
        if (typeof pid === "string" && pid && !propertyIds.includes(pid)) {
          propertyIds.push(pid);
        }
      }
    }
    if (propertyIds.length === 0) {
      // Nothing to check against — don't block on missing linkage.
      return { applicable: false, upcoming: true, detail: "no linked properties" };
    }

    // 2026-07-28 — fetch the LATEST window instead of filtering on
    // end_at > now. This distinguishes three cases the old query merged:
    //   1. no open_houses rows at all  -> FAIL OPEN. Our open_houses table
    //      is not authoritative for every listing (e.g. the Bright OH feed
    //      is not wired), and a mislabeled post_type must not hard-block a
    //      publish. The guard only exists to stop advertising an event we
    //      KNOW has ended — with zero rows we know no such thing. This was
    //      the 7/28 false positive: a Just Listed carousel carrying
    //      post_type "open_house" on a property with no OH rows was blocked
    //      with "every open house has already ended".
    //   2. latest window still upcoming/running -> pass.
    //   3. rows exist and every window has ended -> block (the real case).
    const { data: latestOh, error: ohErr } = await supabase
      .from("open_houses")
      .select("end_at")
      .in("property_id", propertyIds)
      // end_at is nullable in the schema; a windowless row proves nothing
      // either way, and NULLS FIRST on a desc order would mask real rows.
      .not("end_at", "is", null)
      .order("end_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (ohErr) {
      console.warn(
        `[oh-guard] lookup failed for ${args.generated_post_id} (failing open):`,
        ohErr.message,
      );
      return { applicable: true, upcoming: true, detail: "lookup failed, failed open" };
    }
    if (!latestOh) {
      return {
        applicable: false,
        upcoming: true,
        detail:
          "no open_houses rows on record for the linked properties — cannot confirm an ended event, failing open",
      };
    }
    if (latestOh.end_at !== null && new Date(latestOh.end_at).getTime() > Date.now()) {
      return { applicable: true, upcoming: true, detail: "upcoming open house found" };
    }
    return {
      applicable: true,
      upcoming: false,
      detail: `every open house across ${propertyIds.length} propert${propertyIds.length === 1 ? "y" : "ies"} has ended (latest end_at ${latestOh.end_at})`,
    };
  } catch (e) {
    console.warn(
      `[oh-guard] crashed for ${args.generated_post_id} (failing open):`,
      e instanceof Error ? e.message : e,
    );
    return { applicable: true, upcoming: true, detail: "guard crashed, failed open" };
  }
}
