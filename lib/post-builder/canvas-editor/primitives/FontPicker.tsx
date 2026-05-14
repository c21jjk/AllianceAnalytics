"use client";

/**
 * FontPicker — custom dropdown that previews each option in its own font.
 * -----------------------------------------------------------------------
 *
 * Replaces a native <select> in TextPropertiesControls because native
 * <option> elements can't reliably preview their own font: Chrome ignores
 * `font-family` on <option>, Safari supports it inconsistently, and Firefox
 * supports it but draws the rest of the list in the system font. The only
 * way to get Canva-style "see the font BEFORE you pick it" is a custom
 * dropdown.
 *
 * Design:
 *   • Trigger button shows the current font name styled in that font.
 *   • Portaled popover (same stacking pattern as ColorPicker — escapes the
 *     canvas's transform-stacking context).
 *   • Options grouped by category header (Sans / Display / Serif / Script /
 *     Mono) so the list scans fast.
 *   • Each option label rendered in its own font-family, sized larger
 *     (18px) so the visual character of the typeface is unmistakable.
 *
 * The component is presentational — receives the active value + options
 * via props and emits onChange. Doesn't know about Fabric.
 */

import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  /** Fired on every option click. Parent handles history recording. */
  onChange: (next: string) => void;
  /** All available options. Order within each category is preserved. */
  options: ReadonlyArray<FontPickerOption>;
  /** When true, the picker is disabled. */
  disabled?: boolean;
}

export default function FontPicker(props: FontPickerProps): JSX.Element {
  const { value, onChange, options, disabled = false } = props;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // why: find the active option's label to render on the trigger button.
  // Fall back to the raw value if no option matches (defensive — shouldn't
  // happen with our enumerated options, but a stale schema could trip it).
  const activeOption = options.find((o) => o.value === value) ?? null;
  const activeLabel = activeOption?.label ?? value;

  // ----- Position popover under trigger button, viewport-clamped -----
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPopoverPos(null);
      return;
    }
    const POPOVER_MAX_WIDTH = 320;
    const GAP = 4;
    const rect = triggerRef.current.getBoundingClientRect();
    // why: match popover width to trigger so it looks like a "real" dropdown,
    // but cap at 320px when the trigger is narrow.
    const width = Math.max(rect.width, 220);
    const cappedWidth = Math.min(width, POPOVER_MAX_WIDTH);
    let top = rect.bottom + GAP;
    let left = rect.left;
    // Right-edge clamp.
    const maxLeft = window.innerWidth - cappedWidth - GAP;
    if (left > maxLeft) left = maxLeft;
    if (left < GAP) left = GAP;
    // Bottom-edge clamp — if the popover would spill off the viewport,
    // flip it above the trigger.
    const POPOVER_MAX_HEIGHT = 400;
    if (top + POPOVER_MAX_HEIGHT > window.innerHeight - GAP) {
      const flippedTop = rect.top - POPOVER_MAX_HEIGHT - GAP;
      if (flippedTop > GAP) top = flippedTop;
    }
    setPopoverPos({ top, left, width: cappedWidth });
  }, [open]);

  // ----- Outside-click close -----
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

  // ----- Reposition on scroll/resize -----
  useEffect(() => {
    if (!open) return;
    const reposition = (): void => {
      // why: just re-trigger the layout effect by toggling open through
      // a state shim. Cheaper: replicate the math here. We replicate
      // inline so the listener doesn't depend on stale closures.
      if (!triggerRef.current) return;
      const POPOVER_MAX_WIDTH = 320;
      const GAP = 4;
      const rect = triggerRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 220);
      const cappedWidth = Math.min(width, POPOVER_MAX_WIDTH);
      let top = rect.bottom + GAP;
      let left = rect.left;
      const maxLeft = window.innerWidth - cappedWidth - GAP;
      if (left > maxLeft) left = maxLeft;
      if (left < GAP) left = GAP;
      const POPOVER_MAX_HEIGHT = 400;
      if (top + POPOVER_MAX_HEIGHT > window.innerHeight - GAP) {
        const flippedTop = rect.top - POPOVER_MAX_HEIGHT - GAP;
        if (flippedTop > GAP) top = flippedTop;
      }
      setPopoverPos({ top, left, width: cappedWidth });
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  // ----- Group options by category, preserving input order within each group -----
  const grouped: ReadonlyArray<{
    category: FontPickerOption["category"];
    options: ReadonlyArray<FontPickerOption>;
  }> = (() => {
    const order: ReadonlyArray<FontPickerOption["category"]> = [
      "Sans",
      "Display",
      "Serif",
      "Script",
      "Mono",
    ];
    return order
      .map((cat) => ({
        category: cat,
        options: options.filter((o) => o.category === cat),
      }))
      .filter((g) => g.options.length > 0);
  })();

  const handlePick = (next: string): void => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-left text-sm transition-colors hover:border-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-gold-500 ring-1 ring-gold-500/40" : ""
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Font family"
      >
        {/* why: render the active label in its own font family so the
            trigger itself is a font preview. Truncate long labels. */}
        <span
          className="truncate text-neutral-800"
          style={{ fontFamily: value }}
        >
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
          className="flex-shrink-0 text-neutral-400"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && !disabled && popoverPos
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                top: popoverPos.top,
                left: popoverPos.left,
                width: popoverPos.width,
                maxHeight: 400,
              }}
              className="z-[100] flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-elevated animate-fade-in-up"
              role="listbox"
              aria-label="Font family options"
            >
              <div className="flex-1 overflow-y-auto py-1">
                {grouped.map((group, gIdx) => (
                  <div
                    key={group.category}
                    className={gIdx > 0 ? "mt-1 border-t border-neutral-100 pt-1" : ""}
                  >
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      {group.category}
                    </div>
                    {group.options.map((opt) => {
                      const isActive = opt.value === value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => handlePick(opt.value)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                            isActive
                              ? "bg-gold-50 text-gold-900"
                              : "text-neutral-800 hover:bg-neutral-50"
                          }`}
                        >
                          {/* why: render the LABEL in its own font and at
                              18px so the typographic character is obvious
                              at a glance. Truncate long names. */}
                          <span
                            className="truncate"
                            style={{ fontFamily: opt.value, fontSize: 18 }}
                          >
                            {opt.label}
                          </span>
                          {isActive ? (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="flex-shrink-0 text-gold-700"
                              aria-hidden="true"
                            >
                              <path d="M3 8l3 3 7-7" />
                            </svg>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
