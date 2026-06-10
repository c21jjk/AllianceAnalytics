/**
 * Daily Vercel-cron endpoint that refreshes the Coach insights cache.
 *
 * Cron schedule lives in `vercel.json`. Vercel cron requests carry the
 * `user-agent: vercel-cron/1.0` header and are automatically protected
 * from external access on Pro/Enterprise plans via Deployment Protection.
 *
 * Auth: strict Bearer CRON_SECRET via requireCronAuth (lib/cron-auth.ts).
 * The work itself (Claude generation → coach_insights upsert) is in
 * lib/ai/coach-insights.ts → refreshCoachInsights.
 */
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { refreshCoachInsights } from "@/lib/ai/coach-insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Cap the function at 60s — Claude's Opus model can run ~10–30s; budget for
// the second call too. Vercel hobby tier maxes at 60s, pro at 300s.
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const startedAt = Date.now();
  try {
    const result = await refreshCoachInsights("brand_wide");
    return NextResponse.json({
      ok: true,
      scope: "brand_wide",
      recommendations_count: result.recommendations.length,
      budgets_count: result.budgets.length,
      generated_at: result.generated_at,
      duration_ms: Date.now() - startedAt,
      last_error: result.last_error,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "refresh failed",
        duration_ms: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
