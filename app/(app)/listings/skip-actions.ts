"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 2026-08-07 (John) — per-milestone "skip this one" writes.
 *
 * Its own file rather than more lines on listings/actions.ts, matching the
 * split already made for note-actions.ts. See lib/data/listing-skip-marks.ts
 * for why this is keyed on (mls_number, post_type) and not on the property.
 *
 * Reminder: a "use server" module may export ONLY async functions, so the
 * valid-type list lives inline rather than as an exported const.
 */

export interface SkipActionResult {
  ok: boolean;
  error?: string;
}

const VALID_SKIP_TYPES = [
  "just_listed",
  "under_contract",
  "just_sold",
  "price_reduction",
] as const;

type SkipPostType = (typeof VALID_SKIP_TYPES)[number];

function revalidateMilestoneSurfaces(mlsNumber: string): void {
  revalidatePath("/");
  revalidatePath("/properties");
  revalidatePath(`/properties/${encodeURIComponent(mlsNumber)}`);
  revalidatePath("/settings/promotions");
}

/**
 * Mark a listing as "not worth a post" for ONE milestone. Skipping the Just
 * Sold leaves that listing's Price Change alone.
 *
 * Upsert so a re-skip refreshes the reason instead of failing on the unique
 * constraint.
 */
export async function setListingSkipAction(
  mlsNumber: string,
  postType: string,
  reason: string | null,
): Promise<SkipActionResult> {
  const profile = await requireAdmin();

  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }
  if (!(VALID_SKIP_TYPES as readonly string[]).includes(postType)) {
    return { ok: false, error: "Invalid post type." };
  }

  const trimmedReason = (reason ?? "").trim().slice(0, 200) || null;

  const supabase = createAdminClient();
  // listing_skip_marks isn't in the generated Database type yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const { error } = await untyped.from("listing_skip_marks").upsert(
    {
      mls_number: mlsNumber,
      post_type: postType as SkipPostType,
      reason: trimmedReason,
      skipped_at: new Date().toISOString(),
      skipped_by: profile.id,
    },
    { onConflict: "mls_number,post_type" },
  );
  if (error) return { ok: false, error: error.message };

  revalidateMilestoneSurfaces(mlsNumber);
  return { ok: true };
}

/**
 * Undo a skip. Also clears the LEGACY property-wide dismissal when undoing a
 * just_listed skip, because that column is what put older listings in the
 * dismissed state and leaving it set would make the undo look like it did
 * nothing.
 */
export async function clearListingSkipAction(
  mlsNumber: string,
  postType: string,
): Promise<SkipActionResult> {
  await requireAdmin();

  if (!mlsNumber || typeof mlsNumber !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }
  if (!(VALID_SKIP_TYPES as readonly string[]).includes(postType)) {
    return { ok: false, error: "Invalid post type." };
  }

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;

  const { error } = await untyped
    .from("listing_skip_marks")
    .delete()
    .eq("mls_number", mlsNumber)
    .eq("post_type", postType);
  if (error) return { ok: false, error: error.message };

  if (postType === "just_listed") {
    const { error: legacyErr } = await supabase
      .from("properties")
      .update({
        promotion_dismissed_at: null,
        promotion_dismissed_by: null,
        promotion_dismissed_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("mls_number", mlsNumber);
    if (legacyErr) return { ok: false, error: legacyErr.message };
  }

  revalidateMilestoneSurfaces(mlsNumber);
  return { ok: true };
}
