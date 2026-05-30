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
 * Auth strategy mirrors /api/cron/weekly-social-report:
 *   1. CRON_SECRET env var match → accept.
 *   2. user-agent starts with "vercel-cron" → accept.
 *   3. NODE_ENV !== "production" → accept (dev / preview hits).
 *   4. Otherwise → 401.
 */
import { NextResponse } from "next/server";
import { runOwnerStoryWeeklyCron } from "@/lib/email/reports/owner-story-weekly";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

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
  const result = await runOwnerStoryWeeklyCron();
  return NextResponse.json({ ok: true, ...result });
}
