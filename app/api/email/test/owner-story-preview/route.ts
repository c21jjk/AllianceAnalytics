import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendOwnerStoryPreview } from "@/lib/email/reports/owner-story-weekly";

export const dynamic = "force-dynamic";

/**
 * POST /api/email/test/owner-story-preview
 *
 * Renders the real weekly Owner Story email for the FIRST currently-eligible
 * listing (active, >= 7 days of posts, has a listing agent) and sends it to a
 * single hardcoded admin inbox (c21jjk@gmail.com) so John can iterate on the
 * design before the Monday cron goes live.
 *
 * Does NOT record an owner_story_email_sends row — previewing never consumes
 * the listing's real Monday slot. Hardcoded recipient by design.
 */

const PREVIEW_RECIPIENT = "c21jjk@gmail.com";

export async function POST() {
  await requireAdmin();

  const result = await sendOwnerStoryPreview({ to: PREVIEW_RECIPIENT });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
