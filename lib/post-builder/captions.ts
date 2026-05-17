import "server-only";
import { getAnthropic, ANTHROPIC_MODELS } from "@/lib/ai/anthropic";
import {
  EXCELLENCE_HASHTAG,
  isExcellenceCollection,
} from "./excellence-collection";
import type {
  PostBuilderListing,
  PostType,
  SchedulablePlatform,
} from "./types";

/**
 * Caption + hashtag generation for Post Builder posts.
 *
 * Phase D — produces THREE platform-tuned captions per call (IG, FB,
 * TikTok). One Claude request, structured output, three variants that
 * stay stylistically coherent because they're written together in one
 * pass.
 *
 * Tone is driven by post_type. Just Listed = excited intro, Just Sold =
 * celebratory close, UC = momentum, Open House = invitation, Price
 * Reduction = value-forward.
 *
 * Hashtags are assembled deterministically per platform (brand + post
 * type + canonical MLS hashtag, capped per platform's conventions) with
 * AI-suggested local/market tags layered on top. The canonical MLS
 * hashtag is what makes the auto-linker tie the post back to the
 * listing once Larissa publishes.
 *
 * Back-compat: the top-level `caption`/`hashtags` fields on the return
 * value mirror the Instagram variant — older callers that read those
 * directly continue to work without changes.
 */

export interface PlatformCaptionVariant {
  caption: string;
  hashtags: string[];
}

/**
 * Per-platform caption map. All three platforms always populated — when
 * Claude is unavailable or returns malformed data for one platform, the
 * caller falls back to the deterministic generator for that platform
 * specifically, so the map is never missing a key.
 */
export type CaptionsByPlatform = Record<
  SchedulablePlatform,
  PlatformCaptionVariant
>;

export interface GeneratedCaption {
  /** Legacy single-caption field — mirrors `captions.instagram.caption`. */
  caption: string;
  /** Legacy hashtags — mirrors `captions.instagram.hashtags`. */
  hashtags: string[];
  /** The canonical MLS hashtag (e.g. "#CMC230456"). Always included in every platform's hashtags. */
  mls_hashtag: string;
  /** Phase D — per-platform variants. */
  captions: CaptionsByPlatform;
}

const POST_TYPE_TONE: Record<PostType, string> = {
  just_listed:
    "excited but understated. Open with the address or a confident hook (NOT 'Just Listed!' — that's already on the image). Highlight what makes THIS property worth seeing — a specific feature from the property remarks if anything stands out. End with a soft CTA like 'DM for a private showing' or 'Tour link in bio'.",
  just_sold:
    "celebratory and warm. Congratulate the new owners (without naming them). Acknowledge the agent's work briefly if known. End with a confidence line like 'Thinking of selling? Let's talk.'",
  under_contract:
    "momentum-forward. Quick, snappy. Note that it's under contract in days/weeks if known (we don't track that yet — keep generic). End with a buyer-pipeline line like 'Have a similar dream property in mind? Let's find it.'",
  open_house:
    "warm invitation. Lead with the date and time prominently in the caption text (the image will also show it). Mention what's special about the property in one sentence. End with 'See you Saturday!' or similar.",
  price_reduction:
    "value-forward, not desperate. Lead with the property — what makes it worth a fresh look. Mention the price reduction matter-of-factly without pleading or hyping urgency ('the seller adjusted their price' beats 'PRICE SLASHED'). End with a soft CTA like 'Same property, better number — DM to see it.'",
};

const POST_TYPE_HASHTAGS: Record<PostType, string[]> = {
  just_listed: ["#JustListed", "#NewListing", "#ForSale"],
  just_sold: ["#JustSold", "#SOLD", "#Closed"],
  under_contract: ["#UnderContract", "#PendingSale"],
  open_house: ["#OpenHouse", "#OpenHouseWeekend"],
  price_reduction: ["#PriceReduction", "#NewPrice", "#JustReduced"],
};

/**
 * Brand hashtags that go on every caption regardless of post type or
 * office. Office-specific tags would layer on top in a future iteration
 * once we pass office_short_code through.
 */
const BRAND_HASHTAGS = [
  "#Century21Alliance",
  "#C21Alliance",
  "#SouthJerseyRealEstate",
];

/**
 * Per-platform style guidance the AI follows. These are the platform-
 * specific dials on top of the post-type tone — what makes an IG caption
 * read like IG vs. a FB caption read like FB.
 */
const PLATFORM_STYLE: Record<SchedulablePlatform, string> = {
  instagram:
    "INSTAGRAM — 3-5 sentences. Conversational but polished. Hashtags go in the caption body at the end is fine (no #'s inside the prose itself though). Algorithm rewards meaningful captions; aim for ~125-300 characters of prose before hashtags. Modern IG voice — not corporate, not over-emoji'd. Zero emoji unless the user specifically adds them later.",
  facebook:
    "FACEBOOK — 2-3 sentences max. Conversational, warmer tone. Reads like a recommendation from a knowledgeable friend, not a marketing post. Minimal hashtags — FB's algorithm doesn't reward them the way IG's does, so the AI suggests only 2-3 extras (brand + MLS hashtag are added separately). Slightly more relaxed punctuation. No emoji.",
  tiktok:
    "TIKTOK — 1-2 punchy sentences max. The caption is a hook, not a description (the video carries the content). Use vivid one-line setups: 'Beach block. Sunset views. New listing.' Cap suggested EXTRA hashtags at 2 — TikTok max is ~5 total once brand + MLS are added. Algorithm rewards hooks that prompt a stop-scroll. No emoji.",
};

/**
 * Per-platform hashtag caps applied AFTER AI assembly. IG can carry the
 * full set, FB is throttled to a small focused list, TikTok is the most
 * aggressively capped.
 */
const PLATFORM_HASHTAG_CAP: Record<SchedulablePlatform, number> = {
  instagram: 30, // IG hard limit; we don't try to hit it but tolerate up to 30
  facebook: 6, // FB doesn't reward hashtags; small focused set
  tiktok: 5, // TikTok rewards 3-5
};

export async function generateCaption(args: {
  listing: PostBuilderListing;
  post_type: PostType;
}): Promise<GeneratedCaption | null> {
  const { listing, post_type } = args;

  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);
  const tone = POST_TYPE_TONE[post_type];
  // why: Excellence Collection listings ($949k+) get an auto-appended
  // #ExcellenceCollection hashtag on every caption regardless of platform.
  // The threshold + hashtag are defined in lib/post-builder/excellence-collection.ts.
  const excellenceHashtag = isExcellenceCollection(listing.list_price)
    ? [EXCELLENCE_HASHTAG]
    : [];
  const basePostTypeAndBrand = [
    ...POST_TYPE_HASHTAGS[post_type],
    ...BRAND_HASHTAGS,
    ...excellenceHashtag,
    mlsHashtag,
  ];

  const client = await getAnthropic();

  if (!client) {
    // Graceful fallback — return deterministic captions per platform so
    // the UI still works when Anthropic isn't configured. Larissa can
    // edit each tab manually.
    const fallback = buildFallbackCaptions({
      listing,
      post_type,
      basePostTypeAndBrand,
    });
    return {
      caption: fallback.instagram.caption,
      hashtags: fallback.instagram.hashtags,
      mls_hashtag: mlsHashtag,
      captions: fallback,
    };
  }

  const userPrompt = buildPrompt({ listing, post_type, tone });

  let aiByPlatform: Partial<Record<SchedulablePlatform, {
    caption: string;
    extra_hashtags: string[];
  }>> = {};
  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 1200,
      system:
        "You are a senior real estate social media writer at Century 21 Alliance, a brokerage with 8 offices in South Jersey (Cape May County, Cumberland County, Atlantic County). You write captions that convert lookers into showings. You write in plain, confident sentences. No emoji unless explicitly requested. No real estate cliches like 'home sweet home' or 'dream home'. You write THREE platform-tuned captions per task (Instagram, Facebook, TikTok) — each platform reads differently, so the captions must differ in length and rhythm, not just hashtags. You always return strict JSON with the exact shape the user requests — no markdown, no preamble, no commentary.",
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = safeParseJson(raw);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      for (const platform of ["instagram", "facebook", "tiktok"] as const) {
        const entry = obj[platform];
        if (entry && typeof entry === "object") {
          const platformObj = entry as {
            caption?: unknown;
            extra_hashtags?: unknown;
          };
          const captionVal =
            typeof platformObj.caption === "string" &&
            platformObj.caption.trim().length > 0
              ? platformObj.caption.trim()
              : null;
          const extras = Array.isArray(platformObj.extra_hashtags)
            ? platformObj.extra_hashtags
                .filter((s): s is string => typeof s === "string")
                .map((s) => normalizeHashtag(s))
                .filter((s) => s.length > 1)
            : [];
          if (captionVal) {
            aiByPlatform[platform] = {
              caption: captionVal,
              extra_hashtags: extras,
            };
          }
        }
      }
    }
  } catch (e) {
    console.error("[post-builder/captions] Claude error:", e);
  }

  // Assemble per-platform variants. AI-produced caption + extras when
  // present, deterministic fallback when not. Hashtags are deduped and
  // capped per-platform.
  const captions = {} as CaptionsByPlatform;
  for (const platform of ["instagram", "facebook", "tiktok"] as const) {
    const ai = aiByPlatform[platform];
    const caption = ai?.caption ?? deterministicFallbackCaption(listing, post_type);
    const merged = dedupeHashtags([
      ...basePostTypeAndBrand,
      ...(ai?.extra_hashtags ?? []),
    ]).slice(0, PLATFORM_HASHTAG_CAP[platform]);
    // why: ensure the canonical MLS hashtag survives the per-platform cap.
    // The auto-linker keys on it, so if the cap clips it off we'd break
    // listing→post linkage on the affected platform.
    const ensuredMls = merged.includes(mlsHashtag)
      ? merged
      : [mlsHashtag, ...merged.slice(0, PLATFORM_HASHTAG_CAP[platform] - 1)];
    captions[platform] = {
      caption,
      hashtags: ensuredMls,
    };
  }

  return {
    caption: captions.instagram.caption,
    hashtags: captions.instagram.hashtags,
    mls_hashtag: mlsHashtag,
    captions,
  };
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

  // Open House — surface the start time so the AI can mention "Saturday at 1 PM"
  // rather than a generic "this weekend".
  const ohContext =
    post_type === "open_house" && listing.oh_start_at
      ? `\n\nOPEN HOUSE: ${formatOpenHouseForPrompt(listing.oh_start_at, listing.oh_end_at)}. Reference the day and time naturally in each caption.`
      : "";

  return `Write a ${humanPostType(post_type)} caption for the property below — THREE variants, one per platform.

PROPERTY FACTS:
${facts}${remarks}${ohContext}

OVERALL TONE: ${tone}

PER-PLATFORM STYLE:
- ${PLATFORM_STYLE.instagram}
- ${PLATFORM_STYLE.facebook}
- ${PLATFORM_STYLE.tiktok}

UNIVERSAL CONSTRAINTS (apply to all three):
- Real punctuation. No bullet lists in the prose.
- Do NOT include hashtags inside the caption body.
- Do NOT include emoji.
- Do NOT include the words "Just Listed", "Just Sold", "Under Contract", or "Open House" — those are on the image already.
- Do NOT mention specific bedroom/bathroom/sqft counts in the caption — those are visible in the image. Talk about what makes the property worth seeing instead.
- Do NOT use cliches: "home sweet home", "dream home", "must see", "won't last".
- Do NOT include any contact info, phone, or URL — Larissa will add those.
- The three variants should READ DIFFERENTLY in length and rhythm — not just three slight rewrites of the same sentence.

For each platform, also suggest extra hashtags (no '#' prefix needed, we'll add it). Mix local/market tags (city, county, neighborhood feel — e.g. "CapeMayRealEstate", "VinelandHomes") and lifestyle tags relevant to the property (e.g. "BeachHouse", "HistoricHome", "FixerUpper"). Skip generic tags like "RealEstate" or "Realtor" — we add brand tags separately.

Suggested extra-hashtag counts (per the platform style):
- Instagram: 4-6 extras
- Facebook: 2-3 extras
- TikTok: 1-2 extras

Return STRICT JSON in this exact shape:
{
  "instagram": {"caption": "...", "extra_hashtags": ["tag1","tag2",...]},
  "facebook":  {"caption": "...", "extra_hashtags": ["tag1","tag2",...]},
  "tiktok":    {"caption": "...", "extra_hashtags": ["tag1"]}
}`;
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
    case "price_reduction":
      return "Price Reduction";
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
    case "price_reduction":
      return `Price just adjusted on ${addr}${city}. Same property, better number — DM if you'd like a closer look.`;
  }
}

/**
 * Build per-platform fallback captions when Claude isn't reachable. All
 * three platforms share the same deterministic body — Larissa edits each
 * tab to taste. Hashtags are platform-capped so the UI still reflects
 * the per-platform shape.
 */
function buildFallbackCaptions(args: {
  listing: PostBuilderListing;
  post_type: PostType;
  basePostTypeAndBrand: string[];
}): CaptionsByPlatform {
  const { listing, post_type, basePostTypeAndBrand } = args;
  const body = deterministicFallbackCaption(listing, post_type);
  const out = {} as CaptionsByPlatform;
  for (const platform of ["instagram", "facebook", "tiktok"] as const) {
    out[platform] = {
      caption: body,
      hashtags: dedupeHashtags(basePostTypeAndBrand).slice(
        0,
        PLATFORM_HASHTAG_CAP[platform],
      ),
    };
  }
  return out;
}

function formatOpenHouseForPrompt(
  start_at: string,
  end_at: string | null | undefined,
): string {
  try {
    const start = new Date(start_at);
    if (Number.isNaN(start.getTime())) return "scheduled soon";
    const datePart = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    }).format(start);
    const timeFmt: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    };
    const startTime = new Intl.DateTimeFormat("en-US", timeFmt).format(start);
    const end = end_at ? new Date(end_at) : null;
    if (end && !Number.isNaN(end.getTime())) {
      const endTime = new Intl.DateTimeFormat("en-US", timeFmt).format(end);
      return `${datePart}, ${startTime} to ${endTime} ET`;
    }
    return `${datePart}, ${startTime} ET`;
  } catch {
    return "scheduled soon";
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
