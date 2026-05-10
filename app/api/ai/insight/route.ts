/**
 * POST /api/ai/insight
 * Body: { post_id: string }
 *
 * Returns the AI insight payload for a single post, scoped to the post's
 * linked office market profile. Auth-gated to signed-in Alliance users.
 *
 * Caching: per-post results live in an in-memory Map keyed by post_id, with
 * a 30-minute TTL. We don't burn Sonnet tokens on every page render, but the
 * insight refreshes within half an hour of new metrics rolling in. The ID is
 * derived from a short hash of post_id + posted_at so a hot reload doesn't
 * re-issue if the same post is requested moments later.
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getPostById } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generatePostInsight,
  type BaselineSnapshot,
  type InsightContext,
  type SiblingPostingSnapshot,
} from "@/lib/ai/insight";
import { isAnthropicConfigured } from "@/lib/ai/anthropic";
import type { Platform } from "@/lib/types/post";

export const dynamic = "force-dynamic";

interface CacheEntry {
  payload: unknown;
  expires: number;
}

// Simple per-server-instance memoization. A real shared cache (KV / Redis)
// can replace this without touching callers — the route just needs to return
// the same shape.
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map<string, CacheEntry>();

function readCache(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function writeCache(key: string, payload: unknown) {
  cache.set(key, { payload, expires: Date.now() + CACHE_TTL_MS });
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Hide the surface entirely if Anthropic isn't configured.
  // The client treats null as "don't render" rather than as an error.
  const configured = await isAnthropicConfigured();
  if (!configured) {
    return NextResponse.json({ insight: null, configured: false });
  }

  let body: { post_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // ignore
  }
  const postId = (body.post_id ?? "").trim();
  if (!postId) {
    return NextResponse.json({ error: "post_id required" }, { status: 400 });
  }

  // Cache check — by post id only, fine because metrics are aggregated and
  // the 30-minute TTL bounds staleness anyway.
  const cached = readCache(postId);
  if (cached) {
    return NextResponse.json({ insight: cached, configured: true, cached: true });
  }

  try {
    const post = await getPostById(postId);
    if (!post) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }

    // 24h gate — coaching insights need at least one full day of distribution
    // before they're useful. Initial spikes mislead one way (premature
    // boost), early stalls mislead the other way (post hasn't peaked yet).
    // Skip the Opus call entirely for too-recent posts; the strip renders
    // a muted "settling" placeholder when too_recent is true.
    const MIN_AGE_MS = 24 * 3600 * 1000;
    if (post.posted_at) {
      const ageMs = Date.now() - new Date(post.posted_at).getTime();
      if (ageMs < MIN_AGE_MS) {
        return NextResponse.json({
          insight: null,
          configured: true,
          too_recent: true,
        });
      }
    }

    // Look up the office row directly so we have the market profile fields.
    // posts.office_id isn't on the Post type yet — read it from the table.
    const supabase = createAdminClient();
    const { data: postRow } = await supabase
      .from("posts")
      .select("office_id")
      .eq("id", postId)
      .maybeSingle();
    let office = null;
    if (postRow?.office_id) {
      const { data: officeRow } = await supabase
        .from("offices")
        .select("*")
        .eq("id", postRow.office_id)
        .maybeSingle();
      office = officeRow ?? null;
    }
    // If we don't have an office_id yet but the property has one, use that.
    if (!office && post.property?.mls) {
      const { data: propRow } = await supabase
        .from("properties")
        .select("office_id")
        .eq("mls_number", post.property.mls)
        .maybeSingle();
      if (propRow?.office_id) {
        const { data: fallback } = await supabase
          .from("offices")
          .select("*")
          .eq("id", propRow.office_id)
          .maybeSingle();
        office = fallback ?? null;
      }
    }

    // Build the coaching context: cross-platform siblings + agent + office
    // baselines. All three are optional — the prompt handles missing data
    // gracefully — but the more we feed in, the sharper the insight.
    const context = await buildInsightContext(supabase, post, postId);

    const insight = await generatePostInsight(post, office, context);
    writeCache(postId, insight);
    return NextResponse.json({ insight, configured: true });
  } catch (e) {
    console.error("[/api/ai/insight] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "insight failed" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Coaching context builder
// ---------------------------------------------------------------------------

/**
 * Pull cross-platform siblings + agent + office baselines for the model.
 * All queries are best-effort; failures degrade to no-context rather than
 * blocking the insight.
 */
async function buildInsightContext(
  supabase: ReturnType<typeof createAdminClient>,
  post: Awaited<ReturnType<typeof getPostById>>,
  postId: string,
): Promise<InsightContext> {
  if (!post) return {};
  const ctx: InsightContext = {};

  try {
    // Find this post's group_id, then fetch the other postings in the group.
    const { data: thisRow } = await supabase
      .from("posts")
      .select("group_id, agent_name, office_id, posted_at")
      .eq("id", postId)
      .maybeSingle();

    if (thisRow?.group_id) {
      const { data: siblingRows } = await supabase
        .from("posts")
        .select("platform, metrics, media_type")
        .eq("group_id", thisRow.group_id)
        .neq("id", postId);
      const siblings: SiblingPostingSnapshot[] = ((siblingRows ?? []) as Array<{
        platform: Platform;
        metrics: Record<string, unknown> | null;
        media_type: string | null;
      }>).map((r) => {
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        const reach = Number(m.reach ?? 0) || 0;
        const eng =
          (Number(m.likes ?? 0) || 0) +
          (Number(m.comments ?? 0) || 0) +
          (Number(m.shares ?? 0) || 0) +
          (Number(m.saves ?? 0) || 0);
        const rate = reach > 0 ? eng / reach : 0;
        return {
          platform: r.platform,
          reach,
          engagement_rate: rate,
          total_engagements: eng,
          is_video:
            r.media_type === "video" || r.media_type === "reel",
        };
      });
      if (siblings.length > 0) ctx.siblings = siblings;
    }

    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();

    // Agent baseline — average reach + engagement rate across the same agent's
    // last 30d of posts (excluding this one).
    if (thisRow?.agent_name) {
      const { data: agentRows } = await supabase
        .from("posts")
        .select("metrics, posted_at")
        .eq("agent_name", thisRow.agent_name)
        .neq("id", postId);
      ctx.agent_baseline = aggregateBaseline(agentRows, cutoff);
    }

    // Office baseline — same shape, scoped to office_id.
    if (thisRow?.office_id) {
      const { data: officeRows } = await supabase
        .from("posts")
        .select("metrics, posted_at")
        .eq("office_id", thisRow.office_id)
        .neq("id", postId);
      ctx.office_baseline = aggregateBaseline(officeRows, cutoff);
    }
  } catch (e) {
    console.error("[insight] buildInsightContext failed:", e);
  }

  return ctx;
}

function aggregateBaseline(
  rows: unknown,
  cutoffIso: string,
): BaselineSnapshot | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let count = 0;
  let totalReach = 0;
  let totalRate = 0;
  for (const r of rows as Array<{
    metrics: Record<string, unknown> | null;
    posted_at: string | null;
  }>) {
    if (!r.posted_at || r.posted_at < cutoffIso) continue;
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    const reach = Number(m.reach ?? 0) || 0;
    if (reach === 0) continue; // skip zero-reach posts to avoid skewing low
    const eng =
      (Number(m.likes ?? 0) || 0) +
      (Number(m.comments ?? 0) || 0) +
      (Number(m.shares ?? 0) || 0) +
      (Number(m.saves ?? 0) || 0);
    const rate = eng / reach;
    totalReach += reach;
    totalRate += rate;
    count++;
  }
  if (count === 0) return null;
  return {
    sample_size: count,
    avg_reach: totalReach / count,
    avg_engagement_rate: totalRate / count,
  };
}

