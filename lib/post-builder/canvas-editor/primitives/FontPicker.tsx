"use client";

/**
 * FontPicker — trigger button that opens the shared FontPickerPanel.
 * -----------------------------------------------------------------------
 *
 * 2026-05-26: simplified to just the trigger pill. Clicks call
 * `onOpenPanel` so the parent surface (right panel via SelectionProperties
 * / floating top toolbar) can route the open through CanvasEditor's
 * shared `fontPickerOpen` state and unified FontPickerPanel.
 *
 * The legacy portaled-dropdown render path + per-component Favorites
 * localStorage helpers were deleted — favorites now live in
 * FontPickerPanel under the `studio:starred-fonts` key (with a one-time
 * migration from the legacy `alliance.canvas.favorite-fonts` key).
 *
 * The `panelMode` prop is retained as a no-op for callsite compatibility
 * (FloatingToolbar passes `panelMode={Boolean(onOpenFontPicker)}` and
 * TextPropertiesControls passes `panelMode={true}` — both surfaces now
 * use the same trigger render).
 */

import { type JSX } from "react";

export interface FontPickerOption {
  /** Display label — typically the family's marketing name ("Playfair Display"). */
  label: string;
  /** Full CSS font-family stack — what gets passed to Fabric / written to layer.fontFamily. */
  value: string;
  /** Category for grouping inside the popover. Matches our token taxonomy. */
  category: "Sans" | "Display" | "Serif" | "Script" | "Mono";
}

export interface FontPickerProps {
  /** Current value (a font-family stack string from FontPickerOption.value). */
  value: string;
  /**
   * Fired on direct value writes. The panel now drives every actual font
   * change, but the prop stays in the signature so callsites can still pass
   * their handler (used as a defensive no-op fallback).
   */
  onChange: (next: string) => void;
  /** All available options. Order within each category is preserved. */
  options: ReadonlyArray<FontPickerOption>;
  /** When true, the picker is disabled. */
  disabled?: boolean;
  /**
   * Retained as a no-op for callsite compatibility. Every callsite now
   * renders trigger-only; the legacy dropdown render path was deleted
   * 2026-05-26.
   */
  panelMode?: boolean;
  /** Fired on trigger click — opens the shared FontPickerPanel. */
  onOpenPanel?: () => void;
  /** Drives the trigger's active styling + aria-expanded. */
  panelOpen?: boolean;
}

/**
 * Trigger button. Clicks open the FontPickerPanel via shared state.
 */
export default function FontPicker(props: FontPickerProps): JSX.Element {
  const {
    value,
    options,
    disabled = false,
    onOpenPanel,
    panelOpen = false,
  } = props;
  const activeOption = options.find((o) => o.value === value) ?? null;
  const activeLabel = activeOption?.label ?? value;
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onOpenPanel?.();
      }}
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-2 rounded-md border border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] px-2 py-1.5 text-left text-sm transition-colors hover:border-white/20 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
        panelOpen ? "border-gold-500 ring-1 ring-gold-500/40" : ""
      }`}
      aria-haspopup="dialog"
      aria-expanded={panelOpen}
      aria-label="Font family"
    >
      <span className="truncate text-white" style={{ fontFamily: value }}>
        {activeLabel}
      </span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex-shrink-0 text-[var(--studio-text-muted)]"
        aria-hidden="true"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
  );
}

