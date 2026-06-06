/**
 * AI reflow — adapt a square (1080x1080) card design to a vertical 9:16
 * (1080x1920) Reel hero frame.
 * --------------------------------------------------------------------------
 *
 * The "Make it a Reel" hybrid: the hero defaults to a pre-built 9:16
 * template, but the user can opt in to carry their EXACT designed square card
 * over. A square card jammed into 9:16 either letterboxes or crops off the
 * branding, so we ask Claude to RE-FLOW the layout: keep every layer, but
 * return new geometry (and text size) that uses the taller frame natively —
 * bigger photo area, branding kept in place, text repositioned with margins.
 *
 * Design choices that keep this reliable + cheap:
 *   - Single focused Sonnet call (not the 4-pass AI Design pipeline).
 *   - Claude only returns GEOMETRY per layer id (left/top/width/height +
 *     optional fontSize). Every other layer property (colors, fonts, bound
 *     fields, effects, z-order) is copied verbatim from the source schema, so
 *     there's nothing to hallucinate and the result can't drift off-brand.
 *   - Output is clamped to the canvas so a bad number can't push a layer off
 *     screen or to an absurd size.
 *
 * Returns a NEW CanvasTemplateSchema at story_9x16; the caller swaps it onto
 * the Reel's hero design scene.
 */

import { ANTHROPIC_MODELS, getAnthropic } from "@/lib/ai/anthropic";
import { extractJson } from "./schema";
import {
  PLATFORM_DIMENSIONS,
  type CanvasLayer,
  type CanvasTemplateSchema,
} from "@/lib/post-builder/canvas-editor/types";

export type ReflowResult =
  | { ok: true; schema: CanvasTemplateSchema }
  | { ok: false; error: string };

const REFLOW_SYSTEM_PROMPT = `You are a layout engine that re-flows a social-media graphic from one canvas size to another.

You receive a SOURCE canvas size, a TARGET canvas size, and a list of LAYERS positioned on the source canvas. Each layer has: id, kind ("text" | "image" | "shape"), name, and a bounding box (left, top, width, height) in pixels with a TOP-LEFT origin. Text layers also include their text and fontSize.

Re-flow the layers so the design looks NATIVE on the target canvas (the target is taller/portrait). Rules:
- Keep EVERY layer. Return new left/top/width/height for each, keyed by id.
- Use the whole target canvas — do NOT just center the source design with empty bands above and below it.
- The main IMAGE/photo layer should grow to fill the extra vertical space (a 9:16 frame wants a tall photo area).
- Keep the brand logo fully visible, at a similar relative size, in a comparable corner.
- Preserve visual hierarchy and reading order (headline above subtext, info band near the bottom, etc.).
- Keep all TEXT inside the canvas with at least a 48px margin from every edge, and never overlap two text blocks. Return a scaled fontSize for each text layer so it stays proportional.
- Scale width and height together for layers where aspect matters (logos, photos).
- Never push any layer off-canvas; never return negative sizes.

Return ONLY JSON, no prose, in exactly this shape:
{"layers":[{"id":"<id>","left":<px>,"top":<px>,"width":<px>,"height":<px>,"fontSize":<px, text layers only>}]}`;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Reflow a square card schema into a 9:16 schema via a single Claude call.
 * Returns ok:false with a friendly message if the key is missing or the model
 * returns unusable JSON (the caller should fall back to the default hero).
 */
export async function reflowSchemaToVertical(
  squareSchema: CanvasTemplateSchema,
): Promise<ReflowResult> {
  const client = await getAnthropic();
  if (!client) {
    return { ok: false, error: "Anthropic API key is not configured." };
  }

  const target = PLATFORM_DIMENSIONS.story_9x16;
  const round = (n: number): number => Math.round(n);

  const layerSummary = squareSchema.layers.map((l) => {
    const base: Record<string, unknown> = {
      id: l.id,
      kind: l.kind,
      name: l.name,
      left: round(l.left),
      top: round(l.top),
      width: round(l.width),
      height: round(l.height),
    };
    if (l.kind === "text") {
      base.text = l.text ? l.text.slice(0, 48) : "";
      base.fontSize = l.fontSize;
    } else if (l.kind === "image") {
      base.objectFit = l.objectFit;
    }
    return base;
  });

  const userPayload = JSON.stringify({
    source: { width: squareSchema.width, height: squareSchema.height },
    target: { width: target.width, height: target.height },
    layers: layerSummary,
  });

  let response;
  try {
    response = await client.messages.create({
      model: ANTHROPIC_MODELS.sonnet,
      max_tokens: 4000,
      system: REFLOW_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPayload }],
    });
  } catch (e) {
    return {
      ok: false,
      error: `reflow API call failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJson(raw) as {
    layers?: Array<Record<string, unknown>>;
  } | null;
  if (!parsed || !Array.isArray(parsed.layers)) {
    return {
      ok: false,
      error: `reflow returned malformed JSON. First 300 chars: ${raw.slice(0, 300)}`,
    };
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const g of parsed.layers) {
    const id = g.id;
    if (typeof id === "string") byId.set(id, g);
  }

  const newLayers: CanvasLayer[] = squareSchema.layers.map((l) => {
    const g = byId.get(l.id);
    if (!g) return l;
    const gw = num(g.width);
    const gh = num(g.height);
    const gl = num(g.left);
    const gt = num(g.top);
    const width = gw != null ? clamp(gw, 1, target.width * 1.5) : l.width;
    const height = gh != null ? clamp(gh, 1, target.height * 1.5) : l.height;
    const left = gl != null ? clamp(gl, -target.width, target.width) : l.left;
    const top = gt != null ? clamp(gt, -target.height, target.height) : l.top;
    if (l.kind === "text") {
      const gf = num(g.fontSize);
      const fontSize = gf != null ? clamp(gf, 8, 400) : l.fontSize;
      return { ...l, left, top, width, height, fontSize };
    }
    return { ...l, left, top, width, height };
  });

  return {
    ok: true,
    schema: {
      ...squareSchema,
      format: "story_9x16",
      width: target.width,
      height: target.height,
      layers: newLayers,
      updatedAt: new Date().toISOString(),
    },
  };
}
