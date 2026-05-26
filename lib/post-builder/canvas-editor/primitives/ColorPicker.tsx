"use client";

/**
 * ColorPicker — trigger swatch for the canvas editor color panel.
 * ----------------------------------------------------------------
 *
 * 2026-05-26 — this file used to render a portaled popover with HSV pad +
 * hex input + swatch sections inline. That dropdown was migrated to a full
 * Canva-style left-rail panel (`panels/ColorPickerPanel.tsx`) so the picker
 * has room for more affordances without overflowing.
 *
 * The component now renders ONLY the trigger swatch button:
 *   • shows the current color (or a checkerboard for transparent)
 *   • on click, calls `onOpenPanel(target, currentValue)` so the parent
 *     (CanvasEditor) opens the panel with the right target + initial value
 *
 * Mirrors the `FontPicker` → `FontPickerPanel` split. The `panelMode` /
 * `onOpenPanel` props mean callers can always pass them — no fallback to
 * the legacy popover (it's been deleted). The props stay for API symmetry
 * with FontPicker.
 *
 * Why a separate trigger component (vs. inlining a swatch button at each
 * callsite): six callsites share the same checkerboard-on-transparent +
 * compact-vs-default sizing + disabled-affordance + focus-ring conventions.
 * Centralizing them keeps the look identical across the toolbar and right-
 * panel controls.
 */

import { type JSX } from "react";

import type { ColorTarget } from "../panels/ColorPickerPanel";

// Re-export ColorTarget so consumers can import the union from one place
// (the legacy ColorPicker location is the natural import path for it).
export type { ColorTarget } from "../panels/ColorPickerPanel";

export interface ColorPickerProps {
  /** Current value — hex string ("#RRGGBB") or "transparent" or "" (treated as transparent). */
  value: string;
  /**
   * Which target the picker is editing. Forwarded to `onOpenPanel` so the
   * parent (CanvasEditor) knows which Fabric property to mutate when the
   * panel commits a color.
   */
  target: ColorTarget;
  /**
   * Fired when the user clicks the swatch. Parent opens the
   * ColorPickerPanel with this target + the current value as the initial
   * pad position.
   */
  onOpenPanel: (target: ColorTarget, currentValue: string) => void;
  /** Optional label rendered above the swatch trigger. */
  label?: string;
  /** When true, the picker is disabled. */
  disabled?: boolean;
  /** Compact mode shrinks the trigger to 20px instead of 28px. */
  compact?: boolean;
  /**
   * When true, the trigger renders with the gold "active" ring so users can
   * see which swatch is being edited by the currently-open panel. Wired by
   * the parent based on whether `ColorPickerPanel` is open AND its target
   * matches this trigger's target.
   */
  panelOpen?: boolean;
}

export default function ColorPicker(props: ColorPickerProps): JSX.Element {
  const {
    value,
    target,
    onOpenPanel,
    label,
    disabled = false,
    compact = false,
    panelOpen = false,
  } = props;

  const isTransparent = value === "transparent" || value === "";
  const triggerSize = compact ? "h-5 w-5" : "h-7 w-7";

  return (
    <div className="relative">
      {label ? (
        <label className="mb-1 block text-xs font-medium text-white">
          {label}
        </label>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          onOpenPanel(target, value);
        }}
        disabled={disabled}
        className={`${triggerSize} flex-shrink-0 rounded-md border shadow-lg shadow-black/40 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          panelOpen
            ? "border-transparent ring-2 ring-gold-500 ring-offset-2 ring-offset-[var(--studio-popover)]"
            : "border-[var(--studio-border)] hover:border-white/30"
        }`}
        style={{
          // why: render checkerboard pattern when transparent so the user
          // can distinguish "no fill" from "white fill" at a glance.
          background: isTransparent
            ? "repeating-conic-gradient(#e5e5e2 0% 25%, #ffffff 0% 50%) 50% / 8px 8px"
            : value,
        }}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        aria-label={label ? `${label} color picker` : "Color picker"}
        title={isTransparent ? "Transparent" : value}
      />
    </div>
  );
}
