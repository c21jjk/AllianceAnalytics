"use client";

/**
 * ColorPicker — shared primitive for the canvas editor properties panels.
 * -----------------------------------------------------------------------
 *
 * Used by the text fill picker, the shape fill picker, and the shape stroke
 * picker. Shows Alliance brand swatches first (so the most likely choice is
 * one click), then a neutral ramp, then a hex input for custom values, plus
 * a "recent colors" row that remembers within-session choices.
 *
 * Why a custom primitive and not a library:
 *   • react-color and similar add ~80KB for features we don't need (HSL
 *     wheels, alpha sliders, advanced gradient pickers). The canvas editor
 *     never opens a color outside hex RGB.
 *   • Per project conventions: no third-party UI component libraries —
 *     custom Tailwind elements only.
 *
 * Design constraints:
 *   • The popover anchors to a small swatch button. The parent panel passes
 *     `value` (the current hex) and `onChange` (fires on every swatch click
 *     OR a debounced commit from the hex input).
 *   • "transparent" is a real valid value — shape layers use it for
 *     no-fill (outlined-only shapes). Render as a checkerboard swatch.
 *   • A "recent colors" row is component-local state — not persisted.
 *     Persisting across sessions would mean Supabase or localStorage; per
 *     project rules localStorage is fine on the client but the value here
 *     isn't important enough to ship a schema for.
 */

import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ALLIANCE_COLORS } from "../templates/tokens";

/**
 * Alliance brand-curated swatches, surfaced first. Order matters — gold is
 * the primary accent so it's first; whites/greys are next for type and
 * surfaces; off-brand alternatives (red/green/blue) are intentionally NOT
 * shown to discourage off-brand designs. Users can still pick anything via
 * the hex input.
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

const NEUTRAL_RAMP: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#000000", label: "Black" },
  { value: "#262626", label: "Neutral 800" },
  { value: "#525252", label: "Neutral 600" },
  { value: "#A3A3A3", label: "Neutral 400" },
  { value: "#D4D4D4", label: "Neutral 300" },
  { value: "#F5F5F5", label: "Neutral 100" },
  { value: "#FFFFFF", label: "White" },
  { value: "transparent", label: "Transparent / no fill" },
];

export interface ColorPickerProps {
  /** Current value — hex string ("#RRGGBB") or "transparent" or "" (treated as transparent). */
  value: string;
  /** Fired on every change. Parent decides debouncing for undo history. */
  onChange: (next: string) => void;
  /** Optional label rendered above the swatch trigger. */
  label?: string;
  /** When true, allows transparent. Stroke pickers want this; text fill doesn't. */
  allowTransparent?: boolean;
  /** When true, the picker is disabled. */
  disabled?: boolean;
  /** Compact mode shrinks the trigger to 20px instead of 28px. */
  compact?: boolean;
}

/**
 * Sanitize a hex string. Returns null if invalid. Accepts forms:
 *   • "#RGB"   → expands to "#RRGGBB"
 *   • "#RRGGBB"
 *   • "RRGGBB" (no leading #)
 *   • "transparent" — passes through when allowTransparent is true
 */
function normalizeHex(raw: string, allowTransparent: boolean): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (allowTransparent && trimmed === "transparent") return "transparent";
  // why: strip the leading # so we can validate just the digits.
  const digits = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/.test(digits)) {
    // expand "abc" → "aabbcc"
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

export default function ColorPicker(props: ColorPickerProps): JSX.Element {
  const {
    value,
    onChange,
    label,
    allowTransparent = false,
    disabled = false,
    compact = false,
  } = props;

  const [open, setOpen] = useState<boolean>(false);
  const [hexInput, setHexInput] = useState<string>(value);
  const [recents, setRecents] = useState<readonly string[]>([]);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // why: popover is portaled to document.body to escape the canvas editor's
  // nested stacking contexts (the canvas wrapper uses `transform: scale()`,
  // which creates a new context that was painting over our absolute popover
  // even at z-50). With a portal + position:fixed, the popover lives on the
  // <body> stacking context where nothing else competes.
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // why: sync the hex input when the parent's value changes externally
  // (e.g., user clicked a different layer with a different fill).
  useEffect(() => {
    setHexInput(value);
  }, [value]);

  // why: compute popover position whenever it opens. useLayoutEffect rather
  // than useEffect so the position is set BEFORE the first paint — avoids a
  // single frame where the popover renders at (0, 0) then jumps.
  // The popover is 256px wide; we right-align it to the trigger so it doesn't
  // spill off the right edge of a side panel. If that would put it off the
  // LEFT edge of the viewport, clamp.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPopoverPos(null);
      return;
    }
    const POPOVER_WIDTH = 256;
    const GAP = 8;
    const rect = triggerRef.current.getBoundingClientRect();
    const top = rect.bottom + GAP;
    // Default: right-align popover's right edge to trigger's right edge.
    let left = rect.right - POPOVER_WIDTH;
    // Clamp to viewport — never spill off the left edge.
    if (left < GAP) left = GAP;
    // Clamp right — if the popover would overflow, push it left.
    const maxLeft = window.innerWidth - POPOVER_WIDTH - GAP;
    if (left > maxLeft) left = maxLeft;
    setPopoverPos({ top, left });
  }, [open]);

  // why: reposition on scroll/resize so the popover stays anchored to the
  // trigger even when the user scrolls the panel underneath. Cheap listener;
  // we only attach it while the popover is open.
  useEffect(() => {
    if (!open) return;
    const reposition = (): void => {
      if (!triggerRef.current) return;
      const POPOVER_WIDTH = 256;
      const GAP = 8;
      const rect = triggerRef.current.getBoundingClientRect();
      const top = rect.bottom + GAP;
      let left = rect.right - POPOVER_WIDTH;
      if (left < GAP) left = GAP;
      const maxLeft = window.innerWidth - POPOVER_WIDTH - GAP;
      if (left > maxLeft) left = maxLeft;
      setPopoverPos({ top, left });
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  // why: close the popover on outside click. We listen to mousedown rather
  // than click so we close BEFORE a downstream click handler runs — feels
  // more responsive and avoids a class of "I clicked outside but it didn't
  // close until after my other click took effect" bugs.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const commit = (next: string): void => {
    onChange(next);
    // why: keep recents to the last 6 (display constraint of the recents row).
    // We dedupe so re-picking the same color doesn't shuffle the row.
    if (next === "transparent" || next === "") return;
    setRecents((prev) => {
      const filtered = prev.filter((c) => c !== next);
      return [next, ...filtered].slice(0, 6);
    });
  };

  const handleHexCommit = (): void => {
    const normalized = normalizeHex(hexInput, allowTransparent);
    if (normalized === null) {
      // why: revert the input to the last good value rather than leaving
      // the user staring at their invalid hex. The popover stays open so
      // they can try again.
      setHexInput(value);
      return;
    }
    commit(normalized);
  };

  const isTransparent = value === "transparent" || value === "";
  const triggerSize = compact ? "h-5 w-5" : "h-7 w-7";

  return (
    <div className="relative">
      {label ? (
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          {label}
        </label>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`${triggerSize} flex-shrink-0 rounded-md border border-neutral-300 shadow-card transition-colors hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-50`}
        style={{
          // why: render checkerboard pattern when transparent so the user
          // can distinguish "no fill" from "white fill" at a glance.
          background: isTransparent
            ? "repeating-conic-gradient(#e5e5e2 0% 25%, #ffffff 0% 50%) 50% / 8px 8px"
            : value,
        }}
        aria-label={label ? `${label} color picker` : "Color picker"}
        title={isTransparent ? "Transparent" : value}
      />
      {open && !disabled && popoverPos
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                top: popoverPos.top,
                left: popoverPos.left,
                width: 256,
              }}
              className="z-[100] rounded-xl border border-neutral-200 bg-white p-3 shadow-elevated animate-fade-in-up"
              role="dialog"
              aria-label="Color picker"
            >
          {/* === Alliance brand swatches === */}
          <SwatchRow
            title="Alliance brand"
            swatches={ALLIANCE_SWATCHES}
            current={value}
            onPick={commit}
          />

          {/* === Neutral ramp + transparent === */}
          <SwatchRow
            title="Neutrals"
            swatches={
              allowTransparent
                ? NEUTRAL_RAMP
                : NEUTRAL_RAMP.filter((s) => s.value !== "transparent")
            }
            current={value}
            onPick={commit}
          />

          {/* === Recent colors === */}
          {recents.length > 0 ? (
            <SwatchRow
              title="Recent"
              swatches={recents.map((c) => ({ value: c, label: c }))}
              current={value}
              onPick={commit}
            />
          ) : null}

          {/* === Custom hex input === */}
          <div className="mt-3 border-t border-neutral-100 pt-3">
            <label className="mb-1 block text-xs font-medium text-neutral-600">
              Custom hex
            </label>
            <div className="flex items-center gap-2">
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
                placeholder="#C9A961"
                className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm font-mono uppercase text-neutral-800 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40"
                maxLength={9}
                spellCheck={false}
              />
              <button
                type="button"
                onClick={handleHexCommit}
                className="rounded-md bg-gold-500 px-3 py-1 text-xs font-semibold text-white hover:bg-gold-600"
              >
                Apply
              </button>
            </div>
          </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// ===========================================================================
// SwatchRow — internal subcomponent
// ===========================================================================

interface SwatchRowProps {
  title: string;
  swatches: ReadonlyArray<{ value: string; label: string }>;
  current: string;
  onPick: (value: string) => void;
}

function SwatchRow(props: SwatchRowProps): JSX.Element {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {props.title}
      </div>
      <div className="grid grid-cols-9 gap-1">
        {props.swatches.map((s) => {
          const isSelected = s.value === props.current;
          const isTransparent = s.value === "transparent" || s.value === "";
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => props.onPick(s.value)}
              className={`h-5 w-5 rounded border transition-transform hover:scale-110 ${
                isSelected
                  ? "border-gold-500 ring-2 ring-gold-500/40"
                  : "border-neutral-300"
              }`}
              style={{
                background: isTransparent
                  ? "repeating-conic-gradient(#e5e5e2 0% 25%, #ffffff 0% 50%) 50% / 6px 6px"
                  : s.value,
              }}
              aria-label={s.label}
              title={s.label}
            />
          );
        })}
      </div>
    </div>
  );
}
