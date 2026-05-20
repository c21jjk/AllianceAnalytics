import "server-only";
import { getAnthropic, ANTHROPIC_MODELS } from "@/lib/ai/anthropic";
import type { WeeklySocialReportData } from "./weekly-social-data";

/**
 * Generates the one-line "AI takeaway" shown in the weekly social report.
 *
 * Tone constraints (from project memory):
 *   - Optimistic, advanced-only, views-first.
 *   - Larissa is skilled — no basic pointers ("be consistent", "post more").
 *   - Success = views/exposure, NOT saves/likes/comments.
 *   - Think "mini commercials every day" — Alliance is producing volume reach.
 *
 * Output is a single sentence, ~12–24 words, no emoji, no caveats, no
 * disclaimers. Never blocks the send — on any failure (Claude key missing,
 * API error, parse error) we return a safe static fallback.
 */

const FALLBACK_LINE =
  "Solid week of mini-commercials across the lineup — Alliance Social keeps the brand in motion.";

const SYSTEM_PROMPT = `You write a single optimistic one-liner for a real-estate brokerage's weekly social-media report.

Rules:
- Output EXACTLY one sentence. No emoji. No quote marks. No prefix/preamble.
- 12–24 words.
- Optimistic and forward-leaning, but specific to the data — don't generalize.
- Frame success around reach / views / exposure, not likes / comments / saves.
- Treat the team as skilled professionals. No basic advice. No "consider posting more."
- Allowed: identify what worked, name the platform momentum, point to the campaign or office driving reach.
- Tone: leadership-voice newsletter. Not a coach pep talk, not a memo.`;

interface WeekDigest {
  weekLabel: string;
  totalReach: number;
  prevReach: number;
  weekYoYReach: number;
  perPlatform: {
    facebook: { reach: number; posts: number; prev: number };
    instagram: { reach: number; posts: number; prev: number };
    tiktok: { reach: number; posts: number; prev: number };
  };
  topCampaign: {
    reach: number;
    platforms: string[];
    captionSnippet: string;
  } | null;
  topOffice: { name: string; reach: number } | null;
  topAgent: { name: string; reach: number } | null;
  ytdReach: number;
  ytdReachLastYear: number;
}

function digest(d: WeeklySocialReportData): WeekDigest {
  const top = d.topCampaigns[0] ?? null;
  return {
    weekLabel: `${d.weekStartLabel}–${d.weekEndLabel}`,
    totalReach: d.totals.reach,
    prevReach: d.prevTotals.reach,
    weekYoYReach: d.weekYoY.reach,
    perPlatform: {
      facebook: {
        reach: d.byPlatform.facebook.reach,
        posts: d.byPlatform.facebook.posts,
        prev: d.prevByPlatform.facebook.reach,
      },
      instagram: {
        reach: d.byPlatform.instagram.reach,
        posts: d.byPlatform.instagram.posts,
        prev: d.prevByPlatform.instagram.reach,
      },
      tiktok: {
        reach: d.byPlatform.tiktok.reach,
        posts: d.byPlatform.tiktok.posts,
        prev: d.prevByPlatform.tiktok.reach,
      },
    },
    topCampaign: top
      ? {
          reach: top.mergedReach,
          platforms: top.platforms,
          captionSnippet: (top.caption ?? "").slice(0, 120),
        }
      : null,
    topOffice: d.officeSpotlight
      ? { name: d.officeSpotlight.name, reach: d.officeSpotlight.reach }
      : null,
    topAgent: d.agentLeaderboard[0]
      ? {
          name: d.agentLeaderboard[0].display_name,
          reach: d.agentLeaderboard[0].reach,
        }
      : null,
    ytdReach: d.ytd.reach,
    ytdReachLastYear: d.ytdYoY.reach,
  };
}

/**
 * Returns the AI one-liner. Never throws; falls back to a static line on
 * any failure path (no key, no network, bad shape, etc.).
 */
export async function generateWeeklyTakeaway(
  data: WeeklySocialReportData,
): Promise<string> {
  // If the week had zero activity, skip the API call entirely — there's
  // nothing optimistic and data-grounded we could say truthfully.
  if (data.totals.posts === 0 && data.totals.reach === 0) {
    return "No new posts logged for this window — sync may catch fresh activity before the next send.";
  }

  try {
    const client = await getAnthropic();
    if (!client) return FALLBACK_LINE;

    const userPayload = JSON.stringify(digest(data), null, 2);

    const resp = await client.messages.create({
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Weekly stats for Alliance Social:\n\n${userPayload}\n\nWrite the one-line takeaway.`,
        },
      ],
    });

    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    const cleaned = cleanLine(text);
    return cleaned.length > 0 ? cleaned : FALLBACK_LINE;
  } catch (err) {
    console.error("[weekly-takeaway] generation failed:", err);
    return FALLBACK_LINE;
  }
}

/** Strip surrounding quotes, take only the first sentence, cap length. */
function cleanLine(raw: string): string {
  let s = raw.replace(/^[\s"'`]+|[\s"'`]+$/g, "");
  // Take only the first line if Claude produced multiple.
  const firstLine = s.split(/\r?\n/)[0]?.trim() ?? "";
  s = firstLine;
  // Strip any leading "Takeaway:" / "Summary:" style preamble.
  s = s.replace(/^(takeaway|summary|insight|note)\s*[:—-]\s*/i, "");
  // Cap at 280 chars just in case.
  if (s.length > 280) s = s.slice(0, 277).trimEnd() + "…";
  return s;
}
