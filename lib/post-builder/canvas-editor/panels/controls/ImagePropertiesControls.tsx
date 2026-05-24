"use client";

/**
 * ImagePropertiesControls — Phase 2, Agent A
 * --------------------------------------------
 *
 * Properties panel for an active Fabric Image. Provides:
 *   • A "Swap photo" thumbnail grid wired to listing.photos[] (up to 5)
 *   • An object-fit toggle (cover / contain / stretch)
 *   • Corner radius slider
 *   • Opacity slider
 *
 * Photo swapping uses `img.setSrc(url, { crossOrigin: "anonymous" })` per the
 * Fabric v6 API. After load, we re-apply the object-fit scaling against the
 * new natural dimensions so the user doesn't see a sudden zoom/crop change.
 *
 * Corner radius is implemented via a Rect clipPath on the image — matching
 * the approach used in CanvasEditor.tsx's createFabricImage factory. We
 * REPLACE the clipPath on each change rather than mutating an existing one
 * because the clip dimensions depend on the image's natural width/height.
 */

import { FabricImage, Rect } from "fabric";
import type { Canvas } from "fabric";
import {
  type ChangeEvent,
  type JSX,
  useCallback,
  useEffect,
  useState,
} from "react";

import type { MLSListingPayload } from "../../types";

interface ImagePropertiesControlsProps {
  canvas: Canvas | null;
  listing: MLSListingPayload | null;
  selectionVersion: number;
  onCanvasMutated?: () => void;
  recordHistory?: () => void;
}

/**
 * Local mirror of the active Image's editable state.
 */
interface ImageState {
  /** Current src URL — used to highlight the active thumbnail in the swap grid. */
  src: string;
  /** Derived object-fit setting. We persist this as image meta on a custom prop. */
  objectFit: "cover" | "contain" | "stretch";
  /** Corner radius in display px. */
  cornerRadius: number;
  /** 0..1 opacity from Fabric. */
  opacity: number;
  /**
   * The image's CURRENT displayed dimensions (= naturalDim * scale). These
   * are what the user sees on screen RIGHT NOW. Distinct from box dims
   * (below) because the displayed image may overflow / be letterboxed
   * inside the box depending on object-fit.
   */
  targetWidth: number;
  targetHeight: number;
  /**
   * The image layer's BOX dimensions — what the template author specified
   * (or what the user has resized to). Object-fit math runs against THIS,
   * not the displayed dims. Read from the Fabric object's data bag and
   * falls back to displayed dims for pre-fix images.
   *
   * Why this exists: prior to 2026-05-23, the code derived "target" dims
   * from naturalDim × scale, which meant Cover/Contain/Stretch always
   * computed scale = currentScale (no-op). Tracking the box separately
   * breaks the circular reference.
   */
  boxWidth: number;
  boxHeight: number;
  /** Natural image dimensions — used when computing the new scale on fit change. */
  naturalWidth: number;
  naturalHeight: number;
}

const FIT_OPTIONS: ReadonlyArray<{
  value: ImageState["objectFit"];
  label: string;
}> = [
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "stretch", label: "Stretch" },
];

/**
 * Read the image's natural dimensions out of its underlying HTMLImageElement.
 * Fabric exposes the element via `.getElement()`. When the element is a video
 * or canvas (Fabric.Image accepts both), we fall back to `width`/`height` on
 * the FabricImage itself.
 */
function readNaturalSize(img: FabricImage): {
  naturalWidth: number;
  naturalHeight: number;
} {
  // why: getElement() can return an HTMLImageElement | HTMLVideoElement |
  // HTMLCanvasElement. Only HTMLImageElement carries naturalWidth/Height.
  const el = img.getElement?.();
  if (el && el instanceof HTMLImageElement) {
    return {
      naturalWidth: el.naturalWidth || img.width || 1,
      naturalHeight: el.naturalHeight || img.height || 1,
    };
  }
  return {
    naturalWidth: img.width || 1,
    naturalHeight: img.height || 1,
  };
}

/**
 * Read our custom `objectFit` metadata off the image. We stamp this on the
 * Fabric object's `data` bag at swap-time so the panel can recover the user's
 * intent on re-select (Fabric doesn't natively persist object-fit — it only
 * tracks the resulting scaleX/scaleY).
 */
function readObjectFit(img: FabricImage): ImageState["objectFit"] {
  const data = (img as unknown as { data?: { objectFit?: string } }).data;
  const fit = data?.objectFit;
  if (fit === "contain" || fit === "stretch") return fit;
  return "cover";
}

function writeObjectFit(img: FabricImage, fit: ImageState["objectFit"]): void {
  // why: preserve existing data fields (layerId, layerKind, displayName).
  // Without this we'd nuke the metadata that the layer panel relies on.
  const obj = img as unknown as { data?: Record<string, unknown> };
  obj.data = { ...(obj.data ?? {}), objectFit: fit };
}

/**
 * Read the layer's BOX dimensions (independent of current scale).
 *
 * Returns the values stamped by `createFabricImage`'s data bag. Falls back
 * to the image's CURRENT displayed dimensions for pre-2026-05-23 images
 * (autosave snapshots etc. that don't carry targetBoxWidth/Height). The
 * fallback is intentionally lossy — old images won't see Cover/Contain/
 * Stretch do anything until the user re-creates them — but it's better
 * than crashing the panel.
 */
function readBoxDims(img: FabricImage): {
  boxWidth: number;
  boxHeight: number;
} {
  const data = (
    img as unknown as {
      data?: { targetBoxWidth?: number; targetBoxHeight?: number };
    }
  ).data;
  const bw = typeof data?.targetBoxWidth === "number" ? data.targetBoxWidth : null;
  const bh = typeof data?.targetBoxHeight === "number" ? data.targetBoxHeight : null;
  if (bw && bh && bw > 0 && bh > 0) {
    return { boxWidth: bw, boxHeight: bh };
  }
  // Fallback: derive from current displayed dims. Lossy but safe.
  const { naturalWidth, naturalHeight } = readNaturalSize(img);
  const scaleX = img.scaleX ?? 1;
  const scaleY = img.scaleY ?? 1;
  return {
    boxWidth: naturalWidth * scaleX,
    boxHeight: naturalHeight * scaleY,
  };
}

/**
 * Write box dims back to the data bag — preserves all other data-bag
 * fields. Called when the user resizes via Fabric handles (orchestrator
 * picks up the change via object:modified) so the box follows the image.
 */
export function writeBoxDims(img: FabricImage, w: number, h: number): void {
  const obj = img as unknown as { data?: Record<string, unknown> };
  obj.data = {
    ...(obj.data ?? {}),
    targetBoxWidth: Math.max(1, w),
    targetBoxHeight: Math.max(1, h),
  };
}

/**
 * Read the corner radius back from the image's clipPath, if one exists.
 * Returns 0 when the image has no clipPath (i.e., square corners).
 *
 * As of 2026-05-23 the clipPath is absolutePositioned (canvas px) so rx
 * is already in display px — no scale math needed. We still divide by
 * scaleX as a fallback for legacy images created with the old
 * image-local clip pattern, so the slider position doesn't lie on
 * historic content.
 */
function readCornerRadius(img: FabricImage): number {
  const clip = img.clipPath;
  if (!clip || !(clip instanceof Rect)) return 0;
  const rx = clip.rx ?? 0;
  const absolute =
    (clip as unknown as { absolutePositioned?: boolean }).absolutePositioned ??
    false;
  if (absolute) return Math.round(rx);
  // Legacy fallback — clip is image-local, scale back to display px.
  const scaleX = img.scaleX ?? 1;
  return Math.round(rx * scaleX);
}

/**
 * Read the current image state out of the canvas. Returns null when there's
 * no active object or the active object isn't a FabricImage.
 */
function readImageState(canvas: Canvas | null): ImageState | null {
  if (!canvas) return null;
  const active = canvas.getActiveObject();
  if (!active || !(active instanceof FabricImage)) return null;
  const { naturalWidth, naturalHeight } = readNaturalSize(active);
  const scaleX = active.scaleX ?? 1;
  const scaleY = active.scaleY ?? 1;
  const { boxWidth, boxHeight } = readBoxDims(active);
  return {
    src: active.getSrc?.() ?? "",
    objectFit: readObjectFit(active),
    cornerRadius: readCornerRadius(active),
    opacity: typeof active.opacity === "number" ? active.opacity : 1,
    targetWidth: naturalWidth * scaleX,
    targetHeight: naturalHeight * scaleY,
    boxWidth,
    boxHeight,
    naturalWidth,
    naturalHeight,
  };
}

/**
 * Compute the scaleX/scaleY pair that satisfies the requested object-fit
 * against the current target box. Mirrors the math in CanvasEditor's
 * createFabricImage factory.
 */
function computeFitScale(
  fit: ImageState["objectFit"],
  targetWidth: number,
  targetHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): { scaleX: number; scaleY: number } {
  const cover = Math.max(
    targetWidth / naturalWidth,
    targetHeight / naturalHeight,
  );
  const contain = Math.min(
    targetWidth / naturalWidth,
    targetHeight / naturalHeight,
  );
  if (fit === "stretch") {
    return {
      scaleX: targetWidth / naturalWidth,
      scaleY: targetHeight / naturalHeight,
    };
  }
  if (fit === "contain") {
    return { scaleX: contain, scaleY: contain };
  }
  return { scaleX: cover, scaleY: cover };
}

/**
 * Apply (or remove) a rounded-corner radius on the image's BOX clipPath.
 *
 * As of 2026-05-23 the image ALWAYS has a clipPath at its box dimensions
 * (added by `createFabricImage`). We never delete that clipPath — even at
 * radius=0 we keep the rect clip so Cover overflow continues to be clipped
 * to the layer's box. Setting radius=0 just gives square corners.
 *
 * Why we rebuild the Rect rather than mutating in place: Fabric's clipPath
 * rendering caches geometry; reassigning `img.clipPath` invalidates the
 * cache reliably across all Fabric v6 versions. Mutating rx/ry on the
 * existing Rect sometimes leaves a stale-render until the next redraw.
 */
function applyCornerRadius(img: FabricImage, radius: number): void {
  const { boxWidth, boxHeight } = readBoxDims(img);
  // Read the image's current canvas-space top-left so the clip stays in
  // place across re-applications. The clipPath is absolutePositioned, so
  // its left/top are in CANVAS pixels (NOT image-local).
  const existing =
    img.clipPath instanceof Rect ? img.clipPath : null;
  const clipLeft =
    existing && typeof existing.left === "number"
      ? existing.left
      : img.left ?? 0;
  const clipTop =
    existing && typeof existing.top === "number"
      ? existing.top
      : img.top ?? 0;

  img.clipPath = new Rect({
    left: clipLeft,
    top: clipTop,
    width: boxWidth,
    height: boxHeight,
    // why: absolutePositioned means rx/ry are in canvas px — no scale math.
    rx: Math.max(0, radius),
    ry: Math.max(0, radius),
    originX: "left",
    originY: "top",
    absolutePositioned: true,
  });
}

/**
 * Resize the image's bounding box to a perfect square using the shorter of
 * the current target width/height. Recomputes scaleX/scaleY against the
 * object-fit so the photo crops to the square cleanly. Returns the new
 * side length in display px — callers pass this to applyCornerRadius to
 * achieve a perfect circle (radius = side / 2).
 */
function resizeToSquare(img: FabricImage, fit: ImageState["objectFit"]): number {
  const { naturalWidth, naturalHeight } = readNaturalSize(img);
  // why: use the BOX dims (not the displayed dims) so circle-ifying
  // an image whose displayed bounds overflowed the box (Cover) still
  // produces a circle inside the box.
  const { boxWidth, boxHeight } = readBoxDims(img);
  const side = Math.min(boxWidth, boxHeight);
  const { scaleX: nextScaleX, scaleY: nextScaleY } = computeFitScale(
    fit,
    side,
    side,
    naturalWidth,
    naturalHeight,
  );
  img.set({ scaleX: nextScaleX, scaleY: nextScaleY });
  // The box is now square — persist so future Cover/Contain/Stretch use it.
  writeBoxDims(img, side, side);
  return side;
}

/**
 * One-shot "make it a circle" — squares the bounding box, then applies a
 * half-dimension clipPath so the result is a perfect circle regardless of
 * the source photo's aspect ratio.
 */
function applyCircleShape(img: FabricImage, fit: ImageState["objectFit"]): void {
  const side = resizeToSquare(img, fit);
  applyCornerRadius(img, side / 2);
}

/**
 * Detect whether the image currently reads as a circle: bounding box is
 * approximately square AND the corner radius is at least half the shorter
 * side. We use a 2px tolerance on the square check because float scaling
 * can drift the displayed box by a fraction of a pixel after several edits.
 */
function isCircleShape(state: ImageState): boolean {
  const dim = Math.min(state.targetWidth, state.targetHeight);
  const squareEnough = Math.abs(state.targetWidth - state.targetHeight) < 2;
  const roundEnough = state.cornerRadius >= dim / 2 - 1;
  return squareEnough && roundEnough && dim > 0;
}

export default function ImagePropertiesControls(
  props: ImagePropertiesControlsProps,
): JSX.Element {
  const {
    canvas,
    listing,
    selectionVersion,
    onCanvasMutated,
    recordHistory,
  } = props;
  const [state, setState] = useState<ImageState | null>(() =>
    readImageState(canvas),
  );
  /** Tracks an in-flight swap so the user can't double-click two thumbs and race FabricImage.fromURL. */
  const [isSwapping, setIsSwapping] = useState<boolean>(false);

  useEffect(() => {
    setState(readImageState(canvas));
  }, [canvas, selectionVersion]);

  /**
   * Swap the active image's underlying source to a new listing photo URL.
   * Uses Fabric v6's `setSrc` — replaces the image's underlying element
   * in place, preserving position/angle/zIndex/clipPath structure. After
   * load we recompute the scale to honor the current objectFit.
   */
  const handleSwapPhoto = useCallback(
    async (nextUrl: string): Promise<void> => {
      if (!canvas || isSwapping) return;
      const active = canvas.getActiveObject();
      if (!active || !(active instanceof FabricImage)) return;
      if (nextUrl === state?.src) return;

      setIsSwapping(true);
      try {
        // why: crossOrigin: "anonymous" is mandatory — without it the new
        // image taints the canvas and toDataURL throws SecurityError on
        // export. See ImageLayer typedoc + CanvasEditor.tsx createFabricImage.
        await active.setSrc(nextUrl, { crossOrigin: "anonymous" });

        // why: setSrc gives us a new underlying element with new natural
        // dimensions — re-apply object-fit so the visual size doesn't
        // suddenly jump. Compute against the BOX dims (stable target)
        // so the new photo lands at the same on-screen size, regardless
        // of how it differs in natural aspect from the previous photo.
        const currentFit = readObjectFit(active);
        const { boxWidth, boxHeight } = readBoxDims(active);
        const { naturalWidth, naturalHeight } = readNaturalSize(active);
        const { scaleX, scaleY } = computeFitScale(
          currentFit,
          boxWidth,
          boxHeight,
          naturalWidth,
          naturalHeight,
        );
        active.set({ scaleX, scaleY });

        // why: always re-apply the clipPath after swap — the new image's
        // displayed dims may differ, but the box is unchanged. Pass the
        // current corner radius so rounded photos stay rounded.
        applyCornerRadius(active, state?.cornerRadius ?? 0);

        canvas.requestRenderAll();
        onCanvasMutated?.();
        recordHistory?.();
        setState(readImageState(canvas));
      } catch (err) {
        // why: failed swap is non-fatal — log and bail. The user sees the
        // existing image and can try another thumbnail. A toast system would
        // belong in the orchestrator, not in a leaf control.
        console.error("Image swap failed:", err);
      } finally {
        setIsSwapping(false);
      }
    },
    [canvas, isSwapping, onCanvasMutated, recordHistory, state],
  );

  /**
   * Change the object-fit. Recomputes the scale and writes the new fit into
   * the image's `data` bag so it survives re-select.
   */
  const handleFitChange = useCallback(
    (next: ImageState["objectFit"]): void => {
      if (!canvas || !state) return;
      const active = canvas.getActiveObject();
      if (!active || !(active instanceof FabricImage)) return;
      // why (2026-05-23 fix): compute the new scale against the BOX dims
      // (stable target) rather than the displayed dims (= naturalDim *
      // currentScale, which is a circular reference that always returns
      // the current scale = no-op). This is the root fix for the
      // "Cover/Contain/Stretch don't change anything" bug.
      const { scaleX, scaleY } = computeFitScale(
        next,
        state.boxWidth,
        state.boxHeight,
        state.naturalWidth,
        state.naturalHeight,
      );
      active.set({ scaleX, scaleY });
      writeObjectFit(active, next);
      // why: the clipPath stays at the box position — re-applying corner
      // radius preserves it. With the new absolutePositioned clip, the
      // radius value is in canvas px directly, no scale math.
      applyCornerRadius(active, state.cornerRadius);
      canvas.requestRenderAll();
      onCanvasMutated?.();
      recordHistory?.();
      // why: re-read from canvas so targetWidth/Height reflect the new
      // scaled dimensions in the local mirror. boxWidth/Height stay the
      // same; this just refreshes the displayed-dims half.
      setState(readImageState(canvas));
    },
    [canvas, onCanvasMutated, recordHistory, state],
  );

  const handleShapeCircle = useCallback((): void => {
    if (!canvas || !state) return;
    const active = canvas.getActiveObject();
    if (!active || !(active instanceof FabricImage)) return;
    applyCircleShape(active, state.objectFit);
    canvas.requestRenderAll();
    onCanvasMutated?.();
    recordHistory?.();
    // why: re-read from canvas so targetWidth/Height + cornerRadius reflect
    // the squared-up box. The "Circle" pill now shows as active.
    setState(readImageState(canvas));
  }, [canvas, onCanvasMutated, recordHistory, state]);

  const handleShapeRect = useCallback((): void => {
    if (!canvas || !state) return;
    const active = canvas.getActiveObject();
    if (!active || !(active instanceof FabricImage)) return;
    // why: clear the clip but leave the bounding box where the user has it
    // — if they squared it intentionally for a circular crop and then
    // changed their mind, they probably still want a square. They can resize
    // by handle if they want a different aspect ratio.
    applyCornerRadius(active, 0);
    canvas.requestRenderAll();
    onCanvasMutated?.();
    recordHistory?.();
    setState({ ...state, cornerRadius: 0 });
  }, [canvas, onCanvasMutated, recordHistory, state]);

  const handleCornerRadiusChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      if (!canvas || !state) return;
      const active = canvas.getActiveObject();
      if (!active || !(active instanceof FabricImage)) return;
      const next = Number(e.target.value);
      if (!Number.isFinite(next)) return;
      applyCornerRadius(active, next);
      canvas.requestRenderAll();
      onCanvasMutated?.();
      setState({ ...state, cornerRadius: next });
      // why: continuous slider — defer recordHistory to mouseup commit.
    },
    [canvas, onCanvasMutated, state],
  );

  const handleCornerRadiusCommit = useCallback(() => {
    recordHistory?.();
  }, [recordHistory]);

  const handleOpacityChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      if (!canvas || !state) return;
      const active = canvas.getActiveObject();
      if (!active || !(active instanceof FabricImage)) return;
      // why: panel shows 0..100, Fabric uses 0..1. Convert at the boundary.
      const pct = Number(e.target.value);
      if (!Number.isFinite(pct)) return;
      const next = pct / 100;
      active.set({ opacity: next });
      canvas.requestRenderAll();
      onCanvasMutated?.();
      setState({ ...state, opacity: next });
    },
    [canvas, onCanvasMutated, state],
  );

  const handleOpacityCommit = useCallback(() => {
    recordHistory?.();
  }, [recordHistory]);

  if (!state) {
    return (
      <div className="px-4 py-6 text-sm text-neutral-400">
        Select an image layer to edit its properties.
      </div>
    );
  }

  // why: listing.photos is the source of truth for the swap grid. We cap at 5
  // because the canvas-editor schema only binds hero_photo + photo_2..5.
  const photoOptions = listing?.photos?.slice(0, 5) ?? [];
  const hasListing = listing !== null;

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* ===== Swap photo ===== */}
      <Section title="Swap Photo">
        {!hasListing ? (
          <p className="text-xs text-neutral-400">
            No listing attached — photo swap unavailable.
          </p>
        ) : photoOptions.length === 0 ? (
          <p className="text-xs text-neutral-400">
            This listing has no photos.
          </p>
        ) : (
          <div className="grid grid-cols-5 gap-1.5">
            {photoOptions.map((url, idx) => {
              const isCurrent = url === state.src;
              return (
                <button
                  key={`${url}_${idx}`}
                  type="button"
                  onClick={() => void handleSwapPhoto(url)}
                  disabled={isSwapping}
                  aria-label={`Use photo ${idx + 1}`}
                  title={`Photo ${idx + 1}`}
                  className={`group relative aspect-square overflow-hidden rounded-md border transition-all disabled:opacity-50 ${
                    isCurrent
                      ? "border-gold-500 ring-2 ring-gold-500/40"
                      : "border-neutral-300 hover:border-neutral-400"
                  }`}
                >
                  {/*
                    why: native <img>, not next/image. The Fabric layer also
                    uses raw browser images, so any CDN quirks (CORS headers,
                    redirects) surface here AT THUMB-TIME instead of after the
                    user clicks. Cheaper debugging cost.
                  */}
                  <img
                    src={url}
                    alt={`Photo ${idx + 1}`}
                    crossOrigin="anonymous"
                    className="h-full w-full object-cover"
                  />
                  {isCurrent ? (
                    <span className="absolute inset-x-0 bottom-0 bg-gold-500 py-0.5 text-center text-[8px] font-bold uppercase text-white">
                      Current
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        {isSwapping ? (
          <p className="mt-2 text-[10px] text-neutral-400">
            Swapping photo…
          </p>
        ) : null}
      </Section>

      {/* ===== Object fit ===== */}
      <Section title="Fit">
        <div className="grid grid-cols-3 gap-1">
          {FIT_OPTIONS.map((opt) => {
            const isActive = state.objectFit === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleFitChange(opt.value)}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "border-gold-500 bg-gold-50 text-gold-600"
                    : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Section>

      {/* ===== Shape (Rectangle / Circle) =====
          why: one-click circle for agent headshots + co-brand marks. The
          freeform Corner Radius slider below still works for soft-rounded
          cards (e.g. 16-24px) — Shape is the preset for "perfect circle". */}
      <Section title="Shape">
        <div className="grid grid-cols-2 gap-1">
          {(
            [
              { value: "rect", label: "Rectangle", onClick: handleShapeRect },
              { value: "circle", label: "Circle", onClick: handleShapeCircle },
            ] as const
          ).map((opt) => {
            const isCircle = isCircleShape(state);
            const isActive =
              (opt.value === "circle" && isCircle) ||
              (opt.value === "rect" && !isCircle);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={opt.onClick}
                aria-pressed={isActive}
                className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "border-gold-500 bg-gold-50 text-gold-700"
                    : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {opt.value === "circle" ? <CircleGlyph /> : <RectGlyph />}
                {opt.label}
              </button>
            );
          })}
        </div>
      </Section>

      {/* ===== Corner radius ===== */}
      <Section title="Corner Radius">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={state.cornerRadius}
            min={0}
            max={200}
            onChange={handleCornerRadiusChange}
            onBlur={handleCornerRadiusCommit}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
          />
          <input
            type="range"
            min={0}
            max={200}
            value={state.cornerRadius}
            onChange={handleCornerRadiusChange}
            onMouseUp={handleCornerRadiusCommit}
            onTouchEnd={handleCornerRadiusCommit}
            className="flex-1 accent-gold-500"
          />
        </div>
      </Section>

      {/* ===== Opacity ===== */}
      <Section title="Opacity">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={Math.round(state.opacity * 100)}
            min={0}
            max={100}
            onChange={handleOpacityChange}
            onBlur={handleOpacityCommit}
            className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
          />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(state.opacity * 100)}
            onChange={handleOpacityChange}
            onMouseUp={handleOpacityCommit}
            onTouchEnd={handleOpacityCommit}
            className="flex-1 accent-gold-500"
          />
          <span className="w-8 text-right text-xs text-neutral-500">
            {Math.round(state.opacity * 100)}%
          </span>
        </div>
      </Section>
    </div>
  );
}

// ===========================================================================
// Section subcomponent
// ===========================================================================

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section(props: SectionProps): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

// ===========================================================================
// Shape glyphs — small line-art icons for the segmented control buttons
// ===========================================================================

function RectGlyph(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    </svg>
  );
}

function CircleGlyph(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  );
}
