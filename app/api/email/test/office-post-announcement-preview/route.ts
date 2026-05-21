import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { previewOfficePostAnnouncement } from "@/lib/email/reports/office-post-announcement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/email/test/office-post-announcement-preview
 *
 * Admin-only "send a sample office-post announcement to me" diagnostics.
 * Picks the first currently-eligible group (category='property' + audience
 * scoped to an office or division) and sends the rendered email to a
 * hardcoded preview recipient. Does NOT record an announcement row, so the
 * group can be re-previewed and the real cron will still pick it up.
 */

const PREVIEW_RECIPIENT = "c21jjk@gmail.com";

export async function POST() {
  await requireAdmin();
  const result = await previewOfficePostAnnouncement({ to: PREVIEW_RECIPIENT });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
