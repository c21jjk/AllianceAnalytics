/**
 * extractPhotoColors — dominant-color extraction via median-cut quantization.
 * ----------------------------------------------------------------------------
 *
 * Used by the ColorPicker's "Photo colors" section so Larissa can pick a fill
 * that matches the listing's hero photo (sky blue, brick red, lawn green, etc.).
 *
 * Algorithm: classic median-cut.
 *   1. Downsample the image to a small offscreen canvas (cuts work to <15k
 *      pixels regardless of input size — fast and "good enough").
 *   2. Pull all opaque pixels into a flat array.
 *   3. Wrap them in one box (an axis-aligned bounding range in RGB).
 *   4. Iteratively split the box with the most pixels along its longest
 *      RGB dimension at the median, until we have `count` boxes.
 *   5. For each box, average its pixels → one palette color.
 *
 * Why median-cut over simpler bucketing:
 *   • Better at picking up accent colors (a small but vivid orange door
 *     beats out the gray sidewalk in median-cut; bucketing buries it).
 *   • Standard algorithm — well-understood failure modes.
 *   • Still O(N log N) and finishes in well under 100ms on a 120×120 sample.
 *
 * CORS / tainted canvas:
 *   getImageData throws SecurityError when an image was loaded without
 *   crossOrigin="anonymous" OR when the image server didn't return ACAO
 *   headers. The canvas editor loads everything with crossOrigin="anonymous",
 *   so the only failure mode in practice is a misconfigured third-party
 *   image host. We catch and return [] — the caller hides the section.
 */

interface Pixel {
  r: number;
  g: number;
  b: number;
}

interface ColorBox {
  pixels: Pixel[];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

// why: downsample to 120×120. At this size we get ~14k samples — plenty for
// stable color clustering, far below the cost of a full 1080×1080 scan.
const SAMPLE_DIMENSION = 120;

// why: skip near-black, near-white, and near-gray pixels — they're almost
// always background/overlay artifacts that drown out the colors Larissa
// actually wants to grab (the brick, the door, the sky, the lawn).
const MIN_SATURATION = 0.08;
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.96;

/**
 * Public API. Returns up to `count` hex strings ("#RRGGBB"), sorted by
 * dominance descending (most-prevalent color first).
 *
 * @param source  An HTMLImageElement (Fabric: `img.getElement()`) or an
 *                HTMLCanvasElement. Must be drawable to a canvas (no SVG).
 * @param count   How many colors to extract. 6 is the Canva default; pass
 *                up to ~12 if you want a wider palette.
 */
export function extractPhotoColors(
  source: HTMLImageElement | HTMLCanvasElement,
  count: number = 6,
): string[] {
  // why: bail early on count == 0 to avoid a degenerate while-loop below.
  if (count <= 0) return [];

  // ---- 1. Downsample to an offscreen canvas ----
  const tmp = document.createElement("canvas");
  tmp.width = SAMPLE_DIMENSION;
  tmp.height = SAMPLE_DIMENSION;
  const ctx = tmp.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  try {
    // why: drawImage with explicit dimensions performs the downsample for
    // us. We use the default low-quality but fast scaling — no
    // imageSmoothingEnabled tweaks. The quantizer doesn't care about edge
    // fidelity, just bulk color distribution.
    ctx.drawImage(source, 0, 0, SAMPLE_DIMENSION, SAMPLE_DIMENSION);
  } catch {
    // why: drawImage can throw if the source is in an inconsistent state
    // (e.g., FabricImage element that's been disposed). Defensively return.
    return [];
  }

  // ---- 2. Read pixel data ----
  let raw: Uint8ClampedArray;
  try {
    raw = ctx.getImageData(0, 0, SAMPLE_DIMENSION, SAMPLE_DIMENSION).data;
  } catch {
    // why: SecurityError on tainted canvas. Caller should hide the section.
    return [];
  }

  const pixels: Pixel[] = [];
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const a = raw[i + 3];
    // why: skip transparent pixels — they're padding from non-square images.
    if (a < 128) continue;
    // why: skip pixels that are too gray/black/white to be a useful accent
    // color. Computed cheaply via min/max of channels rather than full HSL.
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / (2 * 255);
    if (lightness < MIN_LIGHTNESS || lightness > MAX_LIGHTNESS) continue;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < MIN_SATURATION) continue;
    pixels.push({ r, g, b });
  }

  // why: if filtering killed everything (e.g., pure-white seller's flyer
  // photo), fall back to including ALL non-transparent pixels so we still
  // surface some colors. Better than returning [].
  if (pixels.length < 32) {
    pixels.length = 0;
    for (let i = 0; i < raw.length; i += 4) {
      if (raw[i + 3] < 128) continue;
      pixels.push({ r: raw[i], g: raw[i + 1], b: raw[i + 2] });
    }
  }

  if (pixels.length === 0) return [];

  // ---- 3. Initial box ----
  const initialBox = boundingBox(pixels);
  const boxes: ColorBox[] = [initialBox];

  // ---- 4. Median-cut iterations ----
  // why: cap iterations defensively — without a cap, a degenerate input
  // (all identical pixels = unsplittable) would loop forever in some
  // pathological cases.
  let safety = 0;
  while (boxes.length < count && safety < 64) {
    safety += 1;
    // Find the box with the largest population (Canva's heuristic). Ties
    // broken by which has the longest dimension — keeps the algorithm stable.
    let targetIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      if (b.pixels.length < 2) continue;
      const score = b.pixels.length;
      if (score > bestScore) {
        bestScore = score;
        targetIdx = i;
      }
    }
    if (targetIdx === -1) break; // no splittable box left

    const target = boxes[targetIdx];
    const split = splitBox(target);
    if (!split) break;
    boxes.splice(targetIdx, 1, split[0], split[1]);
  }

  // ---- 5. Average each box → palette ----
  // Sort by population descending so the most-prevalent color is first.
  boxes.sort((a, b) => b.pixels.length - a.pixels.length);

  const palette: string[] = [];
  for (const box of boxes) {
    if (box.pixels.length === 0) continue;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (const p of box.pixels) {
      rSum += p.r;
      gSum += p.g;
      bSum += p.b;
    }
    const n = box.pixels.length;
    const r = Math.round(rSum / n);
    const g = Math.round(gSum / n);
    const b = Math.round(bSum / n);
    palette.push(rgbToHex(r, g, b));
  }

  // why: dedupe perceptually-close colors — median-cut occasionally
  // produces near-duplicates when the longest dimension is tight. Drop any
  // color within ~10 units of an earlier one in either channel.
  return dedupeClose(palette).slice(0, count);
}

// ===========================================================================
// Helpers
// ===========================================================================

function boundingBox(pixels: Pixel[]): ColorBox {
  let rMin = 255,
    rMax = 0,
    gMin = 255,
    gMax = 0,
    bMin = 255,
    bMax = 0;
  for (const p of pixels) {
    if (p.r < rMin) rMin = p.r;
    if (p.r > rMax) rMax = p.r;
    if (p.g < gMin) gMin = p.g;
    if (p.g > gMax) gMax = p.g;
    if (p.b < bMin) bMin = p.b;
    if (p.b > bMax) bMax = p.b;
  }
  return { pixels, rMin, rMax, gMin, gMax, bMin, bMax };
}

function splitBox(box: ColorBox): [ColorBox, ColorBox] | null {
  // why: pick the channel with the widest range to split. Maximizes the
  // perceptual diversity of the resulting palette.
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;

  let pickChannel: "r" | "g" | "b";
  if (rRange >= gRange && rRange >= bRange) pickChannel = "r";
  else if (gRange >= bRange) pickChannel = "g";
  else pickChannel = "b";

  if (rRange === 0 && gRange === 0 && bRange === 0) return null;

  const sorted = box.pixels.slice().sort((a, b) => a[pickChannel] - b[pickChannel]);
  const mid = Math.floor(sorted.length / 2);
  if (mid === 0) return null;

  const left = sorted.slice(0, mid);
  const right = sorted.slice(mid);
  return [boundingBox(left), boundingBox(right)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => {
    const clamped = Math.max(0, Math.min(255, n));
    const s = clamped.toString(16).toUpperCase();
    return s.length === 1 ? "0" + s : s;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function dedupeClose(hexes: string[]): string[] {
  const out: { r: number; g: number; b: number; hex: string }[] = [];
  const THRESHOLD_SQUARED = 1200; // Euclidean RGB ≈ 35 units away
  for (const hex of hexes) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    let isClose = false;
    for (const prev of out) {
      const dr = prev.r - r;
      const dg = prev.g - g;
      const db = prev.b - b;
      if (dr * dr + dg * dg + db * db < THRESHOLD_SQUARED) {
        isClose = true;
        break;
      }
    }
    if (!isClose) out.push({ r, g, b, hex });
  }
  return out.map((p) => p.hex);
}
