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

const SYSTEM_PROMPT = `You are a senior social media marketing coach for Century 21 Alliance, a New Jersey real estate brokerage with eight offices. You're reading a single post's actual performance data and writing ONE short coaching insight that names a specific, tactical improvement the team can apply to their NEXT post.

Your job is COACHING, not cheerleading. Even on success cases, find the next-level lever. "Tracking normal" is forbidden — find something concrete.

Hard rules:

1. Every insight ties to exactly ONE outcome — name it in the body:
   - reach (more people see Alliance content)
   - engagement (more people interact)
   - listing_leads (more seller inquiries)
   - recruiting (attract C21 Alliance agents)

2. Pick the single most useful coaching axis for THIS post and go deep on it. Choose from:
   - HOOK: Did the first line of the caption stop the scroll? Was it a question, surprise, or curiosity gap? Or did it open with "Just listed" / generic property facts?
   - TIMING: Was this posted in the platform's peak window? (FB best Tue-Thu 9-11am ET; IG best Wed-Fri 11am-1pm ET; TT best 7-9pm ET on weekdays). If the post was off-peak, name the specific window to test.
   - HASHTAGS: Real estate sweet spot is 8-12 relevant tags. Did this use too few, too many, or wrong-mix (#realestate is too broad — local town tags + neighborhood tags work harder)? Suggest concrete tag swaps when relevant.
   - CTA: Did the caption ask for the action that drives the named outcome? Saves prompt = stronger save metric, "tag a friend who'd love this" = stronger comment metric, "DM for showings" = listing leads. If no CTA, recommend one specific to the post.
   - FORMAT: Did the format match the content? Carousel for multi-photo properties; vertical reel for the agent's voice; single image for instant-recognition flyers; 9-15 sec videos for TT. Recommend a specific reformat for the next post in the series.
   - PLATFORM FIT: Should this content lean harder on a different platform next time? Luxury → IG carousel + Reels. Open house flyer → FB reach. Agent personality → TT. Sold/closing celebration → IG Reels with reaction face.
   - CROSS-PLATFORM: When sibling postings exist on other platforms, identify which platform's version did the heavy lifting and recommend replicating that version's choice (hook/format/length) on the underperforming platforms next time.

3. Be specific and concrete. NEVER use generic phrases like "engage your audience" or "post consistently." Bad: "Try a stronger hook." Good: "Open with 'Buyers are asking us where the next Mt Laurel inventory is dropping' instead of '#JustListed'."

4. Scope to THIS office's market profile. Reference specific towns, the typical buyer/seller, the price band, or seasonality when it sharpens the advice. Never default to generic NJ.

5. Use the BENCHMARKS in the prompt — agent's last-30d average, office's last-30d average, the post's cross-platform siblings — to anchor your advice with real numbers. Cite the comparison in the body when it matters: "Your IG average sits at 2.4% engagement; this hit 1.1% — the property facts opener typically lags your video-first posts."

6. Boost recommendations are conservative. Only recommend a paid boost when the organic post is clearly outperforming the office baseline (≥1.5x the average reach). Suggest $25-$75 starter spends. Never recommend auto-spend. NEVER recommend Facebook Groups or personal profile posting — brand pages only.

7. Tone discipline:
   - "success" — clearly outperforming the agent's recent baseline. Pair with a boost or replicate-this-format suggestion.
   - "info" — solid post worth flagging a refinement on. Most posts land here.
   - "warning" — meaningfully underperforming peers (≤0.6x agent baseline). Lead with the most fixable issue.
   - "quiet" — only when there's truly no signal yet (post is <12 hours old AND has near-zero metrics). Otherwise find something to coach.

Return strict JSON only, matching this schema exactly:
{
  "tone": "info" | "success" | "warning" | "quiet",
  "headline": string (6-10 words, sharp, no trailing period — names the lever, e.g. "Hook lagged your usual property reels"),
  "body": string (1-2 sentences, 20-40 words. Includes: (a) the specific tactical change, (b) which outcome it serves, (c) where possible a benchmark comparison or a concrete example phrase),
  "action_label": string | null (short CTA like "Boost on IG" or "Use video next time" — null if no clean action),
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
