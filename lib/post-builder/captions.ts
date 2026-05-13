import "server-only";
import { getAnthropic, ANTHROPIC_MODELS } from "@/lib/ai/anthropic";
import type { PostBuilderListing, PostType } from "./types";

/**
 * Caption + hashtag generation for Post Builder posts.
 *
 * Tone is driven by post_type (per the planning convo with John —
 * per-office voice tuning is a v2 problem). Just Listed = excited intro,
 * Just Sold = celebratory close, UC = momentum, Open House = invitation.
 *
 * Hashtags are assembled deterministically (brand + post type + canonical
 * MLS hashtag) with AI-suggested local/market tags layered on top. The
 * canonical MLS hashtag is what makes the auto-linker tie this back to
 * the listing once Larissa posts it.
 */

export interface GeneratedCaption {
  caption: string;
  hashtags: string[];
  /** The canonical MLS hashtag (e.g. "#CMC230456"). Always included in `hashtags`. */
  mls_hashtag: string;
}

const POST_TYPE_TONE: Record<PostType, string> = {
  just_listed:
    "excited but understated. Open with the address or a confident hook (NOT 'Just Listed!' — that's already on the image). Use 2-4 sentences max. Highlight what makes THIS property worth seeing — a specific feature from the property remarks if anything stands out. End with a soft CTA like 'DM for a private showing' or 'Tour link in bio'.",
  just_sold:
    "celebratory and warm. Congratulate the new owners (without naming them). Acknowledge the agent's work briefly if known. 2-3 sentences. End with a confidence line like 'Thinking of selling? Let's talk.'",
  under_contract:
    "momentum-forward. Quick, snappy. Note that it's under contract in days/weeks if known (we don't track that yet — keep generic). 1-2 sentences. End with a buyer-pipeline line like 'Have a similar dream property in mind? Let's find it.'",
  open_house:
    "warm invitation. Lead with the date and time prominently in the caption text (the image will also show it). Mention what's special about the property in one sentence. End with 'See you Saturday!' or similar.",
};

const POST_TYPE_HASHTAGS: Record<PostType, string[]> = {
  just_listed: ["#JustListed", "#NewListing", "#ForSale"],
  just_sold: ["#JustSold", "#SOLD", "#Closed"],
  under_contract: ["#UnderContract", "#PendingSale"],
  open_house: ["#OpenHouse", "#OpenHouseWeekend"],
};

/**
 * Brand hashtags that go on every caption regardless of post type or office.
 * Office-specific tags would layer on top in a future iteration once we
 * pass office_short_code through.
 */
const BRAND_HASHTAGS = [
  "#Century21Alliance",
  "#C21Alliance",
  "#SouthJerseyRealEstate",
];

export async function generateCaption(args: {
  listing: PostBuilderListing;
  post_type: PostType;
}): Promise<GeneratedCaption | null> {
  const { listing, post_type } = args;

  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);
  const tone = POST_TYPE_TONE[post_type];
  const baseHashtags = [
    ...POST_TYPE_HASHTAGS[post_type],
    ...BRAND_HASHTAGS,
    mlsHashtag,
  ];

  const client = await getAnthropic();
  if (!client) {
    // Graceful fallback — return a deterministic caption so the UI still
    // works when Anthropic isn't configured. Larissa can edit the text.
    return {
      caption: deterministicFallbackCaption(listing, post_type),
      hashtags: dedupeHashtags(baseHashtags),
      mls_hashtag: mlsHashtag,
    };
  }

  const userPrompt = buildPrompt({ listing, post_type, tone });

  let aiCaption: string | null = null;
  let aiExtraHashtags: string[] = [];
  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 600,
      system:
        "You are a senior real estate social media writer at Century 21 Alliance, a brokerage with 8 offices in South Jersey (Cape May County, Cumberland County, Atlantic County). You write captions that convert lookers into showings. You write in plain, confident sentences. No emoji unless explicitly requested. No real estate cliches like 'home sweet home' or 'dream home'. You always return strict JSON with the exact shape the user requests — no markdown, no preamble, no commentary.",
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = safeParseJson(raw);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as { caption?: unknown; extra_hashtags?: unknown };
      if (typeof obj.caption === "string" && obj.caption.trim().length > 0) {
        aiCaption = obj.caption.trim();
      }
      if (Array.isArray(obj.extra_hashtags)) {
        aiExtraHashtags = obj.extra_hashtags
          .filter((s): s is string => typeof s === "string")
          .map((s) => normalizeHashtag(s))
          .filter((s) => s.length > 1);
      }
    }
  } catch (e) {
    console.error("[post-builder/captions] Claude error:", e);
  }

  const caption =
    aiCaption ?? deterministicFallbackCaption(listing, post_type);
  const hashtags = dedupeHashtags([...baseHashtags, ...aiExtraHashtags]);

  return { caption, hashtags, mls_hashtag: mlsHashtag };
}

function buildPrompt(args: {
  listing: PostBuilderListing;
  post_type: PostType;
  tone: string;
}): string {
  const { listing, post_type, tone } = args;

  const fact = (label: string, val: unknown) => {
    if (val === null || val === undefined || val === "") return null;
    return `- ${label}: ${val}`;
  };

  const facts = [
    fact("Address", listing.address),
    fact(
      "Location",
      [listing.city, listing.state, listing.zip].filter(Boolean).join(" "),
    ),
    typeof listing.list_price === "number"
      ? `- List price: $${listing.list_price.toLocaleString()}`
      : null,
    fact("Bedrooms", listing.bedrooms),
    fact("Full bathrooms", listing.bathrooms_full),
    fact("Half bathrooms", listing.bathrooms_half),
    fact("Property type", listing.property_type),
    fact("Listing agent", listing.agent_name),
    fact("Office", listing.listing_office_name),
  ]
    .filter((s): s is string => !!s)
    .join("\n");

  const remarks = listing.public_remarks
    ? `\n\nMLS public remarks (use sparingly — pull at most one specific detail):\n"""\n${listing.public_remarks.slice(0, 1200)}\n"""`
    : "";

  return `Write a ${humanPostType(post_type)} caption for the property below.

PROPERTY FACTS:
${facts}${remarks}

TONE: ${tone}

CONSTRAINTS:
- 2-4 sentences. Real punctuation. No bullet lists.
- Do NOT include hashtags inside the caption body.
- Do NOT include emoji.
- Do NOT include the words "Just Listed", "Just Sold", "Under Contract", or "Open House" — those are on the image already.
- Do NOT mention specific bedroom/bathroom/sqft counts in the caption — those are visible in the image. Talk about what makes the property worth seeing instead.
- Do NOT use cliches: "home sweet home", "dream home", "must see", "won't last".
- Do NOT include any contact info, phone, or URL — Larissa will add those.

Then suggest 4-6 EXTRA hashtags (no '#' prefix needed, we'll add it). Mix:
- Local/market tags (city, county, neighborhood feel — e.g. "CapeMayRealEstate", "VinelandHomes")
- Lifestyle tags relevant to the property (e.g. "BeachHouse", "HistoricHome", "FixerUpper")
- Skip generic tags like "RealEstate" or "Realtor" — we add brand tags separately.

Return STRICT JSON in this exact shape:
{"caption": "...", "extra_hashtags": ["tag1","tag2",...]}`;
}

function humanPostType(t: PostType): string {
  switch (t) {
    case "just_listed":
      return "Just Listed";
    case "just_sold":
      return "Just Sold";
    case "under_contract":
      return "Under Contract";
    case "open_house":
      return "Open House";
  }
}

function deterministicFallbackCaption(
  listing: PostBuilderListing,
  post_type: PostType,
): string {
  const addr = listing.address ?? "this property";
  const city = listing.city ? ` in ${listing.city}` : "";
  switch (post_type) {
    case "just_listed":
      return `New on market: ${addr}${city}. Reach out for a private showing or share with someone who'd love to see it.`;
    case "just_sold":
      return `Closed on ${addr}${city}. Congratulations to everyone involved. Thinking of making a move yourself? Let's talk.`;
    case "under_contract":
      return `Under contract: ${addr}${city}. Have something similar in mind? We'll help you find it.`;
    case "open_house":
      return `Open house at ${addr}${city} this weekend. Come walk through and see for yourself.`;
  }
}

function safeParseJson(s: string): unknown {
  if (!s) return null;
  // Handle ```json ... ``` wrapping just in case.
  const stripped = s
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to grab the first {...} block.
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeHashtag(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, "").replace(/[^A-Za-z0-9_]/g, "");
  if (cleaned.length === 0) return "";
  return `#${cleaned}`;
}

function dedupeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Inline duplicate of toHashtag() from lib/data/listings-needing-posts.ts.
 * If that canonical helper is moved to a shared location, replace this
 * import. Kept here to avoid circular import with the listings module.
 */
function canonicalMlsHashtag(
  mls_number: string,
  source_mls: PostBuilderListing["source_mls"],
): string {
  const normalized = mls_number.replace(/^#/, "").trim();
  if (source_mls === "cmc") return `#CMC${normalized}`;
  if (source_mls === "sjsr") return `#SJSR${normalized}`;
  if (source_mls === "bright" || /^NJ[A-Z]{2}\d+$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return `#${normalized}`;
}
