/**
 * Path B — Layer tree schema for the Post Editor.
 *
 * The layer tree is the structured representation of a post that the
 * editor manipulates. It replaces the monolithic HTML-string output of
 * Path A primitives. Same tree renders to:
 *
 *   - SVG (browser editor canvas + Chromium screenshot for final PNG)
 *   - JSON (persisted in generated_posts.layer_tree)
 *
 * Coordinates are in TEMPLATE space — the canvas is sized to the
 * template's native dimensions (e.g. 1080×1080 for square). Editor scales
 * to viewport via CSS transform on the rendered SVG.
 *
 * Origin is top-left, like SVG / web canvas conventions.
 */

/** Top-level container. The full post is one LayerTree. */
export interface LayerTree {
  /** Schema version — bump when we make breaking changes. */
  schema_version: 1;
  /** Native template dimensions in pixels. */
  width: number;
  height: number;
  /** Solid background color (hex). Falls back to white. Layers paint over it. */
  background?: string;
  /** Ordered list of layers. Earlier = farther back; later = on top. */
  layers: Layer[];
  /**
   * Optional metadata about which template seeded this tree (for
   * "regenerate from template" + analytics). Not load-bearing — the
   * tree alone is enough to re-render.
   */
  source?: {
    template_id?: string;
    post_type?: string;
    variant?: string;
    format?: string;
    seeded_at?: string;
  };
}

export type Layer =
  | ImageLayer
  | TextLayer
  | RectLayer
  | GradientLayer
  | LineLayer
  | GroupLayer;

/**
 * Common transform/identity properties shared by every layer.
 * x/y/w/h are in template-space pixels.
 */
export interface BaseLayer {
  /** Stable id (UUID-ish). Used for selection, undo history, and re-render diffing. */
  id: string;
  /** Discriminator — narrows to the concrete layer type. */
  type: LayerType;
  /** Position in template-space pixels. */
  x: number;
  y: number;
  /** Box dimensions. For text, this is the wrap box. */
  w: number;
  h: number;
  /** Rotation in degrees, clockwise around the box center. Default 0. */
  rotation?: number;
  /** 0..1. Default 1. */
  opacity?: number;
  /** Hide this layer in render and editor. Stays in tree. Default false. */
  hidden?: boolean;
  /** Disable selection/transform in the editor. Default false. */
  locked?: boolean;
  /** Optional human-readable layer name shown in the layer panel. */
  name?: string;
}

export type LayerType = "image" | "text" | "rect" | "gradient" | "line" | "group";

/**
 * Image layer — wraps an external URL or data URI. The image is
 * positioned within the (x,y,w,h) box per `fit`.
 */
export interface ImageLayer extends BaseLayer {
  type: "image";
  src: string;
  /**
   * cover  → fill box, crop overflow (CSS background-size: cover)
   * contain → fit inside box, letterbox empty space
   * fill   → stretch to box, ignore aspect
   */
  fit?: "cover" | "contain" | "fill";
  /**
   * Optional crop window in source-image coordinates (0..1 normalized).
   * Applied before fit. Useful for "focus on this part of the photo."
   */
  crop?: { x: number; y: number; w: number; h: number };
  /** Corner radius in template-space px. Default 0. */
  radius?: number;
}

/**
 * Text layer — renders rich text inside the (x,y,w,h) box. Auto-wraps
 * to box width. SVG text doesn't auto-wrap natively; the renderer uses
 * <foreignObject> with HTML inside, which Chromium handles correctly.
 */
export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  /** Font family. Must be in the font registry (svg-renderer FONT_FAMILIES). */
  font?: string;
  /** Font size in template-space px. */
  size?: number;
  /** 100..900 or named ("normal" | "bold"). */
  weight?: number | "normal" | "bold";
  /** Hex color. */
  color?: string;
  /** Horizontal alignment within the wrap box. */
  align?: "left" | "center" | "right";
  /** em-relative letter spacing. e.g. 0.32 = +0.32em. */
  letter_spacing?: number;
  /** Multiplier on font-size. e.g. 1.2 = 120% line height. */
  line_height?: number;
  /** Force uppercase. */
  uppercase?: boolean;
  /** CSS-style text-shadow. Optional. */
  text_shadow?: string;
  /**
   * Vertical alignment within the wrap box. Default "top".
   */
  vertical_align?: "top" | "middle" | "bottom";
}

/** Solid rectangle layer with optional stroke + corner radius. */
export interface RectLayer extends BaseLayer {
  type: "rect";
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  /** Corner radius in template-space px. Default 0. */
  radius?: number;
}

/**
 * Gradient layer — fills the box with a linear or radial gradient.
 * Stops are 0..1 offsets along the gradient.
 */
export interface GradientLayer extends BaseLayer {
  type: "gradient";
  variant: "linear" | "radial";
  /** Linear: angle in degrees, 0 = top→bottom, 90 = left→right. Ignored for radial. */
  angle?: number;
  stops: GradientStop[];
  /** Corner radius. Default 0. */
  radius?: number;
}

export interface GradientStop {
  offset: number; // 0..1
  color: string;
  opacity?: number; // 0..1, default 1
}

/** Line layer — a single straight stroke from (x,y) to (x+w, y+h). */
export interface LineLayer extends BaseLayer {
  type: "line";
  stroke?: string;
  stroke_width?: number;
}

/**
 * Group layer — a rotation/translation/opacity wrapper around child
 * layers. Used by templates to bundle the "content stack" so the user
 * can move/scale it as a unit. Children's coordinates are relative to
 * the group's (x, y) origin.
 */
export interface GroupLayer extends BaseLayer {
  type: "group";
  children: Layer[];
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Type guard. */
export function isLayer(v: unknown): v is Layer {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.w === "number" &&
    typeof o.h === "number"
  );
}

/** Type guard. */
export function isLayerTree(v: unknown): v is LayerTree {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.schema_version === 1 &&
    typeof o.width === "number" &&
    typeof o.height === "number" &&
    Array.isArray(o.layers)
  );
}

/** Generate a stable layer id. Used by the editor when adding new layers. */
export function newLayerId(prefix: string = "layer"): string {
  // Simple time + random — unique enough for client-side, no need for crypto.
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Walk a layer tree in render order (depth-first, parent before children
 * so transforms compose correctly). Yields each layer with its parent
 * group chain for transform resolution.
 */
export function* walkLayers(tree: LayerTree): Generator<{
  layer: Layer;
  parents: GroupLayer[];
}> {
  function* walk(layers: Layer[], parents: GroupLayer[]): Generator<{
    layer: Layer;
    parents: GroupLayer[];
  }> {
    for (const layer of layers) {
      yield { layer, parents };
      if (layer.type === "group") {
        yield* walk(layer.children, [...parents, layer]);
      }
    }
  }
  yield* walk(tree.layers, []);
}

/**
 * Find a layer by id, walking groups recursively.
 * Returns null if not found.
 */
export function findLayer(tree: LayerTree, id: string): Layer | null {
  for (const { layer } of walkLayers(tree)) {
    if (layer.id === id) return layer;
  }
  return null;
}

/**
 * Replace a layer by id, preserving group structure. Returns a new tree.
 * If id is not found, returns the original tree unchanged.
 */
export function replaceLayer(tree: LayerTree, id: string, next: Layer): LayerTree {
  function replaceIn(layers: Layer[]): Layer[] {
    return layers.map((l) => {
      if (l.id === id) return next;
      if (l.type === "group") return { ...l, children: replaceIn(l.children) };
      return l;
    });
  }
  return { ...tree, layers: replaceIn(tree.layers) };
}

/** Remove a layer by id. Returns a new tree. */
export function removeLayer(tree: LayerTree, id: string): LayerTree {
  function removeIn(layers: Layer[]): Layer[] {
    const out: Layer[] = [];
    for (const l of layers) {
      if (l.id === id) continue;
      if (l.type === "group") {
        out.push({ ...l, children: removeIn(l.children) });
      } else {
        out.push(l);
      }
    }
    return out;
  }
  return { ...tree, layers: removeIn(tree.layers) };
}
