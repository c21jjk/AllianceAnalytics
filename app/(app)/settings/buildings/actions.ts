"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";

/**
 * Admin server actions for Building Consolidation.
 *
 * Buildings group several MLS unit-listings (a condo break-up) into ONE logical
 * listing. These actions let staff fix membership when the address-derived
 * backfill gets it wrong (e.g. "Avenue" vs "Street" drift):
 *
 *   - setPropertyBuilding: move a property into a building, or detach it.
 *   - createBuilding: spin up a new building seeded from one property.
 *   - mergeBuildings: fold one building's members into another.
 *
 * `buildings` / `properties.building_id` aren't in the generated Database type
 * yet, so these use a permissive client. Regenerate types after this lands.
 */

interface ActionState {
  ok: boolean;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedSupabase = any;
function untyped(): UntypedSupabase {
  return createAdminClient() as unknown as UntypedSupabase;
}

/** Re-pick a building's primary_property_id = earliest listing_date member. */
async function recomputePrimary(
  supabase: UntypedSupabase,
  buildingId: string,
): Promise<void> {
  const { data: members } = await supabase
    .from("properties")
    .select("id, listing_date")
    .eq("building_id", buildingId)
    .order("listing_date", { ascending: true, nullsFirst: false });
  const first = (members ?? [])[0] as { id: string } | undefined;
  await supabase
    .from("buildings")
    .update({
      primary_property_id: first?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", buildingId);
}

/** Delete a building row if it has no remaining members. */
async function deleteIfEmpty(
  supabase: UntypedSupabase,
  buildingId: string,
): Promise<void> {
  const { count } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("building_id", buildingId);
  if ((count ?? 0) === 0) {
    await supabase.from("buildings").delete().eq("id", buildingId);
  }
}

/**
 * Move a property into a building (or detach it when buildingId is null).
 * Recomputes the primary on both the old and new building, and garbage-
 * collects a building that just lost its last member.
 */
export async function setPropertyBuilding(
  propertyId: string,
  buildingId: string | null,
): Promise<ActionState> {
  await requireAdmin();
  if (!propertyId) return { ok: false, error: "Missing property." };

  const supabase = untyped();

  // Capture the previous building so we can recompute/clean it up.
  const { data: prev } = await supabase
    .from("properties")
    .select("building_id")
    .eq("id", propertyId)
    .maybeSingle();
  const prevBuildingId =
    (prev as { building_id?: string | null } | null)?.building_id ?? null;

  const { error } = await supabase
    .from("properties")
    .update({ building_id: buildingId, updated_at: new Date().toISOString() })
    .eq("id", propertyId);
  if (error) return { ok: false, error: `Update failed: ${error.message}` };

  if (buildingId) await recomputePrimary(supabase, buildingId);
  if (prevBuildingId && prevBuildingId !== buildingId) {
    await recomputePrimary(supabase, prevBuildingId);
    await deleteIfEmpty(supabase, prevBuildingId);
  }

  revalidatePath("/settings/buildings");
  return { ok: true };
}

/**
 * Create a new building seeded from one property. The property is moved onto
 * the new building and becomes its primary. Display fields come from the
 * seed property's address/city.
 */
export async function createBuilding(
  seedPropertyId: string,
): Promise<ActionState> {
  await requireAdmin();
  if (!seedPropertyId) return { ok: false, error: "Missing property." };

  const supabase = untyped();
  const { data: seed } = await supabase
    .from("properties")
    .select("id, address, city, building_id")
    .eq("id", seedPropertyId)
    .maybeSingle();
  const seedRow = seed as
    | { id: string; address: string | null; city: string | null; building_id: string | null }
    | null;
  if (!seedRow) return { ok: false, error: "Property not found." };

  const prevBuildingId = seedRow.building_id;

  const { data: inserted, error: insErr } = await supabase
    .from("buildings")
    .insert({
      display_address: seedRow.address,
      display_city: seedRow.city,
      primary_property_id: seedRow.id,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return { ok: false, error: `Create failed: ${insErr?.message ?? "unknown"}` };
  }
  const newBuildingId = (inserted as { id: string }).id;

  await supabase
    .from("properties")
    .update({ building_id: newBuildingId, updated_at: new Date().toISOString() })
    .eq("id", seedRow.id);

  if (prevBuildingId) {
    await recomputePrimary(supabase, prevBuildingId);
    await deleteIfEmpty(supabase, prevBuildingId);
  }

  revalidatePath("/settings/buildings");
  return { ok: true };
}

/**
 * Fold every member of `sourceBuildingId` into `targetBuildingId`, then delete
 * the now-empty source building. Recomputes the target's primary.
 */
export async function mergeBuildings(
  sourceBuildingId: string,
  targetBuildingId: string,
): Promise<ActionState> {
  await requireAdmin();
  if (!sourceBuildingId || !targetBuildingId) {
    return { ok: false, error: "Pick two buildings to merge." };
  }
  if (sourceBuildingId === targetBuildingId) {
    return { ok: false, error: "Cannot merge a building into itself." };
  }

  const supabase = untyped();
  const { error } = await supabase
    .from("properties")
    .update({
      building_id: targetBuildingId,
      updated_at: new Date().toISOString(),
    })
    .eq("building_id", sourceBuildingId);
  if (error) return { ok: false, error: `Merge failed: ${error.message}` };

  await supabase.from("buildings").delete().eq("id", sourceBuildingId);
  await recomputePrimary(supabase, targetBuildingId);

  revalidatePath("/settings/buildings");
  return { ok: true };
}
