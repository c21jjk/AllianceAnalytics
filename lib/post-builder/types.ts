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
}

export interface SaveGeneratedPostResult {
  ok: true;
  id: string;
}

export interface SaveGeneratedPostErrorResult {
  ok: false;
  error: string;
}
