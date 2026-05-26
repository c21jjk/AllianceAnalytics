/**
 * AI design-pipeline types — shared by the server pipeline, the API route,
 * the client-side applier, and (later) the UI surfaces in Phases 2-5.
 *
 * Why a dedicated types file (not co-located with each module): the
 * client-side applier in `apply-mutations.ts` and the server-side pipeline
 * in `design-pipeline.ts` both need to agree on shapes. Co-locating types
 * with one of them would force the other to reach across the
 * server-only / client-only boundary just to read a type, which TypeScript
 * tolerates but `server-only`-protected modules don't.
 *
 * Phase 1 scope (2026-05-23): server pipeline runs; no UI consumer yet.
 * The Phase 2 UI work will consume these types unchanged.
 */
import type {
  CanvasLayer,
  CanvasTemplateSchema,
  MLSListingPayload,
  PostFormat,
} from "../types";

// ===========================================================================
// Inputs to the design pipeline
// ===========================================================================

/**
 * Everything the pipeline needs to produce a design.
 *
 * Why pass `currentSchema` (not optional): the pipeline ALWAYS works against
 * a template skeleton, even for "design from scratch" auto-layout — the
 * caller supplies the hydrated default-template schema and Claude rewrites
 * it. This guarantees Claude has a known starting point and lets us measure
 * its decisions against a baseline.
 */
export interface DesignPipelineInput {
  /** The hydrated layer tree to redesign. Could be the freshly-loaded
   *  template, or the user's mid-edit canvas state. */
  currentSchema: CanvasTemplateSchema;
  /** Real-estate listing data — drives copy, hierarchy, market context. */
  listing: MLSListingPayload;
  /** Target format. The pipeline does NOT change format; if the caller
   *  wants Smart Resize, they pass the desired target here and the pipeline
   *  re-flows the layers into it. */
  format: PostFormat;
  /** Photos available for the design. Index 0 is the recommended hero.
   *  These URLs are sent to Claude vision for composition analysis. */
  photoUrls: readonly string[];
  /** Optional free-text intent from the user — e.g. "more luxury", "punchy
   *  modern", "minimal". When omitted, the pipeline picks a creative
   *  direction on its own based on listing + composition.
   *
   *  Phase 3 (chat assistant) will populate this with the user's message. */
  intent?: string;
  /** Optional pinned mood. When set, the strategy pass is constrained to
   *  this mood instead of inferring one. Useful for "apply Luxury Editorial
   *  treatment to my whole carousel" workflows. */
  forceMood?: DesignMood;
}

/**
 * The creative direction the design will execute. Closed enum so Claude
 * can't invent moods we don't have a brand expression for.
 */
export type DesignMood =
  | "luxury_editorial"
  | "punchy_modern"
  | "warm_local"
  | "minimal_classic"
  | "magazine_cover"
  | "bold_celebration";

// ===========================================================================
// Outputs from each pipeline pass
// ===========================================================================

/**
 * Pass 1 — composition brief from Claude vision on the hero photo.
 *
 * Why structured (not free prose): the strategy pass consumes specific
 * fields (subject_position, lighting, palette). Free prose would force
 * each downstream pass to re-parse English. Strict fields force Claude to
 * commit to specific observations.
 */
export interface CompositionBrief {
  /** Where the visual subject of the photo sits within the frame. */
  subject_position: "left" | "center" | "right" | "balanced";
  /** Overall lighting / time-of-day reading. */
  lighting:
    | "bright_daylight"
    | "overcast"
    | "golden_hour"
    | "blue_hour"
    | "twilight"
    | "interior_lit"
    | "mixed";
  /** Author-style description of the architectural / property type — useful
   *  for matching brand tone (e.g., "shore colonial", "mid-century modern",
   *  "victorian cottage"). Free text, 2-6 words. */
  architectural_style: string;
  /** Hex colors dominating the photo. 3-5 entries, no alpha. Used to pick
   *  brand-harmonious accent colors for the design. */
  dominant_palette: string[];
  /**
   * Regions of the photo where text would read cleanly (uniform tone,
   * not over the subject). Coordinates are normalized 0..1 percentages
   * of the photo's width × height, with origin at top-left.
   *
   * Why normalized: the photo can be cropped/rescaled inside the canvas
   * box at any aspect ratio. Normalized coords survive that transform.
   */
  safe_text_zones: ReadonlyArray<{
    /** Human-readable label — "upper sky", "foreground grass", "left wall". */
    label: string;
    /** Bounding box, 0..1. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Suggested text color when laid over this zone — usually "light" or
     *  "dark" based on the zone's average luminance. */
    recommended_text_color: "light" | "dark";
  }>;
  /** Free-prose notes — anything else the design pass should know.
   *  Capped at ~600 chars in the prompt; longer is truncated. */
  notes: string;
}

/**
 * Pass 2 — creative direction. Opus reads listing + composition brief
 * and decides the design's personality before any layout work happens.
 */
export interface StrategyBrief {
  /** The chosen mood. */
  mood: DesignMood;
  /** Short prose explaining WHY this mood fits this listing + photo. */
  rationale: string;
  /**
   * Hierarchy decision — which element should dominate the eye.
   * The layout pass uses this to size + position elements.
   */
  hierarchy: ReadonlyArray<
    "hero_photo" | "price" | "address" | "eyebrow" | "stats" | "brand_mark"
  >;
  /** Brand colors to emphasize. Strings reference ALLIANCE_COLORS keys. */
  color_emphasis: ReadonlyArray<
    "gold500" | "gold600" | "gold100" | "ink900" | "ink800" | "ink700" | "white" | "whiteWarm"
  >;
  /**
   * Type-treatment direction in plain prose. The layout pass uses this
   * for font / weight / case decisions. E.g., "Editorial serif address
   * (Cormorant Garamond, 64px), small-caps Inter eyebrow at 14px tracked
   * +200, large gold price in Inter Black at 132px."
   */
  type_treatment: string;
  /**
   * Photo treatment — how the hero photo should be presented.
   * Options that the layout pass knows how to execute.
   */
  photo_treatment:
    | "full_bleed"
    | "scrim_overlay_bottom"
    | "scrim_overlay_top"
    | "framed_with_margin"
    | "polaroid_offset"
    | "duotone_gold_ink";
}

/**
 * Pass 3 — the actual layout. Returned EITHER as a full schema
 * replacement (for design-from-scratch) OR as a list of targeted
 * mutations against the existing layer tree (for chat-assistant tweaks).
 *
 * Phase 2 (auto-layout) uses `full_replacement`.
 * Phase 3 (chat) uses `mutations`.
 */
export type LayoutPlan =
  | { kind: "full_replacement"; schema: CanvasTemplateSchema }
  | { kind: "mutations"; changes: ReadonlyArray<LayerMutation> };

/**
 * A single targeted layer mutation. Mirrors the shape of `Partial<Layer>`
 * for the layer kind being mutated. We do NOT support changing a layer's
 * `kind` mid-mutation — that would require recreating the Fabric object
 * which is out of scope for Phase 1.
 *
 * Why discriminated by kind: Fabric needs to know which factory ran
 * (Textbox vs Rect vs Image) before applying the patch. The applier
 * narrows on `kind` to choose the right Fabric method per layer.
 */
export type LayerMutation =
  | {
      kind: "text";
      /** Target layer id from the existing canvas. Must match an existing layer. */
      layerId: string;
      /** Partial updates — only the fields Claude wants to change. */
      patch: TextLayerMutationPatch;
    }
  | {
      kind: "image";
      layerId: string;
      patch: ImageLayerMutationPatch;
    }
  | {
      kind: "shape";
      layerId: string;
      patch: ShapeLayerMutationPatch;
    };

/**
 * Allowed fields the AI can mutate on a text layer. Subset of TextLayer —
 * specifically excludes `id`, `kind`, `boundField` (changing what data
 * binds where is a structural change that needs human review) and
 * `editable` (a UX concern, not a design concern).
 */
export interface TextLayerMutationPatch {
  text?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  angle?: number;
  opacity?: number;
  visible?: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fill?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
  charSpacing?: number;
  underline?: boolean;
  linethrough?: boolean;
  maxWidth?: number | null;
}

/**
 * Allowed image-layer mutations. Note that `src` and `boundField` are
 * NOT in here — Claude can swap photos via the photo_index recommendation
 * in the strategy brief, but actually changing the URL is a separate
 * concern handled by the existing photo-swap UI.
 */
export interface ImageLayerMutationPatch {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  angle?: number;
  opacity?: number;
  visible?: boolean;
  objectFit?: "cover" | "contain" | "stretch";
  cornerRadius?: number;
  borderColor?: string;
  borderWidth?: number;
}

export interface ShapeLayerMutationPatch {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  angle?: number;
  opacity?: number;
  visible?: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  strokeDashArray?: number[];
}

/**
 * Pass 4 — self-critique. Opus reads its own Pass 3 layout against a
 * checklist and either approves it or returns a revised version.
 *
 * `passed` is the gate: when true, the LayoutPlan from Pass 3 is the
 * final answer. When false, the `revised` field carries the corrected
 * layout and the pipeline returns THAT to the caller.
 */
export interface CritiqueResult {
  passed: boolean;
  /** Specific issues identified, when any. Empty array when passed=true. */
  issues: ReadonlyArray<string>;
  /** Revised layout — present when passed=false. */
  revised?: LayoutPlan;
  /** Free-text rationale Claude wrote about its critique. Useful for
   *  understanding WHY a layout was changed when debugging. */
  notes: string;
}

// ===========================================================================
// Hard-rule enforcement — Task #67 (2026-05-25)
// ===========================================================================

/**
 * A single violation of an Alliance brand hard rule, detected by the
 * deterministic checker in `hard-rule-checker.ts`.
 *
 * Why structured (not just a string): the pipeline injects these into
 * Pass 4's critique prompt AND into a Pass 3 retry's layout prompt, so
 * the LLM gets both human context (`detail`) and an executable hint
 * (`fix_hint`). The `rule` field is a stable identifier for telemetry.
 *
 * Severity:
 *   • "fail" — must be fixed; triggers retry-or-surface.
 *   • "warn" — surfaces in `criticalIssues` for visibility, doesn't gate.
 */
export interface HardRuleViolation {
  rule: string;
  severity: "fail" | "warn";
  /** When the violation is attributable to a specific layer, its id. */
  layerId?: string;
  /** Human-readable explanation suitable for an LLM prompt. */
  detail: string;
  /** Specific recipe for fixing — what value to set, what to add/strip. */
  fix_hint: string;
}

// ===========================================================================
// Progress events — emitted as the pipeline runs
// ===========================================================================

/**
 * Discriminated union of progress events. The route handler streams these
 * to the client as NDJSON; the client renders them in the "Claude is
 * thinking..." progress indicator (Phase 2 UI work).
 *
 * Phase 1 emits these to the route's stream but the only consumer is a
 * manual test script. The shapes are stable so Phase 2 can plug in
 * without re-spec'ing this layer.
 *
 * Task #67 (2026-05-25) added `retry_triggered` — fired when the
 * deterministic hard-rule check finds violations after Pass 4 and the
 * pipeline kicks off a single retry of Pass 3 + Pass 4.
 */
export type PipelineProgress =
  | { type: "started"; ts: number }
  | { type: "pass_started"; pass: PipelinePass; ts: number }
  | {
      type: "pass_completed";
      pass: PipelinePass;
      durationMs: number;
      ts: number;
    }
  | {
      type: "pass_failed";
      pass: PipelinePass;
      error: string;
      ts: number;
    }
  | {
      type: "retry_triggered";
      /** The unresolved fail-severity violations that triggered the retry. */
      reason: ReadonlyArray<HardRuleViolation>;
      ts: number;
    }
  | {
      type: "completed";
      result: DesignPipelineOutput;
      durationMs: number;
      ts: number;
    }
  | { type: "failed"; error: string; ts: number };

export type PipelinePass = "composition" | "strategy" | "layout" | "critique";

// ===========================================================================
// Final pipeline output
// ===========================================================================

/**
 * The full result of a successful pipeline run. The caller (Phase 2
 * auto-layout, Phase 3 chat, Phase 4 smart-resize) decides what to do
 * with each field — typically apply `plan` to the canvas and stash the
 * other fields on the post for telemetry / debugging.
 */
export interface DesignPipelineOutput {
  composition: CompositionBrief;
  strategy: StrategyBrief;
  /** The layout Claude landed on (post-critique). */
  plan: LayoutPlan;
  critique: CritiqueResult;
  /** Total wall-clock time the pipeline took to run, in ms. */
  totalDurationMs: number;
  /**
   * Tokens used across all passes. Useful for cost tracking when we
   * decide whether to keep an "always-on" Phase 2 forever.
   */
  tokensUsed: {
    input: number;
    output: number;
  };
  /**
   * Task #67 — Pass-4 + post-retry hard-rule violations that remain after
   * the deterministic checker's final run on `plan`. Empty array means
   * the design is clean. Non-empty means the pipeline shipped the best
   * plan it could but the caller should treat the design as un-approved
   * (UI may surface a warning chip; the renderer still runs).
   */
  criticalIssues: ReadonlyArray<HardRuleViolation>;
  /**
   * Task #67 — How many Pass-3+Pass-4 retries the pipeline performed.
   * 0 on the happy path; 1 when the deterministic check after the first
   * critique still found fail-severity violations. Capped at MAX_RETRIES
   * (currently 1) inside `runDesignPipeline`.
   */
  retriesUsed: number;
}

/**
 * Failure shape — wraps a partial output so the caller can decide what
 * to do. E.g., if Pass 1 (composition) succeeded but Pass 2 (strategy)
 * timed out, we can still log the composition for human review.
 */
export interface DesignPipelineFailure {
  /** Which pass failed. */
  failedAt: PipelinePass;
  /** Human-readable error. */
  error: string;
  /** Anything we managed to compute before failing. */
  partial: {
    composition?: CompositionBrief;
    strategy?: StrategyBrief;
    plan?: LayoutPlan;
  };
}

/** Top-level pipeline return — discriminated success/failure. */
export type DesignPipelineResult =
  | { ok: true; output: DesignPipelineOutput }
  | { ok: false; failure: DesignPipelineFailure };

// ===========================================================================
// Helper — narrow CanvasLayer by kind for the applier
// ===========================================================================

export function mutationLayerKind(m: LayerMutation): CanvasLayer["kind"] {
  return m.kind;
}
