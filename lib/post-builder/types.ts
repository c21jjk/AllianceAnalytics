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
// 2026-05-22 — Square 1:1 retired. IG distribution now strongly favors
// Portrait 4:5 for feed; Square added no value, only confused the picker.
// All NEW posts render as 4:5 (feed) or 9:16 (Stories / Reels / TikTok).
// Legacy generated_posts rows with format='square_1x1' keep their column
// value (it's just text in the DB) and their already-rendered PNG, but no
// new code path can produce square output.
// 2026-05-24 — square_1x1 is the default feed format. story_9x16 is for
// Stories and Reels. portrait_4x5 was retired in the same purge; all
// generated_posts rows that previously stored 'portrait_4x5' were
// migrated to 'square_1x1' in the DB. New code must NOT reintroduce
// portrait_4x5 as a valid format.
export type PostFormat = "square_1x1" | "story_9x16";

/**
 * Variant identifier. Active single-photo variants: v1 (Hero Editorial),
 * v2 (Bold Stats), v3 (Side-by-Side / Excellence Collection), v6 (Magazine
 * Cover), v7 (Polaroid), v8 (Minimal Frame / Standard Listing), v9 (Just
 * Sold Celebration — the triumphant variant designed AROUND closed deals).
 * Retired: v4 (Two-Photo Diptych — 2 photos), v5 (Three-Photo Grid — 3
 * photos). Retired variants remain in the union because legacy
 * generated_posts rows still reference them.
 *
 * NOTE: the OutputMode union was removed on 2026-05-14 along with the
 * FB multi-photo bundle workflow. Every post is now a single designed
 * image; Studio handles adding extra photos via the left-panel inserter
 * if a user wants a composite.
 */
export type PostVariant =
  | "v1"
  | "v2"
  | "v3"
  | "v4"
  | "v5"
  | "v6"
  | "v7"
  | "v8"
  | "v9"
  | "v10";
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
  /** Living-area square footage. CMC L_SquareFeet / SJSR LM_Int4_2. NULL when feed omits it. */
  square_feet?: number | null;
  property_type: string | null;
  public_remarks: string | null;
  hero_image_url: string | null;
  listing_office_name: string | null;
  agent_name: string | null;
  /**
   * 2026-08-17 (John): which side of the transaction Alliance represented
   * (properties.alliance_role). Drives the `agent_role_label` bound field on
   * Just Sold templates ("Listing Agent" / "Buyers Agent" / "Dual Agent").
   * Note agent_name is ALREADY the display agent by the time this shape
   * exists — toListing swaps in buyer_agent_name on 'buyer' rows (8/15 fix) —
   * so this field only labels the side; it never changes who is featured.
   * Optional: legacy callers that build this shape without it keep compiling
   * and simply default to the "Listing Agent" label.
   */
  alliance_role?: "listing" | "buyer" | "both" | null;
  listing_date: string | null;
  status: "active" | "pending" | "sold" | "expired";
  /** Condo/townhouse/lot identifier from Paragon's L_Address2 — e.g.
   *  "Unit 207", "#9", "Lot #MJ-01". NULL for single-family homes. */
  unit_number?: string | null;
  /** Open House start (UTC ISO). Set by the listings fetcher when post_type='open_house'. */
  oh_start_at?: string | null;
  /** Open House end (UTC ISO). May be null even when start is set. */
  oh_end_at?: string | null;
  /** Open House comments/notes from Paragon — used to parse "Hosted by …"
   *  patterns that override the listing agent attribution. */
  oh_comments?: string | null;
  /**
   * 2026-08-07 (John): the Multi-OH wizard needs to batch its picker by
   * division the same way the dashboard Open Houses card does. Resolved from
   * properties.office_id via the offices table in the listings fetcher.
   */
  office_short_code?: string | null;
  /** offices.division, e.g. "shore" / "south_jersey". Null when unset. */
  division?: string | null;
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

/**
 * Phase D — per-platform caption variant. Each platform (IG, FB, TikTok)
 * gets its own caption + hashtag list tuned to that platform's audience
 * and algorithm. Persisted on `generated_posts.captions_by_platform`.
 */
export interface PlatformCaptionVariant {
  caption: string;
  hashtags: string[];
}

export type CaptionsByPlatform = Record<
  SchedulablePlatform,
  PlatformCaptionVariant
>;

export interface CaptionResponse {
  ok: true;
  /** Legacy single-caption field — mirrors `captions.instagram.caption`. */
  caption: string;
  /** Legacy hashtags — mirrors `captions.instagram.hashtags`. */
  hashtags: string[];
  mls_hashtag: string;
  /** Phase D — per-platform variants. */
  captions: CaptionsByPlatform;
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
  /**
   * Phase D — per-platform caption variants. Optional; when omitted the
   * action writes `{}` which makes the publish-side helper fall back to
   * the legacy single `caption` column. Set this when the user has
   * tuned the IG / FB / TikTok tabs before clicking Download/Save.
   */
  captions_by_platform?: CaptionsByPlatform;
  /**
   * Phase 2 AI Design — optional provenance written when the post was
   * produced by /api/post-builder/design-and-render. Drives the Studio
   * "Designed by Claude" badge + the Revert link. All-or-nothing: callers
   * either pass every field or none.
   */
  ai_design?: AiDesignProvenance | null;
}

/**
 * Phase 2 AI Design provenance bag — telemetry + revert-target written
 * onto generated_posts when the post was produced via the Studio AI
 * pipeline. Drives the gold "✨ Designed by Claude" badge in Studio +
 * the "Revert to template default" link.
 *
 * Mood is the closed-enum DesignMood from
 * `lib/post-builder/canvas-editor/ai/types.ts`; kept as a string here
 * because this types file is imported by both server actions and client
 * components, and we don't want a server-only import chain reaching
 * into the AI types from here.
 */
export interface AiDesignProvenance {
  /** One of the 6 closed-enum DesignMoods from the pipeline strategy pass. */
  mood: string;
  /** Pass 4 critique gate result. False = critique returned a revised plan. */
  critique_passed: boolean;
  token_input: number;
  token_output: number;
  duration_ms: number;
  /**
   * Factory template id we started from. Persisted as
   * `generated_posts.original_template_id` so the Studio revert link can
   * re-hydrate from the factory after layer_tree was overwritten by the
   * AI schema.
   */
  original_template_id: string;
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
  /** ISO 8601 UTC timestamps for the PRIMARY OH window. Kept for
   *  backward compat (single-session events). When a property is hosting
   *  multiple OHs that same weekend, `oh_sessions` holds the full list
   *  including this one. */
  oh_start_at: string | null;
  oh_end_at: string | null;
  /** Every OH window for this property in the event — Sat + Sun if the
   *  user picked both. Newer field (2026-05-22). Empty/undefined falls
   *  back to the single oh_start_at / oh_end_at pair. */
  oh_sessions?: ReadonlyArray<{
    start_at: string | null;
    end_at: string | null;
  }>;
  /** Optional per-property hosting agent override. Useful when a single
   *  event spans homes hosted by different agents. */
  hosting_agent_name?: string | null;
  /** Condo/townhouse/lot identifier — shown right after the address on
   *  hero rows and per-property cards so consumers know which unit. */
  unit_number?: string | null;
}

/**
 * The complete wizard payload. The wizard collects this, the multi-render
 * endpoint consumes it.
 */
export interface MultiOHEventInput {
  /**
   * DEPRECATED 2026-05-21 — the event hero no longer surfaces a single
   * event-level agent. Each property card carries its own
   * `hosting_agent_name`, which is the only attribution shown on the
   * carousel. Fields are kept on the type for backward compatibility with
   * any older callers / persisted rows that still send them, but the
   * renderer ignores them entirely.
   */
  agent_name?: string | null;
  agent_phone?: string | null;
  agent_email?: string | null;
  /** Office shown on the footer of the event hero. Mirrors how the
   *  single-property templates bind office_name. */
  office_name: string;
  /** Format Larissa selected for the post. All slides in the carousel
   *  render at this format — IG/FB enforce uniform aspect ratios across
   *  carousel slides. */
  format: PostFormat;
  /** Variant for the PER-PROPERTY cards (the supporting slides). The set
   *  matches the active templates in lib/post-builder/templates/registry.ts.
   *  Updated 2026-05-21 — v1 Hero Editorial was retired from the registry
   *  on 2026-05-17; the multi-OH wizard now offers v2, v3, v6, v8. The
   *  "v1" string survives in the wider PostVariant union (lib/post-builder
   *  /types.ts) so legacy generated_posts rows can still deserialize.
   *
   *  Ignored when `db_template_id` is set — DB templates supersede the
   *  legacy variant choice for every per-property slide in the event. */
  per_property_variant: "v2" | "v3" | "v6" | "v8";
  /** Phase 2E (2026-05-22) — when set, every per-property card in the
   *  carousel renders via the admin-authored DB template at this UUID
   *  instead of the legacy `per_property_variant` registry entry. The
   *  event hero card always uses its dedicated multi-OH layout regardless
   *  of this field (the DB template applies to per-property slides only).
   *  Optional / nullable so legacy clients continue to work unchanged. */
  db_template_id?: string | null;
  /**
   * Phase 6 (2026-05-27) — caption tone bias. Picked from a 6-pill picker
   * on Step 3 of the wizard. `"auto"` (the default) runs heuristic tone
   * detection inside the shared synth module; explicit values lock the
   * pool. Editorial is never auto-picked.
   *
   * Ignored when `caption_override` is set — the override always wins.
   */
  tone?: "auto" | "coastal" | "family" | "investor" | "cozy" | "editorial";
  /**
   * Phase 6 — full-caption user override. When set, replaces the auto-
   * synth body for all three platforms. Hashtags are still auto-appended
   * unless the override already contains them. Null / empty means "no
   * override; let synth do its thing".
   */
  caption_override?: string | null;
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

/**
 * Per-slide source metadata for a Multi-OH carousel post. Stored as a
 * parallel array to additional_images on the generated_posts row — index N
 * here corresponds to slide N+1 in the carousel (slide 0 is the hero).
 *
 * Enables "edit each individual property card" workflow: when Larissa
 * clicks Edit on a slide thumbnail, the editor uses this metadata to
 * resolve the slide's template + listing payload and re-open it. The
 * layer_tree field, when present, takes precedence over the factory
 * template so prior edits are preserved.
 */
export interface SlideMetadata {
  /** MLS number of the listing this slide was generated from. */
  listing_mls: string;
  /** The variant that originally produced this slide. Includes "v1"
   *  defensively for legacy rows persisted before 2026-05-21 when v1 was
   *  the default; current writes only use the active set (v2/v3/v6/v8).
   *  When `db_template_id` is set, `variant` is informational only —
   *  rehydration uses the DB template id. */
  variant: "v1" | "v2" | "v3" | "v6" | "v8";
  /** Phase 2E (2026-05-22) — when present, the slide was rendered via an
   *  admin-authored DB template. Supersedes `variant` for the rehydration
   *  path (Studio's "Edit slide" opens the DB template's schema for the
   *  active format, not a registry entry). Null/absent on legacy slides. */
  db_template_id?: string | null;
  /** Format — same as the hero's format; carousel slides share aspect ratio. */
  format: PostFormat;
  /** Optional per-property hosting agent override from the wizard. */
  hosting_agent_name?: string | null;
  /**
   * Saved canvas-editor schema from the user's edits to this slide. Null
   * until the user has opened + saved the slide in Studio at least once.
   * Same role as generated_posts.layer_tree plays for the hero.
   */
  layer_tree?: unknown | null;
  /**
   * 2026-05-28 — Fabric `toObject` snapshot of the user's latest slide
   * design, written by the debounced server autosave (and on explicit
   * Save). Same role `generated_posts.fabric_json` plays for the hero:
   * reopen restores it via `initialFabricJson` so edits survive without a
   * "restore?" prompt. Null until the slide has been edited in Studio.
   */
  fabric_json?: unknown | null;
}

// ---------------------------------------------------------------------------
// Native video / Reels — Phase 6 (started 2026-05-15)
// ---------------------------------------------------------------------------
//
// Static feed posts get a fraction of the reach Reels do on IG + FB. The
// fix is to deliver still-property content AS short Reels-format videos —
// same source material (designed hero card + listing photos), wrapped in
// 5-7 seconds of motion, audio, and brand-perfect framing.
//
// We're building this natively rather than renting a render service. The
// schema below is the contract between the editor (which composes the
// video declaratively) and the render worker (which interprets the schema
// and produces an MP4 via headless Fabric + ffmpeg).
//
// Persisted on `generated_posts.composition_json` so a published Reel can
// be re-opened and re-edited in Studio later — same role layer_tree plays
// for stills.

/**
 * A motion path defines how a photo is cropped + animated over a scene's
 * duration. Coordinates are 0..1 normalized (fractions of the source
 * photo's dimensions), so the same motion path applies cleanly across
 * different source photos.
 *
 *   startRect = {x:0.10, y:0.10, w:0.80, h:0.80}  →  start zoomed to center 80%
 *   endRect   = {x:0.00, y:0.00, w:1.00, h:1.00}  →  end at full frame
 *   easing    = "ease_in_out"                       →  smooth zoom-out
 *
 * The renderer interpolates rect → rect linearly over the scene's
 * durationMs, with the easing curve applied. Frame N's crop is the lerped
 * rect projected onto the source photo's pixel grid.
 */
export interface MotionRect {
  /** Top-left x as fraction of source width [0..1]. */
  x: number;
  /** Top-left y as fraction of source height [0..1]. */
  y: number;
  /** Crop width as fraction of source width (0..1]. */
  w: number;
  /** Crop height as fraction of source height (0..1]. */
  h: number;
}

export interface MotionPath {
  startRect: MotionRect;
  endRect: MotionRect;
  /**
   * Easing curve applied to the parametric t (0..1) before lerping the
   * rects. Default is "ease_in_out" — the most natural Ken Burns motion.
   */
  easing: "linear" | "ease_in" | "ease_out" | "ease_in_out";
}

/**
 * Canonical motion preset library. The editor surfaces these as named
 * buttons ("Zoom in", "Pan left", etc.); a custom path is also allowed.
 *
 * Why preset constants live in types.ts: the renderer needs to resolve a
 * preset NAME to a motion path the same way the editor does, and both
 * sides need to agree on the exact rect math. Single source of truth.
 */
export const MOTION_PRESETS: Readonly<Record<string, MotionPath>> = {
  static: {
    startRect: { x: 0, y: 0, w: 1, h: 1 },
    endRect: { x: 0, y: 0, w: 1, h: 1 },
    easing: "linear",
  },
  zoom_in: {
    startRect: { x: 0, y: 0, w: 1, h: 1 },
    endRect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    easing: "ease_in_out",
  },
  zoom_out: {
    startRect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    endRect: { x: 0, y: 0, w: 1, h: 1 },
    easing: "ease_in_out",
  },
  pan_left: {
    startRect: { x: 0.1, y: 0, w: 0.9, h: 1 },
    endRect: { x: 0, y: 0, w: 0.9, h: 1 },
    easing: "ease_in_out",
  },
  pan_right: {
    startRect: { x: 0, y: 0, w: 0.9, h: 1 },
    endRect: { x: 0.1, y: 0, w: 0.9, h: 1 },
    easing: "ease_in_out",
  },
} as const;

/**
 * Discriminated union for what a scene actually contains. Three kinds
 * cover everything we need at MVP:
 *
 *   "design"      — a canvas-editor schema instance (uses CanvasTemplateSchema).
 *                   Rendered by running the editor's Fabric pipeline
 *                   server-side and capturing the result. Static for the
 *                   full scene duration (no motion — text doesn't animate
 *                   in MVP). Used for hero card frames + outros.
 *
 *   "photo"       — a single listing photo with a motion path. The most
 *                   common scene type — this is what makes the Reel feel
 *                   like a moving listing tour.
 *
 *   "video_clip"  — RESERVED for Phase 7 (real video clip ingestion). Not
 *                   wired in MVP; reserved in the schema to keep the union
 *                   open. The renderer rejects this kind for now.
 */
export type SceneContent =
  | {
      kind: "design";
      /**
       * The canvas-editor template schema this scene renders, embedded by
       * VALUE so the composition is self-contained — re-rendering the MP4
       * produces the same output even if the underlying template factory
       * changes over time.
       *
       * Stored as `unknown` here at the main-app boundary (the schema's
       * full structural type lives in `lib/post-builder/canvas-editor/
       * types.ts` as `CanvasTemplateSchema`). The worker's render.js
       * interprets it structurally — width / height / layers[] / etc. —
       * without depending on the editor module. Cast at the consumer.
       */
      template: unknown;
    }
  | {
      kind: "photo";
      /** Public URL of the source photo (listing photo, brand asset, etc.). */
      photoUrl: string;
      /** How the photo crops + animates over the scene duration. */
      motion: MotionPath;
    }
  | {
      kind: "video_clip";
      /** RESERVED — Phase 7. Renderer rejects this in MVP. */
      videoUrl: string;
      trimStartMs: number;
    };

/** Transitions between scenes. All have a configurable duration in ms.
 *  Maps to ffmpeg xfade presets in the worker (worker/src/render/compose-video.ts).
 *  Existing 5 kept for back-compat; expanded 2026-06-05. */
export type TransitionType =
  | "cut" // 0ms hard cut — no overlap.
  | "fade" // crossfade (cross-dissolve) between the two scenes.
  | "dissolve" // dip-to-black between scenes.
  | "fade_white" // dip-to-white between scenes.
  | "slide_left" // outgoing slides off-left as incoming enters from the right.
  | "slide_right" // outgoing slides off-right as incoming enters from the left.
  | "slide_up" // outgoing slides up as incoming enters from below.
  | "slide_down" // outgoing slides down as incoming enters from above.
  | "wipe_left" // hard wipe revealing the incoming scene from the right.
  | "smooth_left" // smooth "whip" pan to the left.
  | "smooth_right" // smooth "whip" pan to the right.
  | "circle_open" // incoming scene revealed through an expanding circle.
  | "zoom_blur"; // outgoing zooms in + blurs out as incoming fades in.

/**
 * 2026-06-05 — Animated text overlays on a scene (CapCut-style). Any scene
 * (photo or design) can carry N text overlays rendered on top of its content
 * and animated in. Mirrored in worker/src/types.ts; both the preview
 * (ReelPreview) and the worker render them, so keep the three in lockstep.
 */

/** Entrance animation for a text overlay. Preview + worker approximate these. */
export type TextOverlayAnimation =
  | "none" // appears instantly, holds
  | "fade" // opacity 0 -> 1
  | "pop" // scales up past 1 then settles (overshoot)
  | "rise" // slides up into place while fading in
  | "typewriter"; // characters reveal left-to-right

/**
 * Brand style preset for a text overlay. Drives the fill / outline /
 * background-pill treatment so the user picks a LOOK, not ten knobs. Exact
 * colors resolve from the Alliance palette at render time.
 */
export type TextOverlayPreset =
  | "headline" // large bold light text, soft shadow for legibility
  | "gold_bar" // text sitting on a Relentless Gold pill
  | "outline" // light text with a dark outline (reads on any photo)
  | "subtle"; // smaller muted caption

export interface TextOverlay {
  /** Stable id (crypto.randomUUID()). React key + edit targeting. */
  id: string;
  /** The text content. Newlines allowed. */
  text: string;
  /**
   * Normalized position (0..1) of the text block's anchor on the 1080x1920
   * frame. Default anchor is the block's center. Lets the same overlay land
   * correctly regardless of output resolution.
   */
  x: number;
  y: number;
  /** Font size in px at native 1080x1920 resolution. */
  fontSize: number;
  /** Font family (must be available to both the canvas preview and the worker). */
  fontFamily: string;
  /** Primary text color (hex). The preset may override/augment with outline/bg. */
  color: string;
  /** Visual style preset (outline / pill / shadow treatment). */
  preset: TextOverlayPreset;
  /** Text alignment within the block. */
  align: "left" | "center" | "right";
  /** Max block width as a fraction of canvas width (drives wrapping). */
  maxWidthPct: number;
  /** Entrance animation. */
  animation: TextOverlayAnimation;
  /** Entrance animation duration in ms. ~400 default; typewriter scales with length. */
  animationMs: number;
}

export interface Scene {
  /** Stable id used as React key + for re-ordering. Generate with crypto.randomUUID(). */
  id: string;
  /** Start of the scene in the timeline, in ms. Computed from prior scene durations. */
  startMs: number;
  /** Duration of the scene in ms. Cap: 10s per scene. Min: 500ms. */
  durationMs: number;
  /** What this scene shows. */
  content: SceneContent;
  /** Transition into this scene (from the previous one, or from black at start). */
  transitionIn: TransitionType;
  /** Transition duration in ms. Overlaps with the END of the previous scene. */
  transitionMs: number;
  /**
   * Optional animated text overlays drawn on top of this scene's content.
   * Absent/empty = no overlay (back-compat with every existing composition).
   */
  textOverlays?: readonly TextOverlay[];
}

/** Audio track on the composition — background music. */
export interface AudioTrack {
  /** Stable id of the track in our curated music library. */
  trackId: string;
  /** Public URL of the audio file (mp3 or aac, Supabase Storage). */
  url: string;
  /** Display name shown in the editor's music picker. */
  displayName: string;
  /**
   * Volume 0..1 applied to the track. Default 0.6 so it sits under any
   * future voiceover without overpowering — also matches IG's typical
   * Reels music balance.
   */
  volume: number;
  /** Fade-in duration at the start of the track, in ms. */
  fadeInMs: number;
  /** Fade-out duration at the end of the track, in ms. */
  fadeOutMs: number;
}

/**
 * The full Reel composition document. Persisted to
 * `generated_posts.composition_json` so a Reel can be re-opened and
 * re-edited in Studio. Self-contained — no foreign keys to templates
 * outside this document.
 */
export interface VideoComposition {
  /** Schema version. Bumped on breaking changes; renderer migrates older versions. */
  schemaVersion: 1;
  /**
   * Output canvas dimensions. For Reels this is always 1080×1920 (9:16)
   * because that's the only IG/FB Reels accepts in feed/Reels surfaces.
   * Stored explicitly so the renderer doesn't have to assume.
   */
  width: 1080;
  height: 1920;
  /** Frame rate for the rendered MP4. 30 is standard for IG/FB. */
  frameRate: 30;
  /**
   * Total duration of the rendered MP4 in ms. Computed as the sum of all
   * scene durations minus the sum of overlapping transition durations.
   * Stored explicitly so the renderer + UI can read it directly without
   * recomputing.
   */
  totalDurationMs: number;
  /** Scenes in playback order. */
  scenes: readonly Scene[];
  /** Optional background music. Null = silent Reel. */
  audio: AudioTrack | null;
  /**
   * Optional: the listing this Reel was composed for. Set when the user
   * launched the Reel wizard from a listing. The renderer uses this to
   * stamp a watermark + the canonical MLS hashtag on the cover frame
   * (matching the static post flow's auto-attribution).
   */
  sourceListingMls?: string;
  /** ISO timestamp the composition was last edited. */
  updatedAt: string;
}

/**
 * Input shape the Reel wizard / Studio sends to the render worker.
 * Carries the composition + an idempotency key so duplicate submits
 * (network retries) don't produce duplicate jobs.
 */
export interface ReelRenderInput {
  composition: VideoComposition;
  /**
   * Client-generated UUID. Renderer dedupes by this — submitting the same
   * idempotency_key twice within 24h returns the original job's status,
   * not a new job.
   */
  idempotency_key: string;
}

/**
 * Job status returned by the render worker. The wizard polls this until
 * `status === "succeeded"` or `"failed"`.
 */
export type ReelRenderStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

export interface ReelRenderJob {
  job_id: string;
  status: ReelRenderStatus;
  /** 0..100 progress percentage. Only meaningful while status === "processing". */
  progress_pct: number;
  /** Public Storage URL of the rendered MP4. Only set when status === "succeeded". */
  video_url: string | null;
  /** Internal Storage path of the MP4. Only set when status === "succeeded". */
  video_path: string | null;
  /** Duration of the rendered MP4 in ms. Only set when status === "succeeded". */
  duration_ms: number | null;
  /**
   * Public Storage URL of the cover frame (first frame of the rendered
   * video). Mirrors worker/src/types.ts's ReelRenderJob.cover_url. Set on
   * "succeeded" when the worker extracted + uploaded a cover PNG; null
   * when the cover upload was skipped or failed (degraded path — the
   * caller falls back to the listing's hero photo).
   *
   * why: the Studio's generate flow reads this as the IG Reels grid
   * cover so the thumbnail matches the actual first frame of the video
   * (the designed hero card) instead of the listing's raw hero photo.
   */
  cover_url: string | null;
  /** Internal Storage path of the cover PNG. Mirrors video_path. Null
   *  whenever cover_url is null. */
  cover_path: string | null;
  /** Error message. Only set when status === "failed". */
  error: string | null;
  /** ISO timestamp the job was submitted. */
  created_at: string;
  /** ISO timestamp of the last status update. */
  updated_at: string;
}

/** Hard caps used by both the editor (validation) and the renderer (rejection). */
export const REEL_CAPS = {
  /** Maximum total composition duration. IG Reels cap is 90s but we cap
   *  ourselves at 15s for "still property → motion" content — anything
   *  longer dilutes the Reels-tier distribution boost. */
  maxTotalDurationMs: 15_000,
  /** Minimum total composition duration. Anything under 3s reads as a stutter. */
  minTotalDurationMs: 3_000,
  /** Maximum number of scenes in one composition. */
  maxScenes: 8,
  /** Minimum scenes (must include at least a hero card + one content frame). */
  minScenes: 2,
  /** Per-scene duration caps. */
  maxSceneDurationMs: 10_000,
  minSceneDurationMs: 500,
} as const;

// ---------------------------------------------------------------------------
// Scheduled posting — Phase 5C (2026-05-16)
// ---------------------------------------------------------------------------
//
// Larissa wants a single generated_posts row to publish to each platform at
// THAT platform's optimal time — IG mid-morning, TikTok evenings, FB
// mid-week. A "Post Now" still exists (parallel path, /api/post-builder/post)
// for when she's already in the optimal window or just wants to ship.
//
// Schedule data lives on generated_posts.scheduled_for (jsonb, NOT NULL
// default '{}'::jsonb). Keys are platform names, values are ISO 8601 UTC
// strings. Missing key = not scheduled for that platform. The cron route at
// /api/cron/publish-scheduled drains due timestamps every 5 minutes.

/** Platform identifiers the scheduler understands. Mirrors PublishPlatform
 *  from publish.ts but lives here so client code can import without pulling
 *  the server-only publish module. */
export type SchedulablePlatform = "facebook" | "instagram" | "tiktok";

/**
 * Per-platform scheduled publish times for a generated post. Each platform
 * key is independently optional — Larissa can schedule IG for Wednesday at
 * 11am and TikTok for Friday at 8pm with the same post row. Missing keys
 * = not scheduled for that platform.
 *
 * Stored as jsonb on generated_posts.scheduled_for so the cron runner can
 * query with jsonb path expressions for due timestamps.
 *
 * ISO 8601 UTC strings ONLY — the cron runner compares with NOW() in UTC.
 */
export interface ScheduledFor {
  facebook?: string;
  instagram?: string;
  tiktok?: string;
}

/**
 * Optimal posting windows per platform based on Meta + TikTok algorithm
 * research (current as of 2026). The Schedule UI pre-fills the next
 * available window from these defaults — Larissa can override per-post,
 * but the default is the highest-probability good time.
 *
 * All times Eastern (America/New_York) — the project is NJ-based and every
 * audience touchpoint runs in ET. The Schedule UI converts to/from local
 * input controls; the cron route stores + compares in UTC.
 */
export const OPTIMAL_POSTING_WINDOWS: Readonly<
  Record<
    SchedulablePlatform,
    {
      /** Days of the week (0=Sun..6=Sat) when this platform performs best. */
      preferredDays: readonly number[];
      /** Local hour (0-23 ET) at the start of the optimal window. */
      startHour: number;
      /** Local hour (0-23 ET) at the end of the optimal window. */
      endHour: number;
      /** Display copy shown in the UI. */
      label: string;
    }
  >
> = {
  facebook: {
    preferredDays: [2, 3, 4], // Tue/Wed/Thu — feed peaks for FB Pages.
    startHour: 9,
    endHour: 11,
    label: "Tue-Thu · 9-11am ET",
  },
  instagram: {
    preferredDays: [3, 4, 5], // Wed/Thu/Fri — IG users skew later in the week.
    startHour: 11,
    endHour: 13,
    label: "Wed-Fri · 11am-1pm ET",
  },
  tiktok: {
    preferredDays: [1, 2, 3, 4], // Mon-Thu — TikTok evenings outperform weekends for real-estate content.
    startHour: 19,
    endHour: 21,
    label: "Mon-Thu · 7-9pm ET",
  },
} as const;

/**
 * Per-platform error map written by the cron publisher when a scheduled
 * publish fails. Cleared key-by-key on the next successful publish for
 * that platform. Persisted to generated_posts.last_schedule_error (jsonb).
 *
 * Surface in the UI so Larissa can tell whether a scheduled post landed,
 * is still queued, or hit a problem (e.g. token expired, image host not
 * verified on TikTok).
 */
export interface LastScheduleError {
  facebook?: { error: string; at: string };
  instagram?: { error: string; at: string };
  tiktok?: { error: string; at: string };
}
