/**
 * Path B — Layer tree → SVG renderer.
 *
 * Pure function, no side effects, no I/O. Same renderer used by:
 *   - The browser editor canvas (live preview as you edit)
 *   - The /api/post-builder/render-tree endpoint (final PNG screenshot)
 *
 * Output is a complete <svg> document — embeddable inline or as a
 * standalone file. Text uses <foreignObject> + HTML <div> so we get
 * native browser text wrapping (Chromium screenshots correctly).
 *
 * Coordinates: top-left origin, template-space pixels. The SVG
 * viewBox matches the tree's width/height; the editor scales via CSS.
 */

import type {
  GradientLayer,
  GradientStop,
  GroupLayer,
  ImageLayer,
  Layer,
  LayerTree,
  LineLayer,
  RectLayer,
  TextLayer,
} from "./types";

/**
 * Curated font family list available in the editor. Keep in sync with
 * the editor's font picker. Each entry maps to a Google Fonts family
 * loaded via the inline <style> in the SVG.
 *
 * The first entry is the default — used when a TextLayer has no explicit
 * `font` set.
 */
export const FONT_FAMILIES: ReadonlyArray<{
  /** Internal id used in TextLayer.font and the editor picker. */
  id: string;
  /** CSS font-family value. */
  family: string;
  /** Google Fonts URL fragment for the @import. */
  google_url: string;
  /** Display label in the editor. */
  label: string;
  /** Stack category — sans, serif, display, mono. */
  category: "sans" | "serif" | "display" | "mono";
}> = [
  { id: "inter", family: "Inter", google_url: "Inter:wght@400;500;600;700;800;900", label: "Inter", category: "sans" },
  { id: "barlow", family: "Barlow", google_url: "Barlow:wght@400;500;600;700;800;900", label: "Barlow", category: "sans" },
  { id: "playfair_display", family: "Playfair Display", google_url: "Playfair+Display:wght@400;500;600;700;800;900", label: "Playfair Display", category: "serif" },
  { id: "montserrat", family: "Montserrat", google_url: "Montserrat:wght@400;500;600;700;800;900", label: "Montserrat", category: "sans" },
  { id: "lora", family: "Lora", google_url: "Lora:wght@400;500;600;700", label: "Lora", category: "serif" },
  { id: "merriweather", family: "Merriweather", google_url: "Merriweather:wght@400;700;900", label: "Merriweather", category: "serif" },
  { id: "bebas_neue", family: "Bebas Neue", google_url: "Bebas+Neue", label: "Bebas Neue", category: "display" },
  { id: "oswald", family: "Oswald", google_url: "Oswald:wght@400;500;600;700", label: "Oswald", category: "sans" },
  { id: "raleway", family: "Raleway", google_url: "Raleway:wght@400;500;600;700;800;900", label: "Raleway", category: "sans" },
  { id: "source_sans_3", family: "Source Sans 3", google_url: "Source+Sans+3:wght@400;500;600;700", label: "Source Sans 3", category: "sans" },
  { id: "dm_serif_display", family: "DM Serif Display", google_url: "DM+Serif+Display", label: "DM Serif Display", category: "display" },
  { id: "crimson_pro", family: "Crimson Pro", google_url: "Crimson+Pro:wght@400;500;600;700;800;900", label: "Crimson Pro", category: "serif" },
];

const DEFAULT_FONT_FAMILY = FONT_FAMILIES[0].family; // Inter
const DEFAULT_TEXT_COLOR = "#18181B";
const DEFAULT_FONT_SIZE = 32;

/**
 * Render a complete SVG document from a layer tree. Output is a self-
 * contained string starting with `<svg>` — no XML prolog, no DOCTYPE.
 * Suitable for inline rendering in an HTML page or for wrapping in a
 * minimal HTML shell for Chromium screenshotting.
 */
export function layerTreeToSvg(tree: LayerTree): string {
  const w = tree.width;
  const h = tree.height;
  const bg = tree.background ?? "#FFFFFF";

  // Collect referenced fonts so we can emit a single @import block. Walk
  // the tree once, gather unique font ids that appear in TextLayers.
  const fontsUsed = collectFonts(tree);
  const fontImport = buildFontImport(fontsUsed);

  // Render layers (recursively for groups). Each layer becomes an SVG
  // node. Text uses <foreignObject> + HTML.
  const layerSvg = tree.layers.map((l) => renderLayer(l, "")).join("\n");

  // We give each layer's group an `<g>` wrapper so transforms (rotation,
  // opacity, hidden) compose cleanly. The CSS @import goes in <defs>
  // inside a <style> block — Chromium handles this fine.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<style>
${fontImport}
.lt-text-html { box-sizing: border-box; word-wrap: break-word; overflow-wrap: anywhere; }
.lt-text-html * { box-sizing: border-box; }
</style>
</defs>
<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeAttr(bg)}" />
${layerSvg}
</svg>`;
}

/**
 * Wrap a rendered SVG in a minimal HTML document, ready for Chromium
 * to setContent + screenshot. The wrapper sizes the SVG to the viewport
 * so the screenshot crop matches the template dimensions exactly.
 */
export function wrapSvgInHtml(svg: string, width: number, height: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Layer tree render</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #FFFFFF; }
body { font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
svg { display: block; width: ${width}px; height: ${height}px; }
</style>
</head>
<body>
${svg}
</body>
</html>`;
}

// ─── Internal: per-layer renderers ──────────────────────────────────

function renderLayer(layer: Layer, indent: string): string {
  if (layer.hidden) return "";
  switch (layer.type) {
    case "image":
      return renderImage(layer, indent);
    case "text":
      return renderText(layer, indent);
    case "rect":
      return renderRect(layer, indent);
    case "gradient":
      return renderGradient(layer, indent);
    case "line":
      return renderLine(layer, indent);
    case "group":
      return renderGroup(layer, indent);
  }
}

function renderImage(l: ImageLayer, indent: string): string {
  const transform = layerTransform(l);
  const opacity = layerOpacity(l);
  const fit = l.fit ?? "cover";
  const aspect =
    fit === "fill" ? "none" : fit === "contain" ? "xMidYMid meet" : "xMidYMid slice";
  const radius = l.radius && l.radius > 0 ? l.radius : 0;

  // ── Crop handling ─────────────────────────────────────────────────
  // When `crop` is set with normalized 0..1 coordinates, we render the
  // selected sub-region of the source image into the layer's box. Strategy:
  // wrap the <image> in a clipPath sized to (l.x..l.x+l.w, l.y..l.y+l.h)
  // and STRETCH the underlying image so the cropped region maps exactly
  // into that box. Stretched-width = l.w / crop.w, stretched-height = l.h
  // / crop.h. The image is then offset by -crop.x*scaledW so the cropped
  // origin lands at the box's top-left.
  //
  // Without crop, the existing fit/preserveAspectRatio handles things.
  const crop = l.crop;
  const hasValidCrop =
    crop &&
    crop.w > 0 &&
    crop.h > 0 &&
    !(crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1);

  // For rounded corners OR cropping, we use a clipPath on the wrapping <g>.
  // Crop always needs a clip rect to hide the overflow.
  const needsClip = radius > 0 || hasValidCrop;
  const clipId = needsClip ? `clip_${l.id}` : null;
  const clipDef = clipId
    ? `<defs><clipPath id="${clipId}"><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${radius}" ry="${radius}" /></clipPath></defs>`
    : "";
  const clipAttr = clipId ? ` clip-path="url(#${clipId})"` : "";

  if (hasValidCrop && crop) {
    // Stretch-and-shift approach. We bypass preserveAspectRatio by using
    // "none" for the cropped path — fit modes only matter for un-cropped
    // images. The crop window IS the new framing.
    const scaledW = l.w / crop.w;
    const scaledH = l.h / crop.h;
    const ix = l.x - crop.x * scaledW;
    const iy = l.y - crop.y * scaledH;
    return `${indent}${clipDef}<g${transform}${opacity}${clipAttr}>
${indent}  <image href="${escapeAttr(l.src)}" x="${ix}" y="${iy}" width="${scaledW}" height="${scaledH}" preserveAspectRatio="none" />
${indent}</g>`;
  }

  return `${indent}${clipDef}<g${transform}${opacity}${clipAttr}>
${indent}  <image href="${escapeAttr(l.src)}" x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" preserveAspectRatio="${aspect}" />
${indent}</g>`;
}

function renderText(l: TextLayer, indent: string): string {
  const transform = layerTransform(l);
  const opacity = layerOpacity(l);

  const fontFamily = resolveFontFamily(l.font);
  const fontSize = l.size ?? DEFAULT_FONT_SIZE;
  const weight = l.weight ?? 400;
  const color = l.color ?? DEFAULT_TEXT_COLOR;
  const align = l.align ?? "left";
  const letterSpacing = typeof l.letter_spacing === "number" ? `${l.letter_spacing}em` : "normal";
  const lineHeight = l.line_height ?? 1.2;
  const textTransform = l.uppercase ? "uppercase" : "none";
  const textShadow = l.text_shadow ?? "none";
  const verticalAlign = l.vertical_align ?? "top";

  // foreignObject with HTML inside gets us auto-wrap. Chromium renders
  // this faithfully on screenshot. The inner div uses flexbox to handle
  // vertical-align (top/middle/bottom) inside the box.
  const flexAlign =
    verticalAlign === "middle" ? "center" : verticalAlign === "bottom" ? "flex-end" : "flex-start";

  const innerStyle =
    `font-family:'${fontFamily}',sans-serif;` +
    `font-size:${fontSize}px;` +
    `font-weight:${weight};` +
    `color:${color};` +
    `text-align:${align};` +
    `letter-spacing:${letterSpacing};` +
    `line-height:${lineHeight};` +
    `text-transform:${textTransform};` +
    `text-shadow:${textShadow};` +
    `width:100%;`;

  const wrapperStyle =
    `width:100%;height:100%;display:flex;flex-direction:column;` +
    `justify-content:${flexAlign};` +
    `align-items:${align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"};`;

  // Escape the actual text. Convert newlines to <br>.
  const html = escapeHtml(l.text).replace(/\n/g, "<br />");

  return `${indent}<g${transform}${opacity}>
${indent}  <foreignObject x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}">
${indent}    <div xmlns="http://www.w3.org/1999/xhtml" class="lt-text-html" style="${wrapperStyle}">
${indent}      <div class="lt-text-html" style="${innerStyle}">${html}</div>
${indent}    </div>
${indent}  </foreignObject>
${indent}</g>`;
}

function renderRect(l: RectLayer, indent: string): string {
  const transform = layerTransform(l);
  const opacity = layerOpacity(l);
  const fill = l.fill ?? "none";
  const stroke = l.stroke ?? "none";
  const strokeWidth = l.stroke_width ?? 0;
  const radius = l.radius ?? 0;

  return `${indent}<g${transform}${opacity}>
${indent}  <rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${radius}" ry="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}" />
${indent}</g>`;
}

function renderGradient(l: GradientLayer, indent: string): string {
  const transform = layerTransform(l);
  const opacity = layerOpacity(l);
  const radius = l.radius ?? 0;
  const gradientId = `grad_${l.id}`;

  // For linear, convert angle (0=top→bottom, 90=left→right) to x/y endpoints.
  const stops = l.stops.map((s) => stopToSvg(s)).join("");
  const gradientDef =
    l.variant === "radial"
      ? `<radialGradient id="${gradientId}" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`
      : (() => {
          const a = ((l.angle ?? 0) % 360 + 360) % 360;
          // SVG linear gradient: x1/y1 → x2/y2 in the gradient's bounding box (0..1).
          // angle 0 = vertical top→bottom = (0,0)→(0,1)
          // angle 90 = horizontal left→right = (0,0)→(1,0)
          const rad = (a * Math.PI) / 180;
          // top→bottom direction for angle=0: (0.5-sin/2, 0.5-cos/2) → (0.5+sin/2, 0.5+cos/2)
          const sx = 0.5 - Math.sin(rad) * 0.5;
          const sy = 0.5 - Math.cos(rad) * 0.5;
          const ex = 0.5 + Math.sin(rad) * 0.5;
          const ey = 0.5 + Math.cos(rad) * 0.5;
          return `<linearGradient id="${gradientId}" x1="${sx.toFixed(4)}" y1="${sy.toFixed(4)}" x2="${ex.toFixed(4)}" y2="${ey.toFixed(4)}">${stops}</linearGradient>`;
        })();

  return `${indent}<defs>${gradientDef}</defs>
${indent}<g${transform}${opacity}>
${indent}  <rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${radius}" ry="${radius}" fill="url(#${gradientId})" />
${indent}</g>`;
}

function renderLine(l: LineLayer, indent: string): string {
  const transform = layerTransform(l);
  const opacity = layerOpacity(l);
  const stroke = l.stroke ?? "#000000";
  const strokeWidth = l.stroke_width ?? 1;
  return `${indent}<g${transform}${opacity}>
${indent}  <line x1="${l.x}" y1="${l.y}" x2="${l.x + l.w}" y2="${l.y + l.h}" stroke="${escapeAttr(stroke)}" stroke-width="${strokeWidth}" stroke-linecap="round" />
${indent}</g>`;
}

function renderGroup(l: GroupLayer, indent: string): string {
  const transform = layerTransform(l);
  const opacity = layerOpacity(l);
  const children = l.children.map((c) => renderLayer(c, indent + "  ")).join("\n");
  // Group transforms compose with child transforms naturally because we
  // wrap each child in its own <g> with its own transform.
  return `${indent}<g${transform}${opacity}>
${children}
${indent}</g>`;
}

// ─── Internal: helpers ──────────────────────────────────────────────

/**
 * Build the SVG transform attribute for a layer. Currently rotation
 * around the layer's center. Translation is handled by per-element x/y.
 */
function layerTransform(l: Layer): string {
  if (!l.rotation) return "";
  const cx = l.x + l.w / 2;
  const cy = l.y + l.h / 2;
  return ` transform="rotate(${l.rotation} ${cx} ${cy})"`;
}

function layerOpacity(l: Layer): string {
  if (typeof l.opacity !== "number" || l.opacity === 1) return "";
  return ` opacity="${Math.max(0, Math.min(1, l.opacity))}"`;
}

function stopToSvg(s: GradientStop): string {
  const opacity = typeof s.opacity === "number" && s.opacity !== 1 ? ` stop-opacity="${s.opacity}"` : "";
  return `<stop offset="${s.offset}" stop-color="${escapeAttr(s.color)}"${opacity} />`;
}

function resolveFontFamily(id?: string): string {
  if (!id) return DEFAULT_FONT_FAMILY;
  // If caller passed a family name directly (e.g. "Inter"), accept it.
  const byFamily = FONT_FAMILIES.find((f) => f.family === id);
  if (byFamily) return byFamily.family;
  const byId = FONT_FAMILIES.find((f) => f.id === id);
  if (byId) return byId.family;
  return DEFAULT_FONT_FAMILY;
}

function collectFonts(tree: LayerTree): Set<string> {
  const out = new Set<string>();
  const visit = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.type === "text") {
        const fam = resolveFontFamily(l.font);
        out.add(fam);
      } else if (l.type === "group") {
        visit(l.children);
      }
    }
  };
  visit(tree.layers);
  // Always include the default so any missed text layer still has a fallback.
  out.add(DEFAULT_FONT_FAMILY);
  return out;
}

function buildFontImport(families: Set<string>): string {
  if (families.size === 0) return "";
  const queries = [...families]
    .map((fam) => FONT_FAMILIES.find((f) => f.family === fam)?.google_url)
    .filter((u): u is string => !!u);
  if (queries.length === 0) return "";
  // One @import line per family — Google Fonts lets us combine, but
  // separate keeps things obvious in dev tools.
  return queries
    .map((q) => `@import url("https://fonts.googleapis.com/css2?family=${q}&display=block");`)
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  // Same as HTML escape for our purposes — used for SVG attribute values.
  return escapeHtml(s);
}
