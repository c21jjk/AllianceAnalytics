/**
 * mapListingToPayload — V1 PostBuilderListing → editor-facing MLSListingPayload
 * ------------------------------------------------------------------------------
 *
 * The boundary between the V1 schema (Path A render pipeline) and the
 * canvas-editor schema (Path C). Pure function. No async, no DB queries —
 * caller is responsible for fetching photos and agent info upstream and
 * passing them in.
 *
 * Why a thin mapper instead of "just use PostBuilderListing everywhere":
 *   • The editor needs an ordered photo array (PostBuilderListing only carries
 *     a single hero_image_url). Photos come from `lib/post-builder/photos.ts`
 *     which queries the `listing_photos` table.
 *   • The editor's status enum includes "coming_soon" which doesn't exist in
 *     V1's `PostBuilderListing.status`. We default it to "active".
 *   • Field names normalize: priceList vs list_price, addressLine1 vs address.
 *     Keeping the editor field names in camelCase (matching the rest of the
 *     canvas-editor module) avoids confusion when reading the editor code.
 *
 * Why this lives in the canvas-editor folder and not somewhere shared:
 *   It's a one-way transformation FROM V1 TO the editor. The inverse would
 *   only be needed if we were serializing canvas-editor edits back into V1
 *   types — we're not. The editor's outputs go to a NEW persistence layer
 *   in Step 3.
 */

import type { PostBuilderListing } from "../types";
import type { MLSListingPayload } from "./types";

/**
 * Extra context the mapper needs that doesn't live on the V1 listing row.
 *
 * Everything here is optional with sensible defaults so callers can pass
 * just the listing in the common case. Step 2 only needs `photos` because
 * we're testing single-photo templates.
 */
export interface ListingMapperContext {
  /**
   * Ordered photo URLs. Index 0 is the hero. When omitted, falls back to
   * [listing.hero_image_url] if that's set, else an empty array.
   */
  photos?: string[];

  /**
   * Agent overrides — for Step 2 these come from a hardcoded "current user"
   * context in PostBuilderClient. Step 3 will source these from a proper
   * `agents` table per the V2 roadmap.
   */
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  agentTitle?: string | null;
  agentPhotoUrl?: string | null;

  /**
   * Office overrides. Defaults to the listing_office_name field on the V1
   * listing, with the official C21 Alliance logo URL.
   */
  officeName?: string | null;
  officeLogoUrl?: string | null;

  /**
   * Auto-generated tagline (Claude-powered). When omitted, the editor will
   * render an empty string and the user can fill it in by editing the
   * bound text layer in place.
   */
  tagline?: string | null;
}

/**
 * Translate V1 status enum (`active | pending | sold | expired`) to the
 * editor's enum (adds `coming_soon`). One-to-one for the V1 members, with
 * the editor's superset member defaulting via the input not matching any.
 *
 * Why a helper rather than inlining the cast: keeps the V1 → editor enum
 * coercion auditable. If V1 ever adds a new status, TS will catch it here
 * via the exhaustive switch.
 */
function mapStatus(
  status: PostBuilderListing["status"],
): MLSListingPayload["status"] {
  switch (status) {
    case "active":
      return "active";
    case "pending":
      return "pending";
    case "sold":
      return "sold";
    case "expired":
      return "expired";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * Coerce the V1 `source_mls` field into the canvas-editor union shape.
 * V1's type is `"cmc" | "sjsr" | "bright" | "manual" | null` — the editor
 * matches exactly, so this is a no-op cast wrapped in a function for
 * documentation clarity.
 */
function mapSourceMls(
  src: PostBuilderListing["source_mls"],
): MLSListingPayload["sourceMls"] {
  return src;
}

/**
 * Main mapper.
 *
 * @param listing  V1 listing row from the Post Builder data layer.
 * @param ctx      Optional extra context (photos, agent, office, tagline).
 * @returns        MLSListingPayload ready for the canvas editor.
 *
 * Edge cases handled:
 *   • Listing.hero_image_url null AND ctx.photos undefined → photos = [].
 *     The editor renders placeholder rects for missing photo slots.
 *   • Listing.close_price set when post_type is just_sold — passed through
 *     to priceClose; templates can bind either field.
 *   • Open House dates (oh_start_at / oh_end_at) — V1 stores ISO UTC strings;
 *     we pass them through unchanged. Editor formats at hydration time.
 */
export function mapListingToPayload(
  listing: PostBuilderListing,
  ctx: ListingMapperContext = {},
): MLSListingPayload {
  // why: build photos array with explicit precedence — caller's explicit
  // array wins, then hero_image_url as a single-entry fallback, then empty.
  //
  // Subtle bug fix 2026-05-16: treat an EMPTY caller-provided array
  // (`ctx.photos = []`) the same as undefined — fall through to the
  // hero_image_url fallback. Previously empty was treated as authoritative,
  // which silently produced templates with no hero photo when Studio
  // opened before the listing's photos endpoint had returned. Multi-OH
  // posts hit this race regularly because the resume flow auto-opens
  // Studio as soon as photosLoading resolves, but if the listing has no
  // listing_photos rows the endpoint returns []. With this change, the
  // hero_image_url synth on the listing row becomes the cover.
  // We never silently concatenate the two because the caller's `photos` is
  // assumed to be the authoritative ordered list from listing_photos table.
  const photos: string[] =
    ctx.photos && ctx.photos.length > 0
      ? ctx.photos
      : listing.hero_image_url
        ? [listing.hero_image_url]
        : [];

  return {
    id: listing.id,
    mlsNumber: listing.mls_number,
    sourceMls: mapSourceMls(listing.source_mls),

    // pricing
    priceList: listing.list_price,
    priceClose: listing.close_price ?? null,

    // address
    addressLine1: listing.address,
    city: listing.city,
    state: listing.state,
    zip: listing.zip,

    // specs
    beds: listing.bedrooms,
    bathsFull: listing.bathrooms_full,
    bathsHalf: listing.bathrooms_half,
    // why: V1 doesn't carry squareFeet on PostBuilderListing. When the editor
    // binds to {{sqft}}, it gets null → falls back to layer.text. Adding sqft
    // to the V1 row is a Step 3+ enhancement.
    squareFeet: null,
    propertyType: listing.property_type,

    // marketing
    tagline: ctx.tagline ?? null,
    remarks: listing.public_remarks,
    status: mapStatus(listing.status),

    // photos
    photos,

    // agent
    agentName: ctx.agentName ?? listing.agent_name ?? null,
    agentPhone: ctx.agentPhone ?? null,
    agentEmail: ctx.agentEmail ?? null,
    agentTitle: ctx.agentTitle ?? null,
    agentPhotoUrl: ctx.agentPhotoUrl ?? null,

    // office
    officeName: ctx.officeName ?? listing.listing_office_name ?? null,
    officeLogoUrl: ctx.officeLogoUrl ?? null,
    // Filled by the headless render route from the brand_assets logo library;
    // null here so the editor preview falls back to the brand-logos.ts constant.
    brokerageLogoUrl: null,

    // open house
    openHouseStartUtc: listing.oh_start_at ?? null,
    openHouseEndUtc: listing.oh_end_at ?? null,
  };
}
