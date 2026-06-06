"use client";

/**
 * ReelPreview — Day 4 client-side, real-time playback preview for the Reel
 * Studio composition.
 *
 * Replaces the Day 3 static "frame 0" preview with an animated `<canvas>` that
 * plays the composition at 30fps: photo scenes Ken-Burns-pan via the same
 * lerp + easing math the worker uses (worker/render-page/render.js), design
 * scenes render as a simplified hero card placeholder, and scenes blend via
 * dissolve at scene boundaries.
 *
 * Scope discipline (Day 4):
 *   • Only the dissolve transition is honored. Other transitions render as
 *     "cut" — see the TODO comments at the transition dispatch.
 *   • Design scenes get a structurally-read approximation, NOT a real Fabric
 *     render. The real hero render happens server-side via the worker on
 *     Generate; the client preview is a UX cue, not a pixel proof.
 *   • Audio is ignored at preview time. The renderer mixes audio server-side.
 *
 * Performance contract:
 *   • The RAF loop runs ONLY while playing. Paused → one draw, no scheduling.
 *   • Image decode is cached in a stable Map ref so re-renders don't blow it.
 *   • Frame timing keys off `performance.now()` deltas — if the browser
 *     drops frames (long task on the main thread), we DON'T queue catch-up
 *     frames; we just jump the playhead forward and render the next frame
 *     at its correct virtual timestamp.
 */

import { Pause, Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type MotionPath,
  type Scene,
  type TransitionType,
  type VideoComposition,
} from "@/lib/post-builder/types";

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface ReelPreviewProps {
  composition: VideoComposition;
  /** All available listing photo URLs (used for design scenes' fallback hero background). */
  availablePhotos: readonly string[];
  /**
   * Optional — when set, jumps the playhead to this scene's start when it
   * changes. Useful so selecting a scene in the timeline scrubs the preview
   * to that scene.
   */
  scrubToSceneId?: string | null;
  /**
   * Visual size constraint — width in pixels. Height is computed from the
   * composition's 9:16 ratio. Default 360 (matches Day 3 layout).
   */
  maxWidth?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers — easing, lerp, scene lookup
// ---------------------------------------------------------------------------

/**
 * Apply the easing curve from a MotionPath to a raw `t` parameter in [0..1].
 *
 * why these exact curves: they match worker/render-page/render.js byte-for-
 * byte so the preview's frame N looks (within rounding) like the worker's
 * exported frame N. If you change one side you MUST change the other.
 */
function easeT(t: number, easing: MotionPath["easing"]): number {
  switch (easing) {
    case "linear":
      return t;
    case "ease_in":
      return t * t;
    case "ease_out":
      return 1 - (1 - t) * (1 - t);
    case "ease_in_out":
      // smoothstep — same formula the worker uses for its ease_in_out
      return 3 * t * t - 2 * t * t * t;
  }
}

/**
 * Find the scene whose [startMs, startMs+durationMs) interval contains the
 * given time. Returns the lerped intra-scene t (0..1) plus the index so the
 * caller can look up adjacent scenes for transitions.
 *
 * Why an explicit walk vs binary search: max 8 scenes per composition (per
 * REEL_CAPS), so the linear scan is faster than the binary-search overhead
 * once branch-prediction warms up. Code stays trivially readable too.
 */
function findActiveScene(
  composition: VideoComposition,
  currentTimeMs: number,
): { scene: Scene; intraSceneT: number; sceneIndex: number } | null {
  if (composition.scenes.length === 0) return null;
  for (let i = 0; i < composition.scenes.length; i++) {
    const s = composition.scenes[i]!;
    const end = s.startMs + s.durationMs;
    // Last scene includes its end timestamp so end-of-reel pauses at the
    // final frame instead of falling through to "no scene".
    const isLast = i === composition.scenes.length - 1;
    const inRange = isLast
      ? currentTimeMs >= s.startMs && currentTimeMs <= end
      : currentTimeMs >= s.startMs && currentTimeMs < end;
    if (inRange) {
      const dur = Math.max(s.durationMs, 1);
      const intraSceneT = Math.max(0, Math.min(1, (currentTimeMs - s.startMs) / dur));
      return { scene: s, intraSceneT, sceneIndex: i };
    }
  }
  // Past the end — clamp to last scene (used while we wait for the RAF loop
  // to wrap back to 0).
  const last = composition.scenes[composition.scenes.length - 1]!;
  return {
    scene: last,
    intraSceneT: 1,
    sceneIndex: composition.scenes.length - 1,
  };
}

/** Format ms as "M:SS" with one-decimal seconds (e.g. "0:03"). */
function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Compute a linear fade multiplier in [0..1] for the audio track at a given
 * playhead position. Returns 1.0 in the steady-state middle of the track,
 * ramps from 0→1 during the first `fadeInMs`, and ramps from 1→0 during the
 * last `fadeOutMs` before `totalDurationMs`. Mirrors the worker's audio-mix
 * fade math so the preview matches the rendered output.
 *
 * why a pure function: called every RAF frame to update audio.volume —
 * keeping it pure (no React state reads) keeps the loop tight.
 */
function computeFadeMultiplier(
  currentTimeMs: number,
  totalDurationMs: number,
  fadeInMs: number,
  fadeOutMs: number,
): number {
  if (totalDurationMs <= 0) return 1;
  // Fade-in band: 0..fadeInMs.
  if (fadeInMs > 0 && currentTimeMs < fadeInMs) {
    return Math.max(0, Math.min(1, currentTimeMs / fadeInMs));
  }
  // Fade-out band: (total - fadeOutMs)..total.
  if (fadeOutMs > 0) {
    const fadeOutStart = totalDurationMs - fadeOutMs;
    if (currentTimeMs >= fadeOutStart) {
      const into = currentTimeMs - fadeOutStart;
      return Math.max(0, Math.min(1, 1 - into / fadeOutMs));
    }
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Design-scene structural readers
// ---------------------------------------------------------------------------
//
// SceneContent.template is typed as `unknown` at the main-app boundary
// (composition is portable JSON). We read structurally with narrow type
// guards so a malformed template degrades gracefully — empty bg + no text —
// rather than throwing the whole preview loop.

interface ReadonlyTemplate {
  backgroundColor?: string;
  layers?: ReadonlyArray<unknown>;
}

interface ReadonlyImageLayer {
  kind: "image";
  boundField?: string;
}

interface ReadonlyTextLayer {
  kind: "text";
  text?: string;
  resolvedText?: string;
  fontSize?: number;
  fill?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTemplate(value: unknown): ReadonlyTemplate {
  if (!isObject(value)) return {};
  const bg = value.backgroundColor;
  const layers = value.layers;
  return {
    backgroundColor: typeof bg === "string" ? bg : undefined,
    layers: Array.isArray(layers) ? (layers as ReadonlyArray<unknown>) : undefined,
  };
}

function readImageLayer(layer: unknown): ReadonlyImageLayer | null {
  if (!isObject(layer)) return null;
  if (layer.kind !== "image") return null;
  return {
    kind: "image",
    boundField: typeof layer.boundField === "string" ? layer.boundField : undefined,
  };
}

function readTextLayer(layer: unknown): ReadonlyTextLayer | null {
  if (!isObject(layer)) return null;
  if (layer.kind !== "text") return null;
  return {
    kind: "text",
    text: typeof layer.text === "string" ? layer.text : undefined,
    resolvedText:
      typeof layer.resolvedText === "string" ? layer.resolvedText : undefined,
    fontSize: typeof layer.fontSize === "number" ? layer.fontSize : undefined,
    fill: typeof layer.fill === "string" ? layer.fill : undefined,
  };
}

/**
 * Find the first eyebrow-looking text layer in a template. Heuristic: the
 * first text layer with fontSize >= 24 and any fill — captures eyebrow
 * labels like "JUST LISTED" without depending on a specific class name.
 */
function findEyebrowText(template: ReadonlyTemplate): string | null {
  if (!template.layers) return null;
  for (const raw of template.layers) {
    const t = readTextLayer(raw);
    if (!t) continue;
    if ((t.fontSize ?? 0) >= 24) {
      const text = t.resolvedText ?? t.text;
      if (text && text.trim().length > 0) return text;
    }
  }
  return null;
}

/** True if the template's first image layer is hero_photo-bound. */
function templateHasHeroPhotoSlot(template: ReadonlyTemplate): boolean {
  if (!template.layers) return false;
  for (const raw of template.layers) {
    const img = readImageLayer(raw);
    if (!img) continue;
    return img.boundField === "hero_photo";
  }
  return false;
}

// ---------------------------------------------------------------------------
// Image cache hook
// ---------------------------------------------------------------------------

interface ImageCacheEntry {
  image: HTMLImageElement;
  /** True once the image has decoded enough to drawImage cleanly. */
  ready: boolean;
}

/**
 * Stable Map of URL → HTMLImageElement that survives re-renders. We
 * deliberately mutate the Map in place (not via setState) — the consumer
 * polls `cache.get(url)?.ready` each draw, and the canvas redraws on a
 * dedicated effect when `loadingTick` flips.
 */
function useImageCache(): {
  cacheRef: React.MutableRefObject<Map<string, ImageCacheEntry>>;
  loadingTick: number;
  ensureLoaded: (urls: ReadonlyArray<string>) => void;
  allReady: (urls: ReadonlyArray<string>) => boolean;
} {
  const cacheRef = useRef<Map<string, ImageCacheEntry>>(new Map());
  // why a tick counter: we need to nudge React to re-render when an async
  // image finishes loading so the "Loading…" overlay drops and the canvas
  // redraws with the now-ready image. A counter is the simplest debounced
  // re-render signal; setState with the Map itself would risk aliasing.
  const [loadingTick, setLoadingTick] = useState(0);

  const ensureLoaded = useCallback((urls: ReadonlyArray<string>) => {
    let scheduled = false;
    for (const url of urls) {
      if (!url) continue;
      if (cacheRef.current.has(url)) continue;
      const img = new Image();
      // why crossOrigin set BEFORE src: matches the worker's load path —
      // a canvas tainted by a non-CORS image throws SecurityError on
      // getImageData / toDataURL. Won't bite preview today (we never
      // export from preview) but keeps parity with worker rules.
      img.crossOrigin = "anonymous";
      const entry: ImageCacheEntry = { image: img, ready: false };
      cacheRef.current.set(url, entry);
      img.onload = () => {
        entry.ready = true;
        if (!scheduled) {
          scheduled = true;
          // why microtask defer: multiple onload callbacks fire in the
          // same tick when several photos finish at once. Batching the
          // re-render keeps the loading overlay from flickering.
          queueMicrotask(() => setLoadingTick((n) => n + 1));
        }
      };
      img.onerror = () => {
        // Leave entry in the cache with ready=false. ensureLoaded won't
        // retry — the user reloads to recover. Logged for debugging.
        // eslint-disable-next-line no-console
        console.warn(`[ReelPreview] image load failed: ${url}`);
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(() => setLoadingTick((n) => n + 1));
        }
      };
      img.src = url;
    }
  }, []);

  const allReady = useCallback((urls: ReadonlyArray<string>): boolean => {
    for (const url of urls) {
      if (!url) continue;
      const entry = cacheRef.current.get(url);
      if (!entry || !entry.ready) return false;
    }
    return true;
  }, []);

  return { cacheRef, loadingTick, ensureLoaded, allReady };
}

// ---------------------------------------------------------------------------
// Draw routines
// ---------------------------------------------------------------------------

/**
 * Draw a photo scene's current frame onto the destination context.
 *
 * 2026-06-05 — cover + pan-across + gentle-zoom model (must stay in lockstep
 * with the worker's renderPhotoScene in worker/render-page/render.js). The
 * OLD code did a stretched source-rect → full-canvas drawImage, which
 * squished landscape photos into the 9:16 frame (the distortion bug). Now we
 * cover-fit the FULL photo to the frame (uniform scale, no distortion, no
 * bars) and pan across the overflow axis while zooming in slightly. For a
 * landscape photo the overflow is horizontal, so the camera sweeps across the
 * full width of the shot — nothing is permanently cropped out of frame.
 *
 * The motion preset now only encodes pan DIRECTION (the sign of the x/y
 * delta); the magnitude is ignored and we always traverse the full overflow.
 */
function drawPhotoScene(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  motion: MotionPath,
  intraSceneT: number,
  canvasW: number,
  canvasH: number,
): void {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  // Guard: a decoded-but-zero image (rare onload race) would NaN the math.
  if (natW <= 0 || natH <= 0) return;

  const p = easeT(Math.max(0, Math.min(1, intraSceneT)), motion.easing);

  // Cover scale fills both axes (one axis overflows). Add a gentle Ken
  // Burns zoom over the scene for depth.
  const KEN_ZOOM = 1.08;
  const baseScale = Math.max(canvasW / natW, canvasH / natH);
  const scale = baseScale * (1 + (KEN_ZOOM - 1) * p);
  const renderedW = natW * scale;
  const renderedH = natH * scale;
  const overflowX = renderedW - canvasW;
  const overflowY = renderedH - canvasH;

  const dx = motion.endRect.x - motion.startRect.x;
  const dy = motion.endRect.y - motion.startRect.y;

  let left: number;
  let top: number;
  if (overflowX >= overflowY) {
    // Pan horizontally across the full width; center vertically.
    const fX = dx >= 0 ? p : 1 - p;
    left = -fX * overflowX;
    top = -overflowY / 2;
  } else {
    // Pan vertically; center horizontally.
    const fY = dy >= 0 ? p : 1 - p;
    top = -fY * overflowY;
    left = -overflowX / 2;
  }

  // Background fill so any sub-pixel gap shows black, not stale pixels.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasW, canvasH);
  // Draw the full image scaled + positioned; the canvas clips the overflow.
  ctx.drawImage(img, 0, 0, natW, natH, left, top, renderedW, renderedH);
}

/**
 * Draw a simplified design scene. NOT a real Fabric render — we approximate
 * the look so the user can preview pacing and motion in context without
 * shipping the heavy editor pipeline into the preview path.
 *
 * The real hero render happens server-side via the worker on Generate. This
 * placeholder shows: hero photo (if template has a hero_photo slot and we
 * have a fallback photo), template background color, and the eyebrow text.
 */
function drawDesignScene(
  ctx: CanvasRenderingContext2D,
  templateUnknown: unknown,
  fallbackHeroImg: HTMLImageElement | null,
  canvasW: number,
  canvasH: number,
): void {
  const template = readTemplate(templateUnknown);
  // why the "transparent" check: templates use the literal string
  // "transparent" to mean "no fill" — paint a brand-neutral cream instead
  // so the canvas isn't see-through (canvases don't support real alpha
  // backgrounds anyway, but the visual is cleaner).
  const bg =
    template.backgroundColor && template.backgroundColor !== "transparent"
      ? template.backgroundColor
      : "#FCFCFB";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Hero photo if the template binds one. Drawn cover-fit underneath the
  // text overlay. Cover math: scale so the photo fills both axes, center it.
  if (fallbackHeroImg && templateHasHeroPhotoSlot(template)) {
    const natW = fallbackHeroImg.naturalWidth || fallbackHeroImg.width;
    const natH = fallbackHeroImg.naturalHeight || fallbackHeroImg.height;
    if (natW > 0 && natH > 0) {
      const scale = Math.max(canvasW / natW, canvasH / natH);
      const rW = natW * scale;
      const rH = natH * scale;
      const dx = (canvasW - rW) / 2;
      const dy = (canvasH - rH) / 2;
      // Slight darken so the eyebrow text reads — matches the V1 hero
      // card's overlay treatment. Real renderer uses a gradient; the
      // preview gets a flat scrim for speed.
      ctx.drawImage(fallbackHeroImg, dx, dy, rW, rH);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
  }

  const eyebrow = findEyebrowText(template);
  if (eyebrow) {
    // why fixed gold band: matches Alliance brand standards
    // (Relentless Gold #C9A84C). Real renderer uses the layer's exact
    // fill; we hard-pin gold so the preview always reads on-brand even
    // when the template's text layer color hasn't been tuned.
    const fontPx = Math.round(canvasW * 0.06); // ~65px on 1080w
    ctx.font = `700 ${fontPx}px Barlow, "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#C9A84C";
    const y = canvasH * 0.75;
    ctx.fillText(eyebrow.toUpperCase(), canvasW / 2, y);
  }
}

/**
 * Draw a single scene into the destination context. Photo scenes look up
 * their decoded image from the cache; if it's missing or not ready we paint
 * black (the preloader overlay covers this visually).
 */
function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  intraSceneT: number,
  cache: Map<string, ImageCacheEntry>,
  designHeroFallbackUrl: string | null,
  canvasW: number,
  canvasH: number,
): void {
  if (scene.content.kind === "photo") {
    const entry = cache.get(scene.content.photoUrl);
    if (entry && entry.ready) {
      drawPhotoScene(ctx, entry.image, scene.content.motion, intraSceneT, canvasW, canvasH);
      return;
    }
    // Not loaded yet — paint black. The overlay covers this.
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvasW, canvasH);
    return;
  }

  if (scene.content.kind === "design") {
    const fallback = designHeroFallbackUrl
      ? (cache.get(designHeroFallbackUrl)?.image ?? null)
      : null;
    drawDesignScene(
      ctx,
      scene.content.template,
      fallback && (cache.get(designHeroFallbackUrl ?? "")?.ready ?? false)
        ? fallback
        : null,
      canvasW,
      canvasH,
    );
    return;
  }

  // video_clip — reserved (Phase 7). Render a label so it's clear what's
  // happening. The renderer rejects this kind before publish, so the user
  // can't accidentally generate one.
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = "#888";
  ctx.font = "500 32px Barlow, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Video clip — Phase 7", canvasW / 2, canvasH / 2);
}

/**
 * 2026-06-05 — Composite a transition between two already-rendered scene
 * frames (offscreen canvases `a` = outgoing, `b` = incoming) onto `ctx`, at
 * progress `p` (0..1). The main ctx is pre-filled black by the caller.
 *
 * These are PREVIEW approximations of the worker's ffmpeg xfade presets — the
 * goal is that the user can SEE the move during playback (crossfade vs slide
 * vs circle), not a pixel-exact match of the final MP4. Whip (smooth_*) is
 * approximated as a fast slide; zoom_blur as a scale-in (no real blur).
 */
function compositeTransition(
  ctx: CanvasRenderingContext2D,
  a: HTMLCanvasElement,
  b: HTMLCanvasElement,
  type: TransitionType,
  p: number,
  W: number,
  H: number,
): void {
  switch (type) {
    case "fade":
      // Crossfade.
      ctx.drawImage(a, 0, 0);
      ctx.globalAlpha = p;
      ctx.drawImage(b, 0, 0);
      ctx.globalAlpha = 1;
      return;
    case "dissolve":
      // Dip to black (ctx already black underneath).
      if (p < 0.5) {
        ctx.globalAlpha = 1 - p * 2;
        ctx.drawImage(a, 0, 0);
      } else {
        ctx.globalAlpha = (p - 0.5) * 2;
        ctx.drawImage(b, 0, 0);
      }
      ctx.globalAlpha = 1;
      return;
    case "fade_white":
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      if (p < 0.5) {
        ctx.globalAlpha = 1 - p * 2;
        ctx.drawImage(a, 0, 0);
      } else {
        ctx.globalAlpha = (p - 0.5) * 2;
        ctx.drawImage(b, 0, 0);
      }
      ctx.globalAlpha = 1;
      return;
    case "slide_left":
      ctx.drawImage(a, -p * W, 0);
      ctx.drawImage(b, (1 - p) * W, 0);
      return;
    case "smooth_left":
      // Whip — approximate as a fast slide (ease the progress).
      ctx.drawImage(a, -Math.min(1, p * 1.4) * W, 0);
      ctx.drawImage(b, (1 - Math.min(1, p * 1.4)) * W, 0);
      return;
    case "slide_right":
      ctx.drawImage(a, p * W, 0);
      ctx.drawImage(b, -(1 - p) * W, 0);
      return;
    case "smooth_right":
      ctx.drawImage(a, Math.min(1, p * 1.4) * W, 0);
      ctx.drawImage(b, -(1 - Math.min(1, p * 1.4)) * W, 0);
      return;
    case "slide_up":
      ctx.drawImage(a, 0, -p * H);
      ctx.drawImage(b, 0, (1 - p) * H);
      return;
    case "slide_down":
      ctx.drawImage(a, 0, p * H);
      ctx.drawImage(b, 0, -(1 - p) * H);
      return;
    case "wipe_left":
      // Outgoing underneath; reveal incoming from the right edge inward.
      ctx.drawImage(a, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(W - p * W, 0, p * W, H);
      ctx.clip();
      ctx.drawImage(b, 0, 0);
      ctx.restore();
      return;
    case "circle_open":
      ctx.drawImage(a, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, (p * Math.hypot(W, H)) / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(b, 0, 0);
      ctx.restore();
      return;
    case "zoom_blur": {
      // Incoming scales from 1.3x down to 1x while fading in over the outgoing.
      ctx.globalAlpha = 1 - p;
      ctx.drawImage(a, 0, 0);
      ctx.globalAlpha = 1;
      const s = 1.3 - 0.3 * p;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.globalAlpha = p;
      ctx.drawImage(b, -W / 2, -H / 2);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    case "cut":
    default:
      ctx.drawImage(b, 0, 0);
      return;
  }
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

/**
 * Real-time preview of a VideoComposition. Plays at 30fps off
 * requestAnimationFrame with a wall-clock-driven playhead, so frame drops
 * don't compound — the next frame always renders at its correct virtual
 * timestamp.
 */
export default function ReelPreview({
  composition,
  availablePhotos,
  scrubToSceneId = null,
  maxWidth = 360,
}: ReelPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 2026-06-05 — two offscreen canvases used during a transition band to
  // render the outgoing + incoming scene frames before compositing them
  // (slides/wipes/circle need a fully-painted source to translate/clip).
  const offARef = useRef<HTMLCanvasElement | null>(null);
  const offBRef = useRef<HTMLCanvasElement | null>(null);
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const playButtonRef = useRef<HTMLButtonElement | null>(null);

  // ---- playback state -------------------------------------------------
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // ---- image cache ----------------------------------------------------
  const { cacheRef, loadingTick, ensureLoaded, allReady } = useImageCache();

  // ---- audio: refs + state -------------------------------------------
  //
  // why a single HTMLAudioElement ref (not a <audio> JSX element with React-
  // owned src): we need fine-grained control over currentTime / play() /
  // pause() / volume in the RAF loop without prompting React re-renders.
  // The element is created lazily client-side in an effect (no SSR).
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // Track the URL we last loaded so we can detect URL changes and reload
  // (avoid the "src didn't change so playback continues" bug when Larissa
  // swaps tracks mid-session).
  const loadedAudioUrlRef = useRef<string | null>(null);
  // why a state flag for audio-load errors: we silently skip audio work
  // when the file 404s or fails to decode (the picker already surfaces
  // "Coming soon"; we don't double-error in the preview).
  const [audioErrored, setAudioErrored] = useState<boolean>(false);
  // why a state flag for "audio is still loading": surfaces the 200ms
  // "Loading audio..." overlay when the user hits Play before the file is
  // ready to play through.
  const [audioLoading, setAudioLoading] = useState<boolean>(false);

  // ---- derived: photo URLs the composition needs ----------------------

  /**
   * URLs the composition requires for visual fidelity:
   *   • Every photo scene's photoUrl
   *   • The first availablePhoto (used as fallback hero for design scenes
   *     that bind a hero_photo slot)
   *
   * Memoized on scene identity so re-renders don't reshape the array and
   * blow the ensureLoaded dep array.
   */
  const requiredPhotoUrls = useMemo<readonly string[]>(() => {
    const set = new Set<string>();
    for (const s of composition.scenes) {
      if (s.content.kind === "photo") set.add(s.content.photoUrl);
    }
    const fallback = availablePhotos[0];
    if (fallback) set.add(fallback);
    return Array.from(set);
  }, [composition.scenes, availablePhotos]);

  const designHeroFallbackUrl = availablePhotos[0] ?? null;

  // ---- effects: image preload ----------------------------------------

  useEffect(() => {
    ensureLoaded(requiredPhotoUrls);
  }, [requiredPhotoUrls, ensureLoaded]);

  // ---- effects: scrub-to-scene ----------------------------------------

  useEffect(() => {
    if (!scrubToSceneId) return;
    const idx = composition.scenes.findIndex((s) => s.id === scrubToSceneId);
    if (idx < 0) return;
    const startMs = composition.scenes[idx]!.startMs;
    // why preserve isPlaying: spec says timeline-clicking should scrub
    // the playhead without toggling play state.
    setCurrentTimeMs(startMs);
  }, [scrubToSceneId, composition.scenes]);

  // ---- effects: clamp time when composition shrinks ------------------

  useEffect(() => {
    setCurrentTimeMs((t) => Math.min(t, composition.totalDurationMs));
  }, [composition.totalDurationMs]);

  // ---- effects: audio lifecycle --------------------------------------
  //
  // why an effect (not JSX with src bound): we need to manage currentTime
  // + play()/pause() imperatively in lockstep with the RAF playhead.
  // React's declarative model would round-trip state for every play/pause
  // and lose us the millisecond-precise sync we need.

  // Audio source URL — kept stable via memo so React effects only fire
  // when the actual URL changes (composition object identity is not stable).
  const audioUrl = composition.audio?.url ?? null;

  // Initialize the HTMLAudioElement on mount + tear down on unmount.
  useEffect(() => {
    // why preload="auto": the user can hit Play any moment; we want the
    // browser to start buffering as soon as the URL is set.
    const el = new Audio();
    el.preload = "auto";
    audioElRef.current = el;
    return () => {
      el.pause();
      el.src = "";
      audioElRef.current = null;
      loadedAudioUrlRef.current = null;
    };
  }, []);

  // (Re)load audio source whenever the composition's track URL changes.
  // Edge case spec: if the URL changes mid-session, pause the prior src,
  // load the new URL, and resume if isPlaying. We pause unconditionally
  // here and let the play-state effect below resume on its next tick.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;

    // No audio track → clear any prior src and bail.
    if (!audioUrl) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      loadedAudioUrlRef.current = null;
      setAudioErrored(false);
      setAudioLoading(false);
      return;
    }

    // Already loaded this URL → nothing to do (volume + currentTime sync
    // happens in the playhead effect).
    if (loadedAudioUrlRef.current === audioUrl) return;

    el.pause();
    el.src = audioUrl;
    el.load();
    loadedAudioUrlRef.current = audioUrl;
    setAudioErrored(false);
    setAudioLoading(true);

    // why onCanPlayThrough: the spec wants a "Loading audio..." indicator
    // until the browser can play through without buffering. canplaythrough
    // is the right event for that — readyState >= HAVE_ENOUGH_DATA.
    const onCanPlay = () => setAudioLoading(false);
    const onError = () => {
      setAudioErrored(true);
      setAudioLoading(false);
    };
    el.addEventListener("canplaythrough", onCanPlay);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("canplaythrough", onCanPlay);
      el.removeEventListener("error", onError);
    };
  }, [audioUrl]);

  // Sync play/pause + currentTime with the composition playhead.
  // Triggered when isPlaying flips or the composition's audio config changes.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    const audio = composition.audio;
    if (!audio || audioErrored) {
      // No audio or load failed — make sure nothing is playing.
      if (!el.paused) el.pause();
      return;
    }

    if (isPlaying) {
      // why set currentTime BEFORE play(): jumping the playhead during an
      // active play() causes some browsers to stutter or to ignore the
      // seek; setting it first guarantees the resume starts at the right
      // virtual timestamp.
      const targetSec = Math.max(0, currentTimeMs / 1000);
      // Only seek if the deviation is larger than typical playback drift
      // (~120ms) — frequent setCurrentTime resets cause audible clicks.
      if (Math.abs(el.currentTime - targetSec) > 0.12) {
        el.currentTime = targetSec;
      }
      // why catch + swallow: browser autoplay policies can reject play()
      // even after a user gesture if the file isn't fully buffered yet.
      // The user clicked Play; we don't surface this to them — the next
      // canplaythrough → setAudioLoading(false) tick will let them retry.
      void el.play().catch(() => {
        /* autoplay blocked / interrupted — silent */
      });
    } else {
      if (!el.paused) el.pause();
    }
    // why currentTimeMs is NOT in deps: scrubbing while paused must NOT
    // re-fire this effect every keystroke (RAF would cancel-and-resume on
    // each commit). The dedicated "scrub while paused" effect below handles
    // currentTime sync independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, composition.audio, audioErrored]);

  // While the user is scrubbing OR paused, keep audio.currentTime in sync
  // with the playhead so the next play() resumes at the right offset.
  // Per spec: while dragging the scrub bar, set audio.currentTime to match
  // even if isPlaying was already true (don't pause; just sync).
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    if (!composition.audio || audioErrored) return;
    const targetSec = Math.max(0, currentTimeMs / 1000);
    // Apply seek if scrubbing OR paused. While the RAF loop is running and
    // not scrubbing, we let the audio element drift naturally — the play
    // effect above already aligned at the start, and we re-align inside the
    // RAF tick when the playhead wraps to 0 via the dedicated loop-wrap
    // effect below.
    if (isScrubbing || !isPlaying) {
      if (Math.abs(el.currentTime - targetSec) > 0.05) {
        el.currentTime = targetSec;
      }
    }
  }, [
    currentTimeMs,
    isScrubbing,
    isPlaying,
    composition.audio,
    audioErrored,
  ]);

  // Detect loop wraparound: when the RAF loop sets virtualTimeMs back to 0
  // (or near 0) while the audio is well past 0, the loop wrapped — reset
  // audio.currentTime to keep it in sync.
  // why a ref-tracked previous time: we need to know "the playhead just
  // wrapped" without firing on every frame's normal forward progression.
  const lastPlayheadRef = useRef<number>(0);
  useEffect(() => {
    const el = audioElRef.current;
    if (!el || !composition.audio || audioErrored) {
      lastPlayheadRef.current = currentTimeMs;
      return;
    }
    const wrapped =
      lastPlayheadRef.current > 1_000 && currentTimeMs < lastPlayheadRef.current - 500;
    if (wrapped) {
      el.currentTime = 0;
      // why re-play after wrap: setting currentTime can pause some
      // browsers' playback when the seek crosses a buffered-range boundary.
      // We re-issue play() to guarantee the loop wrap keeps audio rolling.
      if (isPlaying) {
        void el.play().catch(() => {
          /* silent — same rationale as the main play effect */
        });
      }
    }
    lastPlayheadRef.current = currentTimeMs;
  }, [currentTimeMs, isPlaying, composition.audio, audioErrored]);

  // Apply base volume + fade multiplier every time the playhead or fade
  // config changes. Cheap — a single property assignment per tick.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    if (!composition.audio || audioErrored) return;
    const { volume: baseVolume, fadeInMs, fadeOutMs } = composition.audio;
    const fade = computeFadeMultiplier(
      currentTimeMs,
      composition.totalDurationMs,
      fadeInMs,
      fadeOutMs,
    );
    // Clamp final volume to [0..1] — defensive against any composition
    // saved with an out-of-range volume from an older schema.
    el.volume = Math.max(0, Math.min(1, baseVolume * fade));
  }, [
    currentTimeMs,
    composition.audio,
    composition.totalDurationMs,
    audioErrored,
  ]);

  // ---- canvas draw routine -------------------------------------------

  /**
   * Draw the current frame. Pure function of (composition, currentTimeMs,
   * cache state) — no timing concerns. Called by both the RAF loop (while
   * playing) and by the paused-state effect (single frame).
   *
   * Transition handling (MVP — dissolve only):
   *   If `intraSceneT` falls inside the [0, transitionMs/durationMs] band
   *   at the START of a scene whose transitionIn === "dissolve" and there
   *   IS a previous scene, draw the previous scene's last frame first,
   *   then draw the incoming scene on top with globalAlpha = t/bandT. This
   *   produces a smooth crossfade.
   *
   *   Other transitions render as cut (no blend). Day 5+ adds slide_left,
   *   zoom_blur, and full fade-to-black.
   */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvasW, canvasH);

    const active = findActiveScene(composition, currentTimeMs);
    if (!active) return;

    const { scene, intraSceneT, sceneIndex } = active;

    // 2026-06-05 — animate ALL transitions (not just dissolve). We're inside
    // a transition band when the time since scene start is less than
    // transitionMs, the scene isn't a hard "cut", and there's a previous
    // scene to transition from.
    const sinceSceneStartMs = currentTimeMs - scene.startMs;
    const inTransitionBand =
      scene.transitionIn !== "cut" &&
      scene.transitionMs > 0 &&
      sceneIndex > 0 &&
      sinceSceneStartMs < scene.transitionMs;

    if (inTransitionBand) {
      const prev = composition.scenes[sceneIndex - 1]!;
      // Previous scene's intra-T at this moment: prev's end is
      // (scene.startMs + scene.transitionMs) under the recompute model
      // (overlap subtracts transitionMs), so prev's "now" is currentTime -
      // prev.startMs, clamped to its full duration.
      const prevIntra = Math.max(
        0,
        Math.min(1, (currentTimeMs - prev.startMs) / Math.max(prev.durationMs, 1)),
      );
      const blend = Math.max(
        0,
        Math.min(1, sinceSceneStartMs / Math.max(scene.transitionMs, 1)),
      );

      // Render both scene frames to offscreen canvases first (slides/wipes/
      // circle need fully-painted sources to translate/clip), then composite.
      const offA = (offARef.current ??= document.createElement("canvas"));
      const offB = (offBRef.current ??= document.createElement("canvas"));
      if (offA.width !== canvasW || offA.height !== canvasH) {
        offA.width = canvasW;
        offA.height = canvasH;
      }
      if (offB.width !== canvasW || offB.height !== canvasH) {
        offB.width = canvasW;
        offB.height = canvasH;
      }
      const ctxA = offA.getContext("2d");
      const ctxB = offB.getContext("2d");
      if (ctxA && ctxB) {
        ctxA.clearRect(0, 0, canvasW, canvasH);
        ctxB.clearRect(0, 0, canvasW, canvasH);
        drawScene(
          ctxA,
          prev,
          prevIntra,
          cacheRef.current,
          designHeroFallbackUrl,
          canvasW,
          canvasH,
        );
        drawScene(
          ctxB,
          scene,
          intraSceneT,
          cacheRef.current,
          designHeroFallbackUrl,
          canvasW,
          canvasH,
        );
        compositeTransition(
          ctx,
          offA,
          offB,
          scene.transitionIn,
          blend,
          canvasW,
          canvasH,
        );
        return;
      }
      // Fallback if offscreen contexts are unavailable: hard cut to incoming.
    }

    drawScene(
      ctx,
      scene,
      intraSceneT,
      cacheRef.current,
      designHeroFallbackUrl,
      canvasW,
      canvasH,
    );
  }, [composition, currentTimeMs, cacheRef, designHeroFallbackUrl]);

  // ---- effect: redraw on every state change while paused -------------
  //
  // why useLayoutEffect: paint synchronously after DOM updates so the
  // displayed canvas is always consistent with the committed React state.
  // For the active RAF loop this is harmless (the loop calls draw too) and
  // it eliminates a 1-frame flash when scrubbing while paused.
  useLayoutEffect(() => {
    draw();
  }, [draw, loadingTick]);

  // ---- effect: RAF loop while playing --------------------------------

  useEffect(() => {
    if (!isPlaying) return;

    let rafId = 0;
    let lastTs: number | null = null;
    // Local mirror of the playhead so we don't re-trigger this effect every
    // frame via setState dependency. We commit back via setCurrentTimeMs
    // on each tick — React batches the updates inside RAF.
    let virtualTimeMs = currentTimeMs;
    const totalMs = composition.totalDurationMs;

    const tick = (ts: number) => {
      if (lastTs == null) lastTs = ts;
      const deltaMs = ts - lastTs;
      lastTs = ts;
      // why no cap on delta: if the tab was backgrounded the delta can be
      // many seconds. We deliberately let the playhead leap forward — this
      // is the "drop frames, don't queue them" rule. The next render shows
      // the correct virtual time, not a catch-up burst.
      virtualTimeMs += deltaMs;
      if (totalMs > 0 && virtualTimeMs >= totalMs) {
        // Loop. Modulo handles long pauses (no infinite catch-up).
        virtualTimeMs = virtualTimeMs % totalMs;
      }
      setCurrentTimeMs(virtualTimeMs);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
    // why currentTimeMs is NOT in deps: including it would cancel + restart
    // the loop every frame (1 setState per frame would re-fire this effect).
    // We seed virtualTimeMs from the current value once on play; the loop
    // then drives itself. Toggling isPlaying restarts cleanly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, composition.totalDurationMs]);

  // ---- scrub bar handlers --------------------------------------------

  /**
   * Convert a pointer event's clientX into a ms timestamp by measuring its
   * position along the scrub bar element.
   */
  const eventToTimeMs = useCallback(
    (clientX: number): number => {
      const el = scrubRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * composition.totalDurationMs;
    },
    [composition.totalDurationMs],
  );

  const handleScrubPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = scrubRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      setIsScrubbing(true);
      // why we pause-on-scrub-start: feels right for a "scrub through" UX.
      // If the user was playing, they'll resume manually after releasing.
      setIsPlaying(false);
      setCurrentTimeMs(eventToTimeMs(e.clientX));
    },
    [eventToTimeMs],
  );

  const handleScrubPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbing) return;
      setCurrentTimeMs(eventToTimeMs(e.clientX));
    },
    [isScrubbing, eventToTimeMs],
  );

  const handleScrubPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = scrubRef.current;
      if (el && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      setIsScrubbing(false);
    },
    [],
  );

  // ---- play / pause --------------------------------------------------

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      // Restart from 0 if we paused at the very end (no auto-rewind feels
      // wrong on click-Play). Loop wraparound happens during playback.
      if (!p && currentTimeMs >= composition.totalDurationMs - 1) {
        setCurrentTimeMs(0);
      }
      return !p;
    });
  }, [currentTimeMs, composition.totalDurationMs]);

  // ---- keyboard: Space toggles play/pause when canvas/scrub focused ----

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
    },
    [togglePlay],
  );

  // ---- layout: compute display dimensions -----------------------------
  //
  // why scale-down via CSS, not canvas attribute: the canvas's internal
  // resolution stays 1080×1920 so drawImage math + font sizing match the
  // worker's coordinate system. The display size is purely cosmetic.
  const displayHeight = Math.round(maxWidth * (16 / 9));

  // ---- loading overlay -----------------------------------------------

  const isPreloading = !allReady(requiredPhotoUrls);
  // Reference loadingTick so the closure rechecks on each load progression.
  // (Calling allReady directly is enough — the hook's setLoadingTick forces
  // a re-render — but the explicit usage silences exhaustive-deps if a
  // future contributor extracts the check.)
  void loadingTick;

  // ---- render --------------------------------------------------------

  return (
    <div
      className="flex w-full flex-col items-center"
      onKeyDown={handleKeyDown}
    >
      {/* ----- Canvas frame ---------------------------------------------- */}
      <div
        className="relative overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-neutral-200"
        style={{ width: maxWidth, height: displayHeight }}
      >
        <canvas
          ref={canvasRef}
          // why width/height attrs at 1080×1920: backing buffer matches the
          // composition canvas so all drawImage math is in source pixels.
          // The element is CSS-sized down to maxWidth × displayHeight.
          width={composition.width}
          height={composition.height}
          tabIndex={0}
          className="block h-full w-full"
          aria-label="Reel preview canvas"
        />
        {isPreloading ? (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs font-medium text-white"
          >
            Loading preview…
          </div>
        ) : null}
        {/* why a SECOND overlay (not merged with isPreloading): the audio
            loading state can outlast the image preload, and the user gets
            cleaner messaging if we tell them exactly what's still loading. */}
        {!isPreloading && audioLoading && isPlaying ? (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/60 px-3 py-1.5 text-[11px] font-medium text-white"
          >
            Loading audio…
          </div>
        ) : null}
      </div>

      {/* ----- Play + time -------------------------------------------- */}
      <div className="mt-3 flex items-center gap-3">
        <button
          ref={playButtonRef}
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause preview" : "Play preview"}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-gold-600 text-white shadow-sm transition hover:bg-gold-700 focus:outline-none focus:ring-2 focus:ring-gold-500/50"
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" fill="currentColor" />
          ) : (
            <Play className="h-5 w-5" fill="currentColor" />
          )}
        </button>
        <div
          className="font-mono text-xs tabular-nums text-neutral-700"
          aria-live="off"
        >
          {formatMmSs(currentTimeMs)}{" "}
          <span className="text-neutral-400">/</span>{" "}
          {formatMmSs(composition.totalDurationMs)}
        </div>
      </div>

      {/* ----- Scrub bar ---------------------------------------------- */}
      <div
        ref={scrubRef}
        role="slider"
        tabIndex={0}
        aria-label="Preview scrub"
        aria-valuemin={0}
        aria-valuemax={composition.totalDurationMs}
        aria-valuenow={currentTimeMs}
        aria-valuetext={`${formatMmSs(currentTimeMs)} of ${formatMmSs(composition.totalDurationMs)}`}
        onPointerDown={handleScrubPointerDown}
        onPointerMove={handleScrubPointerMove}
        onPointerUp={handleScrubPointerUp}
        onPointerCancel={handleScrubPointerUp}
        onKeyDown={handleKeyDown}
        className="relative mt-2 h-2 cursor-pointer rounded-full bg-neutral-200"
        style={{ width: maxWidth }}
      >
        {/* Filled portion */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gold-500"
          style={{
            width: `${
              composition.totalDurationMs > 0
                ? (currentTimeMs / composition.totalDurationMs) * 100
                : 0
            }%`,
          }}
        />
        {/* Scrubhead */}
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-600 shadow ring-2 ring-white"
          style={{
            left: `${
              composition.totalDurationMs > 0
                ? (currentTimeMs / composition.totalDurationMs) * 100
                : 0
            }%`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2026-05-26 — inline PlayIcon / PauseIcon were replaced with Lucide
// Play / Pause imports above. Both call sites pass fill="currentColor" so
// the icons render as filled silhouettes like the originals.
// ---------------------------------------------------------------------------
