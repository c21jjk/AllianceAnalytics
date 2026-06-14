/**
 * Monday-morning Vercel-cron endpoint that emails the weekly social-media
 * report to the full distribution list (John, Larissa, Chuck + 8 office
 * managers; see lib/email/reports/weekly-social-distribution.ts).
 *
 * Cron schedule lives in `vercel.json` — currently `0 13 * * 1` = Mondays
 * at 13:00 UTC (9 AM EDT / 8 AM EST). The window covered by the report is
 * the most-recently-completed Mon→Sun in America/New_York, so a Monday-morning
 * fire delivers last week's recap before the office is in gear.
 *
 * Auth: strict Bearer CRON_SECRET via requireCronAuth (lib/cron-auth.ts).
 *
 * Send dedupe: one send per covered week, recorded in weekly_report_sends
 * keyed by the covered week's Monday (America/New_York). A Vercel retry,
 * manual re-fire, or double-tick skips with ok:true + deduped:true instead
 * of blasting the distribution list twice. The INSERT happens BEFORE the
 * send (claim-then-send): a crash after claiming means that week needs a
 * manual re-send via /settings, which is the safe failure direction for a
 * leadership-facing email.
 *
 * Returns JSON: { ok, messageId?, subject?, recipientCount, error? }.
 * Never throws — sendWeeklySocialReport returns a result object so a Resend
 * hiccup yields a 500 with a readable message rather than a stack trace in
 * the Vercel logs.
 */
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWeeklySocialReport } from "@/lib/email/reports/weekly-social";
import { recipientEmails } from "@/lib/email/reports/weekly-social-distribution";
import { weeklyEmailsPaused, PAUSE_UNTIL_NY } from "@/lib/email/reports/email-pause";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Resend send + Claude takeaway typically <10s. Budget generously.
export const maxDuration = 60;

/**
 * Monday (YYYY-MM-DD, America/New_York) of the most recently COMPLETED
 * Mon→Sun week — the week the report covers. Used as the dedupe key.
 */
function coveredWeekMondayNY(): string {
  const nyNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const sinceMonday = (nyNow.getDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(nyNow);
  monday.setDate(nyNow.getDate() - sinceMonday - 7); // previous week's Monday
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  // ---- TEMPORARY one-week pause (see lib/email/reports/email-pause.ts) --
  // Stale FB/IG data after the 2026-06-11 Meta page-role lockout. Holding
  // the 2026-06-15 blast; resumes automatically on 2026-06-22.
  if (weeklyEmailsPaused()) {
    return NextResponse.json({ ok: true, skipped: "paused", until: PAUSE_UNTIL_NY });
  }

  // ---- dedupe claim ----------------------------------------------------
  const weekStart = coveredWeekMondayNY();
  const supabase = createAdminClient();
  const { error: claimError } = await supabase
    .from("weekly_report_sends")
    .insert({ week_start: weekStart });
  if (claimError) {
    // 23505 = unique_violation → already sent (or claimed) for this week.
    if (claimError.code === "23505") {
      return NextResponse.json({
        ok: true,
        deduped: true,
        week_start: weekStart,
      });
    }
    return NextResponse.json(
      { ok: false, error: `dedupe_claim_failed: ${claimError.message}` },
      { status: 500 },
    );
  }

  const to = await recipientEmails();
  if (to.length === 0) {
    // Release the claim — nothing was sent, allow a retry once recipients exist.
    await supabase.from("weekly_report_sends").delete().eq("week_start", weekStart);
    return NextResponse.json(
      { ok: false, error: "Recipient list is empty — nothing to send." },
      { status: 500 },
    );
  }

  const result = await sendWeeklySocialReport({
    to,
    tag: "weekly-social-report-cron",
  });

  if (result.ok) {
    // Best-effort: record what was sent on the claim row.
    await supabase
      .from("weekly_report_sends")
      .update({
        message_id: "messageId" in result ? (result.messageId ?? null) : null,
        recipient_count: to.length,
      })
      .eq("week_start", weekStart);
  } else {
    // Send failed — release the claim so the next tick/retry can try again.
    await supabase.from("weekly_report_sends").delete().eq("week_start", weekStart);
  }

  return NextResponse.json(
    { ...result, recipientCount: to.length },
    { status: result.ok ? 200 : 500 },
  );
}
