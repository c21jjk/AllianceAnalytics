"use client";

/**
 * ToolsPanel — Canva-style "Tools" tab in the editor's left rail.
 * ----------------------------------------------------------------
 *
 * What it ports from Canva:
 *   • Draw (Pen / Marker / Highlighter / Eraser) with color + stroke-weight
 *   • Shapes expansion (triangle, inverted-triangle, diamond, pentagon, star,
 *     arrow, speech bubble — on top of the existing rect/circle/line)
 *   • Lines expansion (curved + elbow connector — on top of straight)
 *   • Text shortcut (single-click drop a default paragraph textbox)
 *
 * What it intentionally does NOT include (v1 scope, per chat 2026-05-23):
 *   • Select icon — unnecessary; default cursor returns automatically when
 *     the user exits Draw via Esc, switching to another tool, or clicking
 *     outside the popout. Adding a redundant cursor entry adds clicks
 *     without adding capability.
 *   • Sticky notes — low value for Larissa's real-estate posts.
 *   • Tables — multi-day build, deferred to Phase 2 of the Tools panel.
 *
 * Architecture notes:
 *   • Shape / line / text spawn goes through THIS file's own factories.
 *     They use raw Fabric primitives (Polygon / Path / Polyline) rather
 *     than extending the CanvasTemplateSchema ShapeLayer.shapeType union.
 *     Reason: schema extension would force changes across headless-render,
 *     worker/render.js, every existing factory, and the published-PNG
 *     pipeline. User-spawned shapes round-trip through autosave because
 *     Fabric's toObject() captures Polygon/Path/Polyline natively — we
 *     don't need them in the schema for the live editor to work.
 *   • Draw mode lives on the Fabric canvas (canvas.isDrawingMode + a
 *     freeDrawingBrush). The panel owns the BRUSH STATE (color, width,
 *     sub-tool) and writes the brush onto the canvas; exiting Draw
 *     mode flips isDrawingMode back to false but leaves the brush
 *     settings cached so the next entry resumes where the user left off.
 *   • Brush state persists across reloads via localStorage (the active
 *     TOOL does not — Draw mode reset is the right default; a reload
 *     where the user comes back drawing is a footgun, especially for
 *     ADHD users who can't tell why their clicks aren't selecting).
 */

import {
  Circle as FabricCircle,
  Line as FabricLine,
  Rect as FabricRect,
  type Canvas,
  type FabricObject,
  PencilBrush,
  Path,
  Polygon,
  Polyline,
  Textbox,
} from "fabric";
import {
  ArrowRight,
  Brush,
  Circle as LCircle,
  CornerDownRight,
  Diamond,
  Eraser,
  Heading as LHeading,
  Heading2 as LHeading2,
  Highlighter,
  MessageCircle,
  Minus as LMinus,
  Pen,
  Pentagon,
  Pilcrow as LPilcrow,
  Spline,
  Square as LSquare,
  Star,
  Triangle,
} from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";

import { setLayerData } from "../fabric-factory";
import Tooltip from "../primitives/Tooltip";
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "../templates/tokens";
import { ADD_LAYER_DEFAULTS } from "../contracts";

// ===========================================================================
// Public types
// ===========================================================================

/**
 * Top-level tool mode. Mutually exclusive — only one is active at a time.
 *
 *   • "select" — default cursor; no drawing or shape-spawn in flight
 *   • "draw"   — Fabric isDrawingMode is on; pointer events paint
 */
export type ToolMode = "select" | "draw";

/**
 * Draw sub-mode. Determines brush behavior when ToolMode is "draw".
 *
 * Why all four are PencilBrush variants (no special SmoothBrush / SprayBrush):
 *   Fabric's other brushes (CircleBrush, SprayBrush, PatternBrush) produce
 *   non-vector output that doesn't round-trip well through Fabric.toObject().
 *   PencilBrush is the only brush that always serializes as a Path object,
 *   keeping strokes editable/movable/deletable from the layer panel.
 */
export type DrawBrush = "pen" | "marker" | "highlighter" | "eraser";

/**
 * Persisted brush settings — what survives a reload via localStorage.
 *
 * Why active tool is NOT in here: see file-level comment.
 */
interface PersistedBrushState {
  brush: DrawBrush;
  color: string;
  width: number; // px
}

const BRUSH_STORAGE_KEY = "cwk-studio-tools-brush-v1";

/** Defaults when nothing is persisted. */
const DEFAULT_BRUSH_STATE: PersistedBrushState = {
  brush: "pen",
  color: ALLIANCE_COLORS.gold500,
  width: 4,
};

// ===========================================================================
// Brush persistence
// ===========================================================================

function readBrushState(): PersistedBrushState {
  if (typeof window === "undefined") return DEFAULT_BRUSH_STATE;
  try {
    const raw = window.localStorage.getItem(BRUSH_STORAGE_KEY);
    if (!raw) return DEFAULT_BRUSH_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedBrushState>;
    return {
      brush:
        parsed.brush === "pen" ||
        parsed.brush === "marker" ||
        parsed.brush === "highlighter" ||
        parsed.brush === "eraser"
          ? parsed.brush
          : DEFAULT_BRUSH_STATE.brush,
      color:
        typeof parsed.color === "string" && /^#[0-9a-fA-F]{6,8}$/.test(parsed.color)
          ? parsed.color
          : DEFAULT_BRUSH_STATE.color,
      width:
        typeof parsed.width === "number" && parsed.width >= 1 && parsed.width <= 60
          ? parsed.width
          : DEFAULT_BRUSH_STATE.width,
    };
  } catch {
    return DEFAULT_BRUSH_STATE;
  }
}

function writeBrushState(state: PersistedBrushState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRUSH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort
  }
}

// ===========================================================================
// Brush configuration helpers
// ===========================================================================

/**
 * Tunables per Draw sub-mode. We don't expose them in the UI — they're the
 * personality knobs that make "Marker" feel different from "Pen" beyond just
 * stroke width. If the project later wants per-sub-mode width independence,
 * lift `width` into here too and drop the slider from the popout.
 */
const BRUSH_PRESETS: Record<
  DrawBrush,
  { widthMultiplier: number; opacity: number; eraser: boolean }
> = {
  pen: { widthMultiplier: 1, opacity: 1, eraser: false },
  marker: { widthMultiplier: 2.5, opacity: 1, eraser: false },
  highlighter: { widthMultiplier: 4, opacity: 0.35, eraser: false },
  // why: Fabric v6 doesn't ship an EraserBrush in the main bundle. We
  // approximate by painting white at full opacity. On templates with a
  // photographic background, this is visually wrong (paints over the
  // photo with a white smear). That's an acceptable v1 trade — Larissa
  // can also just select the stroke layer and Delete, which is the
  // "real" eraser. We document this limitation prominently so we don't
  // forget. Phase 2: switch to a destination-out composite stroke.
  eraser: { widthMultiplier: 3, opacity: 1, eraser: true },
};

/**
 * Apply the requested brush state to the canvas's freeDrawingBrush. Idempotent
 * — safe to call on every state change. Returns nothing; mutates the canvas.
 */
function applyBrushToCanvas(
  canvas: Canvas,
  brush: DrawBrush,
  color: string,
  width: number,
): void {
  const preset = BRUSH_PRESETS[brush];
  const fb = new PencilBrush(canvas);
  fb.color = preset.eraser ? "#FFFFFF" : color;
  fb.width = Math.max(1, width * preset.widthMultiplier);
  // why: Fabric's PencilBrush has no opacity property — opacity must be
  // baked into the color (rgba) instead. Convert hex+optional-alpha → rgba.
  if (preset.opacity < 1 && !preset.eraser) {
    fb.color = hexToRgba(color, preset.opacity);
  }
  canvas.freeDrawingBrush = fb;
}

/** Convert "#RRGGBB" + alpha → "rgba(r,g,b,a)". Idempotent on rgba input. */
function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith("rgba")) return hex;
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ===========================================================================
// Shape + line + text factories (Fabric primitives, no schema)
// ===========================================================================

/**
 * Centerline math: given the canvas and a desired size, return the (left, top)
 * for an origin=center placement so the new shape lands visually centered.
 */
function getCenter(canvas: Canvas): { cx: number; cy: number } {
  return {
    cx: (canvas.getWidth() ?? 0) / 2,
    cy: (canvas.getHeight() ?? 0) / 2,
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Common Fabric props applied to every new shape we spawn. */
function commonShapeProps(): Record<string, unknown> {
  return {
    selectable: true,
    evented: true,
    cornerStyle: "circle" as const,
    cornerSize: 10,
    transparentCorners: false,
    borderColor: ALLIANCE_COLORS.gold500,
    cornerColor: ALLIANCE_COLORS.gold500,
  };
}

/**
 * Build the point array for a regular n-sided polygon centered at (0, 0)
 * with the given circumscribed radius. Polygons are rotated so the FIRST
 * vertex points straight up — that gives triangle / pentagon / star the
 * expected "pointing up" orientation without needing an extra rotation.
 */
function regularPolygonPoints(
  sides: number,
  radius: number,
  startAngle: number = -Math.PI / 2,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = startAngle + (i * 2 * Math.PI) / sides;
    out.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  }
  return out;
}

/**
 * Build the point array for a 5-point star. Alternates outer + inner radius
 * around 10 vertices for a classic pointed-star silhouette.
 */
function starPoints(
  outerRadius: number,
  innerRadius: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const points = 5;
  const startAngle = -Math.PI / 2;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = startAngle + (i * Math.PI) / points;
    out.push({
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
    });
  }
  return out;
}

// --- Shape kinds the Tools panel can spawn (in addition to rect/circle/line) ---
export type SpawnShapeKind =
  | "triangle"
  | "triangle_down"
  | "diamond"
  | "pentagon"
  | "star"
  | "arrow"
  | "speech_bubble";

export function spawnShapeFromTools(
  canvas: Canvas,
  kind: SpawnShapeKind,
): FabricObject {
  const { cx, cy } = getCenter(canvas);
  const size = ADD_LAYER_DEFAULTS.shapeSize;
  const radius = size / 2;
  const id = makeId(`user_${kind}`);
  const fill = ALLIANCE_COLORS.gold500;

  let obj: FabricObject;
  let displayName: string;

  switch (kind) {
    case "triangle":
      obj = new Polygon(regularPolygonPoints(3, radius, -Math.PI / 2), {
        ...commonShapeProps(),
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fill,
        stroke: undefined,
        strokeWidth: 0,
      });
      displayName = "Triangle";
      break;
    case "triangle_down":
      obj = new Polygon(regularPolygonPoints(3, radius, Math.PI / 2), {
        ...commonShapeProps(),
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fill,
      });
      displayName = "Triangle";
      break;
    case "diamond":
      obj = new Polygon(regularPolygonPoints(4, radius, -Math.PI / 2), {
        ...commonShapeProps(),
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fill,
      });
      displayName = "Diamond";
      break;
    case "pentagon":
      obj = new Polygon(regularPolygonPoints(5, radius), {
        ...commonShapeProps(),
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fill,
      });
      displayName = "Pentagon";
      break;
    case "star":
      obj = new Polygon(starPoints(radius, radius * 0.4), {
        ...commonShapeProps(),
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fill,
      });
      displayName = "Star";
      break;
    case "arrow": {
      // Arrow shaft + head as a 7-point polygon (right-pointing).
      // why: simpler than a Group of two pieces, and rotates as a single
      // unit. Larissa rotates with the Fabric corner handle.
      const w = size;
      const h = size * 0.4;
      const headLen = h * 1.2;
      const shaftH = h * 0.5;
      const arrowPoints = [
        { x: -w / 2, y: -shaftH / 2 },
        { x: w / 2 - headLen, y: -shaftH / 2 },
        { x: w / 2 - headLen, y: -h / 2 },
        { x: w / 2, y: 0 },
        { x: w / 2 - headLen, y: h / 2 },
        { x: w / 2 - headLen, y: shaftH / 2 },
        { x: -w / 2, y: shaftH / 2 },
      ];
      obj = new Polygon(arrowPoints, {
        ...commonShapeProps(),
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fill,
      });
      displayName = "Arrow";
      break;
    }
    case "speech_bubble": {
      // why: speech bubble is a rounded rect with a tail at the bottom-left.
      // We render as a single Path for simplicity. SVG path: rounded rect
      // body + triangular tail.
      const w = size;
      const h = size * 0.75;
      const r = 16; // corner radius
      const tailW = 30;
      const tailH = 24;
      // Path starts at top-left rounded corner and walks clockwise.
      const d = [
        `M ${-w / 2 + r} ${-h / 2}`,
        `L ${w / 2 - r} ${-h / 2}`,
        `Q ${w / 2} ${-h / 2} ${w / 2} ${-h / 2 + r}`,
        `L ${w / 2} ${h / 2 - r}`,
        `Q ${w / 2} ${h / 2} ${w / 2 - r} ${h / 2}`,
        // tail starts ~30% from left
        `L ${-w / 2 + w * 0.45 + tailW} ${h / 2}`,
        `L ${-w / 2 + w * 0.25} ${h / 2 + tailH}`,
        `L ${-w / 2 + w * 0.45} ${h / 2}`,
        `L ${-w / 2 + r} ${h / 2}`,
        `Q ${-w / 2} ${h / 2} ${-w / 2} ${h / 2 - r}`,
        `L ${-w / 2} ${-h / 2 + r}`,
        `Q ${-w / 2} ${-h / 2} ${-w / 2 + r} ${-h / 2}`,
        "Z",
      ].join(" ");
      obj = new Path(d, {
        ...commonShapeProps(),
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fill,
      });
      displayName = "Speech bubble";
      break;
    }
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }

  setLayerData(obj, {
    layerId: id,
    layerKind: "shape",
    displayName,
  });
  return obj;
}

// --- Lines the Tools panel can spawn (in addition to the straight line in AddLayerToolbar) ---
export type SpawnLineKind = "curved" | "elbow";

export function spawnLineFromTools(
  canvas: Canvas,
  kind: SpawnLineKind,
): FabricObject {
  const { cx, cy } = getCenter(canvas);
  const len = ADD_LAYER_DEFAULTS.lineLength;
  const id = makeId(`user_${kind}`);
  const color = ALLIANCE_COLORS.ink900;
  const strokeWidth = ADD_LAYER_DEFAULTS.lineStrokeWidth;

  let obj: FabricObject;
  let displayName: string;

  if (kind === "curved") {
    // Quadratic curve via SVG Path. Control point lifts the midpoint
    // upward so the user sees an obvious arc rather than a near-line.
    // Path is in absolute coordinates (originX/Y=left/top by default
    // for Path); we use the layer's left/top directly.
    const halfLen = len / 2;
    const d = `M ${-halfLen} 0 Q 0 ${-halfLen * 0.7} ${halfLen} 0`;
    obj = new Path(d, {
      ...commonShapeProps(),
      left: cx,
      top: cy,
      originX: "center",
      originY: "center",
      fill: "transparent",
      stroke: color,
      strokeWidth,
    });
    displayName = "Curved line";
  } else {
    // Elbow connector — Polyline with a 90° corner. Three points form
    // an L; the user can drag any anchor in Fabric's free-transform mode.
    const halfLen = len / 2;
    obj = new Polyline(
      [
        { x: -halfLen, y: -halfLen / 2 },
        { x: -halfLen, y: halfLen / 2 },
        { x: halfLen, y: halfLen / 2 },
      ],
      {
        ...commonShapeProps(),
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        fill: "transparent",
        stroke: color,
        strokeWidth,
      },
    );
    displayName = "Elbow connector";
  }

  setLayerData(obj, {
    layerId: id,
    layerKind: "shape",
    displayName,
  });
  return obj;
}

export function spawnTextFromTools(canvas: Canvas): FabricObject {
  const { cx, cy } = getCenter(canvas);
  const id = makeId("user_text");
  const tb = new Textbox(ADD_LAYER_DEFAULTS.textContent, {
    left: cx,
    top: cy,
    width: ADD_LAYER_DEFAULTS.textWidth,
    originX: "center",
    originY: "center",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: 48,
    fontWeight: 600,
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    editable: true,
    selectable: true,
    evented: true,
    cornerStyle: "circle",
    cornerSize: 10,
    transparentCorners: false,
    borderColor: ALLIANCE_COLORS.gold500,
    cornerColor: ALLIANCE_COLORS.gold500,
    padding: 2,
  });
  setLayerData(tb, {
    layerId: id,
    layerKind: "text",
    displayName: "Text",
  });
  return tb;
}

// ===========================================================================
// ADD section factories — migrated 2026-05-26 from the deleted AddLayerToolbar.
// ===========================================================================
//
// The floating "Add layer" toolbar that used to sit above the canvas was
// removed in favor of a top "ADD" tile section inside this Tools panel. Its
// four spawn factories (text / rect / circle / line) live here so callers
// outside this panel (keyboard shortcuts in CanvasEditor.tsx) still have a
// stable import path. We also add Heading + Subheading variants on top of
// the original text spawn — Canva exposes the three sizes as distinct tiles
// in its Elements panel and Larissa expects the same.
// ---------------------------------------------------------------------------

/** Distinct text-subtype tiles in the ADD section. */
export type AddTextKind = "heading" | "subheading" | "paragraph";

/** Per-subtype defaults — diverge mainly on fontSize + fontWeight + content. */
const ADD_TEXT_PRESETS: Record<
  AddTextKind,
  { content: string; fontSize: number; fontWeight: number; displayName: string }
> = {
  heading: {
    content: "Add a heading",
    fontSize: 96,
    fontWeight: 700,
    displayName: "Heading",
  },
  subheading: {
    content: "Add a subheading",
    fontSize: 64,
    fontWeight: 600,
    displayName: "Subheading",
  },
  paragraph: {
    content: ADD_LAYER_DEFAULTS.textContent,
    fontSize: 32,
    fontWeight: 400,
    displayName: "Paragraph",
  },
};

/**
 * Spawn a Textbox configured for the given text-subtype preset. Shares the
 * placement + corner-handle styling of all Tools-panel spawns. Used by the
 * ADD section tiles (3 text tiles).
 */
export function spawnAddText(
  canvas: Canvas,
  kind: AddTextKind,
): FabricObject {
  const { cx, cy } = getCenter(canvas);
  const preset = ADD_TEXT_PRESETS[kind];
  const id = makeId(`user_${kind}`);
  const tb = new Textbox(preset.content, {
    left: cx,
    top: cy,
    width: ADD_LAYER_DEFAULTS.textWidth,
    originX: "center",
    originY: "center",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: preset.fontSize,
    fontWeight: preset.fontWeight,
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    editable: true,
    selectable: true,
    evented: true,
    cornerStyle: "circle",
    cornerSize: 10,
    transparentCorners: false,
    borderColor: ALLIANCE_COLORS.gold500,
    cornerColor: ALLIANCE_COLORS.gold500,
    padding: 2,
  });
  setLayerData(tb, {
    layerId: id,
    layerKind: "text",
    displayName: preset.displayName,
  });
  return tb;
}

/**
 * Spawn a default text layer — kept for CanvasEditor's keyboard-shortcut
 * dispatcher (the `T` key) which expects a single zero-argument factory.
 * Equivalent to spawnAddText(canvas, "paragraph") with the legacy
 * "Double-click to edit" placeholder and 48px size so the existing T
 * binding's behavior doesn't change.
 */
export function spawnText(canvas: Canvas): FabricObject {
  const { cx, cy } = getCenter(canvas);
  const id = makeId("user_text");
  const tb = new Textbox(ADD_LAYER_DEFAULTS.textContent, {
    left: cx,
    top: cy,
    width: ADD_LAYER_DEFAULTS.textWidth,
    originX: "center",
    originY: "center",
    fontFamily: ALLIANCE_FONTS.bodySans,
    fontSize: 48,
    fontWeight: 600,
    fill: ALLIANCE_COLORS.ink900,
    textAlign: "center",
    editable: true,
    selectable: true,
    evented: true,
    cornerStyle: "circle",
    cornerSize: 10,
    transparentCorners: false,
    borderColor: ALLIANCE_COLORS.gold500,
    cornerColor: ALLIANCE_COLORS.gold500,
    padding: 2,
  });
  setLayerData(tb, {
    layerId: id,
    layerKind: "text",
    displayName: "Text",
  });
  return tb;
}

/** Spawn a default Rectangle — migrated from AddLayerToolbar. */
export function spawnRect(canvas: Canvas): FabricObject {
  const { cx, cy } = getCenter(canvas);
  const id = makeId("user_rect");
  const size = ADD_LAYER_DEFAULTS.shapeSize;
  const rect = new FabricRect({
    left: cx,
    top: cy,
    width: size,
    height: size,
    originX: "center",
    originY: "center",
    fill: ALLIANCE_COLORS.gold500,
    stroke: undefined,
    strokeWidth: 0,
    rx: 0,
    ry: 0,
    selectable: true,
    evented: true,
    cornerStyle: "circle",
    cornerSize: 10,
    transparentCorners: false,
    borderColor: ALLIANCE_COLORS.gold500,
    cornerColor: ALLIANCE_COLORS.gold500,
  });
  setLayerData(rect, {
    layerId: id,
    layerKind: "shape",
    displayName: "Rectangle",
  });
  return rect;
}

/** Spawn a default Circle — migrated from AddLayerToolbar. */
export function spawnCircle(canvas: Canvas): FabricObject {
  const { cx, cy } = getCenter(canvas);
  const id = makeId("user_circle");
  const radius = ADD_LAYER_DEFAULTS.shapeSize / 2;
  const circle = new FabricCircle({
    left: cx,
    top: cy,
    radius,
    originX: "center",
    originY: "center",
    fill: ALLIANCE_COLORS.gold500,
    stroke: undefined,
    strokeWidth: 0,
    selectable: true,
    evented: true,
    cornerStyle: "circle",
    cornerSize: 10,
    transparentCorners: false,
    borderColor: ALLIANCE_COLORS.gold500,
    cornerColor: ALLIANCE_COLORS.gold500,
  });
  setLayerData(circle, {
    layerId: id,
    layerKind: "shape",
    displayName: "Circle",
  });
  return circle;
}

/** Spawn a default straight Line — migrated from AddLayerToolbar. */
export function spawnLine(canvas: Canvas): FabricObject {
  const { cx, cy } = getCenter(canvas);
  const id = makeId("user_line");
  const len = ADD_LAYER_DEFAULTS.lineLength;
  // why: Fabric Line takes [x1, y1, x2, y2] in the constructor. We DON'T set
  // originX/originY=center here — Fabric computes the origin from the
  // endpoints, and overriding the origin shifts the visible line.
  const line = new FabricLine([cx - len / 2, cy, cx + len / 2, cy], {
    stroke: ALLIANCE_COLORS.ink900,
    strokeWidth: ADD_LAYER_DEFAULTS.lineStrokeWidth,
    selectable: true,
    evented: true,
    cornerStyle: "circle",
    cornerSize: 10,
    transparentCorners: false,
    borderColor: ALLIANCE_COLORS.gold500,
    cornerColor: ALLIANCE_COLORS.gold500,
  });
  setLayerData(line, {
    layerId: id,
    layerKind: "shape",
    displayName: "Line",
  });
  return line;
}

// ===========================================================================
// Component
// ===========================================================================

export interface ToolsPanelProps {
  /** Fabric canvas instance. Null while the editor is initializing. */
  canvas: Canvas | null;
  /** Active tool — owned by the parent so Esc + Tab-switching can clear it. */
  activeTool: ToolMode;
  /** Called whenever the user picks a different ToolMode. */
  onToolChange: (next: ToolMode) => void;
  /**
   * Called after a new shape / line / text is spawned and added to the
   * canvas. Mirrors AddLayerToolbar's onLayerAdded — the orchestrator
   * bumps layerVersion, selects the new layer, and records history.
   */
  onLayerAdded: (newObj: FabricObject) => void;
  /** Snapshot a history entry after a spawn / brush change. */
  recordHistory?: () => void;
}

export default function ToolsPanel(props: ToolsPanelProps): JSX.Element {
  const { canvas, activeTool, onToolChange, onLayerAdded, recordHistory } = props;

  const [brushState, setBrushState] = useState<PersistedBrushState>(() =>
    readBrushState(),
  );

  // why: when the user toggles Draw mode on, push the current brush settings
  // onto the canvas immediately. When Draw mode turns off, flip
  // isDrawingMode back. We avoid touching freeDrawingBrush on the
  // off-transition so the cached brush object is still around if the user
  // re-enters Draw without changing settings.
  useEffect(() => {
    if (!canvas) return;
    if (activeTool === "draw") {
      applyBrushToCanvas(canvas, brushState.brush, brushState.color, brushState.width);
      canvas.isDrawingMode = true;
    } else {
      canvas.isDrawingMode = false;
    }
  }, [canvas, activeTool, brushState.brush, brushState.color, brushState.width]);

  // why: whenever the user picks a new stroke, snapshot a history entry so
  // they can undo a stray scribble. Fabric emits `path:created` after each
  // free-drawing stroke commits to the canvas; we listen and record.
  useEffect(() => {
    if (!canvas || activeTool !== "draw") return;
    const handler = (): void => {
      recordHistory?.();
    };
    canvas.on("path:created", handler);
    return () => {
      canvas.off("path:created", handler);
    };
  }, [canvas, activeTool, recordHistory]);

  // why: persist brush state on every change so a reload restores it.
  useEffect(() => {
    writeBrushState(brushState);
  }, [brushState]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handlePickBrush = useCallback(
    (brush: DrawBrush): void => {
      // why: clicking a brush also turns Draw mode ON if it isn't already —
      // matches Canva. If the user clicks the same brush a second time,
      // we toggle Draw OFF (consistent with the rail-button collapse).
      if (activeTool === "draw" && brushState.brush === brush) {
        onToolChange("select");
        return;
      }
      setBrushState((s) => ({ ...s, brush }));
      if (activeTool !== "draw") onToolChange("draw");
    },
    [activeTool, brushState.brush, onToolChange],
  );

  const handleSpawnShape = useCallback(
    (kind: SpawnShapeKind): void => {
      if (!canvas) return;
      // why: exiting Draw mode before a spawn prevents the new shape from
      // getting unintentionally drawn on (Fabric's drawing layer is
      // above the object layer).
      if (activeTool === "draw") onToolChange("select");
      const obj = spawnShapeFromTools(canvas, kind);
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      onLayerAdded(obj);
      recordHistory?.();
    },
    [canvas, activeTool, onToolChange, onLayerAdded, recordHistory],
  );

  const handleSpawnLine = useCallback(
    (kind: SpawnLineKind): void => {
      if (!canvas) return;
      if (activeTool === "draw") onToolChange("select");
      const obj = spawnLineFromTools(canvas, kind);
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      onLayerAdded(obj);
      recordHistory?.();
    },
    [canvas, activeTool, onToolChange, onLayerAdded, recordHistory],
  );

  // why (2026-05-26 — migrated from the deleted floating AddLayerToolbar):
  // generic single-step spawn for the ADD section tiles. Takes a factory
  // closure rather than an enum so future entries (e.g. star, triangle)
  // can reuse the same exit-draw-mode + add + select + record sequence
  // without ballooning the switch statement.
  const handleSpawnObject = useCallback(
    (factory: (c: Canvas) => FabricObject): void => {
      if (!canvas) return;
      if (activeTool === "draw") onToolChange("select");
      const obj = factory(canvas);
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      onLayerAdded(obj);
      recordHistory?.();
    },
    [canvas, activeTool, onToolChange, onLayerAdded, recordHistory],
  );

  const handleAddText = useCallback(
    (kind: AddTextKind): void => {
      handleSpawnObject((c) => spawnAddText(c, kind));
    },
    [handleSpawnObject],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-3">
      {/* ===== ADD (migrated from the deleted floating AddLayerToolbar) =====
          Always-on top section. Three text subtypes + the three primitive
          shapes that used to live in the floating "Add layer" pill. Stays
          visible regardless of the active tool — adding a layer is a
          primary action that shouldn't depend on Draw / Select state. */}
      <Section title="Add">
        <div className="grid grid-cols-3 gap-2">
          <AddTile
            label="Heading"
            sublabel="H1"
            previewFontWeight={700}
            icon={<LHeading size={18} />}
            onClick={() => handleAddText("heading")}
          />
          <AddTile
            label="Subheading"
            sublabel="H2"
            previewFontWeight={600}
            icon={<LHeading2 size={18} />}
            onClick={() => handleAddText("subheading")}
          />
          <AddTile
            label="Paragraph"
            sublabel="P"
            previewFontWeight={400}
            icon={<LPilcrow size={18} />}
            onClick={() => handleAddText("paragraph")}
          />
          <AddTile
            label="Rectangle"
            icon={<LSquare size={18} />}
            onClick={() => handleSpawnObject(spawnRect)}
          />
          <AddTile
            label="Circle"
            icon={<LCircle size={18} />}
            onClick={() => handleSpawnObject(spawnCircle)}
          />
          <AddTile
            label="Line"
            icon={<LMinus size={18} />}
            onClick={() => handleSpawnObject(spawnLine)}
          />
        </div>
      </Section>

      {/* ===== DRAW ===== */}
      <Section title="Draw">
        <div className="grid grid-cols-4 gap-2">
          {(["pen", "marker", "highlighter", "eraser"] as const).map((b) => (
            <BrushButton
              key={b}
              brush={b}
              active={activeTool === "draw" && brushState.brush === b}
              onClick={() => handlePickBrush(b)}
            />
          ))}
        </div>

        {/* Brush color + width controls. We show them ALWAYS (not gated on
            activeTool === "draw") so the user can preconfigure before
            picking a brush — matches Canva. */}
        <div className="mt-3 space-y-3">
          <div>
            <Label>Color</Label>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {BRUSH_COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setBrushState((s) => ({ ...s, color: c }))}
                  aria-label={`Brush color ${c}`}
                  className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                    brushState.color.toLowerCase() === c.toLowerCase()
                      ? "border-gold-500 ring-2 ring-gold-400/40"
                      : "border-[var(--studio-border)]"
                  }`}
                  style={{ background: c }}
                />
              ))}
              {/* Native color picker for custom hex */}
              <label
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-[var(--studio-text-muted)] text-[10px] text-[var(--studio-text-muted)] hover:border-gold-400 hover:text-gold-300"
                title="Custom color"
              >
                +
                <input
                  type="color"
                  value={
                    brushState.color.startsWith("#")
                      ? brushState.color
                      : "#000000"
                  }
                  onChange={(e) =>
                    setBrushState((s) => ({ ...s, color: e.target.value }))
                  }
                  className="absolute h-0 w-0 opacity-0"
                  aria-label="Custom brush color"
                />
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Size</Label>
              <span className="text-[11px] tabular-nums text-[var(--studio-text-muted)]">
                {brushState.width}px
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={40}
              step={1}
              value={brushState.width}
              onChange={(e) =>
                setBrushState((s) => ({ ...s, width: Number(e.target.value) }))
              }
              className="mt-1 w-full accent-gold-500"
            />
          </div>
        </div>
      </Section>

      {/* ===== SHAPES ===== */}
      <Section title="Shapes">
        <div className="grid grid-cols-4 gap-2">
          <ShapeButton
            label="Triangle"
            onClick={() => handleSpawnShape("triangle")}
            icon={<Triangle size={22} fill="currentColor" stroke="none" />}
          />
          <ShapeButton
            label="Triangle down"
            onClick={() => handleSpawnShape("triangle_down")}
            icon={
              <Triangle
                size={22}
                fill="currentColor"
                stroke="none"
                style={{ transform: "rotate(180deg)" }}
              />
            }
          />
          <ShapeButton
            label="Diamond"
            onClick={() => handleSpawnShape("diamond")}
            icon={<Diamond size={22} fill="currentColor" stroke="none" />}
          />
          <ShapeButton
            label="Pentagon"
            onClick={() => handleSpawnShape("pentagon")}
            icon={<Pentagon size={22} fill="currentColor" stroke="none" />}
          />
          <ShapeButton
            label="Star"
            onClick={() => handleSpawnShape("star")}
            icon={<Star size={22} fill="currentColor" stroke="none" />}
          />
          <ShapeButton
            label="Arrow"
            onClick={() => handleSpawnShape("arrow")}
            icon={<ArrowRight size={22} />}
          />
          <ShapeButton
            label="Speech bubble"
            onClick={() => handleSpawnShape("speech_bubble")}
            icon={<MessageCircle size={22} />}
          />
        </div>
      </Section>

      {/* ===== LINES ===== */}
      <Section title="Lines">
        <div className="grid grid-cols-2 gap-2">
          <ShapeButton
            label="Curved"
            onClick={() => handleSpawnLine("curved")}
            icon={<Spline size={26} />}
          />
          <ShapeButton
            label="Elbow"
            onClick={() => handleSpawnLine("elbow")}
            icon={<CornerDownRight size={26} />}
          />
        </div>
      </Section>

      {/* 2026-05-26 — removed the standalone "+ Add a paragraph" Text
          section. Paragraph (along with Heading + Subheading) now lives
          in the ADD section at the top of this panel. */}
    </div>
  );
}

// ===========================================================================
// Color swatches for the brush
// ===========================================================================

const BRUSH_COLOR_SWATCHES = [
  ALLIANCE_COLORS.gold500,
  ALLIANCE_COLORS.ink900,
  "#FFFFFF",
  "#D32F2F",
  "#1976D2",
  "#388E3C",
  "#F57C00",
  "#7B1FA2",
] as const;

// ===========================================================================
// Subcomponents
// ===========================================================================

function Section(props: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function Label(props: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--studio-text-muted)]">
      {props.children}
    </span>
  );
}

function BrushButton(props: {
  brush: DrawBrush;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const label =
    props.brush === "pen"
      ? "Pen"
      : props.brush === "marker"
        ? "Marker"
        : props.brush === "highlighter"
          ? "Highlighter"
          : "Eraser";
  const Icon =
    props.brush === "pen"
      ? Pen
      : props.brush === "marker"
        ? Brush
        : props.brush === "highlighter"
          ? Highlighter
          : Eraser;
  // why: don't wrap brush buttons in Tooltip — they already render the
  // tool name as a label INSIDE the tile (under the icon). A pill
  // hovering on top of an already-labeled button is redundant and
  // visually noisy.
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={label}
      aria-label={label}
      aria-pressed={props.active}
      className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border transition-colors ${
        props.active
          ? "border-gold-500 bg-[var(--studio-active)] text-gold-300"
          : "border-[var(--studio-border)] bg-[var(--studio-input-bg)] text-white hover:border-gold-400 hover:bg-[var(--studio-hover)] hover:text-gold-300"
      }`}
    >
      <Icon size={20} />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

/**
 * 2026-05-26 — ADD-section tile. Icon + label on a dark-themed pill, sized
 * to fit a 3-col grid in the 320-ish-wide Tools panel. Lucide-only icons,
 * white-on-input-bg, hover surfaces the gold accent so the affordance
 * reads as "click to add to canvas" without needing extra copy.
 *
 * `sublabel` and `previewFontWeight` are optional — when both are supplied
 * the tile renders the sublabel ("H1"/"H2"/"P") with the matching weight
 * so the three text tiles preview their own typographic hierarchy. Shape
 * tiles omit them and just show icon + name.
 */
function AddTile(props: {
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  sublabel?: string;
  previewFontWeight?: number;
}): JSX.Element {
  return (
    <Tooltip label={`Add ${props.label.toLowerCase()}`} wrapperClassName="w-full">
      <button
        type="button"
        onClick={props.onClick}
        aria-label={`Add ${props.label}`}
        className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-input-bg)] text-white transition-colors hover:border-gold-400 hover:bg-[var(--studio-hover)] hover:text-gold-300"
      >
        {props.sublabel ? (
          <span
            className="text-base leading-none"
            style={{ fontWeight: props.previewFontWeight ?? 600 }}
          >
            {props.sublabel}
          </span>
        ) : (
          props.icon
        )}
        <span className="text-[10px] font-medium leading-none">
          {props.label}
        </span>
      </button>
    </Tooltip>
  );
}

function ShapeButton(props: {
  label: string;
  icon: JSX.Element;
  onClick: () => void;
}): JSX.Element {
  // why: shape buttons ARE icon-only — wrap in Tooltip so the user
  // knows "is this the diamond or the pentagon?" without clicking.
  // wrapperClassName="w-full" so the button's aspect-square sees its
  // grid cell's full width (default inline-flex would collapse it).
  return (
    <Tooltip label={props.label} wrapperClassName="w-full">
      <button
        type="button"
        onClick={props.onClick}
        title={props.label}
        aria-label={props.label}
        className="flex aspect-square w-full items-center justify-center rounded-lg border border-[var(--studio-border)] bg-[var(--studio-input-bg)] text-white transition-colors hover:border-gold-400 hover:bg-[var(--studio-hover)] hover:text-gold-300"
      >
        {props.icon}
      </button>
    </Tooltip>
  );
}

// ===========================================================================
// Icons — Lucide
// ===========================================================================
//
// 2026-05-26 — all 12 inline-SVG glyphs were replaced with their Lucide
// equivalents (Pen / Brush / Highlighter / Eraser / Triangle / Diamond /
// Pentagon / Star / ArrowRight / MessageCircle / Spline / CornerDownRight).
// The closed-shape tiles (Triangle / Diamond / Pentagon / Star) override
// stroke to none + fill currentColor so they read as filled silhouettes
// like the originals. Lines + open icons (ArrowRight, MessageCircle,
// Spline, CornerDownRight) render with default stroke for legibility.
