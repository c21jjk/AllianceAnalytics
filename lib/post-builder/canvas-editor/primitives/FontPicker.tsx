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

import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// ===========================================================================
// Favorites — localStorage-backed star list
// ===========================================================================
//
// 2026-05-24 — added alongside the 50-font catalog expansion. With ~69 fonts
// in the dropdown, the originals + Larissa's recipe fonts get lost in the
// alphabet. Favorites lets each user pin their 5-10 go-to fonts to the
// top of the popover.
//
// Storage: localStorage. Per-browser, no DB sync — matches the two-person
// team scale. If the team grows or sync becomes a real need, lift to a
// `user_preferences` table.

const FAVORITES_STORAGE_KEY = "alliance.canvas.favorite-fonts";

function readFavoritesFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeFavoritesToStorage(favorites: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify(Array.from(favorites)),
    );
  } catch {
    // localStorage can throw under quota / private-mode constraints. Failure
    // is non-fatal — the in-memory Set still works for the current session.
  }
}

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
  /**
   * 2026-05-26 — when true, the component renders ONLY the trigger pill and
   * delegates open/close + option-list rendering to an external panel
   * (see `FontPickerPanel.tsx`). Used by the floating ContextualTopToolbar
   * where a left-rail panel beats an inline portaled dropdown for browseability.
   *
   * Default is `false` so existing callers (TextPropertiesControls in the
   * right panel) keep the dropdown behavior they already shipped with.
   */
  panelMode?: boolean;
  /** Required when `panelMode` is true. Fired on trigger click. */
  onOpenPanel?: () => void;
  /** When `panelMode` is true, drives the trigger's active styling + aria-expanded. */
  panelOpen?: boolean;
}

/**
 * 2026-05-26 — public entrypoint. Branches on `panelMode` to one of two
 * sibling components that DON'T share hook state (so neither runs the
 * other's hooks). Keeps both behaviors visible in this file while
 * satisfying rules-of-hooks.
 */
export default function FontPicker(props: FontPickerProps): JSX.Element {
  if (props.panelMode) {
    return <FontPickerTrigger {...props} />;
  }
  return <FontPickerDropdown {...props} />;
}

/**
 * 2026-05-26 — trigger-only render path for `panelMode`. Renders the
 * font-name + chevron pill; the panel itself lives elsewhere (mounted at
 * the editor overlay root) and reads / writes the active font value via
 * the same selection-state mechanism the floating toolbar uses.
 */
function FontPickerTrigger(props: FontPickerProps): JSX.Element {
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

/**
 * Legacy popover-dropdown render path. Used by TextPropertiesControls in
 * the right panel where a portaled dropdown is the right affordance
 * (small surface, focused single-property edit).
 */
function FontPickerDropdown(props: FontPickerProps): JSX.Element {
  const { value, onChange, options, disabled = false } = props;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // ----- Favorites state — hydrated from localStorage on mount -----
  // why: lazy initializer so the SSR pass doesn't access window. The first
  // client render reads the stored set; toggleFavorite writes back on each
  // change. Components that mount AFTER the first favorite is set will pick
  // it up on their next render (each mounts its own snapshot).
  const [favorites, setFavorites] = useState<Set<string>>(() =>
    readFavoritesFromStorage(),
  );

  const toggleFavorite = useCallback((fontValue: string): void => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(fontValue)) {
        next.delete(fontValue);
      } else {
        next.add(fontValue);
      }
      writeFavoritesToStorage(next);
      return next;
    });
  }, []);

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

  // ----- Group options by category, plus a virtual "Favorites" section -----
  //
  // Sections render in display order: Favorites first (when non-empty), then
  // Sans / Display / Serif / Script / Mono. Favorites use the same option
  // objects as the underlying categories — selecting one in Favorites is
  // identical to selecting it in its native category.
  //
  // Section labels are typed as string here (not FontPickerOption["category"])
  // because "Favorites" is a virtual label that doesn't exist in the option
  // schema.
  const grouped: ReadonlyArray<{
    label: string;
    options: ReadonlyArray<FontPickerOption>;
  }> = (() => {
    const order: ReadonlyArray<FontPickerOption["category"]> = [
      "Sans",
      "Display",
      "Serif",
      "Script",
      "Mono",
    ];
    const categoryGroups = order
      .map((cat) => ({
        label: cat as string,
        options: options.filter((o) => o.category === cat),
      }))
      .filter((g) => g.options.length > 0);
    // why: only show Favorites when the user has actually starred something —
    // an empty Favorites section would just be visual noise on first use.
    const favoriteOptions = options.filter((o) => favorites.has(o.value));
    if (favoriteOptions.length === 0) return categoryGroups;
    return [
      { label: "★ Favorites", options: favoriteOptions },
      ...categoryGroups,
    ];
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
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] px-2 py-1.5 text-left text-sm transition-colors hover:border-white/20 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-gold-500 ring-1 ring-gold-500/40" : ""
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Font family"
      >
        {/* why: render the active label in its own font family so the
            trigger itself is a font preview. Truncate long labels. */}
        <span
          className="truncate text-white"
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
          className="flex-shrink-0 text-[var(--studio-text-muted)]"
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
              className="z-[100] flex flex-col overflow-hidden rounded-xl border border-[var(--studio-border)] bg-[var(--studio-popover)] shadow-2xl shadow-black/60 animate-fade-in-up text-white"
              role="listbox"
              aria-label="Font family options"
            >
              <div className="flex-1 overflow-y-auto py-1">
                {grouped.map((group, gIdx) => (
                  <div
                    key={group.label}
                    className={gIdx > 0 ? "mt-1 border-t border-[var(--studio-border)] pt-1" : ""}
                  >
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                      {group.label}
                    </div>
                    {group.options.map((opt) => {
                      const isActive = opt.value === value;
                      const isFavorited = favorites.has(opt.value);
                      // why: the row is a flex container with the option
                      // SELECT button on the left and the STAR TOGGLE button
                      // on the right. Two separate <button>s prevents the
                      // star click from accidentally selecting the font, and
                      // gives each affordance its own keyboard handling /
                      // ARIA role.
                      return (
                        <div
                          key={opt.value}
                          className={`flex w-full items-center gap-1 transition-colors ${
                            isActive ? "bg-[var(--studio-active)]" : "hover:bg-[var(--studio-hover)]"
                          }`}
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onClick={() => handlePick(opt.value)}
                            className={`flex flex-1 items-center justify-between gap-2 px-3 py-2 text-left ${
                              isActive ? "text-gold-300" : "text-white"
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
                          <button
                            type="button"
                            onClick={(e) => {
                              // why: stop propagation so the click doesn't
                              // bubble to any outer handlers and doesn't
                              // accidentally trigger font selection on the
                              // sibling button. Critical for the UX
                              // (star = toggle favorite, NOT select font).
                              e.stopPropagation();
                              toggleFavorite(opt.value);
                            }}
                            aria-label={
                              isFavorited
                                ? `Remove ${opt.label} from favorites`
                                : `Add ${opt.label} to favorites`
                            }
                            title={
                              isFavorited
                                ? "Remove from favorites"
                                : "Add to favorites"
                            }
                            className={`flex-shrink-0 rounded p-2 transition-colors ${
                              isFavorited
                                ? "text-gold-600 hover:text-gold-700"
                                : "text-[var(--studio-text-faint)] hover:text-white"
                            }`}
                          >
                            {/* Filled star when favorited, outline when not.
                                Both glyphs use the same 16×16 viewBox so
                                they hot-swap cleanly. */}
                            {isFavorited ? (
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path d="M8 1l2.09 4.24L15 5.97l-3.5 3.41L12.36 14 8 11.69 3.64 14l.86-4.62L1 5.97l4.91-.73L8 1z" />
                              </svg>
                            ) : (
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M8 1l2.09 4.24L15 5.97l-3.5 3.41L12.36 14 8 11.69 3.64 14l.86-4.62L1 5.97l4.91-.73L8 1z" />
                              </svg>
                            )}
                          </button>
                        </div>
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
