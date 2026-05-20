import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendWeeklySocialReport } from "@/lib/email/reports/weekly-social";
import { recipientEmails } from "@/lib/email/reports/weekly-social-distribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Resend send is usually sub-second but Claude takeaway may add a few seconds.
export const maxDuration = 60;

/**
 * POST /api/email/test/weekly-social-distribute
 *
 * Sends the weekly social media report to the full hardcoded distribution list
 * (John, Larissa, Chuck + 8 office managers). Used for the on-demand "Send to
 * full distribution" button on /settings — typically run once or twice to
 * verify every recipient receives the email correctly before the Monday cron
 * is allowed to autopilot.
 *
 * Recipient list is server-side (lib/email/reports/weekly-social-distribution.ts).
 * The route ignores any request body — it cannot be repurposed to mail
 * arbitrary addresses. Admin-gated.
 *
 * Tagged `weekly-social-distribution-manual` in Resend so manual sends can be
 * distinguished from cron sends in the dashboard.
 */
export async function POST() {
  await requireAdmin();

  const to = await recipientEmails();
  if (to.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Recipient list is empty — nothing to send." },
      { status: 500 },
    );
  }

  const result = await sendWeeklySocialReport({
    to,
    tag: "weekly-social-distribution-manual",
  });

  return NextResponse.json(
    { ...result, recipientCount: to.length },
    { status: result.ok ? 200 : 500 },
  );
}
