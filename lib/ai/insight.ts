/**
 * Per-post AI insight generation. Powers:
 *   - The strip at the bottom of each GroupCard on the homepage
 *   - The strip on /posts/[id]
 *
 * Mode (as of 2026-05-15): optimistic / advanced-only / views-first.
 * Larissa is a skilled operator — the prompt is explicitly forbidden from
 * surfacing beginner pointers (lighting, hook 101, posting times, generic
 * CTAs). It produces advanced moves (format laddering, signature series,
 * hook-pattern A/B, sound windows, cross-platform packaging) or nothing.
 *
 * Success metric is REACH vs. the office's last-30d baseline. High-reach
 * low-engagement posts are SUCCESS, not WARNING — saves/likes/comments are
 * nice-to-have, not the goal. "Mini commercials every day." See memory:
 * feedback_ai_coaching_tone.md.
 *
 * Powered by claude-opus-4-6.
 *
 * Hard rules baked into the prompt (per project AI Consultant rules):
 *   1. Every recommendation ties to one of FOUR outcomes:
 *      reach | engagement | listing_leads | recruiting
 *      (reach is the default for almost every post.)
 *   2. Recommendations are scoped to the relevant office's market profile.
 *      We pass the office row through; if a field is empty we omit it from
 *      the prompt rather than say "(no data)".
 *   3. Boost recommendations are conservative — small dollar suggestions,
 *      never auto-spend, and the human-approval gate is enforced upstream.
 *   4. Cross-platform sibling metrics + agent + office baselines are
 *      injected into every call so reach-vs-baseline advice is concrete.
 *   5. Tone is optimistic; if the only available advice is beginner-level,
 *      the model returns tone="quiet" rather than emitting basics.
 */
import "server-only";
import type { Post } from "@/lib/types/post";
import type { OfficeRow } from "@/lib/data/offices";
import { ANTHROPIC_MODELS, getAnthropic } from "./anthropic";

export type InsightTone = "info" | "success" | "warning" | "quiet";
export type InsightActionKind =
  | "boost_ig"
  | "boost_fb"
  | "boost_tt"
  | "pin_ig"
  | null;

export interface AiPostInsight {
  tone: InsightTone;
  /** Bold first phrase, ~6-10 words. */
  headline: string;
  /** Explanatory body, ~15-30 words. Mentions which of the four outcomes
   *  this insight serves (reach/engagement/listing leads/recruiting). */
  body: string;
  /** Optional CTA button label. */
  action_label?: string;
  /** Tagged kind so callers can wire deep-links. */
  action_kind?: InsightActionKind;
  /** Conservative reach lift estimate (optional). */
  est_reach?: number;
  /** Conservative dollar suggestion (optional). */
  est_cost?: number;
}

interface OfficeContextLines {
  /** Full block of office market profile lines, joined with newlines. */
  block: string;
  /** True only when the office has at least one filled market field. */
  hasContext: boolean;
}

function formatPrice(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(Number(n))) return null;
  return `$${Math.round(Number(n)).toLocaleString()}`;
}

function buildOfficeContext(office: OfficeRow | null | undefined): OfficeContextLines {
  if (!office) {
    return { block: "(no office linked to this post)", hasContext: false };
  }
  const lines: string[] = [];
  lines.push(`Office: ${office.display_name ?? office.name} (${office.short_code})`);

  const towns = (office.towns_served ?? []).filter((t) => t && t.trim().length > 0);
  if (towns.length > 0) {
    lines.push(`Towns served: ${towns.slice(0, 12).join(", ")}`);
  }
  if (office.primary_buyer_demo && office.primary_buyer_demo.trim()) {
    lines.push(`Typical buyer: ${office.primary_buyer_demo.trim()}`);
  }
  if (office.primary_seller_demo && office.primary_seller_demo.trim()) {
    lines.push(`Typical seller: ${office.primary_seller_demo.trim()}`);
  }
  if (office.seasonal_pattern && office.seasonal_pattern.trim()) {
    lines.push(`Seasonality: ${office.seasonal_pattern.trim()}`);
  }
  const median = formatPrice(office.price_range_median);
  const low = formatPrice(office.price_range_min);
  const high = formatPrice(office.price_range_high);
  if (median || low || high) {
    const parts: string[] = [];
    if (median) parts.push(`median ${median}`);
    if (low && high) parts.push(`range ${low}–${high}`);
    else if (low) parts.push(`from ${low}`);
    else if (high) parts.push(`up to ${high}`);
    lines.push(`Price band: ${parts.join(", ")}`);
  }
  const angles = (office.signature_angles ?? []).filter((a) => a && a.trim().length > 0);
  if (angles.length > 0) {
    lines.push(`Signature content angles: ${angles.slice(0, 8).join("; ")}`);
  }

  return {
    block: lines.join("\n"),
    hasContext: lines.length > 1, // more than just the name line
  };
}

/**
 * PROMPT_VERSION
 * --------------
 * Bump this string whenever the SYSTEM_PROMPT or heuristicInsight rules change
 * in a way that should invalidate existing coaching. The route handler folds
 * this into its in-memory cache key, so old entries become unreachable and the
 * next page view regenerates coaching against the new rules. Format: short
 * dot-separated semver-ish identifier — content doesn't matter, just unique.
 *
 *   v2.0.0 → 2026-05-15  Reframed to optimistic / advanced-only / views-first.
 *                        Replaced engagement-centric thresholds with reach-vs-
 *                        office-baseline. See feedback_ai_coaching_tone memory.
 *   v1.0.0 → original launch (engagement-rate-driven, corrective tone).
 */
export const PROMPT_VERSION = "v2.0.0" as const;

const SYSTEM_PROMPT = `You are a senior social media strategist embedded with Century 21 Alliance, a New Jersey real estate brokerage with eight offices. You are reading a single post's actual performance data and writing ONE short coaching insight for Larissa, the social media director.

WHO YOU ARE TALKING TO
Larissa is a professional. She has been doing this for years and produces content at a high level. She does not need beginner pointers. If the only thing you have to say is something a competent social operator already knows (use better lighting, write a stronger hook, post at peak times, add a CTA, use more hashtags), say nothing at all on that post — pick a different angle or stay quiet. Generic SaaS-blog real-estate advice is forbidden.

TONE
Optimistic, peer-to-peer, never corrective. Lead with what is working. Frame the next move as upside, not as a fix. The goal of these insights is to surface advanced moves that compound on what Larissa is already doing well — not to grade her.

WHAT SUCCESS LOOKS LIKE FOR THIS BUSINESS
Alliance posts are mini commercials. The job is to keep Alliance top of mind in each office's local market. Reach and views are the primary success metric. Saves, likes, and comments are nice-to-have but they are NOT the goal — Larissa's posts will rarely be saved and only a few will be liked or commented on. That is expected and fine.

A TikTok with 5,000 views and almost no comments is a SUCCESS. Do not treat low engagement on a high-reach post as a problem. Do not rank posts by engagement rate. Rank by reach relative to that office's recent baseline.

THE FOUR OUTCOMES
Every insight ties to exactly ONE outcome — name it in the body:
- reach (more people see Alliance content) — this is the default for almost every post
- engagement (only when the post is specifically engineered for comments/saves, e.g. a poll or a giveaway)
- listing_leads (more seller inquiries — typically when the post is recruiting-listings flavored)
- recruiting (attract C21 Alliance agents)

ADVANCED COACHING AXES — pick ONE per insight and go deep
- FORMAT LADDERING: this post worked at format X — sequence it with a follow-up at format Y next week to compound the impressions (e.g., reel → carousel → static flyer same listing).
- SIGNATURE SERIES: tag this post into a repeatable series the audience can subscribe to (e.g., "Tuesday Tours of [Town]"). Recommend a recurring slot if the series doesn't exist yet.
- HOOK PATTERN A/B: identify the specific opener pattern that worked and recommend testing a sibling variant on the next post (not "use a stronger hook" — name the actual pattern: "Curiosity-gap opener like 'I almost missed this one' pulled 3x your usual reach on portrait video — try it again on the next coastal listing").
- SOUND / TREND WINDOW: when the post is video, flag whether the trending audio window is still open or closing, and recommend a specific replacement sound family. Only when there's a real call to make — do not fabricate a trending sound.
- CROSS-PLATFORM PACKAGING: when sibling postings exist, identify which platform's version did the heavy lifting and recommend porting that version's specific choice (hook line / aspect ratio / length) to the laggards.
- TOP-TIER REPLICATION: if this post is clearly in this office's top decile by reach, name what's replicable about it ("This is a top-decile reach post for the Cape May office — the 'one-line headline + interior reel' shape is your strongest local pattern; queue another with the Wildwood inventory").
- LOCAL MARKET LEVER: pull from the office's market profile (specific towns, buyer type, price band, seasonality) to suggest a content angle that the AVERAGE NJ real-estate agent could not have suggested. If you can't find one, skip this axis.

HARD RULES
1. NEVER use beginner-level advice. No "use better lighting." No "post at peak times." No "add a CTA." No "use more hashtags." No "engage your audience." If the only insight you can produce is one of these, return tone="quiet" with a short observation instead.
2. Use the BENCHMARKS in the prompt to anchor advice with real numbers, but anchor on REACH, not engagement rate. Cite reach vs. the office baseline when it sharpens the call: "Reach hit 4,200 vs. your office's 1,300 last-30d average — top-tier for [office]."
3. Scope to THIS office's market profile when geography matters. Use specific town names, the typical buyer/seller, the price band. Never default to generic NJ.
4. Boost recommendations only when reach is clearly outperforming the office baseline (≥1.5x the office's avg_reach). Suggest $25-$75 starter spends. Never auto-spend. NEVER recommend Facebook Groups or personal profile posting — brand pages only.

TONE FIELD — based on REACH vs. office baseline
- "success" → reach ≥ 1.2x the office's avg_reach (or ≥ 1.5x for a clear top-tier callout). Frame the insight as "replicate this" or "this is boost-worthy." High views with low engagement still lands here — that's a win.
- "info" → reach is roughly on the office's baseline. Default tone. Frame the insight as an advanced lever to try on the next post.
- "warning" → reach is meaningfully below the office baseline (≤ 0.5x). Even here, stay optimistic — name the advanced lever that would have lifted reach, do not list beginner fixes.
- "quiet" → use this when (a) the post is too new to judge (already filtered upstream, but defend-in-depth), OR (b) you genuinely don't have an advanced angle worth surfacing for this specific post. Better to be quiet than to ship a beginner pointer.

OUTPUT FORMAT
Return strict JSON only, matching this schema exactly:
{
  "tone": "info" | "success" | "warning" | "quiet",
  "headline": string (6-10 words, optimistic and concrete, no trailing period — name the advanced lever, e.g. "Top-decile reach — queue a series follow-up"),
  "body": string (1-2 sentences, 20-40 words. Includes: (a) the specific advanced move, (b) which outcome it serves, (c) the reach-vs-baseline comparison where it matters. Treat high-reach low-engagement as a win.),
  "action_label": string | null (short CTA like "Boost on IG" or "Queue a portrait sibling" — null if no clean action),
  "action_kind": "boost_ig" | "boost_fb" | "boost_tt" | "pin_ig" | null,
  "est_reach": number | null (conservative additional reach if action taken),
  "est_cost": number | null (suggested USD spend if action recommends spend)
}`;

interface ModelInsightShape {
  tone?: string;
  headline?: string;
  body?: string;
  action_label?: string | null;
  action_kind?: string | null;
  est_reach?: number | null;
  est_cost?: number | null;
}

function asTone(value: unknown): InsightTone {
  if (value === "info" || value === "success" || value === "warning" || value === "quiet") {
    return value;
  }
  return "info";
}

function asActionKind(value: unknown): InsightActionKind {
  if (
    value === "boost_ig" ||
    value === "boost_fb" ||
    value === "boost_tt" ||
    value === "pin_ig"
  ) {
    return value;
  }
  return null;
}

/** Strict JSON extraction — Opus/Sonnet sometimes wrap in ```json fences. */
function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  // Strip code fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Try to grab the first {...} block
    const match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function platformLabel(p: Post["platform"]): string {
  if (p === "instagram") return "Instagram";
  if (p === "tiktok") return "TikTok";
  return "Facebook";
}

function summarizePost(post: Post): string {
  const captionPreview = (post.caption ?? "").slice(0, 280);
  const m = post.metrics;
  const totalEngagements = m.likes + m.comments + m.shares + m.saves;
  const lines = [
    `Platform: ${platformLabel(post.platform)}`,
    `Posted: ${post.posted_at}`,
    `Media type: ${post.media_type}`,
    `Reach: ${m.reach}`,
    `Impressions: ${m.impressions}`,
    `Likes: ${m.likes} · Comments: ${m.comments} · Shares: ${m.shares} · Saves: ${m.saves}`,
    `Total engagements: ${totalEngagements}`,
    `Engagement rate: ${(m.engagement_rate * 100).toFixed(2)}%`,
  ];
  if (m.plays !== undefined) lines.push(`Plays: ${m.plays}`);
  if (m.completion_rate !== undefined)
    lines.push(`Completion rate: ${(m.completion_rate * 100).toFixed(1)}%`);
  if (m.profile_visits !== undefined) lines.push(`Profile visits: ${m.profile_visits}`);
  if (m.follows !== undefined) lines.push(`New follows: ${m.follows}`);
  if (m.link_clicks !== undefined) lines.push(`Link clicks: ${m.link_clicks}`);
  if (post.category) lines.push(`Category: ${post.category}`);
  if (post.property?.address) lines.push(`Linked property: ${post.property.address}`);
  if (post.agent_name) lines.push(`Agent: ${post.agent_name}`);
  lines.push(`Caption: ${captionPreview}`);
  if (post.hashtags && post.hashtags.length > 0) {
    lines.push(`Hashtags: ${post.hashtags.slice(0, 12).join(" ")}`);
  }
  return lines.join("\n");
}

/**
 * Heuristic fallback used when no Anthropic API key is configured.
 *
 * Why this exists: the production code path always returns null (and the UI
 * hides the strip) when the API isn't configured — see route.ts. This
 * heuristic only runs in test/dev contexts where a Post is passed directly
 * to generatePostInsight without an API key. We keep it deliberately
 * conservative.
 *
 * Rules (mirroring SYSTEM_PROMPT — see feedback_ai_coaching_tone memory):
 *   • Optimistic tone. Never corrective.
 *   • Success metric is REACH, not engagement rate.
 *   • Without an office baseline we can't make a real reach-vs-baseline call
 *     so we fall back to a high-reach absolute floor and otherwise stay quiet.
 *   • The "Below your usual engagement" warning that used to live here is
 *     intentionally removed — high-reach low-engagement is a WIN.
 */
function heuristicInsight(post: Post): AiPostInsight {
  const m = post.metrics;

  // High reach in absolute terms → success. Threshold deliberately set above
  // a typical Alliance post's reach so we don't false-positive on average
  // posts. Without a baseline this is the safest signal we can derive.
  if (m.reach >= 2000) {
    const platform = post.platform;
    const kind: InsightActionKind =
      platform === "instagram"
        ? "boost_ig"
        : platform === "facebook"
          ? "boost_fb"
          : "boost_tt";
    return {
      tone: "success",
      headline: "Strong reach — queue a sibling format",
      body: `Reach hit ${m.reach.toLocaleString()} on ${platformLabel(platform)}. Serves reach: replicate the shape next week with a different listing in the same series.`,
      action_label: `Boost on ${platformLabel(platform)}`,
      action_kind: kind,
      est_cost: 35,
    };
  }

  // Anything else → quiet. Better to say nothing than to surface a beginner
  // pointer. The Opus prompt does the real work in production; this fallback
  // is intentionally minimal.
  return {
    tone: "quiet",
    headline: "Tracking",
    body: "No advanced lever to surface on this one — reach is in normal range for the format.",
  };
}

/** Sibling posting on another platform within the same campaign group. */
export interface SiblingPostingSnapshot {
  platform: Post["platform"];
  reach: number;
  engagement_rate: number;
  total_engagements: number;
  is_video: boolean;
}

/** Aggregated last-30d baseline for an agent or an office. */
export interface BaselineSnapshot {
  /** How many posts contributed to the average. */
  sample_size: number;
  /** Mean reach across the sample. */
  avg_reach: number;
  /** Mean engagement rate (0..1) across the sample. */
  avg_engagement_rate: number;
}

export interface InsightContext {
  /** Sibling posts on other platforms in the same campaign group. */
  siblings?: SiblingPostingSnapshot[];
  /** Agent's last-30-day post average (across all platforms). */
  agent_baseline?: BaselineSnapshot | null;
  /** Office's last-30-day post average (across all platforms). */
  office_baseline?: BaselineSnapshot | null;
}

function platformBucket(p: Post["platform"]): string {
  return p === "instagram" ? "IG" : p === "tiktok" ? "TT" : "FB";
}

function summarizeSiblings(siblings: SiblingPostingSnapshot[] | undefined): string {
  if (!siblings || siblings.length === 0) {
    return "(no sibling postings on other platforms — this is a single-platform post)";
  }
  return siblings
    .map(
      (s) =>
        `${platformBucket(s.platform)}: reach ${s.reach}, engagements ${s.total_engagements} (rate ${(
          s.engagement_rate * 100
        ).toFixed(2)}%)${s.is_video ? ", video" : ""}`,
    )
    .join("\n");
}

function summarizeBaseline(
  label: string,
  baseline: BaselineSnapshot | null | undefined,
): string {
  if (!baseline || baseline.sample_size === 0) {
    return `${label}: no recent posts to compare against`;
  }
  return `${label}: ${baseline.sample_size} posts in last 30d · avg reach ${Math.round(
    baseline.avg_reach,
  )} · avg engagement rate ${(baseline.avg_engagement_rate * 100).toFixed(2)}%`;
}

/**
 * Main entry. Returns an AiPostInsight describing this post, scoped to the
 * given office's market profile + this post's benchmarks. Falls back to a
 * heuristic when no API key is configured so the surface still has _something_
 * usable, but the calling route returns null in that case so the UI hides
 * itself silently.
 */
export async function generatePostInsight(
  post: Post,
  office: OfficeRow | null | undefined,
  context: InsightContext = {},
): Promise<AiPostInsight> {
  const client = await getAnthropic();
  if (!client) {
    return heuristicInsight(post);
  }

  const officeCtx = buildOfficeContext(office);
  const userPrompt = [
    "POST PERFORMANCE",
    summarizePost(post),
    "",
    "CROSS-PLATFORM SIBLINGS (same campaign on other platforms)",
    summarizeSiblings(context.siblings),
    "",
    "BENCHMARKS",
    summarizeBaseline("Agent baseline", context.agent_baseline),
    summarizeBaseline("Office baseline", context.office_baseline),
    "",
    "OFFICE MARKET PROFILE",
    officeCtx.block,
    "",
    officeCtx.hasContext
      ? "Use this market profile heavily. Reference specific towns, buyer/seller types, or angles where they apply."
      : "Office market profile is not yet filled out — keep recommendations generic to NJ residential RE and avoid town-specific claims.",
    "",
    "Return only the JSON object, no prose.",
  ].join("\n");

  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODELS.opus,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = extractJson(raw) as ModelInsightShape | null;
    if (!parsed) {
      console.error("[insight] failed to parse model output:", raw);
      return heuristicInsight(post);
    }

    return {
      tone: asTone(parsed.tone),
      headline:
        typeof parsed.headline === "string" && parsed.headline.trim()
          ? parsed.headline.trim()
          : "Insight",
      body:
        typeof parsed.body === "string" && parsed.body.trim()
          ? parsed.body.trim()
          : "Tracking normal.",
      action_label:
        typeof parsed.action_label === "string" && parsed.action_label.trim()
          ? parsed.action_label.trim()
          : undefined,
      action_kind: asActionKind(parsed.action_kind),
      est_reach:
        typeof parsed.est_reach === "number" && Number.isFinite(parsed.est_reach)
          ? parsed.est_reach
          : undefined,
      est_cost:
        typeof parsed.est_cost === "number" && Number.isFinite(parsed.est_cost)
          ? parsed.est_cost
          : undefined,
    };
  } catch (e) {
    console.error("[insight] anthropic call failed:", e);
    return heuristicInsight(post);
  }
}
