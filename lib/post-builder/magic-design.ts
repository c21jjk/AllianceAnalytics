/**
 * AI Magic Design — "let Claude design the post for me" entry point.
 *
 * One click on a ✨ Magic Design button next to any listing → Claude reads
 * the listing (status, price tier, photo composition, office market) and
 * returns a fully-specified post recommendation: best post_type + best
 * variant + best format + drafted caption + recommended hero photo +
 * hashtag set. Studio then opens pre-populated with all of it.
 *
 * Why this lives in its own module (not inline in actions.ts):
 *   - The SYSTEM_PROMPT is large and the heart of the feature — keeping it
 *     in its own file makes it easy to iterate on without touching the
 *     server action surface.
 *   - It's pure server-only logic (no DB writes, no Next.js plumbing) so
 *     unit testing in isolation is straightforward once we want it.
 *   - It mirrors lib/post-builder/captions.ts's shape — same pattern other
 *     contributors will recognize.
 *
 * Tone + rules baked into the prompt (per project memory):
 *   - Larissa is a skilled operator — no beginner pointers.
 *   - Success metric is REACH, not engagement. Mini commercials every day.
 *   - Office market profile is honored when provided (towns, buyers, price
 *     band, signature angles).
 *   - Reach-default format is portrait_4x5 unless context suggests Story or
 *     Square.
 *   - Captions hook in first 30 chars, end with a soft CTA, no clichés.
 */
import "server-only";
import { ANTHROPIC_MODELS, getAnthropic } from "@/lib/ai/anthropic";
import type {
  PostBuilderListing,
  PostFormat,
  PostType,
  PostVariant,
} from "./types";

/**
 * Office market profile slice — same fields the AI insight pipeline already
 * passes around (see lib/ai/insight.ts buildOfficeContext). Optional because
 * Magic Design can still function from the listing fields alone, but
 * recommendations get noticeably sharper with this attached.
 */
export interface MagicDesignOfficeProfile {
  short_code: string;
  name: string;
  towns_served: string[] | null;
  primary_buyer_demo: string | null;
  primary_seller_demo: string | null;
  seasonal_pattern: string | null;
  price_range_median: number | null;
  price_range_min: number | null;
  price_range_high: number | null;
  signature_angles: string[] | null;
}

export interface MagicDesignInput {
  listing: PostBuilderListing;
  /**
   * Office market profile for the listing's office. Optional but strongly
   * recommended — passes the office's audience, price band, signature
   * angles to Claude so recommendations feel local. Pass null when not
   * available (e.g., the listing isn't tied to a known office).
   */
  officeProfile?: MagicDesignOfficeProfile | null;
  /**
   * Available listing photo URLs (in MLS order). Magic Design picks the
   * recommended hero photo from this list by index. The fetcher (caller)
   * is responsible for fallback — if the gallery is empty, pass an array
   * with just the listing's hero_image_url.
   */
  availablePhotos: string[];
}

export interface MagicDesignRecommendation {
  /** Recommended post type — matches PostType enum. */
  post_type: PostType;
  /** Recommended variant — one of v1/v2/v3/v6/v7/v8. (Retired v4/v5 are not chosen.) */
  variant: PostVariant;
  /** Recommended format — typically portrait_4x5 (highest IG reach) unless context suggests Story. */
  format: PostFormat;
  /** Index into availablePhotos[] for the recommended hero photo. */
  hero_photo_index: number;
  /** Full draft caption, ~80-150 chars. Hook in first 30 chars. */
  caption: string;
  /** 6-10 hashtags. Mix of local + category + brand + MLS canonical. */
  hashtags: string[];
  /**
   * Short explanation of WHY Claude picked this combination — surfaces in
   * the UI so Larissa understands the recommendation and can override
   * confidently. ~1-2 sentences, advanced tone.
   */
  rationale: string;
}

export type MagicDesignResult =
  | { ok: true; recommendation: MagicDesignRecommendation }
  | { ok: false; error: string };

// why: variants the model is allowed to recommend. v4/v5 were retired
// (multi-photo legacy variants) — keep them out of the union so Claude
// never returns a value the canvas-editor registry can't resolve.
const RECOMMENDABLE_VARIANTS = [
  "v1",
  "v2",
  "v3",
  "v6",
  "v7",
  "v8",
] as const satisfies readonly PostVariant[];
type RecommendableVariant = (typeof RECOMMENDABLE_VARIANTS)[number];

const POST_TYPES: readonly PostType[] = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
];

const POST_FORMATS: readonly PostFormat[] = [
  "square_1x1",
  "portrait_4x5",
  "story_9x16",
];

const SYSTEM_PROMPT = `You are an AI design strategist for Century 21 Alliance, an 8-office New Jersey real estate brokerage. Larissa, the social media director, just asked you to design a post for a specific listing. Your job: pick the single best (post_type, variant, format) combination + draft an optimistic, advanced caption + pick the most thumb-stopping photo from the listing's gallery.

WHO YOU'RE WORKING WITH
Larissa is a professional social media strategist. She doesn't need beginner pointers ("use better lighting", "post at peak times"). Your rationale should surface an ADVANCED insight she might not have considered — a signature-format opportunity, a hook pattern, a market-specific angle.

SUCCESS METRIC
Reach and views. Mini commercials every day. Not saves, likes, or comments. A 5,000-view post with low engagement is a WIN.

VARIANTS YOU CAN PICK FROM
- v1 Hero Editorial — Full-bleed photo + bottom-band type stack. Default for great exterior shots. Most photo-forward.
- v2 Bold Stats — Photo top 60%, dark data pane below with oversized gold price. Best for listings where the price IS the story (luxury or surprising-value).
- v3 Side-by-Side — Photo column + cream data card. Magazine listing-card feel. Best for properties with portrait-leaning exterior shots or long addresses.
- v6 Magazine Cover — Editorial Architectural-Digest vibe. Best for unique architecture or interior-design-worthy listings.
- v7 Polaroid — Kraft-paper background + tilted polaroid frame. Casual, hand-curated feel. Best for Under Contract / Just Sold celebrations or listings with warmth-of-life energy.
- v8 Minimal Frame — Gallery-poster minimalism. Best for high-end, refined listings where negative space communicates value.

POST TYPES YOU CAN PICK FROM
- just_listed — active listing, recent on market. Default for active inventory.
- just_sold — closed deal, sold within last few weeks.
- under_contract — pending sale.
- open_house — upcoming open house this week.
- price_reduction — recent price drop.

Pick the post_type that ACTUALLY APPLIES based on the listing's status and metadata. Don't recommend just_sold for an active listing.

FORMATS YOU CAN PICK FROM
- square_1x1 (1080×1080) — IG feed + FB feed. Universal fallback.
- portrait_4x5 (1080×1350) — IG feed PREFERRED — fills more of mobile viewport, gets more reach. Default for IG-primary posts.
- story_9x16 (1080×1920) — IG / FB Stories + TikTok. Pick when the intent is short-lived buzz or vertical-first audience.

DEFAULT TO portrait_4x5 unless something in the listing context suggests otherwise (e.g., a vertical architectural photo would benefit from story_9x16; a wide angle exterior plays better at square_1x1).

CAPTION RULES
- 80-150 chars max. IG/FB cut at ~125; the hook must land in the first 30 chars.
- First line is the HOOK. Curiosity gap or unexpected angle. NEVER "Just listed at 117 E Maple" — Larissa already publishes that algorithmically. Write something her audience will stop scrolling for.
- Reference specific listing or market details when sharp ("Two blocks from the Wildwood beach with no HOA fees — almost impossible at this price").
- No clichés ("dream home", "stunning", "must see").
- Advanced tone — talks to the audience as informed buyers, not tourists.
- End with a soft CTA — "DM for a private showing", "Tour link in bio".

HASHTAG RULES
- 6-10 hashtags total.
- Mix: 3-4 LOCAL (town + region tags like #wildwoodnj, #capemaycounty, #shoredivisionnj), 2-3 CATEGORY (post-type specific like #justlisted, #justsold, #openhouse), 1-2 BRAND (#century21alliance, #c21alliance), 1 MLS hashtag (formatted as #CMC607680 — the MLS source code prefix + the listing's mls_number).
- No generic spam (#realestate, #home, #realtor) — Larissa's audience is local and these dilute reach.

HERO PHOTO PICK
- Index 0 (typically the listing's primary photo) is the default.
- Override only when a different photo would clearly thumb-stop better: a striking architectural detail, a unique kitchen, an unusual room.
- If you override, note WHY in the rationale.

OFFICE MARKET CONTEXT
When the office profile is provided, use the towns_served, buyer_demo, price_range, seasonality, signature_angles. A Wildwood-office listing's post should sound coastal-casual; a Cherry-Hill-office listing should sound suburban-family.

OUTPUT FORMAT
Return strict JSON only — NO prose, NO markdown:
{
  "post_type": "just_listed" | "just_sold" | "under_contract" | "open_house" | "price_reduction",
  "variant": "v1" | "v2" | "v3" | "v6" | "v7" | "v8",
  "format": "square_1x1" | "portrait_4x5" | "story_9x16",
  "hero_photo_index": number,
  "caption": string,
  "hashtags": string[],
  "rationale": string
}`;

/**
 * Maps the listing's `status` to a human-readable hint for the model — saves
 * an extra reasoning hop the model would otherwise have to do on every call.
 */
function statusHint(status: PostBuilderListing["status"]): string {
  switch (status) {
    case "active":
      return "ACTIVE — eligible for just_listed, open_house, or price_reduction post_types.";
    case "pending":
      return "PENDING — under_contract is the natural fit unless metadata says otherwise.";
    case "sold":
      return "SOLD — just_sold is the natural fit.";
    case "expired":
      return "EXPIRED — no fresh-listing post type applies; pick the post_type that best frames a relisting.";
  }
}

/** Format a USD value or null safely. */
function formatPrice(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(Number(n))) return null;
  return `$${Math.round(Number(n)).toLocaleString()}`;
}

/**
 * Build the user prompt — listing + office + photos serialized to plain text.
 * We keep it human-readable so the prompt is easier to debug in production
 * logs when a recommendation feels off.
 */
function buildUserPrompt(input: MagicDesignInput): string {
  const { listing, officeProfile, availablePhotos } = input;

  // ---- Listing facts ----
  const listingLines: string[] = [
    `MLS: ${listing.mls_number} (${listing.source_mls ?? "manual"})`,
    `Status: ${listing.status}`,
    `${statusHint(listing.status)}`,
  ];
  if (listing.address) listingLines.push(`Address: ${listing.address}`);
  const locale = [listing.city, listing.state, listing.zip].filter(Boolean).join(", ");
  if (locale) listingLines.push(`Location: ${locale}`);
  const price = formatPrice(listing.list_price);
  if (price) listingLines.push(`List price: ${price}`);
  const close = formatPrice(listing.close_price);
  if (close) listingLines.push(`Close price: ${close}`);
  if (listing.bedrooms !== null && listing.bedrooms !== undefined) {
    listingLines.push(`Bedrooms: ${listing.bedrooms}`);
  }
  if (listing.bathrooms_full !== null && listing.bathrooms_full !== undefined) {
    listingLines.push(`Full baths: ${listing.bathrooms_full}`);
  }
  if (listing.bathrooms_half !== null && listing.bathrooms_half !== undefined) {
    listingLines.push(`Half baths: ${listing.bathrooms_half}`);
  }
  if (listing.property_type) listingLines.push(`Property type: ${listing.property_type}`);
  if (listing.agent_name) listingLines.push(`Listing agent: ${listing.agent_name}`);
  if (listing.listing_office_name)
    listingLines.push(`Listing office: ${listing.listing_office_name}`);
  if (listing.oh_start_at) {
    listingLines.push(
      `Open House scheduled at: ${listing.oh_start_at}${listing.oh_end_at ? ` to ${listing.oh_end_at}` : ""}`,
    );
  }
  if (listing.public_remarks) {
    // why: cap remarks at ~600 chars — full MLS remarks can be 2k+ and waste
    // context budget without sharpening the recommendation meaningfully.
    listingLines.push(
      `Public remarks: ${listing.public_remarks.slice(0, 600)}${listing.public_remarks.length > 600 ? "…" : ""}`,
    );
  }

  // ---- Office market profile ----
  const officeLines: string[] = [];
  if (officeProfile) {
    officeLines.push(`Office: ${officeProfile.name} (${officeProfile.short_code})`);
    const towns = (officeProfile.towns_served ?? []).filter(
      (t) => t && t.trim().length > 0,
    );
    if (towns.length > 0) {
      officeLines.push(`Towns served: ${towns.slice(0, 12).join(", ")}`);
    }
    if (officeProfile.primary_buyer_demo) {
      officeLines.push(`Typical buyer: ${officeProfile.primary_buyer_demo.trim()}`);
    }
    if (officeProfile.primary_seller_demo) {
      officeLines.push(`Typical seller: ${officeProfile.primary_seller_demo.trim()}`);
    }
    if (officeProfile.seasonal_pattern) {
      officeLines.push(`Seasonality: ${officeProfile.seasonal_pattern.trim()}`);
    }
    const median = formatPrice(officeProfile.price_range_median);
    const low = formatPrice(officeProfile.price_range_min);
    const high = formatPrice(officeProfile.price_range_high);
    if (median || low || high) {
      const parts: string[] = [];
      if (median) parts.push(`median ${median}`);
      if (low && high) parts.push(`range ${low}–${high}`);
      else if (low) parts.push(`from ${low}`);
      else if (high) parts.push(`up to ${high}`);
      officeLines.push(`Price band: ${parts.join(", ")}`);
    }
    const angles = (officeProfile.signature_angles ?? []).filter(
      (a) => a && a.trim().length > 0,
    );
    if (angles.length > 0) {
      officeLines.push(`Signature angles: ${angles.slice(0, 8).join("; ")}`);
    }
  }

  // ---- Photo gallery ----
  // why: pass URLs only (no vision). The model uses gallery LENGTH + the
  // listing's hero_image_url to infer composition strength; vision is a
  // future enhancement, not MVP.
  const photoLines = availablePhotos.length > 0
    ? availablePhotos.map((url, i) => `  [${i}] ${url}`).join("\n")
    : "  (no photos available — Studio will still render with the listing's hero_image_url fallback)";

  return [
    "LISTING",
    listingLines.join("\n"),
    "",
    "OFFICE MARKET PROFILE",
    officeLines.length > 0
      ? officeLines.join("\n")
      : "(no office profile attached — work from listing fields alone)",
    "",
    `AVAILABLE PHOTOS (${availablePhotos.length} total; pick a hero_photo_index in [0..${Math.max(0, availablePhotos.length - 1)}])`,
    photoLines,
    "",
    "Return only the JSON object specified in the system prompt, no prose.",
  ].join("\n");
}

/**
 * Strict JSON extraction — Sonnet sometimes wraps output in ```json fences
 * or adds a leading sentence even with explicit instructions. Mirrors the
 * extractJson() helper in lib/ai/insight.ts so behavior stays consistent
 * across AI-powered features.
 */
function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
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

function isPostType(value: unknown): value is PostType {
  return typeof value === "string" && (POST_TYPES as readonly string[]).includes(value);
}

function isRecommendableVariant(value: unknown): value is RecommendableVariant {
  return (
    typeof value === "string" &&
    (RECOMMENDABLE_VARIANTS as readonly string[]).includes(value)
  );
}

function isPostFormat(value: unknown): value is PostFormat {
  return typeof value === "string" && (POST_FORMATS as readonly string[]).includes(value);
}

interface RawModelResponse {
  post_type?: unknown;
  variant?: unknown;
  format?: unknown;
  hero_photo_index?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  rationale?: unknown;
}

/**
 * Validate + narrow the raw Sonnet output into a strict
 * MagicDesignRecommendation. Returns null when any required field is missing
 * or invalid — the caller surfaces a "malformed response" error rather than
 * applying garbage to Studio state.
 */
function validateRecommendation(
  raw: RawModelResponse,
  photoCount: number,
): MagicDesignRecommendation | null {
  if (!isPostType(raw.post_type)) return null;
  if (!isRecommendableVariant(raw.variant)) return null;
  if (!isPostFormat(raw.format)) return null;

  // why: clamp hero_photo_index into bounds rather than fail outright — the
  // model occasionally returns a 1-based index. Defensive coercion is
  // cheaper than discarding an otherwise valid recommendation.
  let heroIdx = typeof raw.hero_photo_index === "number" ? raw.hero_photo_index : 0;
  if (!Number.isFinite(heroIdx) || !Number.isInteger(heroIdx)) heroIdx = 0;
  if (photoCount === 0) {
    heroIdx = 0;
  } else if (heroIdx < 0 || heroIdx >= photoCount) {
    heroIdx = Math.max(0, Math.min(photoCount - 1, heroIdx));
  }

  if (typeof raw.caption !== "string" || raw.caption.trim().length === 0) return null;

  if (!Array.isArray(raw.hashtags)) return null;
  const hashtags = raw.hashtags
    .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
    .map((h) => h.trim());
  if (hashtags.length === 0) return null;

  const rationale =
    typeof raw.rationale === "string" && raw.rationale.trim().length > 0
      ? raw.rationale.trim()
      : "";

  return {
    post_type: raw.post_type,
    variant: raw.variant,
    format: raw.format,
    hero_photo_index: heroIdx,
    caption: raw.caption.trim(),
    hashtags,
    rationale,
  };
}

/**
 * Run Magic Design against Claude Sonnet and return a parsed, validated
 * recommendation. Caller is responsible for auth-gating + the
 * isAnthropicConfigured() pre-check (the server action wrapper handles both).
 */
export async function runMagicDesign(
  input: MagicDesignInput,
): Promise<MagicDesignResult> {
  const client = await getAnthropic();
  if (!client) {
    // why: defensive — actions.ts checks isAnthropicConfigured() first, but
    // a stale 60s cache could still send us here with no key.
    return { ok: false, error: "Anthropic not configured" };
  }

  const userPrompt = buildUserPrompt(input);
  const photoCount = input.availablePhotos.length;

  let raw = "";
  try {
    const response = await client.messages.create({
      // why: Sonnet for Magic Design — it's a single-shot recommendation
      // that doesn't need Opus's heavier reasoning. Fast + cheap = good UX
      // when the user is sitting in front of a "Designing…" spinner.
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[magic-design] anthropic call failed:", msg);
    return { ok: false, error: `AI call failed: ${msg}` };
  }

  const parsed = extractJson(raw) as RawModelResponse | null;
  if (!parsed || typeof parsed !== "object") {
    console.error("[magic-design] failed to parse model output:", raw.slice(0, 400));
    return { ok: false, error: "Claude returned malformed response" };
  }

  const recommendation = validateRecommendation(parsed, photoCount);
  if (!recommendation) {
    console.error(
      "[magic-design] validation failed for parsed output:",
      JSON.stringify(parsed).slice(0, 400),
    );
    return { ok: false, error: "Claude returned malformed response" };
  }

  return { ok: true, recommendation };
}
