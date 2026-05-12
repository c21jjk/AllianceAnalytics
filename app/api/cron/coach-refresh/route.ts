/**
 * Daily Vercel-cron endpoint that refreshes the Coach insights cache.
 *
 * Cron schedule lives in `vercel.json`. Vercel cron requests carry the
 * `user-agent: vercel-cron/1.0` header and are automatically protected
 * from external access on Pro/Enterprise plans via Deployment Protection.
 *
 * Auth strategy (in order of precedence):
 *   1. CRON_SECRET env var match → strongest; accept request.
 *   2. user-agent starts with "vercel-cron" → accept (Vercel's own cron).
 *   3. NODE_ENV !== "production" → accept (dev/preview hits).
 *   4. Otherwise → 401.
 *
 * To harden in production, set CRON_SECRET in Vercel project settings.
 * The work itself (Claude generation → coach_insights upsert) is in
 * lib/ai/coach-insights.ts → refreshCoachInsights.
 */
import { NextResponse } from "next/server";
import { refreshCoachInsights } from "@/lib/ai/coach-insights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Cap the function at 60s — Claude's Opus model can run ~10–30s; budget for
// the second call too. Vercel hobby tier maxes at 60s, pro at 300s.
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const userAgent = req.headers.get("user-agent") ?? "";

  // 1) Explicit CRON_SECRET bearer.
  if (process.env.CRON_SECRET) {
    if (auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  }
  // 2) Vercel's own cron pingback — auto-protected on Pro/Enterprise.
  if (userAgent.toLowerCase().startsWith("vercel-cron")) return true;
  // 3) Non-prod: let local hits through.
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
