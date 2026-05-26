"use client";

/**
 * HsvPicker — visual color picker with saturation/value pad + hue slider.
 * -----------------------------------------------------------------------
 *
 * Lives inside the ColorPicker popover so users can pick any color visually
 * when the curated swatches don't have what they need. Same pattern as
 * Canva's "+ Custom" affordance.
 *
 * Anatomy:
 *   • SV pad — a 2D area where X = saturation (0..1) and Y = value/
 *     brightness inverted (top = 1, bottom = 0). Background is two stacked
 *     gradients (white→hue right, transparent→black down) so the pad shows
 *     every (S,V) combination of the current hue. A small circle indicates
 *     the current (S,V) coords.
 *   • Hue slider — horizontal range showing the 0..360 rainbow. The thumb
 *     position picks the current hue.
 *   • Hex echo + Apply — types-in alternative to dragging. Also accepts the
 *     EyeDropper API on supported browsers (Chrome 95+, Edge).
 *
 * State model:
 *   We internally track H, S, V. On every change, we compute hex and emit
 *   via onChange. We DON'T treat the parent's `value` as fully authoritative
 *   while dragging — converting hex→HSV then back to hex is lossy at the
 *   extreme ends of the value axis (e.g., pure black, pure white). Instead,
 *   we sync HSV from the parent value when it changes externally (different
 *   layer selected, swatch picked elsewhere), but keep our own HSV during
 *   a drag so the position indicator doesn't jump around.
 */

import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface HsvPickerProps {
  /** Current value as a hex string ("#RRGGBB"). Drives the pad/slider positions. */
  value: string;
  /** Fired on every drag tick + hex commit + eyedropper pick. */
  onChange: (next: string) => void;
}

interface Hsv {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

// ===========================================================================
// HSV / RGB / hex conversion math (pure, no React)
// ===========================================================================

function hexToRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    // expand 3-digit shorthand
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b };
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    const s = clamped.toString(16).toUpperCase();
    return s.length === 1 ? "0" + s : s;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  // why: standard textbook HSV conversion. Inputs are 0..255, outputs are
  // h: 0..360, s: 0..1, v: 0..1.
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rN) h = ((gN - bN) / delta) % 6;
    else if (max === gN) h = (bN - rN) / delta + 2;
    else h = (rN - gN) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb(
  h: number,
  s: number,
  v: number,
): { r: number; g: number; b: number } {
  // why: standard textbook HSV→RGB. h in 0..360, s/v in 0..1. Outputs 0..255.
  const c = v * s;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (hh < 1) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (hh < 2) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (hh < 3) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (hh < 4) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (hh < 5) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }
  const m = v - c;
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
  };
}

function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

function hsvToHex(h: number, s: number, v: number): string {
  const rgb = hsvToRgb(h, s, v);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// ===========================================================================
// Eyedropper API typing helper
// ===========================================================================

interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperInstance {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>;
}
interface EyeDropperConstructor {
  new (): EyeDropperInstance;
}

function getEyeDropper(): EyeDropperConstructor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { EyeDropper?: EyeDropperConstructor })
    .EyeDropper;
  return ctor ?? null;
}

// ===========================================================================
// HsvPicker component
// ===========================================================================

export default function HsvPicker(props: HsvPickerProps): JSX.Element {
  const { value, onChange } = props;
  const padRef = useRef<HTMLDivElement | null>(null);
  // why: we track our OWN HSV state rather than re-deriving from `value`
  // every render. Reason: hex→HSV is lossy at S=0 (every gray maps to h=0,
  // losing the user's intended hue). If we derived on every render, picking
  // a black or white in the pad would snap the hue thumb to red. Keeping
  // our own state preserves the user's intent through low-saturation
  // values.
  const [hsv, setHsv] = useState<Hsv>(() => {
    return hexToHsv(value) ?? { h: 0, s: 0, v: 0 };
  });
  const [hexInput, setHexInput] = useState<string>(value);
  const draggingRef = useRef<boolean>(false);

  // why: sync from parent when value changes externally AND we're not in
  // the middle of a drag. Drags update both state and parent simultaneously,
  // so the parent will echo the value back — without the dragging guard
  // we'd fight ourselves and the thumb would lag.
  useEffect(() => {
    if (draggingRef.current) return;
    setHexInput(value);
    const next = hexToHsv(value);
    if (!next) return;
    // why: preserve hue when the new value has zero saturation (black/gray/
    // white). Same reason as above — locks the hue slider to the user's
    // last intentional hue choice instead of snapping to red.
    setHsv((prev) =>
      next.s === 0 ? { h: prev.h, s: 0, v: next.v } : next,
    );
  }, [value]);

  const commit = useCallback(
    (h: number, s: number, v: number) => {
      const next = hsvToHex(h, s, v);
      setHexInput(next);
      onChange(next);
    },
    [onChange],
  );

  // ----- SV pad drag handling -----
  const handlePadPointer = useCallback(
    (clientX: number, clientY: number) => {
      const pad = padRef.current;
      if (!pad) return;
      const rect = pad.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const newS = rect.width === 0 ? 0 : x / rect.width;
      // why: invert Y because the pad's top is value=1 (brightest), bottom
      // is value=0 (black). Matches Canva / Photoshop convention.
      const newV = rect.height === 0 ? 1 : 1 - y / rect.height;
      setHsv((prev) => {
        const next = { h: prev.h, s: newS, v: newV };
        commit(next.h, next.s, next.v);
        return next;
      });
    },
    [commit],
  );

  const handlePadMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    draggingRef.current = true;
    handlePadPointer(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent): void => {
      handlePadPointer(ev.clientX, ev.clientY);
    };
    const onUp = (): void => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handlePadTouchStart = (e: React.TouchEvent<HTMLDivElement>): void => {
    draggingRef.current = true;
    const t = e.touches[0];
    if (t) handlePadPointer(t.clientX, t.clientY);
    const onMove = (ev: TouchEvent): void => {
      const tt = ev.touches[0];
      if (tt) handlePadPointer(tt.clientX, tt.clientY);
    };
    const onEnd = (): void => {
      draggingRef.current = false;
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onEnd);
  };

  // ----- Hue slider -----
  const handleHueChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const h = Number(e.target.value);
    if (!Number.isFinite(h)) return;
    setHsv((prev) => {
      const next = { h, s: prev.s, v: prev.v };
      commit(next.h, next.s, next.v);
      return next;
    });
  };

  // ----- Hex input -----
  const handleHexCommit = (): void => {
    const next = hexToHsv(hexInput);
    if (!next) {
      // revert to last good
      setHexInput(value);
      return;
    }
    setHsv((prev) =>
      next.s === 0 ? { h: prev.h, s: 0, v: next.v } : next,
    );
    const final = hsvToHex(
      next.s === 0 ? hsv.h : next.h,
      next.s,
      next.v,
    );
    onChange(final);
    setHexInput(final);
  };

  // ----- Eyedropper -----
  const EyeDropperCtor = getEyeDropper();
  const handleEyedropper = async (): Promise<void> => {
    if (!EyeDropperCtor) return;
    try {
      const instance = new EyeDropperCtor();
      const result = await instance.open();
      // why: EyeDropper returns "#rrggbb" in sRGB. Normalize to upper-case
      // 6-digit format so it matches the rest of our palette display.
      const normalized = result.sRGBHex.toUpperCase();
      const asHsv = hexToHsv(normalized);
      if (!asHsv) return;
      setHsv((prev) =>
        asHsv.s === 0 ? { h: prev.h, s: 0, v: asHsv.v } : asHsv,
      );
      setHexInput(normalized);
      onChange(normalized);
    } catch {
      // user aborted (Esc) or API failure — silent.
    }
  };

  // ----- Derived render values -----
  const hueColor = hsvToHex(hsv.h, 1, 1);
  const thumbX = `${hsv.s * 100}%`;
  // top = 0 → value 1, top = 100% → value 0
  const thumbY = `${(1 - hsv.v) * 100}%`;
  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);

  // why: the SV pad background is two stacked gradients drawn behind the
  // pointer/cursor. We compose them with linear-gradient and overlay the
  // black gradient via background-blend-mode "normal" (default), but
  // because gradients are alpha-blended we use a second layer.
  const padBackground: CSSProperties = {
    background: `
      linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 100%),
      linear-gradient(to right, #FFFFFF 0%, ${hueColor} 100%)
    `,
  };

  return (
    <div className="space-y-2">
      {/* ===== Saturation × Value pad ===== */}
      <div
        ref={padRef}
        onMouseDown={handlePadMouseDown}
        onTouchStart={handlePadTouchStart}
        role="application"
        aria-label="Saturation and brightness picker"
        className="relative h-32 w-full cursor-crosshair overflow-hidden rounded-md border border-[var(--studio-border)] select-none"
        style={padBackground}
      >
        {/* Position indicator — small circle showing current (S, V). */}
        <div
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{
            left: thumbX,
            top: thumbY,
            backgroundColor: currentHex,
          }}
        />
      </div>

      {/* ===== Hue slider =====
          why: the rainbow track + circular thumb styling lives in
          lib/post-builder/canvas-editor/fonts.css (canvas-editor-scoped
          CSS that only loads when the editor mounts). Class `hsv-hue-slider`
          is unique to this component. */}
      <input
        type="range"
        min={0}
        max={360}
        step={1}
        value={Math.round(hsv.h)}
        onChange={handleHueChange}
        aria-label="Hue"
        className="hsv-hue-slider w-full"
      />

      {/* ===== Hex input + Eyedropper ===== */}
      <div className="flex items-center gap-2">
        <div
          className="h-7 w-7 flex-shrink-0 rounded-md border border-[var(--studio-border)]"
          style={{ backgroundColor: currentHex }}
          aria-label="Current color preview"
        />
        <input
          type="text"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleHexCommit();
            }
          }}
          className="flex-1 rounded-md border border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] px-2 py-1 text-sm font-mono uppercase text-white focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
          maxLength={9}
          spellCheck={false}
        />
        {EyeDropperCtor ? (
          <button
            type="button"
            onClick={() => void handleEyedropper()}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[var(--studio-border)] text-white hover:bg-[var(--studio-hover)]"
            aria-label="Pick color from screen (eyedropper)"
            title="Pick color from screen"
          >
            {/* why: eyedropper glyph rendered as inline SVG to match the
                rest of the editor's icon style — no lucide dep. */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.5 2.5l3 3" />
              <path d="M12 1.5l2.5 2.5-2 2-2.5-2.5z" />
              <path d="M10 4l-6.5 6.5L2 14l3.5-1.5L12 6" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
