"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { buildReportPayload, newestPostAgeDays } from "@/lib/reports/build";

const POST_AGE_GATE_DAYS = 7;

export interface GenerateReportResult {
  ok: boolean;
  error?: string;
  token?: string;
  flyer_url?: string;
  pdf_url?: string;
  report_url?: string;
}

/**
 * Generate (or refresh, if not locked) a property report for a given MLS.
 *
 * Gate: the most recent post in the property must be at least 7 days old.
 *
 * Behavior:
 *   1. Resolve property by MLS.
 *   2. Build the report payload from posts.
 *   3. Reject if newest post < 7 days old.
 *   4. Upsert into reports — if there's an unlocked row for this property,
 *      refresh it; otherwise insert a new row with a fresh report_token.
 *   5. Insert a 'link' delivery row carrying the same share_token so the
 *      /r/[token] route stays compatible with the existing fixtures path.
 */
export async function generateReportAction(
  mls: string,
): Promise<GenerateReportResult> {
  await requireAdmin();

  if (!mls || typeof mls !== "string") {
    return { ok: false, error: "Missing MLS number." };
  }

  const supabase = createAdminClient();

  // 1) Resolve property
  const { data: propRow, error: propErr } = await supabase
    .from("properties")
    .select("id, mls_number")
    .eq("mls_number", mls)
    .maybeSingle();
  if (propErr) {
    return { ok: false, error: `Property lookup failed: ${propErr.message}` };
  }
  if (!propRow) {
    return { ok: false, error: `No property found for MLS ${mls}.` };
  }

  // 2) Build payload
  let payload;
  try {
    payload = await buildReportPayload(propRow.id);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to build report payload.",
    };
  }

  if (payload.empty) {
    return {
      ok: false,
      error: "No posts found for this property yet.",
    };
  }

  // 3) Post-age gate
  const ageDays = newestPostAgeDays(payload);
  if (ageDays < POST_AGE_GATE_DAYS) {
    const wait = POST_AGE_GATE_DAYS - ageDays;
    return {
      ok: false,
      error: `Posts must be at least ${POST_AGE_GATE_DAYS} days old before generating a report. Newest post is ${ageDays} ${ageDays === 1 ? "day" : "days"} old — try again in ${wait} ${wait === 1 ? "day" : "days"}.`,
    };
  }

  // 4) Upsert report row — refresh unlocked, else insert new
  const { data: existing } = await supabase
    .from("reports")
    .select("id, report_token, is_locked")
    .eq("property_id", propRow.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let reportId: string;
  let token: string;

  const reportColumns = {
    property_id: propRow.id,
    period_start: payload.period_start,
    period_end: payload.period_end,
    post_ids: payload.post_ids,
    kpis: payload.kpis as unknown as Json,
    audience: payload.audience as unknown as Json,
    narrative: {
      hero: "",
      reach_summary: "",
      closing:
        "Alliance Social put your home in front of a measured, qualified audience across the platforms most likely to drive serious buyer interest.",
    } as unknown as Json,
    generated_at: new Date().toISOString(),
  };

  if (existing && !existing.is_locked) {
    const { error } = await supabase
      .from("reports")
      .update(reportColumns)
      .eq("id", existing.id);
    if (error) {
      return { ok: false, error: `Update failed: ${error.message}` };
    }
    reportId = existing.id;
    token = existing.report_token;
  } else {
    token = (globalThis.crypto as Crypto).randomUUID();
    const { data: inserted, error } = await supabase
      .from("reports")
      .insert({
        ...reportColumns,
        report_token: token,
        is_locked: false,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      return {
        ok: false,
        error: `Insert failed: ${error?.message ?? "unknown"}`,
      };
    }
    reportId = inserted.id;
  }

  // 5) Best-effort delivery row for the share-token path
  try {
    await supabase.from("report_deliveries").insert({
      report_id: reportId,
      channel: "link",
      status: "pending",
      share_token: token,
      view_count: 0,
    });
  } catch {
    // not fatal; the /r/[token] route resolves via report_token directly
  }

  revalidatePath(`/properties/${mls}`);
  revalidatePath(`/r/${token}`);

  return {
    ok: true,
    token,
    flyer_url: `/r/${encodeURIComponent(token)}/flyer`,
    pdf_url: `/r/${encodeURIComponent(token)}/flyer.pdf`,
    report_url: `/r/${encodeURIComponent(token)}`,
  };
}
