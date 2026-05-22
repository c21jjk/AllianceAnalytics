/**
 * Template Builder — data-binding contract.
 *
 * Templates reference listing data through a FIXED placeholder vocabulary
 * (see ADR Decision 10). This module is the single source of truth for
 * which placeholders exist and how they resolve against live listing data
 * at render time.
 *
 * Locking the set down means:
 *   • Authors can't introduce data dependencies the binding layer doesn't
 *     fulfill (e.g. inventing `{seller_name}` with no source).
 *   • The renderer never crashes on unknown placeholders — it logs and
 *     leaves the placeholder text in place so the gap is visible.
 *
 * Phase 1 ships the vocabulary + resolver but doesn't wire them into the
 * editor yet — Phase 2's WYSIWYG editor surfaces them as a dropdown when
 * the author adds a text layer.
 */

import "server-only";
import type { PostBuilderListing } from "@/lib/post-builder/types";

/**
 * Canonical placeholder keys. Frozen contract; new entries require an
 * ADR amendment + matching addition to the resolver below.
 */
export const TEMPLATE_PLACEHOLDERS = [
  "address",
  "city",
  "state",
  "zip",
  "price",
  "sold_price",
  "beds",
  "baths",
  "half_baths",
  "property_type",
  "unit_number",
  "agent_name",
  "hosting_agent",
  "oh_window",
  "oh_day",
  "oh_time",
  "mls_hashtag",
  "hero_photo",
  "photo_1",
  "photo_2",
  "photo_3",
  "photo_4",
  "photo_5",
  "brand_logo",
  "agent_headshot",
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

/**
 * Human-readable label shown in the editor's placeholder picker dropdown.
 * Keep terse — these appear in tight UI.
 */
export const PLACEHOLDER_LABELS: Record<TemplatePlaceholder, string> = {
  address: "Street address",
  city: "City",
  state: "State",
  zip: "ZIP code",
  price: "List price",
  sold_price: "Sold price",
  beds: "Bedrooms",
  baths: "Full baths",
  half_baths: "Half baths",
  property_type: "Property type",
  unit_number: "Unit number",
  agent_name: "Agent name",
  hosting_agent: "Hosting agent (OH)",
  oh_window: "Open House day + time",
  oh_day: "Open House day",
  oh_time: "Open House time",
  mls_hashtag: "MLS hashtag",
  hero_photo: "Hero photo",
  photo_1: "Photo 1",
  photo_2: "Photo 2",
  photo_3: "Photo 3",
  photo_4: "Photo 4",
  photo_5: "Photo 5",
  brand_logo: "Brand logo",
  agent_headshot: "Agent headshot",
};

/**
 * Extra context a template render might need beyond the bare listing.
 * Open-House-only fields (hosting_agent, oh_window) flow through here.
 */
export interface BindingContext {
  /** Hosting agent override for Open House posts. Resolves
   *  `{hosting_agent}` and is preferred over `agent_name` when set. */
  hosting_agent_name?: string | null;
  /** Pre-formatted OH window label "Sat · 10 AM–12 PM" — produced by the
   *  multi-OH route / post builder; the renderer doesn't reformat. */
  oh_window?: string | null;
  oh_day?: string | null;
  oh_time?: string | null;
  /** Canonical MLS hashtag including the # prefix and feed marker. */
  mls_hashtag?: string | null;
  /** Additional listing photos beyond the hero. Index N here resolves
   *  `{photo_N+1}` (photo_1 is the FIRST additional photo, since hero is
   *  separate). */
  additional_photos?: ReadonlyArray<string>;
  /** Brand logo URL — resolved by the asset library in Phase 3; Phase 1
   *  callers can pass a hardcoded URL. */
  brand_logo_url?: string | null;
  /** Agent headshot URL — Phase 3 wires this to the brand_assets table. */
  agent_headshot_url?: string | null;
}

/**
 * Resolve every placeholder against a listing + optional context. Returns
 * a map keyed by placeholder name; values are strings (or empty string
 * when unresolved) for text placeholders and URLs for image placeholders.
 *
 * The renderer walks the template schema, replaces `{placeholder}` tokens
 * with the resolved values, and emits the final HTML/canvas.
 */
export function resolvePlaceholders(
  listing: PostBuilderListing,
  context: BindingContext = {},
): Record<TemplatePlaceholder, string> {
  const price =
    typeof listing.list_price === "number"
      ? `$${listing.list_price.toLocaleString()}`
      : "";
  const soldPrice =
    typeof listing.close_price === "number"
      ? `$${listing.close_price.toLocaleString()}`
      : "";

  const baseAddress = (listing.address ?? "").trim();
  const unit = (listing.unit_number ?? "").trim();
  // why: address shown alone uses the canonical "Street · Unit" composite
  // so single-template authors don't have to add their own concatenation
  // logic. Authors who want JUST the street name use {address} (this), and
  // authors who want unit on its own line use {unit_number} separately.
  const addressWithUnit = unit
    ? baseAddress
      ? `${baseAddress} · ${unit}`
      : unit
    : baseAddress;

  const hostingAgent = (context.hosting_agent_name ?? "").trim();
  const listingAgent = (listing.agent_name ?? "").trim();

  return {
    address: addressWithUnit,
    city: (listing.city ?? "").trim(),
    state: (listing.state ?? "").trim(),
    zip: (listing.zip ?? "").trim(),
    price,
    sold_price: soldPrice,
    beds: typeof listing.bedrooms === "number" ? String(listing.bedrooms) : "",
    baths:
      typeof listing.bathrooms_full === "number"
        ? String(listing.bathrooms_full)
        : "",
    half_baths:
      typeof listing.bathrooms_half === "number"
        ? String(listing.bathrooms_half)
        : "",
    property_type: (listing.property_type ?? "").trim(),
    unit_number: unit,
    // why: agent_name picks the most specific contact available — hosting
    // agent first (Open House context), listing agent fallback. Authors
    // who specifically need the LISTING agent regardless of OH context
    // would need a future `{listing_agent}` placeholder.
    agent_name: hostingAgent || listingAgent,
    hosting_agent: hostingAgent,
    oh_window: (context.oh_window ?? "").trim(),
    oh_day: (context.oh_day ?? "").trim(),
    oh_time: (context.oh_time ?? "").trim(),
    mls_hashtag: (context.mls_hashtag ?? "").trim(),
    hero_photo: (listing.hero_image_url ?? "").trim(),
    photo_1: context.additional_photos?.[0] ?? "",
    photo_2: context.additional_photos?.[1] ?? "",
    photo_3: context.additional_photos?.[2] ?? "",
    photo_4: context.additional_photos?.[3] ?? "",
    photo_5: context.additional_photos?.[4] ?? "",
    brand_logo: (context.brand_logo_url ?? "").trim(),
    agent_headshot: (context.agent_headshot_url ?? "").trim(),
  };
}
