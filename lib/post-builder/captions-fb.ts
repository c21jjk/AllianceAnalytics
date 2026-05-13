import "server-only";
import { getAnthropic, ANTHROPIC_MODELS } from "@/lib/ai/anthropic";
import type { PostBuilderListing } from "./types";

/**
 * Phase 7+: caption generator for Facebook-native multi-photo posts.
 *
 * The output is multi-block — header hook, address block, AI description,
 * closing pitch, hashtags — designed for Facebook's post body (clickable
 * hashtags, line-break-preserving typography). Distinct from the IG-style
 * caption in captions.ts which is more compact and dumps hashtags at the
 * end for an image-with-text-overlay post.
 *
 * Two caption shapes:
 *   - new_listing_single  → one listing
 *   - open_house_multi    → N listings grouped by OH date (Phase 8)
 */

export interface FBCaptionResult {
  caption: string;
  hashtags: string[];
  mls_hashtag: string;
}

export type FBCaptionShape = "new_listing_single" | "open_house_multi";

/**
 * Generate a multi-block FB caption from one or more listings.
 *
 * Phase 7 only uses listings[0] (single property). Phase 8 will pass all
 * selected listings and the function will day-group + format them.
 */
export async function generateFBCaption(args: {
  shape: FBCaptionShape;
  listings: PostBuilderListing[];
}): Promise<FBCaptionResult | null> {
  if (args.shape === "new_listing_single") {
    if (args.listings.length === 0) return null;
    return generateNewListingCaption(args.listings[0]);
  }
  if (args.shape === "open_house_multi") {
    // Phase 8 — placeholder. Returns null for now; the UI shouldn't be
    // sending this shape until Phase 8 ships.
    return null;
  }
  return null;
}

/**
 * "Just Listed in {City} 🌅 / address block / AI description / closing /
 * location hashtags" — matches the actual C21 Alliance NJ post format.
 */
async function generateNewListingCaption(
  listing: PostBuilderListing,
): Promise<FBCaptionResult | null> {
  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);

  // Header / address / hashtag stack is fully deterministic — no AI needed
  // for these parts.
  const cityForHeader = listing.city ?? "South Jersey";
  const header = `Just Listed in ${cityForHeader} 🌅`;
  const addressLines = [
    listing.address ?? "",
    [listing.city, listing.state].filter(Boolean).join(", "),
    typeof listing.list_price === "number"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(listing.list_price)
      : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");

  // AI generates the description + closing pitch. Falls back to a
  // deterministic version if Claude isn't configured.
  const client = await getAnthropic();
  let aiDescription = "";
  let aiClosing = "";
  let aiExtraHashtags: string[] = [];

  if (client) {
    try {
      const prompt = buildPrompt(listing);
      const response = await client.messages.create({
        model: ANTHROPIC_MODELS.sonnet,
        max_tokens: 600,
        system:
          "You are a senior real estate social media writer at Century 21 Alliance, a brokerage with 8 offices in South Jersey. You write Facebook captions that drive engagement — conversational, specific, with a touch of personality. You use 1-2 emoji per caption (relevant, not decorative). No real estate cliches. You always return strict JSON with the exact shape requested — no markdown, no preamble.",
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
      const parsed = safeParseJson(raw);
      if (parsed && typeof parsed === "object") {
        const obj = parsed as {
          description?: unknown;
          closing?: unknown;
          extra_hashtags?: unknown;
        };
        if (typeof obj.description === "string") aiDescription = obj.description.trim();
        if (typeof obj.closing === "string") aiClosing = obj.closing.trim();
        if (Array.isArray(obj.extra_hashtags)) {
          aiExtraHashtags = obj.extra_hashtags
            .filter((s): s is string => typeof s === "string")
            .map((s) => normalizeHashtag(s))
            .filter((s) => s.length > 1);
        }
      }
    } catch (e) {
      console.error("[post-builder/captions-fb] Claude error:", e);
    }
  }

  // Fallbacks if AI didn't return usable content.
  if (!aiDescription) {
    aiDescription = `Beautiful ${listing.bedrooms ?? ""}-bedroom${listing.property_type ? ` ${listing.property_type.toLowerCase()}` : ""} ready for its next chapter. Real photos below — take a look and let me know what you think.`.replace(
      /\s+/g,
      " ",
    ).trim();
  }
  if (!aiClosing) {
    aiClosing =
      "Whether you're looking for a getaway, investment property, or full-time home, this one is worth a closer look.";
  }

  // Hashtags: location-led for FB (these get clickable + drive discovery)
  // plus brand + MLS hashtag at the end.
  const baseHashtags = buildLocationHashtags(listing);
  const brandHashtags = [
    "#century21alliance",
    "#southjerseyrealestate",
  ];
  const allHashtags = dedupeHashtags([
    ...baseHashtags,
    ...aiExtraHashtags,
    ...brandHashtags,
    mlsHashtag,
  ]);

  const captionParts = [
    header,
    "",
    addressLines,
    "",
    aiDescription,
    "",
    aiClosing,
    "",
    allHashtags.join(" "),
  ].filter((part) => part !== null);

  return {
    caption: captionParts.join("\n"),
    hashtags: allHashtags,
    mls_hashtag: mlsHashtag,
  };
}

function buildPrompt(listing: PostBuilderListing): string {
  const facts = [
    listing.address ? `Address: ${listing.address}` : null,
    [listing.city, listing.state].filter(Boolean).length > 0
      ? `Location: ${[listing.city, listing.state].filter(Boolean).join(", ")}`
      : null,
    typeof listing.list_price === "number" ? `Price: $${listing.list_price.toLocaleString()}` : null,
    listing.bedrooms ? `Bedrooms: ${listing.bedrooms}` : null,
    listing.bathrooms_full ? `Full bathrooms: ${listing.bathrooms_full}` : null,
    listing.bathrooms_half ? `Half bathrooms: ${listing.bathrooms_half}` : null,
    listing.property_type ? `Property type: ${listing.property_type}` : null,
  ]
    .filter((s): s is string => !!s)
    .join("\n");
  const remarks = listing.public_remarks
    ? `\n\nMLS public remarks (pull 1-2 specific features — don't quote verbatim):\n"""\n${listing.public_remarks.slice(0, 1500)}\n"""`
    : "";

  return `Write a Facebook caption for a new listing.

PROPERTY FACTS:
${facts}${remarks}

CAPTION STRUCTURE (you fill in only the description + closing — the header, address block, and hashtags are handled separately):

1. DESCRIPTION paragraph — 2-3 sentences. Highlight specific features (e.g. "AWESOME sunset views overlooking the intracoastal waterway 🌅 This spacious 4 bedroom home offers room for the whole family..."). Use 1 relevant emoji. Be specific — pull a concrete feature from the remarks.

2. CLOSING paragraph — 1-2 sentences. Position the property by use case (getaway / investment / full-time home / first-time buyer). Use 1 emoji if natural. Ends inviting but not pushy.

Then suggest 3-5 EXTRA hashtags (no '#' prefix needed). Mix:
- Specific neighborhood / lifestyle tags (e.g. "ShoreLiving", "BeachHouse", "OpenConcept")
- Skip generic tags like "realestate" or "realtor" — we add brand tags separately.

CONSTRAINTS:
- NO real estate cliches: "home sweet home", "dream home", "won't last", "must see", "diamond in the rough"
- NO ALL CAPS
- NO contact info / phone / URL — Larissa adds those
- Use AT MOST 2 emojis across description + closing

Return STRICT JSON in this exact shape:
{"description": "...", "closing": "...", "extra_hashtags": ["tag1","tag2",...]}`;
}

/**
 * Build location-led hashtags from the listing. Top of the hashtag stack
 * because FB rewards local discovery — these tags surface the post to
 * people following the area.
 */
function buildLocationHashtags(listing: PostBuilderListing): string[] {
  const tags: string[] = [];
  if (listing.city) {
    const cityTag = listing.city.replace(/[^A-Za-z0-9]/g, "");
    if (cityTag.length > 1) tags.push(`#${cityTag}`);
  }
  if (listing.city && listing.state) {
    const combined = `${listing.city.replace(/[^A-Za-z0-9]/g, "")}${listing.state}`;
    if (combined.length > 2) tags.push(`#${combined}`);
  }
  tags.push("#jerseyshorerealestate");
  return tags;
}

/**
 * Inline duplicate of toHashtag() from lib/data/listings-needing-posts.ts.
 * Kept here to avoid circular imports.
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

function safeParseJson(s: string): unknown {
  if (!s) return null;
  const stripped = s
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
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
