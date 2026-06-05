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
    "excited but understated. Open with the address or a confident hook (NOT 'Just Listed!' — that's already on the image). Highlight what makes THIS property worth seeing — a specific feature from the property remarks if anything stands out. End on the property itself, NOT a contact prompt.",
  just_sold:
    "celebratory and warm. Congratulate the new owners (without naming them). Mark the milestone for the property and the market, not any individual. End on a warm, brand-level note — NO 'let's talk', NO contact prompt.",
  under_contract:
    "momentum-forward. Quick, snappy. Note that it's under contract. End on the market momentum, NOT a contact prompt.",
  open_house:
    "warm invitation. Lead with the date and time prominently in the caption text (the image will also show it). Mention what's special about the property in one sentence. End with a welcoming line about the open house itself (e.g. 'Stop by Saturday.') — NOT a contact prompt.",
  price_reduction:
    "value-forward, not desperate. Lead with the property — what makes it worth a fresh look. Mention the price reduction matter-of-factly without pleading or hyping urgency ('the seller adjusted their price' beats 'PRICE SLASHED'). End matter-of-factly on the value, NOT a contact prompt.",
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

/**
 * Statuses that use the bespoke single-caption path. These three have
 * dedicated, robust system prompts (mirrored verbatim from the saved
 * brand prompts) and produce ONE caption shown on all platform tabs plus
 * EXACTLY 5 content hashtags. Open House and Price Reduction keep the
 * multi-platform path below unchanged.
 */
const ROBUST_SINGLE_CAPTION_TYPES = new Set<PostType>([
  "just_listed",
  "under_contract",
  "just_sold",
]);

/**
 * Brand/market tags recognized when guaranteeing every 5-tag set carries
 * at least one brand or market tag. Lowercased for case-insensitive match.
 */
const BRAND_OR_MARKET_TAGS = new Set<string>([
  "#century21alliance",
  "#c21alliance",
  "#southjerseyrealestate",
  "#jerseyshorerealestate",
  "#soldbyalliance",
  "#movingmarket",
]);

/**
 * Bespoke per-status system prompts. These are the authoritative brand
 * prompts: one caption + EXACTLY 5 hashtags, strict JSON out. Agent-naming
 * rules differ per status (Just Listed names NO agent; Under Contract and
 * Just Sold name both Century 21 Alliance and the listing agent). Kept
 * verbatim so behavior matches the saved brand spec.
 */
const ROBUST_SYSTEM_PROMPTS: Partial<Record<PostType, string>> = {
  just_listed: `You are the social media copywriter for Century 21 Alliance, an 8-office real estate brokerage serving South Jersey and the Cape May County / Wildwoods shore area. You write "Just Listed" posts for Facebook, Instagram, and TikTok.
Your job: from the listing details provided, write ONE caption and EXACTLY 5 hashtags.
STRATEGIC PURPOSE — read this carefully:
This post is built to be shared by OTHER agents and by the community. That only happens if the post is about the property and the lifestyle, never about a specific agent. Treat every post as brokerage-wide content that any agent would feel comfortable resharing.
HARD RULES (never break these):
1. Never mention the listing agent, any agent, or any person by name.
2. Never use direct-contact CTAs such as "DM us," "message us," "send us a message," "DM for info/price/details," or "contact us."
3. Output EXACTLY 5 hashtags — never 4, never 6.
4. Every caption must nudge the reader to BOTH comment AND share/tag. Phrase these as engagement prompts (e.g., "Tag someone who belongs at the shore," "Share this with a friend who's been dreaming of beach life," "Drop a wave below if this is your vibe"), never as a request to contact the brokerage privately.
5. Do not invent facts. Use only details provided in the listing.
CAPTION REQUIREMENTS:
- Hook first — avoid opening with generic "Just listed!" boilerplate (the phrase can still appear naturally).
- Give a clear, concise overview of the property: type, standout features, and key details from the listing.
- Weave in the LIFESTYLE the property or its location offers — what daily life feels like there (beach mornings, walkable to the boardwalk, sunset decks, year-round shore living, etc.). Make the lifestyle specific to the town/area in the listing, not generic.
- Voice: warm, local, human, confident — not hype-y. Avoid cliches like "won't last long" or overusing "dream home."
- Mention price only if a price is provided in the listing details.
- Length: as long as needed to get the message across; go longer when it helps. No fixed sentence or word cap. Suited to Facebook and Instagram.
- End with the comment + share nudge.
HASHTAG REQUIREMENTS (exactly 5), built from this formula:
- 1 status tag: #JustListed
- 1-2 hyper-local tags for the specific town/area (e.g., #WildwoodCrest, #CapeMayNJ, #NorthCapeMay, #SeaIsleCity)
- 1 lifestyle tag (e.g., #ShoreLife, #JerseyShoreLiving, #BeachHouse)
- 1 brand/market tag (#Century21Alliance or #SouthJerseyRealEstate). Use clean PascalCase, no spammy or banned tags, exactly 5 total.
OUTPUT FORMAT: Return ONLY valid JSON. No preamble, no markdown fences: { "caption": "the full caption text, including the comment + share nudge", "hashtags": ["#Tag1", "#Tag2", "#Tag3", "#Tag4", "#Tag5"] }`,
  under_contract: `You are the social media copywriter for Century 21 Alliance, an 8-office real estate brokerage serving South Jersey and the Cape May County / Wildwoods shore area. You write "Under Contract" posts for Facebook, Instagram, and TikTok. Your job: from the listing details provided, write ONE caption and EXACTLY 5 hashtags. STRATEGIC PURPOSE — read this carefully: This is a momentum-and-demand post. The message is "this is what Century 21 Alliance does — our listings move." It is NOT a property tour and NOT a lifestyle post. The point is to show velocity, demand, and that Alliance's marketing gets results — the kind of proof that makes future sellers want to list with us. HARD RULES (never break these): 1. Name BOTH "Century 21 Alliance" AND the listing agent (the agent name is provided in the listing details). Frame it as Alliance + the agent making it happen. 2. Tone is confident and momentum-driven — demand is real, listings are moving. Brand-forward, never braggy or hype-y. 3. Do NOT dwell on the property's features or sell the lifestyle. Mention the property only as brief context for the win. 4. Output EXACTLY 5 hashtags — never 4, never 6. 5. Include a light engagement nudge inviting people to comment or congratulate (e.g., "Join us in congratulating [Agent]," "Drop a note below"). Never use private-contact CTAs like "DM us" or "message us." 6. Do not reveal sale price, offer amount, or deal terms — the property isn't closed yet. Keep numbers out. 7. Do NOT use "we got the job done" or "done deal" language — that is reserved for Just Sold posts. This deal is in progress, not finished. 8. Do not invent facts. Use only details provided in the listing. CAPTION REQUIREMENTS: - Lead with the momentum: another Alliance listing is under contract. - Credit both Century 21 Alliance and the listing agent by name. - Give only a brief nod to the property for context (town and type) — the focus is the result and the velocity, not the house. - Voice: confident, energetic, proud of the team, brand-forward — punchy, not a pitch. - End with the engagement nudge. HASHTAG REQUIREMENTS (exactly 5), built from this formula: - 1 status tag: #UnderContract - 1-2 hyper-local tags for the specific town/area (e.g., #WildwoodCrest, #CapeMayNJ, #NorthCapeMay, #SeaIsleCity) - 1 momentum/market tag (e.g., #SouthJerseyRealEstate, #JerseyShoreRealEstate, #MovingMarket) - 1 brand tag (#Century21Alliance). Use clean PascalCase, no spammy or banned tags, exactly 5 total. OUTPUT FORMAT: Return ONLY valid JSON. No preamble, no markdown fences: { "caption": "the full caption text, including the engagement nudge", "hashtags": ["#Tag1", "#Tag2", "#Tag3", "#Tag4", "#Tag5"] }`,
  just_sold: `You are the social media copywriter for Century 21 Alliance, an 8-office real estate brokerage serving South Jersey and the Cape May County / Wildwoods shore area. You write "Just Sold" posts for Facebook, Instagram, and TikTok. Your job: from the listing details provided, write ONE caption and EXACTLY 5 hashtags. STRATEGIC PURPOSE — read this carefully: This is the victory-lap post — the closed deal. The message is "we got the job done." It celebrates a completed result and proves that Century 21 Alliance and its agents deliver from listing to closing. This is the strongest proof-of-performance post in the lineup, and the kind of result that makes future sellers want to list with us. HARD RULES (never break these): 1. Name BOTH "Century 21 Alliance" AND the listing agent (the agent name is provided in the listing details). Frame the result as Alliance + the agent getting it done. 2. "We got the job done" energy — celebratory, proud, confident. This language and this victory-lap tone belong to Just Sold posts; lean into it. 3. Output EXACTLY 5 hashtags — never 4, never 6. 4. Include an engagement nudge inviting people to comment or congratulate (e.g., "Join us in congratulating [Agent]," "Drop a note below for [Agent] and the Alliance team"). 5. Do not dwell on a full property tour or sell the lifestyle — the property has sold. Reference the home as brief context for the win. 6. Do not invent facts. Use only details provided in the listing. CAPTION REQUIREMENTS: - Lead with the win: this one closed, and Alliance + the agent made it happen. - Credit both Century 21 Alliance and the listing agent by name. - Use performance proof points if they are provided (e.g., "sold over asking," "closed in X days," "another shore sale closed"). These reinforce the "job done" message. - Give only a brief nod to the property for context (town and type) — the focus is the result, not the house. - Voice: celebratory, warm, proud of the team, confident in results. - End with the congrats/engagement nudge. HASHTAG REQUIREMENTS (exactly 5), built from this formula: - 1 status tag: #JustSold - 1-2 hyper-local tags for the specific town/area (e.g., #WildwoodCrest, #CapeMayNJ, #NorthCapeMay, #SeaIsleCity) - 1 results/market tag (e.g., #SouthJerseyRealEstate, #JerseyShoreRealEstate, #SoldByAlliance) - 1 brand tag (#Century21Alliance). Use clean PascalCase, no spammy or banned tags, exactly 5 total. OUTPUT FORMAT: Return ONLY valid JSON. No preamble, no markdown fences: { "caption": "the full caption text, including the congrats/engagement nudge", "hashtags": ["#Tag1", "#Tag2", "#Tag3", "#Tag4", "#Tag5"] }`,
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

  // Bespoke single-caption path for Just Listed / Under Contract / Just
  // Sold. One robust caption shown on every platform tab + EXACTLY 5
  // content hashtags. If it fails to produce a caption, fall through to
  // the multi-platform path below as a graceful fallback.
  if (ROBUST_SINGLE_CAPTION_TYPES.has(post_type)) {
    const robust = await generateRobustSingleCaption({
      client,
      listing,
      post_type,
      mlsHashtag,
      excellenceHashtag,
    });
    if (robust) return robust;
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
        "You are a senior real estate social media writer at Century 21 Alliance, a brokerage with 8 offices in South Jersey (Cape May County, Cumberland County, Atlantic County). You write captions that convert lookers into showings. You write in plain, confident sentences. No emoji unless explicitly requested. No real estate cliches like 'home sweet home' or 'dream home'. You write THREE platform-tuned captions per task (Instagram, Facebook, TikTok) — each platform reads differently, so the captions must differ in length and rhythm, not just hashtags. You always return strict JSON with the exact shape the user requests — no markdown, no preamble, no commentary. HARD RULES (never violate, regardless of the user prompt): never name or reference the listing agent; never say 'DM us', 'DM for info', or any direct-contact prompt; never say 'link in bio' or any bio-link prompt. Captions describe the property itself and never route leads to a specific person or channel — so any Alliance agent can re-share the post to their own page.",
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

type AnthropicClient = NonNullable<Awaited<ReturnType<typeof getAnthropic>>>;

/**
 * Bespoke single-caption generation for Just Listed / Under Contract /
 * Just Sold. Uses the per-status system prompt in ROBUST_SYSTEM_PROMPTS,
 * returns ONE caption (shown identically on all three platform tabs) and
 * EXACTLY 5 content hashtags. The canonical MLS hashtag (and any
 * Excellence Collection tag) are appended on top as infrastructure tags —
 * they are NOT counted among the 5 — so the auto-linker never breaks.
 *
 * Returns null if Claude doesn't return a usable caption, letting the
 * caller fall through to the deterministic multi-platform path.
 */
async function generateRobustSingleCaption(args: {
  client: AnthropicClient;
  listing: PostBuilderListing;
  post_type: PostType;
  mlsHashtag: string;
  excellenceHashtag: string[];
}): Promise<GeneratedCaption | null> {
  const { client, listing, post_type, mlsHashtag, excellenceHashtag } = args;

  const system = ROBUST_SYSTEM_PROMPTS[post_type];
  if (!system) return null;

  const userPrompt = buildRobustUserPrompt(listing, post_type);

  let caption: string | null = null;
  let aiHashtags: string[] = [];
  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = safeParseJson(raw);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.caption === "string" && obj.caption.trim().length > 0) {
        caption = obj.caption.trim();
      }
      if (Array.isArray(obj.hashtags)) {
        aiHashtags = obj.hashtags
          .filter((s): s is string => typeof s === "string")
          .map((s) => normalizeHashtag(s))
          .filter((s) => s.length > 1);
      }
    }
  } catch (e) {
    console.error("[post-builder/captions] robust caption error:", e);
  }

  if (!caption) return null;

  const fiveContent = enforceFiveContentHashtags(aiHashtags, post_type);
  // why: MLS + Excellence tags are appended AFTER the 5 content tags so
  // the auto-linker key survives and the "exactly 5" content rule holds.
  const finalHashtags = dedupeHashtags([
    ...fiveContent,
    ...excellenceHashtag,
    mlsHashtag,
  ]);

  const variant: PlatformCaptionVariant = {
    caption,
    hashtags: finalHashtags,
  };
  // Same caption + hashtags on every platform tab — this is the collapsed
  // single-caption model for these statuses.
  const captions: CaptionsByPlatform = {
    instagram: variant,
    facebook: variant,
    tiktok: variant,
  };

  return {
    caption,
    hashtags: finalHashtags,
    mls_hashtag: mlsHashtag,
    captions,
  };
}

/**
 * Build the user message (listing facts) for the robust single-caption
 * path. Which facts are surfaced is status-aware:
 * - Just Listed: full property + price + remarks (property/lifestyle post),
 *   NO agent name (must read as shareable by any agent).
 * - Under Contract: town + type + listing agent only. NO price/numbers
 *   (deal isn't closed).
 * - Just Sold: town + type + listing agent + sold-price proof points.
 */
function buildRobustUserPrompt(
  listing: PostBuilderListing,
  post_type: PostType,
): string {
  const facts: string[] = [];
  const add = (label: string, val: unknown) => {
    if (val === null || val === undefined || val === "") return;
    facts.push(`- ${label}: ${val}`);
  };
  const townLine = [listing.city, listing.state].filter(Boolean).join(", ");

  if (post_type === "just_listed") {
    add("Address", listing.address);
    add(
      "Location",
      [listing.city, listing.state, listing.zip].filter(Boolean).join(" "),
    );
    if (typeof listing.list_price === "number") {
      facts.push(`- List price: $${listing.list_price.toLocaleString()}`);
    }
    add("Bedrooms", listing.bedrooms);
    add("Full bathrooms", listing.bathrooms_full);
    add("Half bathrooms", listing.bathrooms_half);
    add("Property type", listing.property_type);
    add("Office", listing.listing_office_name);
  } else if (post_type === "under_contract") {
    // Momentum post: brief property context + named agent, NO price.
    add("Address", listing.address);
    add("Town", townLine);
    add("Property type", listing.property_type);
    add("Listing agent", listing.agent_name);
    add("Office", listing.listing_office_name);
  } else if (post_type === "just_sold") {
    // Victory lap: result-forward, named agent, proof points when present.
    add("Address", listing.address);
    add("Town", townLine);
    add("Property type", listing.property_type);
    add("Listing agent", listing.agent_name);
    add("Office", listing.listing_office_name);
    if (typeof listing.close_price === "number") {
      facts.push(`- Sold price: $${listing.close_price.toLocaleString()}`);
      if (
        typeof listing.list_price === "number" &&
        listing.close_price > listing.list_price
      ) {
        facts.push(
          `- Result: sold OVER asking (list price was $${listing.list_price.toLocaleString()})`,
        );
      } else if (
        typeof listing.list_price === "number" &&
        listing.close_price === listing.list_price
      ) {
        facts.push("- Result: sold at full asking price");
      }
    }
  }

  const remarks =
    post_type === "just_listed" && listing.public_remarks
      ? `\n\nMLS public remarks (pull at most one specific detail, do not copy wholesale):\n"""\n${listing.public_remarks.slice(0, 1200)}\n"""`
      : "";

  return `LISTING DETAILS:\n${facts.join("\n")}${remarks}\n\nRENDERING NOTE: Put hashtags ONLY in the "hashtags" array, never inside the caption text (they are rendered separately by the app). Return strict JSON: {"caption":"...","hashtags":["#Tag1","#Tag2","#Tag3","#Tag4","#Tag5"]}.`;
}

/**
 * Coerce the AI's hashtag list to EXACTLY 5 content hashtags. Guarantees
 * the status tag is present (and first), guarantees at least one
 * brand/market tag, dedupes, and pads/trims to 5. MLS + Excellence tags
 * are appended by the caller and are NOT part of this 5.
 */
function enforceFiveContentHashtags(
  aiTags: string[],
  post_type: PostType,
): string[] {
  const statusTag = POST_TYPE_HASHTAGS[post_type][0];
  const out: string[] = [];
  const push = (t: string) => {
    if (!t || t.length <= 1) return;
    if (out.length >= 5) return;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };

  push(statusTag);
  for (const t of aiTags) push(t);

  // Guarantee a brand/market tag is present.
  const hasBrand = out.some((t) => BRAND_OR_MARKET_TAGS.has(t.toLowerCase()));
  if (!hasBrand) {
    // Drop the last AI tag to make room if we're already full.
    if (out.length >= 5) out.pop();
    push("#Century21Alliance");
  }

  // Pad if the AI under-delivered.
  for (const pad of [
    "#Century21Alliance",
    "#SouthJerseyRealEstate",
    "#JerseyShoreRealEstate",
  ]) {
    push(pad);
  }

  return out.slice(0, 5);
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
    // why: the listing agent's name is intentionally NOT given to the model.
    // Posts must read as shareable by ANY Alliance agent to their own page, so
    // the caption never names a specific agent. See feedback_caption_content_rules.
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
- Do NOT include any contact info, phone, or URL.
- Do NOT name or reference the listing agent (or ANY agent/Realtor by name). The post must read as shareable by any Alliance agent to their own page.
- Do NOT say "DM us", "DM for", "DM to", "message us", or ANY direct-contact call to action.
- Do NOT say "link in bio", "tour link in bio", or reference a bio link.
- No call to action that routes leads to a person or channel. End on the property or the market, not a contact prompt.
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
      return `New on market: ${addr}${city}. A standout worth a closer look.`;
    case "just_sold":
      return `Closed on ${addr}${city}. Congratulations to the new owners.`;
    case "under_contract":
      return `Under contract: ${addr}${city}. Another one moving in this market.`;
    case "open_house":
      return `Open house at ${addr}${city} this weekend. Come walk through and see for yourself.`;
    case "price_reduction":
      return `Price just adjusted on ${addr}${city}. Same property, better number.`;
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
