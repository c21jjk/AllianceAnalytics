/**
 * Vercel-cron endpoint that fires office post announcement emails.
 *
 * Cron schedule lives in `vercel.json` — currently `0 13 * * *` (every day at
 * 13:00 UTC = 8 AM EST / 9 AM EDT). Matches the weekly-social-report drift
 * convention so all morning-blast emails land in the same hour window.
 *
 * Behavior on each tick: one email per eligible campaign (group_id). If three
 * separate property posts went up overnight, the roster gets three separate
 * announcements — not one batched digest. The 24h freshness gate catches
 * everything posted since the previous morning's run.
 *
 *   - Finds every post_groups row that's (a) category='property', (b) has an
 *     audience_scope of office:* or division:*, (c) hasn't been announced yet,
 *     and (d) has at least one post within the freshness window.
 *   - For each, fans out to the relevant office or division roster +
 *     the listing agent.
 *   - Records the announcement row so the next tick skips the group.
 *
 * Auth: strict Bearer CRON_SECRET via requireCronAuth (lib/cron-auth.ts).
 * Per-campaign dedupe lives in office_post_announcements (announced guard).
 */
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runOfficePostAnnouncementCron } from "@/lib/email/reports/office-post-announcement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const result = await runOfficePostAnnouncementCron();
  return NextResponse.json({ ok: true, ...result });
}
