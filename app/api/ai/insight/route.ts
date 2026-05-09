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
import { generatePostInsight } from "@/lib/ai/insight";
import { isAnthropicConfigured } from "@/lib/ai/anthropic";

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

    const insight = await generatePostInsight(post, office);
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

