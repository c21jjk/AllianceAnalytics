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
 * Variant identifier. Single-photo: v1 (Hero Editorial), v2 (Bold Stats),
 * v3 (Side-by-Side). Multi-photo: v4 (Two-Photo Diptych — 2 photos),
 * v5 (Three-Photo Grid — 3 photos).
 *
 * NOTE: the OutputMode union was removed on 2026-05-14 along with the
 * FB multi-photo bundle workflow. Every post is now a single designed
 * image; Studio handles adding extra photos via the left-panel inserter
 * if a user wants a composite.
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
   * NOTE: only Just Sold and Price Reduced post types have a badge in the
   * default themes. Just Listed / Under Contract / Open House have none.
   */
  badge_size?: "sm" | "md" | "lg" | "xl";
  /**
   * Which corner the .badge-stamp anchors to. Default depends on template
   * (most use top_right). Banners (.badge-banner) ignore this — they're
   * always full-width.
   */
  badge_position?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  /**
   * Eyebrow label sizing (the "JUST LISTED" / "JUST SOLD" tag at the
   * corner of the post). Scales font-size + rule width together.
   * Default is "md" (no scale). "sm" = 0.8x, "lg" = 1.3x, "xl" = 1.6x.
   */
  eyebrow_size?: "sm" | "md" | "lg" | "xl";
  /**
   * Which corner the .eyebrow anchors to. Default is top_left for all
   * templates today.
   */
  eyebrow_position?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
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

// FBBundle* types removed on 2026-05-14 — the FB multi-photo bundle path
// was deleted in favor of a single-image flow for every post. Studio's
// left-panel photo inserter handles cases where a user wants extra photos
// composited into the final image.

export interface SaveGeneratedPostResult {
  ok: true;
  id: string;
}

export interface SaveGeneratedPostErrorResult {
  ok: false;
  error: string;
}
