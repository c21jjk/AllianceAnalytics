/**
 * AI prompt module — multi-property Open House captions.
 *
 * Produces the system + user prompts that drive
 * `synthesizeMultiOHCaptionAI()` in `multi-oh-caption-ai.ts`. The Claude
 * call returns a per-platform JSON payload (IG / FB / TT body + 5-hashtag
 * arrays) that gets adapted into the same `MultiOHCaptionResult` shape the
 * deterministic synth returns.
 *
 * Module layout mirrors the canvas-editor design pipeline's prompt module
 * (`lib/post-builder/canvas-editor/ai/brand-prompt.ts`): one reusable brand
 * block, one system prompt builder, one user prompt builder, an embedded
 * exemplar caption that anchors the output shape, and an explicit JSON
 * contract at the bottom of the user prompt.
 *
 * Why this lives in `lib/post-builder/ai/` and not `canvas-editor/ai/`:
 *   • The canvas-editor pipeline is about image design — composition,
 *     layout, palette, type. This module is about prose. Different shape,
 *     different validators, different model (Haiku vs Sonnet/Opus).
 *   • Sharing a directory would tempt future code into reusing the
 *     wrong validator. Keeping them physically separated forces a
 *     deliberate choice.
 *
 * 2026-05-28 — first authoring. Expect to iterate the tone descriptors
 * + exemplar after the first week of Larissa-tested output.
 */
import "server-only";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Input bundle for the prompt builders. The caller (the AI synth module)
 * normalizes the wizard's full event payload down to this slim shape so
 * the prompts don't carry renderer-only fields the AI doesn't need.
 *
 * Fields:
 *   • properties — minimum set of address / city / OH window strings.
 *     `oh_window` is pre-formatted ("Saturday, May 16 | 10-12") so the
 *     prompt doesn't try to do timezone math.
 *   • tone — the wizard's tone selector value. `"auto"` is passed through
 *     for context, but the resolved tone (post-auto-detect) is what the
 *     prompt actually commits to.
 *   • hostingAgentNames — for voice context ONLY. The prompt explicitly
 *     instructs Claude NOT to include agent attribution in the caption
 *     body; the slides carry that.
 *   • captionOverride — when set, Claude polishes hashtags onto the
 *     override rather than replacing the body.
 *   • geoHint — the geographic phrase the deterministic synth would have
 *     used ("From Wildwood to Ocean City"). Passed so the AI has
 *     stylistic continuity rather than guessing.
 *   • resolvedTone — concrete tone the prompt commits to (never "auto").
 */
export interface MultiOhCaptionPromptInput {
  properties: Array<{
    address: string | null;
    city: string | null;
    oh_window: string;
  }>;
  tone: "auto" | "coastal" | "family" | "investor" | "cozy" | "editorial";
  hostingAgentNames: string[];
  captionOverride: string | null;
  geoHint: string;
  resolvedTone: "coastal" | "family" | "investor" | "cozy" | "editorial";
}

// ---------------------------------------------------------------------------
// Brand voice block — anchors every system prompt
// ---------------------------------------------------------------------------

/**
 * Encodes Alliance Century 21's caption voice in a reusable string. Same
 * pattern as `BRAND_BLOCK` in
 * `lib/post-builder/canvas-editor/ai/brand-prompt.ts` — prose, not bullets,
 * because Claude honors constraints more reliably when they're explained.
 */
const BRAND_VOICE_BLOCK = `\
BRAND CONTEXT — Alliance Social Analytics writing for Century 21 Alliance NJ.

You are writing in Larissa's voice. Larissa is the marketing lead at a top-tier Jersey-shore brokerage and a skilled writer with strong taste — she does NOT need beginner copywriting tips. Her voice is warm, direct, knowledgeable, and confident. She says "we'll have agents on-site" because she actually knows the team. She is NOT a corporate marketing voice — she's a real person who has been writing these captions for years.

Brand identity:
  • Century 21 Alliance — NJ shore (Wildwood, Cape May, Ocean City, Sea Isle, Stone Harbor, Avalon, Margate, Ventnor, Atlantic City) plus mainland Cape May County. The shore towns are the marketable theme; the mainland is for year-round families and investors.
  • Tagline-feel: "Mini commercials every day." Every post is a short, well-made cue to look — never preachy, never beginner-tier.
  • Voice principles: optimistic, advanced-only, views-first. Success is REACH (views, exposure), NOT engagement (saves, comments, likes). Write to stop the scroll, not to ask for a heart.

Hard rules — NON-NEGOTIABLE:
  • NEVER include "Hosted by", "with [Agent Name]", or any agent attribution in the caption body. The carousel slides carry that. If you reference an agent at all, the caption is broken.
  • NEVER use these clichés: "dream home", "don't miss out", "act fast", "won't last", "must-see", "stunning", "tucked away", "hidden gem". A bare "your forever home" is a cliché too; the multi-path version ("beach getaway, investment property, or your forever shore home") is OK.
  • NEVER use the word "sorted" — not as "weekend sorted", "lineup sorted", "covered and sorted", or any other construction. John flagged this on 2026-05-28 as overused. Use "ready", "lined up", "set", "queued", or simply omit the framing word.
  • NEVER invent property details that weren't provided. If the input says "115 W 6th Avenue, North Wildwood | 10-12" that's all you know about that property — do not add beds, baths, price, features.
  • Address bullets use the EXACT format: \`• {Address}, {City} | {TimeRange}\` — preserve verbatim. No AM/PM suffix on the time, no agent attribution after the time, no period at the end of the bullet.
  • Day headers use the EXACT format: \`📍 {Weekday}, {Month} {Day}\` — e.g., \`📍 Saturday, May 16\`. Always include the 📍 emoji.

Output shape — match this exemplar closely:

\`\`\`
🌊 Shore house hunting this weekend? We've got you covered. From Ocean City to Wildwood, come tour these incredible coastal properties and see what shore living is all about. 🌞🏡

📍 Saturday, May 16
• 115 W 6th Avenue, North Wildwood | 10-12
• 184 W Oak Avenue, Wildwood | 10-1
• 1934 West Ave, Ocean City | 12-2

📍 Sunday, May 17
• 1934 West Ave, Ocean City | 12-2
• 506 West Hampton Court, Swainton | 12-3
• 809 Turnberry Court, Swainton | 12-3

Whether you're looking for a beach getaway, investment property, or your forever shore home — stop by and take a look. 🖤💛

#century21alliance #shoredivision #openhouse #wildwoodnj
\`\`\`

(Note the exemplar has NO \`#southjerseyrealestate\` — every property in it sits in a shore town, so the South Jersey division tag does not apply. See HASHTAGS below.)

Structural rules drawn from the exemplar:
  1. Opening paragraph: emoji prefix + 2-3 short sentences + closing emoji bookend (tone-specific — see "Tone descriptors" below).
  2. Day-grouped bullet sections with 📍 day headers. One section per OH date. Inside each section, one bullet per property with the exact \`• {Address}, {City} | {TimeRange}\` format. Order the day sections STRICTLY CHRONOLOGICALLY — earliest date first (e.g. July 17 before July 18 before July 23). The EVENT DATA list is already sorted earliest-first; preserve that order and never reorder days.
  3. Closing paragraph: ONE sentence with multi-path hooks ("beach getaway, investment property, or your forever shore home" is the canonical example — three audience paths separated by commas/or, with an em-dash before the action). End with the tone-specific closing emoji bookend.
  4. Hashtag block: 4-5 hashtags depending on the division mix (see HASHTAGS below), comma-separated arrays NOT inline.

TONE DESCRIPTORS — pick exactly the one matching \`resolvedTone\`:
  • coastal — Shore lifestyle. Sand-between-toes, ocean-adjacent, beach getaway language. Opener prefix: 🌊. Closing bookend: 🌞🏡 on opener, 🖤💛 on closer.
  • family — Forever home, growing family, neighborhood, "find your next chapter". Opener prefix: 🏡. Closing bookend: 🌟🏡 on opener, 🖤💛 on closer.
  • investor — Rental yield, vacation rental income, appreciation math, "smart move". Opener prefix: 📈. Closing bookend: 🏠💰 on opener, 📈🖤 on closer.
  • cozy — Year-round, off-season charm, "settle in", small-town feel. Opener prefix: 🍂. Closing bookend: 🏡✨ on opener, 🖤💛 on closer.
  • editorial — Magazine voice, NO emoji anywhere (no opener prefix, no closing bookends, no day-header 📍 still allowed because it's structural, not decorative). Short. Confident. No hashtags-driven hype, just clean prose.

PLATFORM RULES:
  • Instagram ("ig"): full body. Aim for 4-6 sentences of prose around the bullet section. Hard ceiling: 2100 chars total.
  • Facebook ("fb"): same body as IG with a slightly more conversational closing. Hard ceiling: 1400 chars.
  • TikTok ("tt"): one-line opener + "Full schedule in the carousel." + one-line closer. Hard ceiling: 280 chars.

HASHTAGS — brand-fixed core, division tags are CONDITIONAL:
  • Always include \`#century21alliance\` and \`#openhouse\`.
  • Include \`#shoredivision\` ONLY if at least one property in EVENT DATA sits in a shore town (Wildwood, Cape May, Ocean City, Sea Isle, Stone Harbor, Avalon, Margate, Ventnor, Atlantic City, Brigantine, Longport, Strathmere, or any city whose name contains "beach", "shore", "coast", or "bay").
  • Include \`#southjerseyrealestate\` ONLY if at least one property sits OUTSIDE those shore towns (mainland / South Jersey division).
  • NEVER include a division tag when zero properties in EVENT DATA belong to that division — a Moorestown/Cherry Hill-only weekend gets \`#southjerseyrealestate\` and NOT \`#shoredivision\`; an all-Wildwood weekend gets \`#shoredivision\` and NOT \`#southjerseyrealestate\`. Mixed weekends (both kinds of towns) get both.
  • Plus exactly ONE regional tag based on the dominant city: \`#wildwoodnj\` (any Wildwood), \`#capemaynj\` (any Cape May), \`#oceancitynj\` (Ocean City), or \`#capemaycounty\` (mixed Cape May County). Skip the regional tag (or pick your best judgment) when no property matches those specific towns.
  • Total count will vary — 3 to 5 hashtags depending on how many of the above actually apply. Do NOT pad the array to hit a fixed count; a real 4-tag result is correct where a 5th tag doesn't apply.
  • For the \`editorial\` tone, apply the exact same conditional rules above — editorial doesn't change hashtag selection, only body prose.
  • Note: the consuming code re-derives the two division tags deterministically from the property list and will overwrite whatever you output here if it disagrees, so getting this right doesn't need to be perfect — but matching it means your caption preview (before reconciliation) looks correct too.`;

// ---------------------------------------------------------------------------
// Output contract footer — explicit JSON shape Claude must return
// ---------------------------------------------------------------------------

const JSON_CONTRACT_FOOTER = `\
Return ONLY a valid JSON object matching this exact schema. No prose, no commentary, no markdown fences, no trailing notes.

{
  "ig": { "body": "<string>", "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4"] },
  "fb": { "body": "<string>", "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4"] },
  "tt": { "body": "<string>", "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4"] }
}

Hashtag arrays MUST contain 3 to 5 strings each per the conditional HASHTAGS policy above — do not pad to a fixed count. Body strings MUST NOT include the hashtags inline — they're carried in the arrays so the consumer can render them per-platform. Body strings MUST honor the per-platform character ceilings above.`;

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Returns the system prompt for the caption pass. Stable per-call (no
 * input-driven branches) so Claude's prefix-cache can hit on repeat
 * generations.
 */
export function buildSystemPrompt(): string {
  return `${BRAND_VOICE_BLOCK}

You will receive the event data + a resolved tone + a geographic hint + (optionally) a Larissa-written override the user wants you to lightly polish. Compose the per-platform captions per the shape above and return them as the JSON object described in the output contract.

If a \`captionOverride\` field is present and non-empty, treat the override body as Larissa's final wording for the prose — DO NOT rewrite the body, only:
  1. Preserve the override text verbatim across all 3 platforms (clamp it down for TikTok if it exceeds 280 chars by taking the first sentence + "Full schedule in the carousel."),
  2. Append exactly 5 hashtags per the brand policy.

If the override is null or empty, compose fresh prose for all 3 platforms.`;
}

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the per-call user prompt. Includes the event data as JSON, the
 * resolved tone, the geo hint, an explicit note about hosting-agent
 * scope, optional caption override text, and the JSON output contract.
 */
export function buildUserPrompt(input: MultiOhCaptionPromptInput): string {
  const eventJson = JSON.stringify(
    {
      properties: input.properties.map((p) => ({
        address: p.address ?? "",
        city: p.city ?? "",
        oh_window: p.oh_window,
      })),
    },
    null,
    2,
  );

  const overrideBlock =
    input.captionOverride && input.captionOverride.trim().length > 0
      ? `\nCAPTION OVERRIDE (Larissa already wrote the body — preserve verbatim and just add hashtags per the system contract):\n\n"""\n${input.captionOverride.trim()}\n"""\n`
      : `\nCAPTION OVERRIDE: (none — compose fresh prose)\n`;

  const hostingNamesBlock =
    input.hostingAgentNames.length > 0
      ? `\nHOSTING AGENTS (for VOICE CONTEXT ONLY — do NOT include in caption body; slides carry attribution): ${input.hostingAgentNames.join(", ")}\n`
      : `\nHOSTING AGENTS: (none provided)\n`;

  const toneBlock =
    input.tone === "auto"
      ? `TONE REQUEST: "auto" — resolved by heuristic to "${input.resolvedTone}". Commit fully to the "${input.resolvedTone}" voice in the descriptors above.`
      : `TONE REQUEST: "${input.tone}" (explicit). Commit fully to the "${input.resolvedTone}" voice in the descriptors above.`;

  const geoBlock = input.geoHint.trim().length > 0
    ? `GEOGRAPHIC HINT: "${input.geoHint.trim()}" — feel free to use this phrasing in the opener, or rework it into something more natural for the tone.`
    : `GEOGRAPHIC HINT: (none — pick your own opener geography phrase)`;

  return [
    `EVENT DATA (do NOT invent properties or details outside this list):`,
    "",
    eventJson,
    "",
    toneBlock,
    "",
    geoBlock,
    overrideBlock,
    hostingNamesBlock,
    "",
    JSON_CONTRACT_FOOTER,
  ].join("\n");
}
