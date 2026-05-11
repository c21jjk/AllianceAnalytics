"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { buildReportPayload, newestPostAgeDays } from "@/lib/reports/build";
import {
  CADENCE_VALUES,
  cadenceIntervalDays,
  type OwnerReportCadence,
} from "@/lib/data/owner-reports-db";

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

/* ------------------------------------------------------------------------- */
/* Owner-report recipient + cadence actions (Phase C)                        */
/*                                                                           */
/* Recipients are the subscriber list per report. Cadence determines when    */
/* the Phase D pg_cron job will (eventually) email everyone here. Until      */
/* Phase D is wired, these actions only persist state — no email goes out.   */
/* ------------------------------------------------------------------------- */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OwnerReportActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Add (or refresh) a recipient on a report. Email is required; name + phone
 * are optional. The (report_id, email) pair is unique — re-adding the same
 * email updates the name/phone instead of creating a duplicate row.
 *
 * `mls` is passed in so we can `revalidatePath` the listing detail page
 * after the write without round-tripping through the property lookup.
 */
export async function addOwnerReportRecipientAction(
  reportId: string,
  mls: string,
  raw: { name?: string | null; email: string; phone?: string | null },
): Promise<OwnerReportActionResult> {
  await requireAdmin();

  if (!reportId) return { ok: false, error: "Missing report id." };
  const email = (raw.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email." };
  }

  const name = (raw.name ?? "").trim();
  const phone = (raw.phone ?? "").trim();

  const supabase = createAdminClient();
  const { error } = await supabase.from("report_recipients").upsert(
    {
      report_id: reportId,
      email,
      name: name.length > 0 ? name : null,
      phone: phone.length > 0 ? phone : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "report_id,email" },
  );
  if (error) return { ok: false, error: error.message };

  if (mls) revalidatePath(`/properties/${mls}`);
  return { ok: true };
}

/**
 * Remove a recipient from a report's subscriber list. Idempotent — deleting
 * a non-existent recipient succeeds quietly. `mls` is used to revalidate the
 * listing detail page after the write.
 */
export async function removeOwnerReportRecipientAction(
  recipientId: string,
  mls: string,
): Promise<OwnerReportActionResult> {
  await requireAdmin();

  if (!recipientId) return { ok: false, error: "Missing recipient id." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("report_recipients")
    .delete()
    .eq("id", recipientId);
  if (error) return { ok: false, error: error.message };

  if (mls) revalidatePath(`/properties/${mls}`);
  return { ok: true };
}

/**
 * Set the auto-send cadence on a report. Setting cadence to "none" clears
 * `next_send_at`. Any other value recomputes `next_send_at = now() + N days`
 * based on the cadence interval (7 / 14 / 30). Phase D's pg_cron job will
 * consume this field; until then it's just persisted state.
 */
export async function setOwnerReportCadenceAction(
  reportId: string,
  mls: string,
  cadence: OwnerReportCadence,
): Promise<OwnerReportActionResult> {
  await requireAdmin();

  if (!reportId) return { ok: false, error: "Missing report id." };
  if (!(CADENCE_VALUES as string[]).includes(cadence)) {
    return { ok: false, error: `Invalid cadence: ${cadence}` };
  }

  const days = cadenceIntervalDays(cadence);
  const nextSendAt =
    days === null
      ? null
      : new Date(Date.now() + days * 86_400_000).toISOString();

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("reports")
    .update({
      cadence,
      next_send_at: nextSendAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reportId);
  if (error) return { ok: false, error: error.message };

  if (mls) revalidatePath(`/properties/${mls}`);
  return { ok: true };
}
