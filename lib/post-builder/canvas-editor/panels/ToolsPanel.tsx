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
  type Canvas,
  type FabricObject,
  PencilBrush,
  Path,
  Polygon,
  Polyline,
  Textbox,
} from "fabric";
import { type JSX, useCallback, useEffect, useState } from "react";

import { setLayerData } from "../fabric-factory";
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

  const handleSpawnText = useCallback((): void => {
    if (!canvas) return;
    if (activeTool === "draw") onToolChange("select");
    const obj = spawnTextFromTools(canvas);
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    onLayerAdded(obj);
    recordHistory?.();
  }, [canvas, activeTool, onToolChange, onLayerAdded, recordHistory]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-3">
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
                      ? "border-gold-500 ring-2 ring-gold-300"
                      : "border-neutral-300"
                  }`}
                  style={{ background: c }}
                />
              ))}
              {/* Native color picker for custom hex */}
              <label
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-neutral-400 text-[10px] text-neutral-500 hover:border-gold-500 hover:text-gold-600"
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
              <span className="text-[11px] tabular-nums text-neutral-500">
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
            icon={<TriangleGlyph />}
          />
          <ShapeButton
            label="Triangle down"
            onClick={() => handleSpawnShape("triangle_down")}
            icon={<TriangleDownGlyph />}
          />
          <ShapeButton
            label="Diamond"
            onClick={() => handleSpawnShape("diamond")}
            icon={<DiamondGlyph />}
          />
          <ShapeButton
            label="Pentagon"
            onClick={() => handleSpawnShape("pentagon")}
            icon={<PentagonGlyph />}
          />
          <ShapeButton
            label="Star"
            onClick={() => handleSpawnShape("star")}
            icon={<StarGlyph />}
          />
          <ShapeButton
            label="Arrow"
            onClick={() => handleSpawnShape("arrow")}
            icon={<ArrowGlyph />}
          />
          <ShapeButton
            label="Speech bubble"
            onClick={() => handleSpawnShape("speech_bubble")}
            icon={<SpeechBubbleGlyph />}
          />
        </div>
        <p className="mt-2 text-[10px] leading-tight text-neutral-400">
          Square, circle, and straight line live in the top toolbar.
        </p>
      </Section>

      {/* ===== LINES ===== */}
      <Section title="Lines">
        <div className="grid grid-cols-2 gap-2">
          <ShapeButton
            label="Curved"
            onClick={() => handleSpawnLine("curved")}
            icon={<CurvedLineGlyph />}
          />
          <ShapeButton
            label="Elbow"
            onClick={() => handleSpawnLine("elbow")}
            icon={<ElbowLineGlyph />}
          />
        </div>
      </Section>

      {/* ===== TEXT ===== */}
      <Section title="Text">
        <button
          type="button"
          onClick={handleSpawnText}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-3 text-left text-sm font-semibold text-neutral-800 transition-colors hover:border-gold-500 hover:bg-gold-50 hover:text-gold-700"
        >
          + Add a paragraph
        </button>
      </Section>
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
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function Label(props: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
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
      ? PenGlyph
      : props.brush === "marker"
        ? MarkerGlyph
        : props.brush === "highlighter"
          ? HighlighterGlyph
          : EraserGlyph;
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={label}
      aria-label={label}
      aria-pressed={props.active}
      className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border transition-colors ${
        props.active
          ? "border-gold-500 bg-gold-50 text-gold-700"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-gold-300 hover:bg-gold-50"
      }`}
    >
      <Icon />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

function ShapeButton(props: {
  label: string;
  icon: JSX.Element;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.label}
      aria-label={props.label}
      className="flex aspect-square items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700 transition-colors hover:border-gold-500 hover:bg-gold-50 hover:text-gold-700"
    >
      {props.icon}
    </button>
  );
}

// ===========================================================================
// Inline SVG glyphs
// ===========================================================================
//
// Conventions follow the rest of canvas-editor/ — inline SVG, currentColor
// fills, viewBox 0 0 24 24 for the tool icons (24 px reads cleanly inside
// the 56-px aspect-square buttons).
// ---------------------------------------------------------------------------

function PenGlyph(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

function MarkerGlyph(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l-5 5v3h3l5-5" />
      <path d="M14 6l4-4 4 4-4 4" />
      <path d="M9 11l4-4 4 4-4 4" />
    </svg>
  );
}

function HighlighterGlyph(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l-4 9h6l3-3" />
      <path d="M15 6l3 3-9 9-3-3 9-9z" />
      <path d="M17 4l3 3" />
    </svg>
  );
}

function EraserGlyph(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17l6 6h12" />
      <path d="M9 17l8-8a2.828 2.828 0 114 4l-8 8" />
      <path d="M14 7l4 4" />
    </svg>
  );
}

function TriangleGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 4 L22 20 L2 20 Z" />
    </svg>
  );
}

function TriangleDownGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 4 L22 4 L12 20 Z" />
    </svg>
  );
}

function DiamondGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3 L21 12 L12 21 L3 12 Z" />
    </svg>
  );
}

function PentagonGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3 L22 10 L18 21 L6 21 L2 10 Z" />
    </svg>
  );
}

function StarGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3 L14.6 9.8 L22 10.3 L16.3 14.9 L18.2 22 L12 18 L5.8 22 L7.7 14.9 L2 10.3 L9.4 9.8 Z" />
    </svg>
  );
}

function ArrowGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 10 L14 10 L14 6 L22 12 L14 18 L14 14 L2 14 Z" />
    </svg>
  );
}

function SpeechBubbleGlyph(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 4 H20 a2 2 0 0 1 2 2 V14 a2 2 0 0 1 -2 2 H10 L5 21 V16 H4 a2 2 0 0 1 -2 -2 V6 a2 2 0 0 1 2 -2 Z" />
    </svg>
  );
}

function CurvedLineGlyph(): JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 18 Q 12 4 21 18" />
    </svg>
  );
}

function ElbowLineGlyph(): JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5 L3 18 L21 18" />
    </svg>
  );
}
