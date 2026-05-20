import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendWeeklySocialReport } from "@/lib/email/reports/weekly-social";

export const dynamic = "force-dynamic";

/**
 * POST /api/email/test/weekly-social-preview
 *
 * Sends the real weekly social media report — populated with last week's
 * actual data — to a single hardcoded admin inbox (c21jjk@gmail.com) so
 * John can iterate on the design before the full distribution list goes live.
 *
 * Hardcoded recipient by design: this endpoint is a "show me the email"
 * button, not a "send the real report" button. The real distribution send
 * (John + Larissa + Chuck) will be a separate endpoint once the design is
 * approved.
 */

const PREVIEW_RECIPIENT = "c21jjk@gmail.com";

export async function POST() {
  await requireAdmin();

  const result = await sendWeeklySocialReport({
    to: [PREVIEW_RECIPIENT],
    tag: "weekly-social-preview",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
