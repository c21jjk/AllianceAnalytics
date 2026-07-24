import "server-only";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reachOf, engagementsOf, isReachReported } from "@/lib/data/post-metrics";
import { notifyAdmins } from "@/lib/push/send";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Performance-alert cron (Phase D of the mobile build, 2026-07-24).
 *
 * Daily scan for posts that are OUTPERFORMING: any post from the last
 * 72 hours whose reach is ≥ 1.5× the 30-day company average (the same
 * threshold the AI-insight boost heuristic uses) with an absolute floor
 * so a quiet week can't fire alerts off tiny numbers. Winners trigger a
 * push + in-app alert to the admins (John + Larissa) via notifyAdmins —
 * catching the "worth boosting while it's hot" window.
 *
 * Dedupe: one performance alert per post ever, enforced by checking the
 * notifications log for metadata.post_id before alerting. At most 3
 * alerts per run so a great week doesn't turn into a buzzing pocket.
 *
 * Schedule: daily 14:00 UTC (10 AM ET) via vercel.json.
 */

const LOOKBACK_HOURS = 72;
const BASELINE_DAYS = 30;
const OUTPERFORM_MULTIPLE = 1.5;
const MIN_REACH_FLOOR = 1000;
const MIN_BASELINE_SAMPLE = 5;
const MAX_ALERTS_PER_RUN = 3;

interface PostRow {
  id: string;
  platform: string;
  media_type: string | null;
  caption: string | null;
  permalink: string | null;
  posted_at: string | null;
  metrics: Record<string, unknown> | null;
}

function fmt(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export async function GET(request: Request) {
  const authFailure = requireCronAuth(request);
  if (authFailure) return authFailure;

  const supabase = createAdminClient();
  const now = Date.now();
  const baselineCutoff = new Date(now - BASELINE_DAYS * 24 * 3600 * 1000).toISOString();
  const recentCutoff = new Date(now - LOOKBACK_HOURS * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from("posts")
    .select("id, platform, media_type, caption, permalink, posted_at, metrics")
    .gte("posted_at", baselineCutoff)
    .order("posted_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[cron/performance-alerts] posts query failed:", error.message);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as PostRow[];

  // 30-day baseline — mean reach across posts with reported, non-zero reach.
  const baselineReaches = rows
    .map((r) => {
      const m = { metrics: r.metrics, media_type: r.media_type, platform: r.platform };
      return isReachReported(m) ? reachOf(m) : 0;
    })
    .filter((n) => n > 0);
  if (baselineReaches.length < MIN_BASELINE_SAMPLE) {
    return NextResponse.json({
      ok: true,
      skipped: `baseline sample too small (${baselineReaches.length})`,
    });
  }
  const avgReach =
    baselineReaches.reduce((a, b) => a + b, 0) / baselineReaches.length;
  const threshold = Math.max(avgReach * OUTPERFORM_MULTIPLE, MIN_REACH_FLOOR);

  // Candidates: recent posts above threshold, best first.
  const candidates = rows
    .filter((r) => r.posted_at && r.posted_at >= recentCutoff)
    .map((r) => {
      const m = { metrics: r.metrics, media_type: r.media_type, platform: r.platform };
      return { row: r, reach: isReachReported(m) ? reachOf(m) : 0, engagements: engagementsOf(m) };
    })
    .filter((c) => c.reach >= threshold)
    .sort((a, b) => b.reach - a.reach);

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, alerted: 0, threshold: Math.round(threshold) });
  }

  // Dedupe against previously-sent performance alerts.
  const { data: priorAlerts } = await supabase
    .from("notifications")
    .select("metadata")
    .eq("type", "performance")
    .gte("created_at", baselineCutoff);
  const alreadyAlerted = new Set(
    (priorAlerts ?? [])
      .map((n) => {
        const md = n.metadata as Record<string, unknown> | null;
        return md && typeof md.post_id === "string" ? md.post_id : null;
      })
      .filter((id): id is string => !!id),
  );

  let alerted = 0;
  for (const c of candidates) {
    if (alerted >= MAX_ALERTS_PER_RUN) break;
    if (alreadyAlerted.has(c.row.id)) continue;

    const platform =
      c.row.platform === "facebook"
        ? "Facebook"
        : c.row.platform === "instagram"
          ? "Instagram"
          : "TikTok";
    const multiple = (c.reach / avgReach).toFixed(1);
    const snippet = (c.row.caption ?? "").replace(/\s+/g, " ").slice(0, 80);

    const result = await notifyAdmins({
      type: "performance",
      title: `${platform} post is taking off 📈`,
      body: `${fmt(c.reach)} reach — ${multiple}× the 30-day average. ${snippet}`,
      url: c.row.permalink || `/posts/${c.row.id}`,
      tag: `perf-${c.row.id}`,
      metadata: {
        post_id: c.row.id,
        platform: c.row.platform,
        reach: c.reach,
        engagements: c.engagements,
        avg_reach: Math.round(avgReach),
        url: c.row.permalink || `/posts/${c.row.id}`,
      },
    });
    if (result.logged > 0 || result.pushed > 0) alerted += 1;
  }

  return NextResponse.json({
    ok: true,
    alerted,
    candidates: candidates.length,
    avg_reach: Math.round(avgReach),
    threshold: Math.round(threshold),
  });
}
