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
 * Auth strategy (mirrors /api/cron/coach-refresh):
 *   1. CRON_SECRET env var match → strongest; accept.
 *   2. user-agent starts with "vercel-cron" → accept (Vercel's own cron).
 *   3. NODE_ENV !== "production" → accept (dev / preview hits).
 *   4. Otherwise → 401.
 *
 * Returns JSON: { ok, messageId?, subject?, recipientCount, error? }.
 * Never throws — sendWeeklySocialReport returns a result object so a Resend
 * hiccup yields a 500 with a readable message rather than a stack trace in
 * the Vercel logs.
 */
import { NextResponse } from "next/server";
import { sendWeeklySocialReport } from "@/lib/email/reports/weekly-social";
import { recipientEmails } from "@/lib/email/reports/weekly-social-distribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Resend send + Claude takeaway typically <10s. Budget generously.
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const userAgent = req.headers.get("user-agent") ?? "";
  if (process.env.CRON_SECRET) {
    if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  }
  if (userAgent.toLowerCase().startsWith("vercel-cron")) return true;
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const to = await recipientEmails();
  if (to.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Recipient list is empty — nothing to send." },
      { status: 500 },
    );
  }

  const result = await sendWeeklySocialReport({
    to,
    tag: "weekly-social-report-cron",
  });

  return NextResponse.json(
    { ...result, recipientCount: to.length },
    { status: result.ok ? 200 : 500 },
  );
}
