"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHostRoster, type HostRoster } from "@/lib/data/host-roster";

/**
 * 2026-10-16 (John) — pick the hosting agent for an open house straight from
 * the dashboard, before anyone builds the post ("in case she receives notice
 * that one agent is hosting for another one").
 *
 * Saved per OCCURRENCE on open_houses.host_agent_name, so Sat and Sun can have
 * different hosts. MLS syncs upsert only the columns they send, so the pick
 * survives every sync. Passing null resets to the MLS notes / listing agent.
 */

export interface OpenHouseHostResult {
  ok: boolean;
  error?: string;
}

export async function setOpenHouseHostAction(
  openHouseId: string,
  hostName: string | null,
): Promise<OpenHouseHostResult> {
  const profile = await requireAdmin();
  if (!openHouseId || typeof openHouseId !== "string") {
    return { ok: false, error: "Missing open house." };
  }
  const name = (hostName ?? "").trim().slice(0, 120) || null;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("open_houses")
    .update({
      host_agent_name: name,
      host_set_by: name ? profile.id : null,
      host_set_at: name ? new Date().toISOString() : null,
    })
    .eq("id", openHouseId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}

/** Loaded lazily the first time someone opens a host picker on the dashboard,
 *  so the ~5k-name roster never weighs down the dashboard's first paint. */
export async function getHostRosterAction(): Promise<HostRoster> {
  await requireAdmin();
  return getHostRoster();
}
