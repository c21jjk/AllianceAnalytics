/**
 * Per-post AI insight generation. Powers:
 *   - The strip at the bottom of each GroupCard on the homepage
 *   - The strip on /posts/[id]
 *
 * Hard rules baked into the prompt (per project AI Consultant rules):
 *   1. Every recommendation ties to one of FOUR outcomes:
 *      reach | engagement | listing_leads | recruiting
 *   2. Recommendations are scoped to the relevant office's market profile.
 *      We pass the office row through; if a field is empty we omit it from
 *      the prompt rather than say "(no data)".
 *   3. Boost recommendations are conservative — small dollar suggestions,
 *      never auto-spend, and the human-approval gate is enforced upstream.
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

const SYSTEM_PROMPT = `You are an AI marketing consultant for Century 21 Alliance, a New Jersey real estate brokerage with eight offices. Your job is to read a single social media post's performance and write ONE short, useful insight strip.

Hard rules:
1. Every insight must serve exactly ONE of these four outcomes (call it out explicitly in the body):
   - reach (more people see Alliance content)
   - engagement (more people interact)
   - listing_leads (more seller inquiries)
   - recruiting (attract C21 Alliance agents)
2. Scope every recommendation to THIS specific office's market profile. Use towns served, demographics, seasonality, price band, and signature angles when relevant. Never default to a generic NJ market.
3. Be conservative on paid boost recommendations. Suggest small starter spends ($25-$75 typical) and only when the organic post clearly outperforms the office's baseline. Never recommend auto-spend.
4. NEVER recommend Facebook Groups posting, NEVER recommend posting from personal profiles. Only the brand pages.
5. Tone discipline:
   - "success" — celebratory, post is overperforming, often paired with a boost or pin recommendation.
   - "info" — neutral observation worth surfacing, often paired with a follow-up content idea.
   - "warning" — underperforming meaningfully vs. peer posts; suggest a fix.
   - "quiet" — nothing remarkable. Use this when metrics are at baseline.

Return strict JSON only, matching this schema exactly:
{
  "tone": "info" | "success" | "warning" | "quiet",
  "headline": string (6-10 words, no trailing period),
  "body": string (1-2 sentences, 15-30 words, name the outcome served e.g. "Boosts reach for the Marlton seller audience."),
  "action_label": string | null (short CTA like "Boost on IG" — null if no action),
  "action_kind": "boost_ig" | "boost_fb" | "boost_tt" | "pin_ig" | null,
  "est_reach": number | null (conservative additional reach if action taken),
  "est_cost": number | null (suggested USD spend if action recommends spend)
}

If the post has so little data that you can't say anything useful, return tone "quiet" with a one-line "Tracking normal." style body and no action.`;

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

/** Strict JSON extraction — Sonnet sometimes wraps in ```json fences. */
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
 * Heuristic fallback used when no API key is configured. Mirrors the prior
 * UI behavior so the strip degrades gracefully.
 */
function heuristicInsight(post: Post): AiPostInsight {
  const m = post.metrics;
  // Strong engagement → success, suggest a small boost
  if (m.engagement_rate >= 0.06 && m.reach >= 500) {
    const platform = post.platform;
    const kind: InsightActionKind =
      platform === "instagram"
        ? "boost_ig"
        : platform === "facebook"
          ? "boost_fb"
          : "boost_tt";
    return {
      tone: "success",
      headline: "Outperforming your office baseline",
      body: `Engagement rate is ${(m.engagement_rate * 100).toFixed(1)}% — well above baseline. Serves reach: a small boost would extend the audience.`,
      action_label: `Boost on ${platformLabel(platform)}`,
      action_kind: kind,
      est_cost: 35,
    };
  }
  if (m.reach > 0 && m.engagement_rate < 0.015) {
    return {
      tone: "warning",
      headline: "Below your usual engagement",
      body: `Engagement rate is ${(m.engagement_rate * 100).toFixed(1)}%. Serves engagement: try a stronger hook in the first line next time.`,
    };
  }
  return {
    tone: "quiet",
    headline: "Tracking normal",
    body: "Tracking normal.",
  };
}

/**
 * Main entry. Returns an AiPostInsight describing this post, scoped to the
 * given office's market profile. Falls back to a heuristic when no API key
 * is configured so the surface still has _something_ usable, but the calling
 * route returns null in that case so the UI hides itself silently.
 */
export async function generatePostInsight(
  post: Post,
  office: OfficeRow | null | undefined,
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
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 600,
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
