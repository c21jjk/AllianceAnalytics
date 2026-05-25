/**
 * Canva-style selection controls.
 * --------------------------------------------------------------------------
 *
 * Replaces Fabric's default control set (uniform circles on every anchor
 * point) with a Canva-matched set:
 *
 *   • Corners (tl, tr, bl, br) — large filled circles, 16px diameter.
 *   • Side midpoints (ml, mr) — vertical capsule "pills", short width
 *     and taller height. Same rotated 90° for top/bottom (mt, mb).
 *   • Rotation handle (mtr) — small circle anchored above the top edge,
 *     drawn smaller than the corners to read as a secondary affordance.
 *
 * All controls share the violet fill `#8B5CF6` with a 2px white stroke
 * so they stand out against any photo background. The selection border
 * uses the same violet at `borderScaleFactor: 2` for a confident frame
 * weight.
 *
 * Apply via `obj.controls = createCanvaStyleControls()` after construction.
 *
 * Why a module-level constant + factory: every Fabric object needs its
 * OWN controls object (mutations on one shouldn't leak across instances).
 * The factory returns a fresh `controls` map each call, but the renderer
 * functions are stable references shared across all instances — Fabric
 * only reads `render` per draw; it doesn't mutate it.
 */
import { Control, controlsUtils } from "fabric";

/** Canva-matched violet for borders + control fills. */
export const CANVA_VIOLET = "#8B5CF6";

/** Diameter (px) of corner circles in canvas-space, post-zoom. */
const CORNER_SIZE = 16;
/** Width of side capsule pills along their thin axis (px). */
const PILL_THICKNESS = 8;
/** Length of side capsule pills along their long axis (px). */
const PILL_LENGTH = 28;
/** Diameter of the rotation handle (px) — smaller to read as secondary. */
const ROTATION_SIZE = 12;

// ---------------------------------------------------------------------------
// Renderers — drawn into the canvas 2D context
// ---------------------------------------------------------------------------
//
// Signature follows Fabric v6's Control.render contract:
//   render(ctx, left, top, styleOverride, fabricObject)
// where (left, top) are absolute canvas coordinates of the control's anchor.

/** Draw a filled white-stroked circle for corner / rotation handles. */
function renderCornerCircle(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  _styleOverride: unknown,
  _obj: unknown,
  size: number = CORNER_SIZE,
): void {
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = CANVA_VIOLET;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(left, top, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a vertical capsule pill (thin × tall). Used on left + right side
 * midpoints — the pill's long axis aligns with the object's vertical
 * edge so the user reads "drag this to resize the WIDTH".
 */
function renderPillVertical(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  _styleOverride: unknown,
  _obj: unknown,
): void {
  const w = PILL_THICKNESS;
  const h = PILL_LENGTH;
  const r = w / 2;
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = CANVA_VIOLET;
  ctx.lineWidth = 2;
  // Build a rounded rect manually — roundRect isn't reliable across all
  // browser canvas implementations until Chrome 99/Safari 16. We use
  // four arcs + two lines for max compat. Centered on (left, top).
  const x = left - w / 2;
  const y = top - h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a horizontal capsule pill (wide × short). Used on top + bottom
 * midpoints.
 */
function renderPillHorizontal(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  _styleOverride: unknown,
  _obj: unknown,
): void {
  const w = PILL_LENGTH;
  const h = PILL_THICKNESS;
  const r = h / 2;
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = CANVA_VIOLET;
  ctx.lineWidth = 2;
  const x = left - w / 2;
  const y = top - h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Smaller rotation handle — same shape as corners, half the size. */
function renderRotationCircle(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  styleOverride: unknown,
  obj: unknown,
): void {
  renderCornerCircle(ctx, left, top, styleOverride, obj, ROTATION_SIZE);
}

// ---------------------------------------------------------------------------
// Factory — returns a fresh `controls` map for one Fabric object
// ---------------------------------------------------------------------------

/**
 * Returns a fresh controls map matching Canva's selection look.
 * Apply via `fabricObject.controls = createCanvaStyleControls();`
 *
 * The Fabric Control constructor takes:
 *   x, y           — normalized -0.5..0.5 anchor on the object's bbox.
 *   offsetX/Y      — pixel offset on top of x/y (for the rotation handle's
 *                    "floating above the top edge" offset).
 *   cursorStyle    — what cursor the browser shows on hover.
 *   actionHandler  — Fabric utility that performs the drag transform
 *                    (scaling, skewing, rotation).
 *   render         — our custom drawing function.
 *   sizeX, sizeY   — HIT area (separate from visual size). We make
 *                    these slightly larger than the visual to give the
 *                    user generous click targets.
 *   touchSizeX/Y   — same for touch devices.
 */
export function createCanvaStyleControls(): Record<string, Control> {
  // Generous hit areas: 24x24 for corners and pills so the user has a
  // comfortable click target. Visual size stays at CORNER_SIZE /
  // PILL_LENGTH × PILL_THICKNESS.
  const cornerHit = 24;
  const pillHitThick = 16;
  const pillHitLong = 32;

  return {
    // ---- corners ----
    tl: new Control({
      x: -0.5,
      y: -0.5,
      actionHandler: controlsUtils.scalingEqually,
      cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
      render: renderCornerCircle,
      sizeX: cornerHit,
      sizeY: cornerHit,
      touchSizeX: cornerHit,
      touchSizeY: cornerHit,
    }),
    tr: new Control({
      x: 0.5,
      y: -0.5,
      actionHandler: controlsUtils.scalingEqually,
      cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
      render: renderCornerCircle,
      sizeX: cornerHit,
      sizeY: cornerHit,
      touchSizeX: cornerHit,
      touchSizeY: cornerHit,
    }),
    bl: new Control({
      x: -0.5,
      y: 0.5,
      actionHandler: controlsUtils.scalingEqually,
      cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
      render: renderCornerCircle,
      sizeX: cornerHit,
      sizeY: cornerHit,
      touchSizeX: cornerHit,
      touchSizeY: cornerHit,
    }),
    br: new Control({
      x: 0.5,
      y: 0.5,
      actionHandler: controlsUtils.scalingEqually,
      cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
      render: renderCornerCircle,
      sizeX: cornerHit,
      sizeY: cornerHit,
      touchSizeX: cornerHit,
      touchSizeY: cornerHit,
    }),
    // ---- side midpoints (pills) ----
    ml: new Control({
      x: -0.5,
      y: 0,
      actionHandler: controlsUtils.scalingXOrSkewingY,
      cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
      render: renderPillVertical,
      sizeX: pillHitThick,
      sizeY: pillHitLong,
      touchSizeX: pillHitThick,
      touchSizeY: pillHitLong,
    }),
    mr: new Control({
      x: 0.5,
      y: 0,
      actionHandler: controlsUtils.scalingXOrSkewingY,
      cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
      render: renderPillVertical,
      sizeX: pillHitThick,
      sizeY: pillHitLong,
      touchSizeX: pillHitThick,
      touchSizeY: pillHitLong,
    }),
    mt: new Control({
      x: 0,
      y: -0.5,
      actionHandler: controlsUtils.scalingYOrSkewingX,
      cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
      render: renderPillHorizontal,
      sizeX: pillHitLong,
      sizeY: pillHitThick,
      touchSizeX: pillHitLong,
      touchSizeY: pillHitThick,
    }),
    mb: new Control({
      x: 0,
      y: 0.5,
      actionHandler: controlsUtils.scalingYOrSkewingX,
      cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
      render: renderPillHorizontal,
      sizeX: pillHitLong,
      sizeY: pillHitThick,
      touchSizeX: pillHitLong,
      touchSizeY: pillHitThick,
    }),
    // ---- rotation ----
    // Floats 28px above the top edge (in canvas px). Smaller circle so
    // it reads as a separate, less-prominent affordance vs corners.
    mtr: new Control({
      x: 0,
      y: -0.5,
      offsetY: -28,
      actionHandler: controlsUtils.rotationWithSnapping,
      cursorStyleHandler: controlsUtils.rotationStyleHandler,
      render: renderRotationCircle,
      sizeX: ROTATION_SIZE + 8,
      sizeY: ROTATION_SIZE + 8,
      withConnection: true,
    }),
  };
}
