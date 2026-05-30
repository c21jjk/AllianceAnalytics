/**
 * Canvas Editor — Strict Type Schema (Phase 1, Step 1 of the Canva-clone rebuild)
 * --------------------------------------------------------------------------------
 *
 * Where this lives in the bigger picture
 *   The Post Builder today renders posts via a headless-Chromium pipeline ("Path A",
 *   see lib/post-builder/render.ts + chromium.ts). Path A is V1-LOCKED and must
 *   keep working. This module ("Path C") sits BESIDE it: it introduces an
 *   interactive Fabric.js canvas editor that opens as an overlay after Larissa
 *   picks a template variant. Long-term, Path C will replace Path A — but during
 *   Phases 1–5 they coexist, so this schema is intentionally separate from the
 *   V1 schema in `lib/post-builder/types.ts`.
 *
 * What this file contains
 *   The full JSON layer-tree schema the editor consumes and emits, plus the lean
 *   MLS payload that hydrates `boundField` placeholders into real listing data.
 *
 * Design rules in this file
 *   • Strict TypeScript — no `any`, discriminated unions on `kind` for layers,
 *     `Readonly<>` on lookup constants, every public type carries a docblock.
 *   • Fabric-aligned property names where possible (`left`/`top`/`angle`/`fill`)
 *     so the editor can pass schema fields straight into Fabric constructors
 *     without renaming maps. Saves cognitive load + a hop in every code path.
 *   • Re-exports from the V1 schema (`PostFormat`, `PostType`, `PostVariant`) so
 *     the canvas editor speaks the same language as the rest of the system —
 *     no parallel "Format" / "PostKind" enums to keep in sync.
 *
 * Why no rendering / Fabric code in this file
 *   Types only. Implementation lives in `./CanvasEditor.tsx`. Keeping the schema
 *   pure means we can serialize templates to disk, fetch them from Supabase,
 *   diff them in tests, and reason about them without importing `fabric` —
 *   which is a 300KB+ client-only bundle.
 */

import type {
  PostBuilderListing,
  PostFormat,
  PostType,
  PostVariant,
} from "../types";

// Re-export so consumers can `import { PostFormat } from "@/lib/post-builder/canvas-editor/types"`
// without reaching into the V1 module. Keeps the canvas-editor surface self-contained.
export type { PostFormat, PostType, PostVariant };

// ---------------------------------------------------------------------------
// Platform dimension defaults
// ---------------------------------------------------------------------------

/**
 * Canonical pixel dimensions per output format.
 *
 * Why "fixed defaults baked per platform" rather than "trust the template":
 *   John chose this path on 2026-05-14. Trade-off: every template MUST conform
 *   to the dimensions below — there is no template-level override. Upside:
 *   the editor never has to handle weirdly-sized canvases, exports are
 *   predictable, and the platform-publish flow can hard-assume these sizes.
 *
 * Reference sizes (Meta + TikTok official guidance, May 2026):
 *   portrait_4x5 → 1080×1350  (IG/FB feed — fills more of the mobile viewport)
 *   story_9x16   → 1080×1920  (IG/FB Stories, TikTok)
 *
 * Square 1:1 (1080×1080) was retired on 2026-05-22 — see lib/post-builder/types.ts.
 *
 * If a different platform shows up (LinkedIn 1200×627, Pinterest 1000×1500),
 * add the format to PostFormat in the V1 types.ts first, then add the
 * dimensions here. Both files in lockstep.
 */
export const PLATFORM_DIMENSIONS: Readonly<
  Record<PostFormat, Readonly<{ width: number; height: number }>>
> = {
  square_1x1: { width: 1080, height: 1080 },
  // why: portrait_4x5 still listed here so existing (pre-2026-05-24) saved
  // posts that carry format='portrait_4x5' in their layer_tree continue to
  // open. New posts use square_1x1. Removed once we confirm zero live
  // portrait_4x5 references remain.
  story_9x16: { width: 1080, height: 1920 },
} as const;

/**
 * Export multiplier for `toDataURL`. 2x retina is the standard.
 * Why a constant: keeps the export-resolution decision in one place so we can
 * raise it to 3x for print/PDF later without hunting through component code.
 */
export const EXPORT_RESOLUTION_MULTIPLIER = 2 as const;

// ---------------------------------------------------------------------------
// Bound fields — placeholder mapping into MLS data
// ---------------------------------------------------------------------------

/**
 * `BoundField` is the discriminator that says "this layer's value comes from the
 * active listing payload, not a hardcoded string". When the editor hydrates a
 * template, every layer with a `boundField` set is replaced with the matching
 * field from `MLSListingPayload`, applying the formatter associated with that
 * field (price → "$929,000", beds_baths → "4 BR / 3 BA", etc.).
 *
 * Two flavors, split for type safety:
 *   • TextBoundField → resolves to a `string`. Only valid on TextLayer.
 *   • ImageBoundField → resolves to a URL string. Only valid on ImageLayer.
 *
 * Keep these two unions disjoint. If a future field could resolve to either
 * (rare — maybe an "agent_card" composite), introduce a third kind rather than
 * widening the existing unions; otherwise type guards downstream collapse.
 */
export type TextBoundField =
  | "price" // list_price, formatted "$929,000"
  | "close_price" // close_price, formatted "$905,000" (Just Sold only)
  | "address_line1" // "117 E Maple Ave"
  | "city_state_zip" // "Wildwood, NJ 08260"
  | "city" // "Wildwood"
  | "state" // "NJ"
  | "zip" // "08260"
  | "beds" // "4"
  | "baths" // "3" (sum of full + half/2)
  | "beds_baths" // "4 BR / 3 BA"
  | "property_type" // "Single Family", "Condo", etc.
  | "mls_number" // "607680"
  | "tagline" // marketing line (auto-generated upstream, see captions.ts)
  | "status_label" // "JUST LISTED" / "JUST SOLD" / "PRICE REDUCED" / "UNDER CONTRACT" / "OPEN HOUSE"
  | "agent_name" // "John Koch"
  | "agent_phone" // "(609) 522-1212"
  | "agent_email" // "c21anj@gmail.com"
  | "agent_title" // "Broker / Co-Owner"
  | "office_name" // "Century 21 Alliance"
  | "open_house_date" // "Friday, April 3"
  | "open_house_time" // "11:30 AM – 1:30 PM"
  // why: hosting-agent fields are distinct from the listing-agent fields
  // above. On a multi-OH carousel, each slide's "hosted by" corner block
  // attributes the agent who'll be AT that specific open house — which
  // may not be the listing agent. Single-listing OH templates can bind
  // these too; the resolvers fall back to the listing-agent fields when
  // hosting is null/empty so the same template "just works" in both flows.
  | "hosting_agent_name" // "Larissa Stevenson" (host of THIS slide's OH)
  | "hosting_agent_phone"; // "(609) 555-1234" (formatted from Alliance Dash)

export type ImageBoundField =
  | "hero_photo" // primary listing photo (cover)
  | "photo_2" // second listing photo
  | "photo_3" // third listing photo
  | "photo_4" // fourth listing photo
  | "photo_5" // fifth listing photo
  | "agent_photo" // headshot URL (from agents table, future)
  | "hosting_agent_photo" // headshot URL of the slide's OH host (fallback: agent_photo)
  | "office_logo" // C21 Alliance lockup (static for now)
  | "brokerage_logo"; // generic "Century 21" mark (static for now)

export type BoundField = TextBoundField | ImageBoundField;

// ---------------------------------------------------------------------------
// Layer base — common transform + visibility props
// ---------------------------------------------------------------------------

/**
 * Properties shared by every layer kind. Named to match Fabric.js v6 object
 * properties exactly (left/top/angle/opacity/selectable/visible/evented) so a
 * layer can be spread directly into a Fabric constructor with no renaming.
 *
 * Coordinate system: top-left origin, pixels at the canvas's logical resolution
 * (i.e., the unmultiplied dimensions from PLATFORM_DIMENSIONS). The retina
 * multiplier applies only at export — never to schema values. This lets the
 * same schema render at any output size without rewriting numbers.
 */
export interface CanvasLayerBase {
  /** Stable ID — use a UUID or `${kind}_${index}_${random}`. Required for React keys + Fabric metadata round-tripping. */
  id: string;
  /** Human label shown in the layer panel. Editable by the user. */
  name: string;
  /** Fabric `left` — pixel offset from canvas left edge. */
  left: number;
  /** Fabric `top` — pixel offset from canvas top edge. */
  top: number;
  /** Render width in pixels (post-scale). */
  width: number;
  /** Render height in pixels (post-scale). */
  height: number;
  /** Rotation in degrees, clockwise. Fabric expects this exact convention. */
  angle: number;
  /** 0..1 opacity. */
  opacity: number;
  /** Stack order. Higher z renders on top. Resolved to Fabric's z-index API on insert. */
  z: number;
  /** When false, the layer is hidden from the canvas AND the layer panel's eye icon shows "closed". */
  visible: boolean;
  /** When true, the layer cannot be selected or transformed in the editor. The user must explicitly unlock to edit. */
  locked: boolean;
  /**
   * Optional layer-level metadata. Use for template authoring hints —
   * e.g., `{ slot: "headline" }` so a template-builder UI knows which layers
   * are user-editable vs locked-by-template. Not currently consumed by
   * CanvasEditor; reserved for Phase 4 (templates panel).
   */
  meta?: Readonly<Record<string, string | number | boolean>>;
}

// ---------------------------------------------------------------------------
// Layer variants — discriminated on `kind`
// ---------------------------------------------------------------------------

/**
 * A text layer. Either renders its literal `text` value, OR — when `boundField`
 * is set — its hydrated value from the active listing.
 *
 * Mutual exclusivity is enforced by convention rather than the type system:
 *   • If `boundField` is set, `text` is treated as a fallback (used when the
 *     listing field is null/empty). This is intentional — templates ship with
 *     "$0" placeholder text so the canvas looks correct in the template-author
 *     view, then gets replaced with the real price at hydration time.
 *   • The hydration code in CanvasEditor.tsx prefers `boundField` over `text`
 *     and only falls back if the resolved value is empty.
 */
/**
 * Phase B.3 — Text effects.
 *
 * Canva-style presets that layer shadows, outlines, and offset duplicates
 * on top of a TextLayer. The schema captures the effect parameters; the
 * editor's hydration path + the worker's render.js translate them into
 * Fabric.js `shadow` / `stroke` / `paintFirst` props at render time.
 *
 * Discriminated union — `kind` selects the parameter shape. `"none"` is
 * the default (renderer skips all effect props), and a missing `effect`
 * field on a TextLayer is treated as `{ kind: "none" }`.
 *
 * Why a small fixed set (vs. an arbitrary shadow + stroke matrix):
 *   Canva's presets are recognizable and predictable. Surfacing every
 *   shadow knob (offset/blur/color/opacity/spread × per-side) is
 *   overwhelming for a non-designer. Five preset chips with sane
 *   defaults cover ~95% of usage; advanced tuning can come later.
 */
export type TextEffect =
  | { kind: "none" }
  | {
      kind: "shadow";
      /** Horizontal offset in px (positive = right). */
      offsetX: number;
      /** Vertical offset in px (positive = down). */
      offsetY: number;
      /** Gaussian blur radius in px. */
      blur: number;
      /** Shadow color as hex or rgba string. Renderer applies as-is. */
      color: string;
    }
  | {
      kind: "outline";
      /** Stroke width in px — also the visual outline thickness. */
      width: number;
      /** Outline color as hex string. */
      color: string;
    }
  | {
      kind: "lift";
      /** Soft drop shadow used to "lift" text off the background. Parametrized
       *  only by opacity — offsets, blur, and color are fixed for visual
       *  consistency (black, offsetY = 4px, blur = 12px). 0..1 range. */
      opacity: number;
    }
  | {
      kind: "splice";
      /** Echo / splice — the outline + offset-duplicate effect. The main
       *  text renders normally; an offset stroke-colored "shadow" trails
       *  behind it, mimicking a duplicated outlined copy. */
      offsetX: number;
      offsetY: number;
      /** Color of the outline + offset duplicate. */
      outlineColor: string;
      outlineWidth: number;
    };

/** Discriminator helper — treat a missing `effect` as "none". */
export function getTextEffectKind(layer: TextLayer): TextEffect["kind"] {
  return layer.effect?.kind ?? "none";
}

export interface TextLayer extends CanvasLayerBase {
  kind: "text";
  /** Literal text content. Used as fallback when boundField resolves to empty. */
  text: string;
  /** When set, hydrate from MLSListingPayload at canvas-init time. */
  boundField?: TextBoundField;
  /** CSS font-family. Custom fonts must be loaded via @font-face before draw. */
  fontFamily: string;
  fontSize: number;
  fontWeight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  /** "normal" | "italic". Kept as a string union not enum for JSON-friendliness. */
  fontStyle: "normal" | "italic";
  /** Hex color "#RRGGBB" or "#RRGGBBAA". Fabric also accepts rgba() but we standardize on hex for diffing. */
  fill: string;
  textAlign: "left" | "center" | "right" | "justify";
  /** Multiplier — 1.0 = single line height for the font. */
  lineHeight: number;
  /**
   * Letter spacing. Fabric uses `charSpacing` in 1/1000 em (so 100 → 0.1em).
   * We mirror that unit here to avoid conversion at render time.
   */
  charSpacing: number;
  underline: boolean;
  linethrough: boolean;
  /** When true, the user can double-click to edit text in place. Default true. */
  editable: boolean;
  /** Optional max-width wrapping. When null, text wraps to the layer's `width`. */
  maxWidth?: number | null;
  /**
   * Phase B.3 — Canva-style text effect (shadow / outline / lift / splice).
   * Optional — a missing field renders as "no effect" (kind: "none").
   */
  effect?: TextEffect;
}

/**
 * An image layer — either a literal URL (e.g., a brand logo on a CDN) or a
 * boundField that resolves to a listing photo / agent headshot.
 *
 * Critical: ALL images must be loaded with `crossOrigin: "anonymous"` so that
 * the canvas does not become "tainted". A tainted canvas can be rendered to
 * screen but cannot be exported via `toDataURL` — it throws SecurityError.
 * The CanvasEditor enforces this on every image load; this field exists in
 * the schema only for completeness / future flexibility.
 */
export interface ImageLayer extends CanvasLayerBase {
  kind: "image";
  /** Literal image URL. Used as fallback when boundField is unset or resolves to null. */
  src: string | null;
  /** When set, hydrate from MLSListingPayload at canvas-init time. */
  boundField?: ImageBoundField;
  /**
   * How the image fits its layer rect.
   *   • "cover"   — scale to fill, crop the overflow (Instagram-style hero photo)
   *   • "contain" — scale to fit entirely, may letterbox (logo on a card)
   *   • "stretch" — fill non-uniformly, will distort (rarely the right choice; exposed for completeness)
   * Implementation lives in CanvasEditor — Fabric's `Image` object doesn't have
   * native object-fit; we compute scaleX/scaleY from this enum + the image's
   * natural dimensions.
   */
  objectFit: "cover" | "contain" | "stretch";
  /**
   * crossOrigin policy. Always "anonymous" in practice — exposed in the schema
   * only so a future "trusted-first-party-only" template could opt out. The
   * editor will warn (and refuse to export) if a non-anonymous image is loaded.
   */
  crossOrigin: "anonymous";
  /** Border radius in px. Rendered as a clipPath in Fabric. */
  cornerRadius: number;
  /** Optional border. When width is 0, no border drawn. */
  borderColor: string;
  borderWidth: number;
  /**
   * When true, the image layer is excluded from the canvas entirely if
   * its `boundField` resolves to null/empty (or `src` is null when no
   * bound field is set). Used by hosting-agent-block to degrade gracefully
   * when a host's headshot isn't in `brand_assets` — without this flag the
   * editor would render a gold dashed placeholder rect where the missing
   * image was supposed to be, and the headless renderer would log a
   * warning but still drop nothing visible.
   *
   * Default: false (layer renders even on empty src, falling back to the
   * placeholder treatment in the editor or being dropped silently in the
   * headless renderer — both of which were the pre-2026-05-27 behavior).
   *
   * Why a schema flag (not a fabric-side prop): the decision to skip the
   * layer happens BEFORE the Fabric image is constructed, so the field
   * only needs to live in the schema layer, not on the Fabric object.
   * `canvas.loadFromJSON()` round-trips an already-built Fabric canvas
   * (no layer-creation step), so no Fabric-side preservation is needed.
   */
  hideIfEmpty?: boolean;
}

/**
 * Shape primitives. One layer covers rect / circle / line / ellipse via a
 * `shapeType` discriminator. Splitting these into four separate layer kinds was
 * considered and rejected — the rendering code is tiny (one switch) and
 * collapsing them keeps the layer-panel UI simpler.
 *
 * Lines use width + angle to position; we don't expose x1/y1/x2/y2 separately
 * because that diverges from how every other layer is positioned, and Fabric's
 * Line object supports the bounding-box approach.
 */
export interface ShapeLayer extends CanvasLayerBase {
  kind: "shape";
  shapeType: "rect" | "circle" | "ellipse" | "line";
  /**
   * Hex string for a flat fill OR a structured GradientFill object. Worker
   * + Fabric factory both handle both shapes. Empty string = no fill
   * (lines, outlined shapes). Use `isGradientFill(layer.fill)` to narrow.
   *
   * why a union (not a separate `gradientFill` field): every consumer that
   * touches `fill` already has to do SOMETHING with it (pass to Fabric,
   * round-trip to JSON, diff in tests). Adding a parallel optional field
   * doubles the read paths and creates an ambiguity if both are set.
   * Discriminated by the runtime shape — string vs object — narrowed via
   * the exported `isGradientFill` type guard.
   */
  fill: string | GradientFill;
  stroke: string;
  strokeWidth: number;
  /** Rectangle corner radius. Ignored for non-rect shapes. */
  cornerRadius: number;
  /**
   * Dashed-stroke pattern, e.g., [10, 5] for 10px dashes / 5px gaps.
   * Empty array = solid. Matches Fabric `strokeDashArray`.
   */
  strokeDashArray: number[];
}

// ---------------------------------------------------------------------------
// Gradient fills — structured fill objects for ShapeLayer
// ---------------------------------------------------------------------------

/**
 * A single color stop along a gradient axis. Used by both linear and radial
 * GradientFill variants.
 *
 * offset:
 *   • 0..1; 0 = start of gradient, 1 = end.
 *   • The first stop's offset should be 0 and the last's offset should be 1;
 *     intermediate stops can be anywhere in between in INCREASING order.
 *     The template validator enforces this; runtime Fabric does too (out-of-
 *     range stops paint as solid color from the nearest in-range stop).
 *
 * color:
 *   • Hex string. Both "#RRGGBB" and "#RRGGBBAA" are permitted — Fabric's
 *     CanvasGradient consumes either via its underlying CanvasRenderingContext2D.
 */
export interface GradientStop {
  /** 0..1 along the gradient axis. */
  offset: number;
  /** Hex color. Hex+alpha permitted. */
  color: string;
}

/**
 * Linear gradient — paints color stops along a straight axis at `angleDeg`.
 *
 * Coordinate convention:
 *   `angleDeg` is degrees CLOCKWISE from horizontal-right. This matches
 *   CSS `linear-gradient()` direction so authors can intuit the rotation
 *   without a separate mental model.
 *     • 0°   → left-to-right
 *     • 90°  → top-to-bottom
 *     • 180° → right-to-left
 *     • 270° → bottom-to-top
 *
 * The factory + worker translate `angleDeg` into Fabric's `x1/y1/x2/y2`
 * coords inside the layer's own bounding box at render time.
 */
export interface GradientFillLinear {
  kind: "linear";
  /** Direction in degrees clockwise from horizontal-right. */
  angleDeg: number;
  /** Color stops along the gradient axis. */
  stops: readonly GradientStop[];
}

/**
 * Radial gradient — paints color stops from the layer's center outward.
 *
 * Coordinate convention:
 *   Centered on the layer's bounding box. `spread` is the fraction of the
 *   box's LONGER axis the gradient covers — 1.0 (default) means the outer
 *   edge of the gradient touches the longer side of the box; 0.5 means
 *   the gradient finishes halfway out (anything beyond paints as the last
 *   stop's color).
 *
 * why no explicit center coordinates: every template designed to date wants
 * a centered radial. If a future template needs an off-center radial (e.g.,
 * a spotlight in one corner), add `centerX`/`centerY` as optional 0..1
 * fractions and default both to 0.5. Don't widen the type prematurely.
 */
export interface GradientFillRadial {
  kind: "radial";
  /** 0..1 — % of the layer's longer axis the gradient spreads. Default 1. */
  spread?: number;
  /** Color stops from center (offset 0) to edge (offset 1). */
  stops: readonly GradientStop[];
}

/**
 * Structured gradient fill — used in `ShapeLayer.fill` to render either a
 * linear or radial color blend instead of a flat hex color.
 *
 * Why two kinds (not one with optional radial fields):
 *   Linear and radial gradients have fundamentally different coordinate
 *   shapes — linear needs an angle; radial needs an implicit center +
 *   spread. Forcing them into one shape would either bloat both with
 *   unused fields OR require runtime branching everywhere. The
 *   discriminated union keeps each consumer's switch exhaustive.
 *
 * Stops:
 *   • At least 2 stops required (rendered as a no-op solid otherwise).
 *   • Validator below enforces ascending offsets in [0, 1]; runtime
 *     Fabric does too.
 */
export type GradientFill = GradientFillLinear | GradientFillRadial;

/**
 * Group layer — RESERVED. Not implemented in Phase 1 of the canvas editor.
 *
 * Why include it in the schema now: Canva uses grouping pervasively (every
 * "Add a heading" preset is a group of one text layer + a shadow rect). When
 * we add the Brand panel (Phase 4) and the Elements panel, we'll want to drop
 * pre-grouped clusters. Retrofitting `kind: "group"` into a discriminated
 * union later forces us to revisit every type guard. Better to reserve the
 * slot now so future code is forward-compatible.
 *
 * Implementation note for whoever adds this in Phase 2/3:
 *   • Children should be `CanvasLayer[]`, recursive.
 *   • Hydration recurses; resolveBoundLayer treats GroupLayer as a passthrough
 *     that maps over its children.
 *   • Fabric v6 has `Group` with `subTargetCheck: true` so the user can
 *     double-click into a group to edit a member.
 */
export interface GroupLayer extends CanvasLayerBase {
  kind: "group";
  children: CanvasLayer[];
}

/**
 * The discriminated union the rest of the editor consumes. Always switch on
 * `kind` — never duck-type. The TS compiler will catch missing branches.
 */
export type CanvasLayer = TextLayer | ImageLayer | ShapeLayer | GroupLayer;

// ---------------------------------------------------------------------------
// Template schema — the JSON document a template ships as
// ---------------------------------------------------------------------------

/**
 * Categories matching the chip strip in the Post Builder UI:
 *   Just Listed / Just Sold / Under Contract / Open House / Price Reduced
 *
 * Note that `category` here mirrors `PostType` from V1 but is named separately
 * because the canvas-editor abstraction may grow categories the V1 render
 * pipeline doesn't recognize (e.g., "testimonial", "new_agent_announcement"
 * for non-listing posts in Phase 5+).
 */
export type CanvasTemplateCategory = PostType;

/**
 * The CanvasTemplateSchema is the full JSON document for a single template.
 * One file per template (stored on disk under `lib/post-builder/canvas-editor/templates/`
 * in a later phase, or in a Supabase `canvas_templates` table).
 *
 * Invariant: `width`/`height` MUST match `PLATFORM_DIMENSIONS[format]`. The
 * editor validates this on load and refuses to open mismatched templates —
 * we don't want a "1080×1200" template floating around that breaks export.
 */
export interface CanvasTemplateSchema {
  /** Stable template ID, unique across all templates. e.g., "just_listed_v1_square". */
  id: string;
  /** Human display name shown in the templates panel. */
  name: string;
  /** Short description (1 sentence). */
  description: string;
  /** Category — drives the Post Builder chip filter. */
  category: CanvasTemplateCategory;
  /** Variant code matching the existing V1 variant identifiers. */
  variant: PostVariant;
  /** Output format. Determines canvas dimensions via PLATFORM_DIMENSIONS. */
  format: PostFormat;
  /** Canvas width in px. MUST equal PLATFORM_DIMENSIONS[format].width. */
  width: number;
  /** Canvas height in px. MUST equal PLATFORM_DIMENSIONS[format].height. */
  height: number;
  /** Solid background color (hex) or "transparent". Use background_image for images. */
  backgroundColor: string;
  /**
   * Optional background image URL — drawn underneath all layers, not selectable
   * in the editor. Use this for full-bleed photo backgrounds where we don't
   * want the photo to be a movable layer.
   */
  backgroundImage?: string | null;
  /** All layers, in document order. The editor honors `z` for stacking, not array order. */
  layers: CanvasLayer[];
  /** ISO timestamp for the template's last save. Useful for cache invalidation. */
  updatedAt: string;
  /** Schema version. Bump when breaking changes are introduced. */
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// MLS listing payload — the lean editor-facing type
// ---------------------------------------------------------------------------

/**
 * The minimal listing data the canvas editor needs to hydrate bound fields.
 *
 * Why a separate type instead of reusing PostBuilderListing from V1:
 *   PostBuilderListing carries Path-A concerns (`hero_image_url` singular,
 *   status as a four-value union, etc.). The canvas editor needs richer photo
 *   support (an array of photos, not just one), formatted strings for open
 *   house dates, and an optional agent-photo URL — none of which are in V1.
 *   Adding them to V1 would risk breaking the render pipeline. So we keep this
 *   type lean and editor-specific, with a documented mapping function name
 *   (`toMLSListingPayload`, to be implemented in Step 2) that transforms a
 *   PostBuilderListing → MLSListingPayload at the boundary.
 *
 * Numbers stay as numbers — formatting (currency, beds_baths string) is the
 * editor's job at hydration time, NOT a precomputed responsibility of whoever
 * constructs this object. Reason: a template could format $929,000 as "$929K"
 * or "Nine hundred twenty-nine thousand" — formatting must live with the
 * template/editor, not the data.
 *
 * Field-by-field mapping from RETS feed codes (Paragon CMC + SJSR + Bright):
 *   priceList     → L_AskingPrice (CMC/SJSR), ListPrice (Bright)
 *   priceClose    → L_SoldPrice (CMC/SJSR), ClosePrice (Bright)
 *   address       → L_DisplayId / L_Address1
 *   beds          → L_Keyword1 / BedsTotal
 *   bathsFull     → L_Keyword2 / BathsFull
 *   bathsHalf     → L_Keyword3 / BathsHalf
 *   propertyType  → LM_Char10_24 / PropertySubType
 *   photos        → MediaUrl[]
 *   (see project_alliance_paragon_rets_field_mapping.md for the full table)
 */
export interface MLSListingPayload {
  /** Internal listings.id (the AllianceAnalytics Supabase row). */
  id: string;
  /** MLS public number — e.g., "607680". */
  mlsNumber: string;
  /** Which feed this came from. Affects nothing in the editor; useful for debug. */
  sourceMls: "cmc" | "sjsr" | "bright" | "manual" | null;

  // --- pricing ---
  /** Current list price as a raw number (no formatting). 929000 not "929,000". */
  priceList: number | null;
  /** Sold/closed price (Just Sold templates only). Null on active listings. */
  priceClose: number | null;

  // --- address ---
  /** Just the street line. "117 E Maple Ave" — NOT including city/state. */
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;

  // --- specs ---
  beds: number | null;
  bathsFull: number | null;
  bathsHalf: number | null;
  squareFeet: number | null;
  propertyType: string | null;

  // --- marketing ---
  /** Auto-generated tagline (Claude-powered). Pulled from captions.ts in V1. */
  tagline: string | null;
  /** Marketing remarks from MLS feed (truncated to ~280 chars upstream). */
  remarks: string | null;
  /** Status of the listing — drives which status_label string appears. */
  status: "active" | "pending" | "sold" | "expired" | "coming_soon";

  // --- photos ---
  /**
   * Ordered array of property photo URLs. Index 0 is the hero/primary photo.
   * Editor binds `hero_photo` → photos[0], `photo_2` → photos[1], etc.
   * Always include the trailing slash / CORS headers — see ImageLayer notes.
   */
  photos: string[];

  // --- agent (optional, set when an agent context is available) ---
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  agentTitle: string | null;
  /** Agent headshot URL. Null if not configured for this agent. */
  agentPhotoUrl: string | null;

  // --- hosting agent (Open House only) ---
  /**
   * Resolved hosting-agent attribution for an Open House slide. Set by the
   * multi-OH generate route (per-property) and the single-listing OH render
   * route. Carries the host's name, formatted phone, and headshot URL — all
   * three are read by the `hosting_agent_*` bound-field resolvers in
   * `fabric-factory.ts`, which fall back to the listing-agent fields above
   * when this is null or any individual field is empty.
   *
   * Null on non-OH posts (just_listed, just_sold, etc.) — those templates
   * never bind to hosting_agent_* fields, so the field stays undefined.
   */
  hosting_agent?: {
    name: string;
    phone: string | null;
    photo_url: string | null;
  } | null;

  // --- office (optional, defaults baked in by editor if null) ---
  officeName: string | null;
  /** Office logo URL — typically a static asset path like "/public/brand/c21-alliance.svg". */
  officeLogoUrl: string | null;

  // --- open house (only populated when status implies an open house) ---
  /** Open house start in ISO 8601 UTC. The editor formats to "Friday, April 3". */
  openHouseStartUtc: string | null;
  /** Open house end in ISO 8601 UTC. Used to format the time range string. */
  openHouseEndUtc: string | null;
}

/**
 * Type-only re-export so external code that needs the V1 row type still has it
 * available in the canvas-editor namespace.
 */
export type { PostBuilderListing };

// ---------------------------------------------------------------------------
// Carousel slides — Phase 5 multi-image post support
// ---------------------------------------------------------------------------

/**
 * A single supporting photo in an Instagram / Facebook / TikTok carousel.
 *
 * The hero image (the designed graphic out of Studio) is slide 0. These are
 * slides 1..N — typically raw listing photos that swipe after the hero. The
 * publish layer already supports up to 10 slides on IG, no cap on FB,
 * up to 35 on TikTok; see `lib/post-builder/publish.ts`.
 *
 * Why not store these in the CanvasTemplateSchema:
 *   CarouselSlides are post-level metadata, not design metadata. They don't
 *   render onto the hero canvas; they're parallel photos. Keeping them
 *   separate means re-opening Studio still works on older single-image
 *   posts (where `slides: []`), and template-author mode (no listing yet)
 *   can ignore them entirely.
 */
export interface CarouselSlide {
  /**
   * Stable client-side id for React keys + drag-reorder operations.
   * Generate with `crypto.randomUUID()` at creation; persists with the row.
   */
  id: string;
  /** Public URL of the photo — listing photo URL or future user-uploaded URL. */
  url: string;
  /**
   * Where the photo came from. Used for analytics ("how often does Larissa
   * add raw listing photos vs. branded extras?") and future swap-source
   * affordances. Today only "listing" is wired.
   */
  source: "listing" | "upload";
  /**
   * When `source === "listing"`, the original photo's sequence number from
   * the listing's photo array. Lets the UI surface "Photo 7 from listing"
   * labels and detect duplicates when adding from the picker.
   */
  listingPhotoSequence?: number;
}

/**
 * Carousel-management surface passed into the editor. Optional — when
 * absent, the editor renders no carousel UI (template-author mode + any
 * future consumer that just wants the design surface).
 *
 * Why a single grouped prop instead of 4 top-level props:
 *   The four fields are tightly coupled — they're meaningless without each
 *   other. Grouping them is friendlier in usage sites and makes "carousel
 *   feature on/off" a single null-check.
 */
export interface CanvasEditorCarouselProps {
  /** Current slides, in order. Slide 0 is the hero (the canvas itself); these are slides 1..N. */
  slides: readonly CarouselSlide[];
  /**
   * Called when the user adds, removes, or reorders slides. The editor
   * does NOT mutate the array in place — always passes a new array so the
   * parent can store it directly with `setState`.
   */
  onSlidesChanged: (slides: readonly CarouselSlide[]) => void;
  /**
   * Listing photos available to add. The picker reads from here. Shape
   * matches PostBuilderClient's `availablePhotos` state (sequence + url).
   */
  availableListingPhotos: readonly {
    url: string;
    sequence: number;
  }[];
  /**
   * URL of the most recently saved hero render — the rendered PNG/JPEG
   * out of Studio. The Preview overlay shows this as slide 0. Null when
   * the user hasn't saved yet; Preview surfaces a "Save your design
   * first to see it in the preview" placeholder in that case.
   */
  heroImageUrl: string | null;
  /**
   * When false (default), the carousel strip hides on Story 9:16 format —
   * IG/FB Story carousels are a different UX from feed carousels and the
   * publish layer doesn't currently support them. Set true to override
   * (e.g., for TikTok which DOES accept Story-format photo carousels).
   */
  enabledOnStory?: boolean;
  /**
   * Phase 5 — per-slide edit affordance. When provided, each thumbnail
   * in the strip surfaces a pencil "Edit" button (hover-revealed)
   * alongside the X. Clicking it fires this callback with the slide's
   * index inside `slides` — the parent (PostBuilderClient) uses that
   * index to look up the slide's source metadata, swap Studio's
   * `studioContext` to that slide, and branch the next Save to
   * `updateGeneratedPostSlideAction` instead of the hero upsert.
   *
   * Omit on consumer flows where slides are raw listing photos (nothing
   * to edit) — the per-slide editor only makes sense for designed
   * graphics like the multi-OH per-property cards.
   */
  onSlideEditClick?: (slideIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Resolved layer types — what the editor sees AFTER hydration
// ---------------------------------------------------------------------------

/**
 * A TextLayer where `boundField` has been substituted with the resolved string.
 * The literal `text` field is left in place as a fallback / for round-tripping
 * to JSON; the editor reads `resolvedText` when rendering.
 */
export interface ResolvedTextLayer extends TextLayer {
  resolvedText: string;
}

/**
 * An ImageLayer where `boundField` has been resolved to a final src URL.
 * `resolvedSrc` may be null when the listing has no photo at that slot — the
 * editor draws a placeholder rectangle in that case (NOT an error).
 */
export interface ResolvedImageLayer extends ImageLayer {
  resolvedSrc: string | null;
}

/** Shape and Group layers don't bind to data; they pass through unchanged. */
export type ResolvedCanvasLayer =
  | ResolvedTextLayer
  | ResolvedImageLayer
  | ShapeLayer
  | GroupLayer;

// ---------------------------------------------------------------------------
// Export payload — what CanvasEditor.onSave receives
// ---------------------------------------------------------------------------

/**
 * Result of the user clicking "Save" / "Export" in the editor.
 *
 * Why both `file` AND `dataUrl`:
 *   • `file` is the canonical artifact to upload to Supabase Storage. File is
 *     a subclass of Blob, so it can also be sent via `fetch` or `FormData`.
 *   • `dataUrl` is convenient for showing an immediate preview thumbnail in the
 *     parent UI before the upload completes ("Saved!" toast with thumbnail).
 *     Avoids a second round-trip to fetch the just-uploaded image.
 *
 * The serialized schema is included so the parent component (Server Action
 * caller) can persist BOTH the rendered image AND the source JSON to the DB.
 * Persisting the JSON enables "re-open in editor" later — a key Canva feature.
 */
export interface CanvasExportResult {
  /** Rendered PNG as a File. Filename includes the template id + timestamp. */
  file: File;
  /** Same image as a data URL (base64). For local preview only. */
  dataUrl: string;
  /** The post-hydration template schema, in case caller wants to persist the source. */
  schema: CanvasTemplateSchema;
  /**
   * Fabric canvas state via `canvas.toObject(propsToInclude)` at export
   * time — the FAITHFUL snapshot of what the user has on canvas, including
   * every move/resize/recolor/hide and any new layers added via toolbar.
   *
   * Why we ship this alongside `schema`:
   *   `schema` is the ORIGINAL template passed into the editor at mount
   *   (Phase 1 placeholder — there's no Fabric→schema serializer yet).
   *   `fabricJson` is the only path that round-trips edits faithfully.
   *
   * Persistence contract: the parent should write this to a `fabric_json`
   * column on the saved row, and on reopen, hand it back to the editor
   * via `initialFabricJson` so `canvas.loadFromJSON()` rebuilds the
   * exact canvas state — Fabric preserves the `data` metadata on every
   * object so `boundField` continues to work for fresh listing data.
   *
   * Shape: opaque to consumers. Treat as JSON; do not introspect.
   */
  fabricJson: unknown;
  /** Output dimensions (post retina multiplier). */
  width: number;
  height: number;
  /**
   * Output content-type. The editor exports JPEG (quality ~0.92) by default
   * for the save flow — the typical 1080×1080 retina-PNG of a real listing
   * photo blows past Vercel's ~4.5MB body limit, and social platforms
   * re-encode to JPEG anyway. PNG is kept as a valid value in the union for
   * future use cases (transparent overlays, brand exports, etc.).
   */
  mimeType: "image/png" | "image/jpeg";
}

// ---------------------------------------------------------------------------
// Type guards — discriminated-union narrowing helpers
// ---------------------------------------------------------------------------

export function isTextLayer(layer: CanvasLayer): layer is TextLayer {
  return layer.kind === "text";
}

export function isImageLayer(layer: CanvasLayer): layer is ImageLayer {
  return layer.kind === "image";
}

export function isShapeLayer(layer: CanvasLayer): layer is ShapeLayer {
  return layer.kind === "shape";
}

export function isGroupLayer(layer: CanvasLayer): layer is GroupLayer {
  return layer.kind === "group";
}

export function isResolvedTextLayer(
  layer: ResolvedCanvasLayer,
): layer is ResolvedTextLayer {
  return layer.kind === "text";
}

export function isResolvedImageLayer(
  layer: ResolvedCanvasLayer,
): layer is ResolvedImageLayer {
  return layer.kind === "image";
}

/**
 * Type guard — narrow a `ShapeLayer.fill` value to a `GradientFill`. Returns
 * false for strings (flat fills), null, undefined, or malformed objects.
 *
 * Why a structural runtime check (not just `typeof === "object"`):
 *   • `null` is `typeof "object"` in JS — checked first to avoid a crash on
 *     the property access below.
 *   • An accidentally-malformed object (e.g., `{ kind: "wrong" }`) should be
 *     rejected, not silently treated as a gradient, so consumers fall back to
 *     the flat-fill code path instead of crashing later in Fabric.
 *   • The two required structural invariants — `kind` is "linear" | "radial"
 *     AND `stops` is an array of >=2 — match the validator in the templates
 *     registry. Keeping these checks in sync is the type guard's job; the
 *     factory + worker both rely on this guard to narrow.
 */
export function isGradientFill(fill: unknown): fill is GradientFill {
  if (!fill || typeof fill !== "object") return false;
  const f = fill as Partial<GradientFill>;
  if (f.kind !== "linear" && f.kind !== "radial") return false;
  if (!Array.isArray(f.stops) || f.stops.length < 2) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Component prop types for CanvasEditor
// ---------------------------------------------------------------------------

/**
 * Public props for the <CanvasEditor /> component.
 *
 * `onSave` is the only required handoff back to the parent. It's deliberately a
 * Promise-returning function so the parent can:
 *   • Show a "Saving…" spinner while it uploads the file to Supabase.
 *   • Throw to surface upload failures back to the editor (which renders an
 *     error toast and keeps the canvas open so the user doesn't lose work).
 *
 * `onClose` is optional — the editor renders its own "X" button only if this
 * prop is provided. This keeps embed contexts flexible: when used inside a
 * drawer, the drawer owns the close affordance; when used as a full-page route,
 * the editor provides one.
 */
export interface CanvasEditorProps {
  template: CanvasTemplateSchema;
  listing: MLSListingPayload;
  /**
   * Called when the user clicks Save. The Promise resolves once the parent
   * has acknowledged (e.g., uploaded to storage). Throws are caught by the
   * editor and shown as a non-blocking error toast.
   */
  onSave: (result: CanvasExportResult) => Promise<void> | void;
  /** When provided, the editor renders an "X" close button in its header. */
  onClose?: () => void;
  /**
   * Optional: override the default "Save" button label. Useful when the
   * editor is reused for different flows ("Generate Post", "Update Template").
   */
  saveLabel?: string;
  /**
   * Optional: disable the export entirely (e.g., when the parent is mid-upload).
   * The Save button shows a loading spinner and is unclickable.
   */
  isSaving?: boolean;
  /**
   * Phase 4 — called whenever the user swaps templates inside Studio (via the
   * Templates panel). The parent uses this to keep its own state in sync
   * (post-type chip / variant card / format selector should reflect what's
   * actually on the canvas). Without this hook, the parent's state stays
   * pinned to whatever the user clicked BEFORE entering Studio, and
   * re-opening Studio from the same parent context would re-derive the old
   * template via `findCanvasTemplate(staleTuple)`.
   *
   * The argument is the new active template — caller reads `.category`,
   * `.variant`, and `.format` to update its own state.
   */
  onTemplateSwitched?: (template: CanvasTemplateSchema) => void;
  /**
   * Phase 4 (Smart Resize) — called when the user picks a different format
   * for the current template (via the Resize menu next to Save). The
   * canvas re-initializes at the new aspect ratio; the parent treats the
   * resize as creating a SIBLING post rather than updating the existing
   * row, so it nulls out `generatedPostId` and lets the next Save insert
   * a new row.
   *
   * Distinct from `onTemplateSwitched` because the downstream semantics
   * differ:
   *   • Template switch (same listing, different design) → next Save
   *     updates the existing row. The user is iterating on the same post.
   *   • Resize (same listing, same design, different aspect ratio) → next
   *     Save creates a new row. The user wants both versions to exist.
   *
   * The argument is the regenerated template at the new format — caller
   * reads `.format` to update its own state.
   */
  onResize?: (template: CanvasTemplateSchema) => void;
  /**
   * Phase 5 (Carousel posts) — optional carousel-management surface. When
   * provided, the editor renders a horizontal "slides" strip under the
   * hero canvas with add/remove/reorder controls. When absent, no
   * carousel UI renders (template-author mode, future single-image-only
   * consumers).
   *
   * See CanvasEditorCarouselProps for the full contract. The parent owns
   * the slides state; the editor is purely a UI surface that reads slides
   * + emits change events.
   */
  carousel?: CanvasEditorCarouselProps;
  /**
   * Part 2 (Phase D) — "+ Reel" header affordance. When provided, the
   * editor renders a small button in the top-right cluster alongside
   * Save Post / Close. Clicking it asks the parent to transition the
   * user from the canvas (still-image) Studio into Reel Studio for the
   * same listing. The parent is responsible for the navigation +
   * Studio-overlay cleanup; this prop is purely a UI hook.
   *
   * Omit on consumers that don't have a Reel companion flow (template-
   * author mode, /properties detail Studio embeds, etc).
   */
  onMakeReel?: () => void;
  /**
   * 2026-05-17 — admin-only brand library management. When `isAdmin` is
   * true, the Brand sidecar (logos + partner_logos) renders + Add Asset
   * buttons and × Remove icons. When false (default), it's read-only.
   * The two callbacks are server-action wrappers; pass them when you
   * want to enable management UX.
   */
  isAdmin?: boolean;
  /**
   * 2026-05-30 — template authoring mode. When true (Template Builder only),
   * the editor surfaces the "Placeholders" sidebar tab so authors can drop
   * bound-field placeholders that re-populate on every post. Larissa's
   * post-building Studio leaves this false/undefined — she fills real data,
   * she doesn't bind fields.
   */
  templateAuthoring?: boolean;
  onUploadBrandAsset?: (input: {
    kind: "logo" | "partner_logo";
    label: string;
    logo_category: string | null;
    filename: string;
    content_type: string;
    file_base64: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onArchiveBrandAsset?: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * 2026-05-17 — Custom Templates. When `onSaveAsTemplate` is provided,
   * the editor renders a "Save as Template" button in the header alongside
   * Save Post. The callback receives the serialized Fabric JSON, a
   * preview PNG data URI, the user-entered metadata, and returns a result
   * shape compatible with `saveCustomTemplateAction`. The parent is
   * responsible for refetching its variant grid after a successful save.
   *
   * `customTemplate` (when set) signals that the canvas was hydrated from
   * a user-authored custom template rather than a factory variant. The
   * editor uses this to (a) load `customTemplate.fabricJson` via
   * `canvas.loadFromJSON()` instead of the schema-driven hydration path,
   * and (b) pre-fill the SaveAsTemplate modal with the existing template's
   * id + name (so the Save action UPDATEs that row instead of inserting a
   * sibling).
   */
  onSaveAsTemplate?: (input: {
    id: string | null;
    name: string;
    postType:
      | "just_listed"
      | "just_sold"
      | "under_contract"
      | "open_house"
      | "price_reduction";
    format: PostFormat;
    basedOnVariant:
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
    schemaJson: CanvasTemplateSchema;
    makeDefault: boolean;
    previewImageDataUri: string;
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /**
   * Identifies a user-authored custom template that the canvas was opened
   * from. When set, the editor:
   *   • Loads `fabricJson` via `canvas.loadFromJSON()` instead of building
   *     from the factory schema's layer list. The `boundField` data on
   *     each text/image object is preserved by Fabric, so the MLS-data
   *     re-bind pass (which keys on those fields) still applies after
   *     load.
   *   • Pre-fills the SaveAsTemplate modal with the existing template's
   *     name + default state and switches to UPDATE mode (Save action
   *     UPDATEs this row rather than inserting a sibling).
   *
   * The factory `template` prop is still required even when this is set —
   * the editor uses it for canvas dimensions, format, and the carousel
   * scaffold. The fabricJson layers override what the schema would have
   * hydrated; they don't replace the template envelope.
   */
  customTemplate?: {
    id: string;
    name: string;
    isDefault: boolean;
    fabricJson: unknown;
  };
  /**
   * Saved Studio canvas state from a prior Save Post — the snapshot of the
   * user's actual edits. When set, the editor:
   *   • Loads `initialFabricJson` via `canvas.loadFromJSON()` INSTEAD of
   *     building from the factory schema's layer list. Faithful round-trip
   *     of every move/resize/recolor/hide/font-swap the user did before.
   *   • Runs the same bound-field rebind pass that customTemplate uses
   *     (text `boundField` re-resolves against the current MLS data,
   *     image `boundField` swaps to the current listing's photo/logo).
   *
   * Wins over `customTemplate.fabricJson` when both are present — the
   * Studio reopen is a more specific intent than a custom-template open.
   *
   * The factory `template` prop is still required for canvas dimensions,
   * format metadata, and the bound-field rebind lookup table. The
   * fabricJson REPLACES the layer list; the template envelope remains.
   *
   * Shape: opaque `unknown` — Fabric's loadFromJSON accepts the result of
   * its toObject()/toJSON() output verbatim. Pass through without
   * introspection.
   */
  initialFabricJson?: unknown;
  /**
   * 2026-05-28 — Multi-OH "Apply layout to all slides".
   *
   * When provided, the editor renders an "Apply layout to all slides"
   * button in the bottom action bar (alongside Save as Template). Clicking
   * it walks the current canvas, builds a per-layer `CarouselLayoutOverrides`
   * map via `extractLayoutDelta`, and hands the map to the parent.
   *
   * The parent is responsible for the persistence call + toast — this prop
   * is a pure UI hook. Return `{ ok: true, slide_count }` so the editor
   * can render a "Layout applied to N slides" success state.
   *
   * Omit on non-multi-OH consumers (single-listing post builder, template
   * author mode, etc.) — the button only makes sense when the same canvas
   * has sibling slides to propagate to.
   */
  onApplyLayoutToSiblings?: (overrides: Record<string, unknown>) => Promise<
    | { ok: true; slide_count: number }
    | { ok: false; error: string }
  >;
  /**
   * 2026-05-28 — Server autosave of the slide/hero design.
   *
   * When provided, the editor calls this ~1s after the last edit with a
   * Fabric `toObject` snapshot of the current canvas (the same shape the
   * explicit Save captures as `fabricJson`). The parent persists it design-
   * only (no PNG re-render) so reopening restores the latest work with no
   * "restore?" prompt. This replaced the old localStorage draft + restore
   * banner. Fire-and-forget from the editor's POV; the parent owns
   * persistence + error handling. Omit to disable autosave for a consumer.
   */
  onAutosaveDesign?: (design: unknown) => void | Promise<void>;
}
