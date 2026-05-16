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
 * Variant identifier. Active single-photo variants: v1 (Hero Editorial),
 * v2 (Bold Stats), v3 (Side-by-Side), v6 (Magazine Cover), v7 (Polaroid),
 * v8 (Minimal Frame). Retired: v4 (Two-Photo Diptych — 2 photos),
 * v5 (Three-Photo Grid — 3 photos). Retired variants remain in the union
 * because legacy generated_posts rows still reference them.
 *
 * NOTE: the OutputMode union was removed on 2026-05-14 along with the
 * FB multi-photo bundle workflow. Every post is now a single designed
 * image; Studio handles adding extra photos via the left-panel inserter
 * if a user wants a composite.
 */
export type PostVariant = "v1" | "v2" | "v3" | "v4" | "v5" | "v6" | "v7" | "v8";
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

// ---------------------------------------------------------------------------
// Multi-property Open House event posts (Phase 5+, 2026-05-16)
// ---------------------------------------------------------------------------
//
// The standard Open House post is single-property: one designed graphic + the
// listing's MLS data bound in. When Larissa is hosting multiple open houses
// on the same day/weekend, the audience-facing pattern is different: she
// posts ONE event-overview card listing every property's address + time +
// agent contact, then a separate per-property card for each home — published
// as a single carousel.
//
// The carousel plumbing we shipped in Phase 5 already handles N+1 images
// (one hero + N supporting images in `additional_images`). What changes here:
//   • Hero is a NEW template (multi-property aggregate, not single-listing
//     bound).
//   • Supporting slides are pre-rendered per-property cards (using the
//     existing v1/v2/v3 Open House templates), not raw listing photos.
//
// MultiOHEventInput is the wizard's output and the multi-render endpoint's
// input. It carries everything the server needs to generate hero + N
// per-property PNGs and produce a single generated_posts row.

/**
 * One property's data inside a multi-property OH event. A slim subset of
 * PostBuilderListing — only the fields the event hero needs to list
 * (address + time + price) plus enough context to render the per-property
 * card via the existing V1 pipeline (mls_number, hero photo, beds/baths).
 */
export interface MultiOHEventProperty {
  /** Unique key for ordering + dedupe inside the carousel. */
  mls_number: string;
  source_mls: SourceMls;
  /** Internal listings.id from AllianceAnalytics Supabase. Used for the
   *  generated_posts.property_id FK if the event is anchored to one main
   *  property (typically the first in the list). */
  listing_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  list_price: number | null;
  bedrooms: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  property_type: string | null;
  hero_image_url: string | null;
  /** ISO 8601 UTC timestamps for the OH window. The hero formats these
   *  per-property as "Sat · 11:00 AM – 1:00 PM"-style strings. */
  oh_start_at: string | null;
  oh_end_at: string | null;
  /** Optional per-property hosting agent override. Useful when a single
   *  event spans homes hosted by different agents. */
  hosting_agent_name?: string | null;
}

/**
 * The complete wizard payload. The wizard collects this, the multi-render
 * endpoint consumes it.
 */
export interface MultiOHEventInput {
  /** Display title rendered at the top of the event hero card. e.g.,
   *  "Open House This Weekend" / "Saturday Open Houses" / "Beach Block
   *  Tour — Sunday 11–3". Wizard pre-fills based on the picked
   *  properties' dates; the user can override. */
  event_title: string;
  /** Primary agent attribution on the event hero (one name shown big).
   *  When properties have different hosting agents, individual cards still
   *  show the per-property host; this is the event-level contact. */
  agent_name: string;
  agent_phone?: string | null;
  agent_email?: string | null;
  /** Office shown on the footer of the event hero. Mirrors how the
   *  single-property templates bind office_name. */
  office_name: string;
  /** Format Larissa selected for the post. All slides in the carousel
   *  render at this format — IG/FB enforce uniform aspect ratios across
   *  carousel slides. */
  format: PostFormat;
  /** Variant for the PER-PROPERTY cards (the supporting slides). v1/v2/v3
   *  are supported; v4-v8 not yet ported into the multi-OH flow. */
  per_property_variant: "v1" | "v2" | "v3";
  /** Properties to feature, in carousel order (slide 1 = properties[0],
   *  slide 2 = properties[1], etc.). Minimum 2 (1 makes a single-listing
   *  post, use the standard Post Builder for that). Maximum 9 — leaves
   *  one slot for the event hero to fit under IG's 10-slide carousel cap. */
  properties: readonly MultiOHEventProperty[];
}

/** Max properties allowed in a single multi-OH event post. Capped so that
 *  hero + N properties stays under IG's 10-slide carousel limit. */
export const MULTI_OH_MAX_PROPERTIES = 9 as const;
/** Minimum — below this, use the standard single-property OH flow. */
export const MULTI_OH_MIN_PROPERTIES = 2 as const;

/**
 * Response from `/api/post-builder/multi-oh-generate` on success. The
 * caller redirects to `/post-builder?gp=<generated_post_id>` to land in
 * the standard resume flow, where the carousel pre-populated from
 * additional_images will render.
 */
export interface MultiOHGenerateOk {
  ok: true;
  /** id of the inserted generated_posts row. */
  generated_post_id: string;
  /** URL of the rendered event-overview hero (also the row's image_url). */
  hero_image_url: string;
  /** URLs of the per-property cards, in carousel slide order. */
  per_property_urls: string[];
}

export interface MultiOHGenerateErr {
  ok: false;
  error: string;
  /** Optional partial progress — useful if some properties rendered before
   *  the overall flow failed. Lets a future retry resume rather than
   *  re-render everything. */
  partial?: {
    hero_image_url?: string;
    per_property_urls?: string[];
  };
}

export type MultiOHGenerateResult = MultiOHGenerateOk | MultiOHGenerateErr;
