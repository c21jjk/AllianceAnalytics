"use client";

/**
 * ColorPickerPanel — Canva-style full-height left panel for color selection.
 * ---------------------------------------------------------------------------
 *
 * 2026-05-26. Mirrors `FontPickerPanel.tsx` + `EffectsPanel.tsx`: sits at
 * left:64px (just right of the icon rail), 320px wide, full editor height,
 * z-30 so it covers whichever left tab is currently active. Replaces the
 * legacy in-place popover that lived inside `primitives/ColorPicker.tsx` so
 * the picker has room for an HSV pad, hex input, eyedropper, document
 * colors, photo colors, brand swatches, and neutrals without overflowing.
 *
 * The trigger swatch button still lives in `primitives/ColorPicker.tsx` —
 * clicking it now calls back up to `CanvasEditor` which opens THIS panel
 * with a target ("text" | "shape_fill" | "shape_stroke" | "text_background"
 * | "background") and the current value. Apply paths are owned by the
 * editor — this panel is purely presentational and emits `onApply` /
 * `onPreview` / `onClose`.
 *
 * Behavior matches FontPickerPanel + EffectsPanel:
 *   • Click swatch / hex commit / eyedropper pick → applies + records history.
 *   • HsvPicker drag → live-previews on every tick; commits once on pointer-up.
 *   • Panel stays open so the user can keep browsing.
 *   • Close via X / Escape / click outside / selection-clear (for selection
 *     targets — "background" is always available so it doesn't auto-close).
 *   • Mounted only when `open` is true (parent owns the boolean).
 */

import { Pipette as LPipette, X as LX } from "lucide-react";
import {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import HsvPicker from "../primitives/HsvPicker";
import { ALLIANCE_COLORS } from "../templates/tokens";

// ===========================================================================
// Target concept
// ===========================================================================

/**
 * Where the picked color should land. CanvasEditor owns the apply path and
 * uses this discriminator to know which Fabric property to mutate.
 */
export type ColorTarget =
  | "text"
  | "shape_fill"
  | "shape_stroke"
  | "text_background"
  | "background";

const HEADER_LABEL_BY_TARGET: Readonly<Record<ColorTarget, string>> = {
  text: "Text color",
  shape_fill: "Fill",
  shape_stroke: "Stroke",
  text_background: "Highlight",
  background: "Background color",
};

// ===========================================================================
// Curated palettes
// ===========================================================================

/**
 * Alliance brand swatches — same content the legacy popover surfaced. Order
 * follows brand-anchored intent: gold first (primary accent), then darks,
 * then whites. "Recent" / "Photo" / "Design" stay dynamic; this one is the
 * always-visible curated palette.
 */
const ALLIANCE_SWATCHES: ReadonlyArray<{ value: string; label: string }> = [
  { value: ALLIANCE_COLORS.gold500, label: "Alliance Gold" },
  { value: ALLIANCE_COLORS.gold600, label: "Gold Dark" },
  { value: ALLIANCE_COLORS.gold100, label: "Gold Light" },
  { value: ALLIANCE_COLORS.ink900, label: "Obsessed Grey" },
  { value: ALLIANCE_COLORS.ink800, label: "Ink 800" },
  { value: ALLIANCE_COLORS.ink700, label: "Ink 700" },
  { value: ALLIANCE_COLORS.white, label: "White" },
  { value: ALLIANCE_COLORS.whiteWarm, label: "Warm White" },
  { value: ALLIANCE_COLORS.whiteDim, label: "Dim White" },
];

/**
 * Neutral grayscale ramp + transparent. Same set the legacy popover used;
 * "transparent" is conditionally included via `allowTransparent`.
 */
const NEUTRAL_RAMP: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#FFFFFF", label: "White" },
  { value: "#F5F5F5", label: "Neutral 100" },
  { value: "#D4D4D4", label: "Neutral 300" },
  { value: "#A3A3A3", label: "Neutral 400" },
  { value: "#525252", label: "Neutral 600" },
  { value: "#262626", label: "Neutral 800" },
  { value: "#000000", label: "Black" },
  { value: "transparent", label: "Transparent / no fill" },
];

// ===========================================================================
// Hex helpers
// ===========================================================================

/**
 * Sanitize a hex string. Returns null if invalid. Accepts forms:
 *   • "#RGB"   → expands to "#RRGGBB"
 *   • "#RRGGBB"
 *   • "RRGGBB" (no leading #)
 *   • "transparent" — passes through when allowTransparent is true
 *
 * Same semantics as the legacy primitives/ColorPicker.tsx normalizer so the
 * apply path doesn't regress on inputs people are used to.
 */
function normalizeHex(raw: string, allowTransparent: boolean): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (allowTransparent && trimmed === "transparent") return "transparent";
  const digits = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/.test(digits)) {
    return (
      "#" +
      digits
        .split("")
        .map((c) => c + c)
        .join("")
        .toUpperCase()
    );
  }
  if (/^[0-9a-f]{6}$/.test(digits)) {
    return "#" + digits.toUpperCase();
  }
  return null;
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
// Props
// ===========================================================================

interface ColorPickerPanelProps {
  /** Drives whether the panel is mounted. Parent flips this. */
  open: boolean;
  /** Target — drives header label + apply path. */
  target: ColorTarget;
  /**
   * Current value of the target. Hex ("#RRGGBB") OR "transparent" OR "" (also
   * treated as transparent for display). Drives the HsvPicker pad position
   * + active-swatch ring.
   */
  currentValue: string;
  /** Distinct hex values in use across the canvas right now. Hidden when empty. */
  documentColors: ReadonlyArray<string>;
  /** Dominant colors extracted from canvas photos. Hidden when empty. */
  photoColors: ReadonlyArray<string>;
  /**
   * When true, the "Transparent" neutral chip is shown. Use for stroke /
   * highlight (allow no-fill) but NOT for text fill or background color.
   */
  allowTransparent: boolean;
  /**
   * Apply (commit) — fires on swatch clicks, hex Enter/blur, eyedropper pick,
   * and HsvPicker pointer-up. Recorded in undo history.
   */
  onApply: (value: string) => void;
  /**
   * Live preview — fires on HsvPicker drag tick. Should write to Fabric but
   * NOT record history. Lets the user see the color update under their cursor
   * without spamming the undo stack with a step per pixel.
   */
  onPreview: (value: string) => void;
  /** Close handler — wired to X / Escape / outside-click / selection-clear. */
  onClose: () => void;
  /**
   * Anchor ref of the trigger swatch. Focus returns to it on close so
   * keyboard users land back where they started.
   */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

// ===========================================================================
// Top-level panel
// ===========================================================================

export default function ColorPickerPanel(
  props: ColorPickerPanelProps,
): JSX.Element | null {
  const {
    open,
    target,
    currentValue,
    documentColors,
    photoColors,
    allowTransparent,
    onApply,
    onPreview,
    onClose,
    triggerRef,
  } = props;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const hexInputRef = useRef<HTMLInputElement | null>(null);

  // why: hex input is a controlled string so the user can type freely without
  // every keystroke fighting a normalization pass. We commit on Enter / blur
  // / explicit Apply click. Syncs from `currentValue` when external mutations
  // bump the value (e.g., selection change while panel is open).
  const [hexInput, setHexInput] = useState<string>(currentValue);
  useEffect(() => {
    setHexInput(currentValue);
  }, [currentValue]);

  // why: lightweight in-session "recent colors" list. Not persisted — matches
  // the legacy popover's behavior (per the file comment there: "Persisting
  // across sessions would mean Supabase or localStorage; per project rules
  // localStorage is fine on the client but the value here isn't important
  // enough to ship a schema for"). Resets when the editor remounts.
  const [recents, setRecents] = useState<readonly string[]>([]);

  // ----- Escape key closes -----
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ----- Outside-click closes -----
  // why: any click outside the panel (canvas, other sidebars, header, etc.)
  // closes so the user can resume working. We exclude the panel itself + the
  // trigger so clicking the trigger doesn't immediately re-close before the
  // trigger's onClick fires.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      // why: the EyeDropper API spawns a system-level overlay — clicks during
      // an active eyedropper session may report as document mousedowns on
      // arbitrary elements. The system overlay isn't a DOM descendant of the
      // panel, which would otherwise close the panel mid-pick. There's no
      // ergonomic way to detect "eyedropper session active" from JS — rely
      // on the user understanding that opening the eyedropper is a single
      // discrete action.
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose, triggerRef]);

  // ----- Return focus to trigger on close -----
  useEffect(() => {
    if (open) return;
    if (triggerRef?.current) {
      triggerRef.current.focus();
    }
  }, [open, triggerRef]);

  // ----- Commit helper — apply + track in recents -----
  const commit = useCallback(
    (value: string): void => {
      onApply(value);
      if (value === "transparent" || value === "") return;
      setRecents((prev) => {
        const filtered = prev.filter((c) => c !== value);
        return [value, ...filtered].slice(0, 12);
      });
    },
    [onApply],
  );

  // ----- HsvPicker drag wiring — preview during, commit on pointer-up -----
  // why: HsvPicker fires onChange on every drag tick. Treating each tick as a
  // commit (the legacy popover's behavior) creates an undo step per pixel,
  // which is unusable. Instead we route ticks through `onPreview` (writes to
  // Fabric, no history), then commit ONCE when the user releases the mouse
  // anywhere on the page.
  const draggingRef = useRef<boolean>(false);
  const latestDragValueRef = useRef<string>(currentValue);

  const handleHsvChange = useCallback(
    (next: string): void => {
      latestDragValueRef.current = next;
      setHexInput(next);
      onPreview(next);
      // Mark as dragging so the global mouseup handler knows to commit. The
      // very first onChange on a pointerdown also flows through here (HsvPicker
      // calls handlePadPointer synchronously on mousedown), so we set the
      // flag every time and clear it on mouseup.
      draggingRef.current = true;
    },
    [onPreview],
  );

  useEffect(() => {
    const onUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      commit(latestDragValueRef.current);
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [commit]);

  // ----- Hex commit -----
  const handleHexCommit = useCallback((): void => {
    const normalized = normalizeHex(hexInput, allowTransparent);
    if (normalized === null) {
      setHexInput(currentValue);
      return;
    }
    setHexInput(normalized);
    commit(normalized);
  }, [hexInput, currentValue, allowTransparent, commit]);

  // ----- Eyedropper -----
  const EyeDropperCtor = useMemo(() => getEyeDropper(), []);
  const handleEyedropper = useCallback(async (): Promise<void> => {
    if (!EyeDropperCtor) return;
    try {
      const instance = new EyeDropperCtor();
      const result = await instance.open();
      const normalized = result.sRGBHex.toUpperCase();
      setHexInput(normalized);
      commit(normalized);
    } catch {
      // user aborted (Esc) or API failure — silent.
    }
  }, [EyeDropperCtor, commit]);

  // ----- Derived -----
  const headerLabel = HEADER_LABEL_BY_TARGET[target];
  const isTransparent =
    currentValue === "transparent" || currentValue === "";

  // why: the HsvPicker pad needs a real hex to position the cursor. When the
  // current value is transparent/empty, fall back to gold so the pad shows a
  // meaningful starting point.
  const hsvValue = isTransparent ? ALLIANCE_COLORS.gold500 : currentValue;

  // why: neutrals filter — strip transparent when not allowed, same as the
  // legacy popover did.
  const neutrals = allowTransparent
    ? NEUTRAL_RAMP
    : NEUTRAL_RAMP.filter((s) => s.value !== "transparent");

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      data-studio-panel="color-picker"
      role="dialog"
      aria-modal="false"
      aria-labelledby="color-picker-panel-title"
      className="fixed bottom-0 left-16 top-0 z-30 flex w-80 flex-col border-r border-[var(--studio-border)] bg-[var(--studio-panel)] shadow-2xl shadow-black/40"
    >
      {/* ----- Header ----- */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--studio-border)] px-4">
        <h2
          id="color-picker-panel-title"
          className="text-sm font-medium text-white"
        >
          {headerLabel}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close color picker"
          title="Close color picker"
          className="focus-ring-dark rounded p-1 text-[var(--studio-text-muted)] transition-colors hover:bg-[var(--studio-hover)] hover:text-white"
        >
          <LX size={16} />
        </button>
      </header>

      {/* ----- Scrollable body ----- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* === Section: Custom (HsvPicker + hex + eyedropper) === */}
        <Eyebrow>Custom</Eyebrow>
        <div className="px-4 pb-3">
          <HsvPicker value={hsvValue} onChange={handleHsvChange} />
          {/* why: HsvPicker already renders its own hex input + eyedropper,
              so we don't render a duplicate row here — keeps the panel
              compact. The HsvPicker's hex input writes through to the same
              `onChange` (handled by handleHsvChange) which also feeds the
              recents tracker via the global mouseup commit. */}
        </div>

        {/* === Section: Type a hex / pick from screen ===
            Standalone hex field outside HsvPicker — slightly redundant with
            HsvPicker's internal hex input, but Canva surfaces a dedicated
            "type a value" field too so the user has an obvious copy/paste
            target. Kept narrow + below to avoid stealing focus on open. */}
        <Eyebrow>Hex</Eyebrow>
        <div className="flex items-center gap-2 px-4 pb-4">
          <div
            className="h-7 w-7 flex-shrink-0 rounded-md border border-[var(--studio-border)]"
            style={{
              background: isTransparent
                ? "repeating-conic-gradient(#e5e5e2 0% 25%, #ffffff 0% 50%) 50% / 8px 8px"
                : currentValue,
            }}
            aria-label="Current color preview"
          />
          <input
            ref={hexInputRef}
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
            placeholder={
              allowTransparent ? '"transparent" or "#C9A84C"' : '"#C9A84C"'
            }
            className="focus-ring-dark flex-1 rounded border border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] px-2 py-1.5 text-sm font-mono uppercase text-white placeholder:text-[var(--studio-input-placeholder)] placeholder:font-sans placeholder:normal-case"
            maxLength={12}
            spellCheck={false}
            aria-label="Hex color value"
          />
          {EyeDropperCtor ? (
            <button
              type="button"
              onClick={() => void handleEyedropper()}
              className="focus-ring-dark flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-[var(--studio-border)] text-white hover:bg-[var(--studio-hover)]"
              aria-label="Pick color from screen (eyedropper)"
              title="Pick color from screen"
            >
              <LPipette size={14} />
            </button>
          ) : null}
        </div>

        {/* === Section: Colors in this design === */}
        {documentColors.length > 0 ? (
          <>
            <Eyebrow>Colors in this design</Eyebrow>
            <SwatchGrid
              swatches={documentColors.map((c) => ({ value: c, label: c }))}
              current={currentValue}
              onPick={commit}
            />
          </>
        ) : null}

        {/* === Section: Photo colors === */}
        {photoColors.length > 0 ? (
          <>
            <Eyebrow>Photo colors</Eyebrow>
            <SwatchGrid
              swatches={photoColors.map((c) => ({ value: c, label: c }))}
              current={currentValue}
              onPick={commit}
            />
          </>
        ) : null}

        {/* === Section: Alliance brand === */}
        <Eyebrow>Alliance brand</Eyebrow>
        <SwatchGrid
          swatches={ALLIANCE_SWATCHES}
          current={currentValue}
          onPick={commit}
        />

        {/* === Section: Neutrals === */}
        <Eyebrow>Neutrals</Eyebrow>
        <SwatchGrid
          swatches={neutrals}
          current={currentValue}
          onPick={commit}
        />

        {/* === Section: Recent === */}
        {recents.length > 0 ? (
          <>
            <Eyebrow>Recent</Eyebrow>
            <SwatchGrid
              swatches={recents.map((c) => ({ value: c, label: c }))}
              current={currentValue}
              onPick={commit}
            />
          </>
        ) : null}

        {/* why: little tail so the last row doesn't stick to the panel bottom. */}
        <div className="h-3" aria-hidden="true" />
      </div>
    </aside>
  );
}

// ===========================================================================
// Eyebrow label
// ===========================================================================

function Eyebrow(props: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-4 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
      {props.children}
    </div>
  );
}

// ===========================================================================
// SwatchGrid — 6-col grid of 28px square swatches
// ===========================================================================

interface SwatchGridProps {
  swatches: ReadonlyArray<{ value: string; label: string }>;
  current: string;
  onPick: (value: string) => void;
}

function SwatchGrid(props: SwatchGridProps): JSX.Element {
  return (
    <div className="grid grid-cols-6 gap-2 px-4 pb-2">
      {props.swatches.map((s) => (
        <ColorSwatch
          key={s.value}
          color={s.value}
          label={s.label}
          active={s.value === props.current}
          onClick={() => props.onPick(s.value)}
        />
      ))}
    </div>
  );
}

// ===========================================================================
// ColorSwatch — single 28px square button
// ===========================================================================

interface ColorSwatchProps {
  color: string;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function ColorSwatch(props: ColorSwatchProps): JSX.Element {
  const { color, label, active = false, onClick } = props;
  const isTransparent = color === "transparent" || color === "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring-dark h-7 w-7 rounded-md border transition-shadow ${
        active
          ? "border-transparent ring-2 ring-gold-500 ring-offset-2 ring-offset-[var(--studio-panel)]"
          : "border-[var(--studio-border)] hover:border-white/30"
      }`}
      style={{
        background: isTransparent
          ? "repeating-conic-gradient(#e5e5e2 0% 25%, #ffffff 0% 50%) 50% / 8px 8px"
          : color,
      }}
      aria-label={`Use color ${label}`}
      title={label}
    />
  );
}
