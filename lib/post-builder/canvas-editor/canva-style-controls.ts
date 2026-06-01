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

/** Brand — Relentless Gold. Single source of truth for the gold accent. */
export const BRAND_GOLD = "#C9A84C";

/** Brand — Obsessed Grey. Single source of truth for the brand dark. */
export const BRAND_OBSESSED = "#252526";

// 2026-05-31 (John) — the handles were nearly invisible: a white fill blended
// into cream/gold templates and the 2px stroke was too thin to read. Tripled
// every size and inverted the look to a SOLID violet fill with a bold white
// ring, so the corner circles and side handles pop on any background.
// 2026-05-31: John found the 3x-larger handles too big. Halved every size
// (keeping the violet fill + white ring + connector line he liked). These land
// at ~1.5x the original pre-enlargement sizes — visible but not bulky.
/** Diameter (px) of corner circles in canvas-space, post-zoom. */
const CORNER_SIZE = 24;
/** Width of side capsule pills along their thin axis (px). */
const PILL_THICKNESS = 12;
/** Length of side capsule pills along their long axis (px). */
const PILL_LENGTH = 42;
/** Diameter of the rotation handle (px) — smaller to read as secondary. */
const ROTATION_SIZE = 14;

/** Handle fill — solid violet so the control reads as a bold blob (was white). */
const HANDLE_FILL = CANVA_VIOLET;
/** Handle outline — a white ring for contrast on dark photos / bands. */
const HANDLE_STROKE = "#FFFFFF";
/** Handle outline width (px). */
const HANDLE_STROKE_WIDTH = 3;

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
  ctx.fillStyle = HANDLE_FILL;
  ctx.strokeStyle = HANDLE_STROKE;
  ctx.lineWidth = HANDLE_STROKE_WIDTH;
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
  ctx.fillStyle = HANDLE_FILL;
  ctx.strokeStyle = HANDLE_STROKE;
  ctx.lineWidth = HANDLE_STROKE_WIDTH;
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
  ctx.fillStyle = HANDLE_FILL;
  ctx.strokeStyle = HANDLE_STROKE;
  ctx.lineWidth = HANDLE_STROKE_WIDTH;
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

// ---------------------------------------------------------------------------
// Native-crop edge handlers (2026-05-31)
// ---------------------------------------------------------------------------
//
// For images framed with Fabric's native crop, the edge midpoint handles
// (ml/mr/mt/mb) TRIM the frame (cut off) instead of scaling — exactly Canva's
// crop behavior. They change the image's `width`/`height` (the cropped region,
// in element px) and shift `cropX`/`cropY` so the OPPOSITE edge's content stays
// pinned. Corner handles keep proportional scaling (no distortion).
//
// Modeled on Fabric's `changeObjectWidth`: getLocalPoint gives the pointer in
// the object's local (scaled) frame relative to the fixed anchor; dividing by
// scale yields element px. wrapWithFixedAnchor pins the opposite edge.

const MIN_CROP_PX = 8;

function naturalSizeOf(img: unknown): { w: number; h: number } {
  const getEl = (img as { getElement?: () => unknown }).getElement;
  const el = typeof getEl === "function" ? getEl.call(img) : null;
  if (el && typeof el === "object") {
    const e = el as {
      naturalWidth?: number;
      naturalHeight?: number;
      width?: number;
      height?: number;
    };
    const w = e.naturalWidth || e.width || 0;
    const h = e.naturalHeight || e.height || 0;
    if (w > 0 && h > 0) return { w, h };
  }
  const f = img as { width?: number; height?: number };
  return { w: f.width || 1, h: f.height || 1 };
}

const cropResizeInner = (
  _eventData: unknown,
  transform: {
    target: unknown;
    corner: string;
    originX: unknown;
    originY: unknown;
  },
  x: number,
  y: number,
): boolean => {
  const target = transform.target as {
    width: number;
    height: number;
    scaleX?: number;
    scaleY?: number;
    cropX?: number;
    cropY?: number;
    set: (k: string | Record<string, unknown>, v?: unknown) => void;
    getElement?: () => unknown;
  };
  const local = (
    controlsUtils as unknown as {
      getLocalPoint: (
        t: unknown,
        ox: unknown,
        oy: unknown,
        x: number,
        y: number,
      ) => { x: number; y: number };
    }
  ).getLocalPoint(transform, transform.originX, transform.originY, x, y);
  const nat = naturalSizeOf(target);
  const corner = transform.corner;

  if (corner === "mr" || corner === "ml") {
    const scaleX = target.scaleX || 1;
    const oldW = target.width;
    const cropX = target.cropX || 0;
    let newW = Math.abs(local.x / scaleX);
    if (corner === "mr") {
      // right edge dragged, left pinned (cropX unchanged); reveal up to the
      // photo's right edge.
      newW = Math.max(MIN_CROP_PX, Math.min(newW, nat.w - cropX));
      target.set("width", newW);
    } else {
      // left edge dragged, right element-edge (cropX+width) pinned.
      const rightEdge = cropX + oldW;
      newW = Math.max(MIN_CROP_PX, Math.min(newW, rightEdge));
      target.set({ width: newW, cropX: rightEdge - newW });
    }
    return oldW !== target.width;
  }
  if (corner === "mt" || corner === "mb") {
    const scaleY = target.scaleY || 1;
    const oldH = target.height;
    const cropY = target.cropY || 0;
    let newH = Math.abs(local.y / scaleY);
    if (corner === "mb") {
      // bottom edge dragged, top pinned (cropY unchanged) → cut off the bottom.
      newH = Math.max(MIN_CROP_PX, Math.min(newH, nat.h - cropY));
      target.set("height", newH);
    } else {
      // top edge dragged, bottom element-edge pinned.
      const bottomEdge = cropY + oldH;
      newH = Math.max(MIN_CROP_PX, Math.min(newH, bottomEdge));
      target.set({ height: newH, cropY: bottomEdge - newH });
    }
    return oldH !== target.height;
  }
  return false;
};

const cropResizeHandler = (
  controlsUtils as unknown as {
    wrapWithFireEvent: (n: string, h: unknown) => unknown;
    wrapWithFixedAnchor: (h: unknown) => unknown;
  }
).wrapWithFireEvent(
  "resizing",
  (
    controlsUtils as unknown as { wrapWithFixedAnchor: (h: unknown) => unknown }
  ).wrapWithFixedAnchor(cropResizeInner),
);

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
export function createCanvaStyleControls(options?: {
  /**
   * When true, the side midpoint handles (ml/mr/mt/mb) scale UNIFORMLY
   * instead of single-axis. Used for image layers: a one-axis scale
   * stretches the photo (and the object:modified clipPath rebuild bakes
   * that distortion in). Corners already scale equally; this makes the
   * sides safe too, so a photo can never be distorted by a frame drag.
   */
  uniformSides?: boolean;
  /**
   * When true (TEXT layers), the left/right midpoint handles change the box
   * WIDTH (text reflows inside) instead of single-axis scaling, and the
   * top/bottom handles are removed entirely. Single-axis scaling physically
   * stretches/squishes the glyphs (the bug John reported); width-resize +
   * corner uniform-scale never distort the letters. The corner handles keep
   * scalingEqually (proportional) and the object:modified handler bakes that
   * uniform scale back into fontSize so the readout stays honest.
   */
  textResize?: boolean;
  /**
   * When true (IMAGE layers with native crop), the side midpoint handles
   * TRIM the frame (cut off) by changing the cropped width/height + cropX/cropY
   * instead of scaling the photo. Corners still scale proportionally. This is
   * Canva's crop behavior — drag the bottom-center handle to cut off the bottom
   * of the photo without stretching it.
   */
  imageCrop?: boolean;
}): Record<string, Control> {
  // Generous hit areas: 24x24 for corners and pills so the user has a
  // comfortable click target. Visual size stays at CORNER_SIZE /
  // PILL_LENGTH × PILL_THICKNESS.
  const cornerHit = 26;
  const pillHitThick = 16;
  const pillHitLong = 44;

  // 2026-05-29 — side-handle action depends on caller. Images pass
  // uniformSides so dragging a side scales the whole photo proportionally
  // (no distortion); text/shapes keep the single-axis scale/skew.
  const uniform = options?.uniformSides === true;
  const textResize = options?.textResize === true;
  const imageCrop = options?.imageCrop === true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cropAction = cropResizeHandler as any;
  // Images: side handles TRIM (native crop). Text: left/right resize box width
  // (reflow). Otherwise scale (uniform for the old image path, single-axis for
  // shapes).
  const sideXAction = imageCrop
    ? cropAction
    : textResize
      ? controlsUtils.changeWidth
      : uniform
        ? controlsUtils.scalingEqually
        : controlsUtils.scalingXOrSkewingY;
  const sideYAction = imageCrop
    ? cropAction
    : uniform
      ? controlsUtils.scalingEqually
      : controlsUtils.scalingYOrSkewingX;

  const controls: Record<string, Control> = {
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
      actionHandler: sideXAction,
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
      actionHandler: sideXAction,
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
      actionHandler: sideYAction,
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
      actionHandler: sideYAction,
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

  // Text boxes auto-fit their height to the content, so a top/bottom handle
  // can only mean a vertical-only scale — which stretches the glyphs. Remove
  // them for text; width (ml/mr) + proportional corners cover every real need.
  if (textResize) {
    delete controls.mt;
    delete controls.mb;
  }

  return controls;
}
