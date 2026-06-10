/**
 * Monday-morning Vercel-cron endpoint that emails each active listing's Owner
 * Story to its listing agent.
 *
 * Cron schedule lives in `vercel.json` — `15 13 * * 1` = Mondays at 13:15 UTC
 * (9:15 AM EDT / 8:15 AM EST), 15 min after the weekly social report so the
 * two Monday blasts don't collide.
 *
 * Eligibility (see lib/email/reports/owner-story-weekly-data.ts):
 *   - listing status = active
 *   - >= 7 days since the listing's first social post
 *   - a listing agent email on file
 *   - not already emailed this week (owner_story_email_sends UNIQUE guard)
 * Re-sends every Monday until the listing leaves "active".
 *
 * Auth: strict Bearer CRON_SECRET via requireCronAuth (lib/cron-auth.ts).
 * Per-listing send dedupe lives in owner_story_email_sends (UNIQUE guard).
 */
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runOwnerStoryWeeklyCron } from "@/lib/email/reports/owner-story-weekly";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const result = await runOwnerStoryWeeklyCron();
  return NextResponse.json({ ok: true, ...result });
}
