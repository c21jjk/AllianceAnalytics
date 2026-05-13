/**
 * Shared types for the Post Builder feature.
 *
 * The "PostBuilderListing" shape is the minimal listing data that templates
 * need. It's a subset of PropertySummary intentionally — keeps the template
 * contract narrow, lets us swap data sources later (e.g. fall through to
 * the Listings DB for richer fields) without rewriting templates.
 */

export type PostType =
  | "just_listed"
  | "just_sold"
  | "under_contract"
  | "open_house"
  | "price_reduction";
export type PostFormat = "square_1x1" | "portrait_4x5" | "story_9x16";

/**
 * How the post is rendered + delivered.
 *
 * - `ig_single` (Phase 1-6): one rendered PNG with all text baked on, optimized
 *   for Instagram feed/story where text-on-image works well and clickable
 *   hashtags aren't a thing.
 *
 * - `fb_multi` (Phase 7+): caption text shipped separately (paste into FB body),
 *   plus a multi-photo gallery — first photo is a designed "hero card" and the
 *   rest are real listing photos. Optimized for Facebook where the gallery grid
 *   + clickable hashtags + native typography all out-perform image-with-text.
 */
export type OutputMode = "ig_single" | "fb_multi";
/**
 * Variant identifier. Single-photo: v1 (Hero Editorial), v2 (Bold Stats),
 * v3 (Side-by-Side). Multi-photo: v4 (Two-Photo Diptych — 2 photos),
 * v5 (Three-Photo Grid — 3 photos).
 */
export type PostVariant = "v1" | "v2" | "v3" | "v4" | "v5";
export type SourceMls = "cmc" | "sjsr" | "bright" | "manual" | null;

export interface PostBuilderListing {
  id: string;
  mls_number: string;
  source_mls: SourceMls;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  /** Used by Just Sold templates. May be null. */
  close_price?: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  property_type: string | null;
  public_remarks: string | null;
  hero_image_url: string | null;
  listing_office_name: string | null;
  agent_name: string | null;
  listing_date: string | null;
  status: "active" | "pending" | "sold" | "expired";
  /** Open House start (UTC ISO). Set by the listings fetcher when post_type='open_house'. */
  oh_start_at?: string | null;
  /** Open House end (UTC ISO). May be null even when start is set. */
  oh_end_at?: string | null;
}

/**
 * Path A customizations — user-applied overrides on top of the template.
 *
 * Each section is fully optional. An empty object means the post uses the
 * template defaults. The renderer composes customizations on top of the
 * theme/primitive output (text overrides mutate the theme before primitive
 * render; visual overrides are injected as a CSS layer after).
 *
 * The shape is forward-compatible with Path B's layer-tree model — every
 * field here will map cleanly to a per-element override there.
 */
export interface PostCustomizations {
  /**
   * Color overrides. Hex strings ("#RRGGBB"). When set, override the
   * theme palette for the corresponding role.
   */
  colors?: {
    /** Primary brand accent (default: Alliance gold #C9A84C). */
    accent?: string;
    /** Gradient companion to accent (default: gold-700 #8B7530). */
    accent_dark?: string;
  };
  /**
   * Text overrides. Replace the auto-generated string for that slot. Useful
   * when the auto label doesn't fit a specific listing's narrative.
   */
  text?: {
    /** "JUST LISTED" / "JUST SOLD" / etc — replace the eyebrow label. */
    eyebrow?: string;
    /** "SOLD" / "↓ NEW PRICE" / etc — replace the badge stamp text. */
    badge_text?: string;
    /** FB hero card third stat ("SUNSET VIEWS"). Ignored on IG templates. */
    custom_feature?: string;
    /** Footer CTA override ("Tour link in bio" by default). */
    cta?: string;
  };
  /**
   * Visibility toggles. true = HIDE the element. False/undefined keeps it.
   */
  hide?: {
    eyebrow?: boolean;
    badge?: boolean;
    price?: boolean;
    /** The bd/ba/property-type chip strip. */
    stats_row?: boolean;
    /** The bottom-of-image brand + CTA footer block. */
    footer?: boolean;
    /** Agent name line (when shown by the template). */
    agent_name?: boolean;
  };
  /**
   * Badge sizing — applies to .badge-stamp / .badge-banner via CSS scale.
   * Default is "md" (no scale). "sm" = 0.75x, "lg" = 1.25x, "xl" = 1.5x.
   */
  badge_size?: "sm" | "md" | "lg" | "xl";
  /**
   * Which corner the .badge-stamp anchors to. Default depends on template
   * (most use top_right). Banners (.badge-banner) ignore this — they're
   * always full-width.
   */
  badge_position?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
}

export interface TemplateDimensions {
  width: number;
  height: number;
}

/**
 * Maps to the (post_type, variant, format) tuple. Composite IDs are stable
 * strings so they can be persisted on generated_posts.template_id without
 * needing a join table.
 */
export interface TemplateMeta {
  id: string;
  post_type: PostType;
  variant: PostVariant;
  format: PostFormat;
  display_name: string;
  description: string;
  dimensions: TemplateDimensions;
  /** Number of hero photos this template expects. 1 for v1-v3, 2 for v4, 3 for v5. */
  photo_count: number;
}

export interface RenderRequest {
  template_id: string;
  listing: PostBuilderListing;
  hero_image_url: string;
  /** Path A — optional user customizations baked into this render. */
  customizations?: PostCustomizations;
}

export interface RenderResponse {
  ok: true;
  image_url: string;
  image_path: string;
  template_id: string;
  width: number;
  height: number;
  rendered_at: string;
}

export interface RenderErrorResponse {
  ok: false;
  error: string;
}

export interface CaptionRequest {
  listing: PostBuilderListing;
  post_type: PostType;
}

export interface CaptionResponse {
  ok: true;
  caption: string;
  hashtags: string[];
  mls_hashtag: string;
}

export interface CaptionErrorResponse {
  ok: false;
  error: string;
}

export interface SaveGeneratedPostInput {
  mls_number: string;
  source_mls: SourceMls;
  property_id: string | null;
  post_type: PostType;
  variant: PostVariant;
  format: PostFormat;
  template_id: string;
  image_url: string;
  image_path: string;
  hero_image_source_url: string;
  template_props: Record<string, unknown>;
  caption: string;
  hashtags: string[];
  mls_hashtag: string;
  /** Path A — user customizations applied to this render. Empty object = defaults. */
  customizations?: PostCustomizations;
}

/**
 * Phase 7+: per-listing input for the FB Native bundle generator. The
 * generator accepts an ARRAY of these so the same code path serves
 * single-listing (Phase 7 New Listing) and multi-listing (Phase 8 Open
 * House) workflows.
 */
export interface FBBundleListingInput {
  listing: PostBuilderListing;
  /** Real-photo URLs to include in the FB gallery, in order. */
  real_photo_urls: string[];
  /** Optional override for the hero card's third stat (e.g. "SUNSET VIEWS"). */
  custom_feature?: string | null;
}

export interface FBBundleRequest {
  /**
   * Which hero card design to use. v1 is the only one for Phase 7.
   * Phase 8 will add an open-house variant.
   */
  hero_template_id: "fb_new_listing_v1" | "fb_open_house_v1";
  /** Caption shape — drives the multi-block format. */
  caption_shape: "new_listing_single" | "open_house_multi";
  listings: FBBundleListingInput[];
}

export interface FBBundleResponse {
  ok: true;
  bundle_url: string;
  bundle_path: string;
  asset_count: number;
  caption: string;
  hashtags: string[];
  mls_hashtag: string;
  generated_post_id: string;
  rendered_at: string;
}

export interface FBBundleErrorResponse {
  ok: false;
  error: string;
}

export interface SaveGeneratedPostResult {
  ok: true;
  id: string;
}

export interface SaveGeneratedPostErrorResult {
  ok: false;
  error: string;
}
