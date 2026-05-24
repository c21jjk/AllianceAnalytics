"use client";

/**
 * AddLayerToolbar — Phase 2 floating toolbar at the top of the canvas area.
 * ------------------------------------------------------------------------
 *
 * A pill-shaped toolbar that exposes four primary "add a layer" affordances:
 * Text, Rectangle, Circle, Line. Sits above the canvas surface inside the
 * editor body so it remains visible regardless of selection state — adding a
 * new layer is a primary action that should never be hidden behind selection.
 *
 * Why a separate component rather than baking these buttons into CanvasEditor:
 *   • Phase 2 split. Three agents (A: properties panel, B: this + history,
 *     C: layer list) work in parallel against a contracts file. Keeping the
 *     toolbar standalone lets the orchestrator wire it without coupling.
 *   • Future expansion. Phase 3+ will add more entry points (right-click,
 *     "/" command palette). Centralizing the Fabric object factories here
 *     so they can be re-used keeps the spawn-defaults in one place.
 *
 * Why inline SVG icons rather than a lib:
 *   The wider editor uses inline SVG (see CanvasEditor.tsx SECTION 5 comment).
 *   Matching that convention keeps the bundle lean and lets icon color follow
 *   currentColor — no per-icon prop plumbing needed.
 */

import {
  Circle as FabricCircle,
  type FabricObject,
  Line as FabricLine,
  Rect as FabricRect,
  Textbox,
} from "fabric";
import { type JSX } from "react";

import {
  ADD_LAYER_DEFAULTS,
  type AddLayerKind,
  type AddLayerToolbarProps,
} from "../contracts";
// Phase 2J (2026-05-22): switched from local copies of setLayerData +
// FabricLayerData to the shared fabric-factory module. Eliminates the
// "kept in sync by hand" caveat that was here before — both the editor's
// hydration path and this toolbar's new-layer creation now write through
// the same helper, so layer metadata is shaped identically across surfaces.
import {
  setLayerData,
  type FabricLayerData,
} from "../fabric-factory";
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "../templates/tokens";

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

/**
 * Generate a unique layer id for a user-added layer.
 *
 * Why timestamp + random: cryptographic randomness isn't required (the id is
 * not a security boundary), and `crypto.randomUUID()` isn't always available
 * in older WebViews. Date.now() + a random suffix gives ample collision
 * resistance for the small lifetime of an editing session.
 */
function makeLayerId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

// ---------------------------------------------------------------------------
// Fabric object factories (per AddLayerKind)
// ---------------------------------------------------------------------------

/**
 * Compute the center of the canvas in its own logical coordinate space.
 * Falls back to (0,0) when the canvas reports null dimensions during init.
 *
 * Why centered defaults: a layer dropped at (0,0) sits in the top-left and
 * is easy to miss on a 1080×1350 canvas. Centering puts the new object on
 * the user's first eye-line.
 */
function getCanvasCenter(canvas: NonNullable<AddLayerToolbarProps["canvas"]>): {
  cx: number;
  cy: number;
} {
  const w = canvas.getWidth() ?? 0;
  const h = canvas.getHeight() ?? 0;
  return { cx: w / 2, cy: h / 2 };
}

// why: exported (2026-05-23) so the Tools-panel keyboard-shortcut dispatcher
// can reuse the EXACT same spawn defaults as the toolbar buttons. Without
// export, T/R/O/L would diverge from the toolbar in subtle ways (font,
// color, size) over time.
export function spawnText(
  canvas: NonNullable<AddLayerToolbarProps["canvas"]>,
): FabricObject {
  const { cx, cy } = getCanvasCenter(canvas);
  const id = makeLayerId("user_text");
  // why: width is taken from the shared default; height auto-sizes to the
  // wrapped text. originX/originY=center keeps the textbox visually centered
  // around (cx, cy) even though Fabric's `left`/`top` semantics shift.
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

export function spawnRect(
  canvas: NonNullable<AddLayerToolbarProps["canvas"]>,
): FabricObject {
  const { cx, cy } = getCanvasCenter(canvas);
  const id = makeLayerId("user_rect");
  const size = ADD_LAYER_DEFAULTS.shapeSize;
  // why: originX/originY=center so the rect's logical center sits on (cx, cy),
  // matching the visual expectation when the user clicks "Add Rectangle".
  const rect = new FabricRect({
    left: cx,
    top: cy,
    width: size,
    height: size,
    originX: "center",
    originY: "center",
    fill: ALLIANCE_COLORS.gold500,
    // why: no stroke per spec — fill-only by default. User can add a stroke
    // via the properties panel (Agent A).
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

export function spawnCircle(
  canvas: NonNullable<AddLayerToolbarProps["canvas"]>,
): FabricObject {
  const { cx, cy } = getCanvasCenter(canvas);
  const id = makeLayerId("user_circle");
  // why: radius=100 => 200×200 bounding box, matching the rect default so the
  // two shape primitives feel like siblings.
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

export function spawnLine(
  canvas: NonNullable<AddLayerToolbarProps["canvas"]>,
): FabricObject {
  const { cx, cy } = getCanvasCenter(canvas);
  const id = makeLayerId("user_line");
  const len = ADD_LAYER_DEFAULTS.lineLength;
  // why: Fabric Line takes [x1, y1, x2, y2] as constructor arg. We center the
  // line around (cx, cy) by anchoring its endpoints symmetrically left/right.
  // We do NOT set originX/originY=center here — Fabric Line computes its
  // origin from the supplied endpoints, and overriding the origin shifts the
  // visible line away from where we placed it.
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

// why: discriminated dispatch on AddLayerKind. The compiler keeps us honest if
// a new kind is added to the union without a corresponding spawn function.
function spawnByKind(
  kind: AddLayerKind,
  canvas: NonNullable<AddLayerToolbarProps["canvas"]>,
): FabricObject {
  switch (kind) {
    case "text":
      return spawnText(canvas);
    case "rect":
      return spawnRect(canvas);
    case "circle":
      return spawnCircle(canvas);
    case "line":
      return spawnLine(canvas);
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ToolbarButtonSpec {
  kind: AddLayerKind;
  label: string;
  icon: JSX.Element;
}

export function AddLayerToolbar(props: AddLayerToolbarProps): JSX.Element {
  const { canvas, onLayerAdded, recordHistory } = props;

  // why: button specs declared once so the JSX loop stays compact. Each entry
  // declares its kind discriminator + tooltip + the inline SVG glyph.
  const buttons: ReadonlyArray<ToolbarButtonSpec> = [
    { kind: "text", label: "Add text", icon: <AddTextGlyph /> },
    { kind: "rect", label: "Add rectangle", icon: <AddRectGlyph /> },
    { kind: "circle", label: "Add circle", icon: <AddCircleGlyph /> },
    { kind: "line", label: "Add line", icon: <AddLineGlyph /> },
  ];

  const handleAdd = (kind: AddLayerKind): void => {
    if (!canvas) return;
    const obj = spawnByKind(kind, canvas);
    canvas.add(obj);
    // why: select the new object immediately so the user can drag/resize/edit
    // without an extra click. Matches Canva's "drop and grab" UX.
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    // why: notify the orchestrator BEFORE recording history — it may want to
    // bump layerVersion etc. before the snapshot, though in practice the
    // snapshot uses Fabric state which is already mutated by canvas.add().
    onLayerAdded(obj);
    recordHistory?.();
  };

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1.5 shadow-card"
      role="toolbar"
      aria-label="Add layer toolbar"
    >
      {buttons.map((b) => (
        <button
          key={b.kind}
          type="button"
          onClick={() => handleAdd(b.kind)}
          disabled={canvas === null}
          aria-label={b.label}
          title={b.label}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-gold-50 hover:text-gold-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {b.icon}
        </button>
      ))}
    </div>
  );
}

export default AddLayerToolbar;

// ===========================================================================
// Inline SVG icon glyphs
// ===========================================================================
//
// Why kept in this file rather than a shared icons module: these are the only
// four glyphs unique to the AddLayerToolbar. Inlining them keeps the toolbar
// self-contained and avoids a second import path for the orchestrator to
// stub during tests.
// ---------------------------------------------------------------------------

function AddTextGlyph(): JSX.Element {
  // why: render the letter T directly — it's universally recognized as "add
  // text" in design tools (Figma, Canva, Photoshop all use this). Cleaner
  // than approximating a serif T via path strokes.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 4.5V3.5h11v1" />
      <path d="M9 3.5v11" />
      <path d="M6.5 14.5h5" />
    </svg>
  );
}

function AddRectGlyph(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="12" height="12" rx="1" />
    </svg>
  );
}

function AddCircleGlyph(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6" />
    </svg>
  );
}

function AddLineGlyph(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 9h12" />
    </svg>
  );
}
