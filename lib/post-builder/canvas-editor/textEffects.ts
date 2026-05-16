/**
 * Text effect → Fabric.js property mapping (Phase B.3).
 * --------------------------------------------------------------------------
 *
 * Single source of truth for translating a `TextEffect` from the schema
 * into the concrete Fabric `Textbox` props (`shadow`, `stroke`,
 * `strokeWidth`, `paintFirst`).
 *
 * Both the editor (client-side Fabric in CanvasEditor.tsx) and the worker
 * (server-side render.js) need to apply the SAME mapping, or a rendered
 * Reel/Post won't match what the user saw in Studio. The worker can't
 * import this TS file directly, so its `render.js` carries a duplicated
 * implementation that MUST match — if you change anything here, mirror
 * it there.
 *
 * Return shape: a plain `TextEffectFabricProps` object the caller spreads
 * into `textbox.set(props)`. `shadow` is returned as a Fabric `Shadow`
 * instance (or `null` to clear); `stroke` and `strokeWidth` carry the
 * outline params; `paintFirst` controls whether the stroke renders
 * under (`stroke`) or over (`fill`) the fill — outlined text reads
 * better with `paintFirst: "stroke"`.
 */

import { Shadow } from "fabric";

import type { TextEffect } from "./types";

export interface TextEffectFabricProps {
  shadow: Shadow | null;
  stroke: string;
  strokeWidth: number;
  /** Fabric's paint order. "fill" (default) draws fill THEN stroke; "stroke"
   *  draws stroke first so a thick outline doesn't eat into the fill glyph. */
  paintFirst: "fill" | "stroke";
}

/**
 * Map a TextEffect (or undefined) to the Fabric properties that produce it.
 * Returns a stable "no effect" baseline for `undefined` / `{ kind: "none" }`
 * so callers can always spread the result onto a Textbox without checking.
 */
export function textEffectToFabricProps(
  effect: TextEffect | undefined,
): TextEffectFabricProps {
  if (!effect || effect.kind === "none") {
    return {
      shadow: null,
      stroke: "",
      strokeWidth: 0,
      paintFirst: "fill",
    };
  }

  switch (effect.kind) {
    case "shadow": {
      // why: build a Fabric Shadow instance directly — Fabric also accepts a
      // string shorthand ("color offX offY blur") but the instance form is
      // unambiguous and matches what Canva exports look like.
      return {
        shadow: new Shadow({
          color: effect.color,
          offsetX: effect.offsetX,
          offsetY: effect.offsetY,
          blur: effect.blur,
        }),
        stroke: "",
        strokeWidth: 0,
        paintFirst: "fill",
      };
    }
    case "outline": {
      // why: paintFirst="stroke" keeps the fill glyph intact — a thick stroke
      // drawn AFTER fill would cut into the letterforms from inside, which
      // looks broken at large outline widths.
      return {
        shadow: null,
        stroke: effect.color,
        strokeWidth: effect.width,
        paintFirst: "stroke",
      };
    }
    case "lift": {
      // why: fixed offset + blur, opacity-only knob. Renders an unobtrusive
      // black drop shadow that gives text a subtle pop off the background —
      // matches Canva's "Lift" preset which doesn't expose the geometry.
      const clamped = Math.max(0, Math.min(1, effect.opacity));
      const alpha = Math.round(clamped * 255)
        .toString(16)
        .padStart(2, "0");
      return {
        shadow: new Shadow({
          color: `#000000${alpha}`,
          offsetX: 0,
          offsetY: 4,
          blur: 12,
        }),
        stroke: "",
        strokeWidth: 0,
        paintFirst: "fill",
      };
    }
    case "splice": {
      // why: approximate Canva's Splice (outlined text + offset duplicate
      // behind it) using a single Textbox. We render the main text outlined
      // (stroke + paintFirst), then attach a Shadow with blur=0 in the same
      // outline color so it reads as a colored offset copy. Not pixel-
      // perfect to Canva's two-layer technique but visually convincing and
      // avoids splitting one TextLayer into two Fabric objects.
      return {
        shadow: new Shadow({
          color: effect.outlineColor,
          offsetX: effect.offsetX,
          offsetY: effect.offsetY,
          blur: 0,
        }),
        stroke: effect.outlineColor,
        strokeWidth: effect.outlineWidth,
        paintFirst: "stroke",
      };
    }
  }
}

/**
 * Default-parameter library used by the preset chips. Picking a preset
 * via the UI starts from one of these — the user can then tune the
 * params via the slider/color controls.
 *
 * Why default specs (vs. just kinds): the "Shadow" chip has multiple
 * recognizable looks; we pick the most common ("soft drop") as the
 * default. Same logic for outline (medium) and splice (3px offset).
 */
export const TEXT_EFFECT_PRESETS: Readonly<{
  none: { kind: "none" };
  shadow: Extract<TextEffect, { kind: "shadow" }>;
  outline: Extract<TextEffect, { kind: "outline" }>;
  lift: Extract<TextEffect, { kind: "lift" }>;
  splice: Extract<TextEffect, { kind: "splice" }>;
}> = {
  none: { kind: "none" },
  shadow: {
    kind: "shadow",
    offsetX: 0,
    offsetY: 4,
    blur: 8,
    color: "#00000080",
  },
  outline: {
    kind: "outline",
    width: 3,
    color: "#000000",
  },
  lift: {
    kind: "lift",
    opacity: 0.5,
  },
  splice: {
    kind: "splice",
    offsetX: 4,
    offsetY: 4,
    outlineColor: "#000000",
    outlineWidth: 2,
  },
};
