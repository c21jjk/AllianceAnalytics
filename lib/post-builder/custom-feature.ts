import "server-only";
import { getAnthropic, ANTHROPIC_MODELS } from "@/lib/ai/anthropic";
import type { PostBuilderListing } from "./types";

/**
 * AI-suggests the "Custom Feature" for the third stat on a FB Hero Card.
 *
 * This is the line that goes after "{bedrooms} BEDROOM | {bathrooms} BATHROOM | ..."
 * — a hand-picked feature that makes the property stand out. Examples from
 * actual C21 Alliance NJ posts: "SUNSET VIEWS", "BEACHBLOCK", "OPEN CONCEPT",
 * "WATERFRONT", "HISTORIC CHARM".
 *
 * AI reads the MLS public remarks and picks the ONE feature most worth
 * highlighting. User can override before render.
 *
 * Returns null if Anthropic isn't configured or the suggestion is empty —
 * caller should let the UI fall back to "PROPERTY TYPE".
 */
export async function suggestCustomFeature(
  listing: PostBuilderListing,
): Promise<string | null> {
  if (!listing.public_remarks || listing.public_remarks.trim().length < 20) {
    return null;
  }

  const client = await getAnthropic();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 60,
      system:
        "You are a real estate marketing copywriter at Century 21 Alliance NJ. You pick the single most compelling 'hero feature' from MLS remarks — the one phrase that makes a property worth a second look. Always respond with just the feature phrase in ALL CAPS, 1-3 words, no punctuation, no quotes. If nothing stands out, respond with NONE.",
      messages: [
        {
          role: "user",
          content: `Pick the standout feature of this property in 1-3 ALL CAPS words for a social media card. Examples of good answers:
SUNSET VIEWS
BEACHBLOCK
OPEN CONCEPT
WATERFRONT
HISTORIC CHARM
TURNKEY READY
CHEF'S KITCHEN
PRIVATE POOL

Property details:
${listing.address ?? ""} · ${listing.city ?? ""}, ${listing.state ?? ""}
${listing.bedrooms ?? "?"}BR / ${listing.bathrooms_full ?? "?"}BA${listing.bathrooms_half ? `+${listing.bathrooms_half}H` : ""}
Type: ${listing.property_type ?? "unknown"}

MLS Public Remarks:
"""
${listing.public_remarks.slice(0, 1200)}
"""

Your answer (ALL CAPS, 1-3 words, NO quotes, NO punctuation):`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const cleaned = raw
      .trim()
      .replace(/^["']+|["']+$/g, "")
      .replace(/[.!?,;:]+$/g, "")
      .toUpperCase()
      .trim();

    if (!cleaned || cleaned === "NONE") return null;
    // Sanity cap: 30 chars max so it fits in the stat strip.
    if (cleaned.length > 30) return cleaned.slice(0, 30).trim();
    return cleaned;
  } catch (e) {
    console.error("[post-builder/custom-feature] Claude error:", e);
    return null;
  }
}
