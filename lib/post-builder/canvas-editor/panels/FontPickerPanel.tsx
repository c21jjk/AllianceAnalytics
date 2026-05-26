"use client";

/**
 * FontPickerPanel — Canva-style full-height left panel for font selection.
 * ------------------------------------------------------------------------
 *
 * Mounted as a sibling overlay at the editor root. Sits to the right of the
 * 64px icon rail, the same width as the existing left expanded panels
 * (Templates / Brand / Agents / Photos / Tools), at a higher z-index so it
 * temporarily covers whichever tab is currently active.
 *
 * Why this exists (vs. the legacy FontPicker portal popover):
 *   • The popover blocks the canvas while you browse 60+ fonts.
 *   • A popover can't comfortably fit search + star + Document Fonts +
 *     categorical sections.
 *   • Larissa's muscle memory IS Canva — Canva opens a font panel here.
 *
 * Trigger lives in ContextualTopToolbar's text-mode pill — the same button
 * that used to open the popover. CanvasEditor owns the open/close state and
 * the active-font value so this panel is purely presentational.
 *
 * Apply behavior matches Canva:
 *   • Click font row → applies immediately to the active text object.
 *   • Panel stays open so the user can keep browsing.
 *   • Close via X / Escape / click outside / text deselection.
 *
 * Starred fonts persist to localStorage under `studio:starred-fonts` so
 * each browser remembers Larissa's go-to list across sessions. Matches the
 * `alliance.canvas.favorite-fonts` pattern the legacy dropdown used but
 * with a fresh key so they don't collide (the two stores aren't synced).
 */

import { Search as LSearch, Star as LStar, X as LX } from "lucide-react";
import {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FontPickerOption } from "../primitives/FontPicker";

// ===========================================================================
// Starred fonts — localStorage-backed
// ===========================================================================
// why: fresh storage key (vs. the popover's `alliance.canvas.favorite-fonts`)
// so the panel + legacy popover can coexist without one wiping the other's
// state. Once the legacy dropdown usage in TextPropertiesControls is also
// migrated, we can collapse to a single key.
const STARRED_STORAGE_KEY = "studio:starred-fonts";

function readStarredFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STARRED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function writeStarredToStorage(starred: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STARRED_STORAGE_KEY,
      JSON.stringify(Array.from(starred)),
    );
  } catch {
    // why: localStorage can throw under quota / private-mode constraints.
    // Failure is non-fatal — the in-memory Set still works for the session.
  }
}

// ===========================================================================
// Categories
// ===========================================================================

const CATEGORY_ORDER: ReadonlyArray<FontPickerOption["category"]> = [
  "Sans",
  "Display",
  "Serif",
  "Script",
  "Mono",
];

type CategoryFilter = "All" | FontPickerOption["category"];

const CATEGORY_CHIPS: ReadonlyArray<CategoryFilter> = [
  "All",
  "Sans",
  "Display",
  "Serif",
  "Script",
  "Mono",
];

// ===========================================================================
// Props
// ===========================================================================

interface FontPickerPanelProps {
  /** Drives whether the panel is mounted. Parent flips this. */
  open: boolean;
  /** Close handler — wired to X / Escape / outside-click / text deselect. */
  onClose: () => void;
  /** Currently active font family (a `value` from FONT_OPTIONS). */
  value: string;
  /** All font options to list. Plumbed from primitives/font-options.ts. */
  options: ReadonlyArray<FontPickerOption>;
  /**
   * Apply a font to the selected text object. CanvasEditor wires this to
   * the same dispatch path the floating toolbar uses, so applying from the
   * panel and applying from the (legacy) popover share semantics.
   */
  onApply: (nextValue: string) => void;
  /**
   * Distinct font-family values currently in use on the canvas. Shown in
   * the "Document fonts" section. Order is "as discovered" — typically
   * the order layers were added.
   */
  documentFontValues: ReadonlyArray<string>;
  /**
   * Anchor element of the trigger pill. Focus returns to it on close so
   * keyboard users land back where they started. Optional — if absent the
   * Esc / X handlers still fire close, just without the focus restoration.
   */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

// ===========================================================================
// Top-level panel
// ===========================================================================

export default function FontPickerPanel(
  props: FontPickerPanelProps,
): JSX.Element | null {
  const {
    open,
    onClose,
    value,
    options,
    onApply,
    documentFontValues,
    triggerRef,
  } = props;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState<string>("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("All");
  const [starred, setStarred] = useState<Set<string>>(() =>
    readStarredFromStorage(),
  );

  // ----- Persist starred fonts to localStorage on change -----
  const toggleStar = useCallback((fontValue: string): void => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(fontValue)) {
        next.delete(fontValue);
      } else {
        next.add(fontValue);
      }
      writeStarredToStorage(next);
      return next;
    });
  }, []);

  // ----- Focus search input on open; return focus to trigger on close -----
  // why: keyboard-only flow — opening the panel should put the caret where
  // typing produces useful output (the search box). Closing should put the
  // user back where they came from (the trigger pill) so Tab cadence isn't
  // disrupted. Same pattern Canva uses.
  useEffect(() => {
    if (open) {
      // why: rAF so the input is in the DOM before .focus() runs. Without
      // it, focus() can fire on a stale node when the panel mounts and
      // re-renders in the same tick.
      const id = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    // On close → return focus to the trigger pill if the caller gave us one.
    if (triggerRef?.current) {
      triggerRef.current.focus();
    }
    return undefined;
  }, [open, triggerRef]);

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
  // should close so the user can resume working. We compare against the
  // panel ref + the trigger ref so clicking the trigger itself doesn't
  // immediately re-close before the trigger's onClick fires.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose, triggerRef]);

  // ----- Filter + group options -----
  // why: search + category combine with AND semantics. Search matches by
  // case-insensitive label substring. Document fonts section comes from
  // the live `documentFontValues` prop and intersects with `options`
  // (we never show a font in Document that isn't in the catalog).
  const filteredOptions = useMemo<ReadonlyArray<FontPickerOption>>(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => {
      const matchesCategory =
        activeCategory === "All" || o.category === activeCategory;
      if (!matchesCategory) return false;
      if (q === "") return true;
      return o.label.toLowerCase().includes(q);
    });
  }, [options, query, activeCategory]);

  const starredOptions = useMemo<ReadonlyArray<FontPickerOption>>(() => {
    // why: filter against the SAME query+category so search hides starred
    // fonts that don't match. Canva does this; keeps the panel scannable.
    return filteredOptions.filter((o) => starred.has(o.value));
  }, [filteredOptions, starred]);

  const documentOptions = useMemo<ReadonlyArray<FontPickerOption>>(() => {
    // why: dedupe by value (a layer could pull the same family twice) and
    // intersect with the catalog. Apply search+category too so the
    // section adapts to filters.
    const seen = new Set<string>();
    const result: FontPickerOption[] = [];
    for (const fam of documentFontValues) {
      if (seen.has(fam)) continue;
      seen.add(fam);
      const opt = options.find((o) => o.value === fam);
      if (!opt) continue;
      if (!filteredOptions.some((f) => f.value === opt.value)) continue;
      result.push(opt);
    }
    return result;
  }, [documentFontValues, options, filteredOptions]);

  const groupedByCategory = useMemo<
    ReadonlyArray<{
      label: FontPickerOption["category"];
      options: ReadonlyArray<FontPickerOption>;
    }>
  >(() => {
    return CATEGORY_ORDER.map((cat) => ({
      label: cat,
      options: filteredOptions.filter((o) => o.category === cat),
    })).filter((g) => g.options.length > 0);
  }, [filteredOptions]);

  if (!open) return null;

  return (
    <aside
      ref={panelRef}
      data-studio-panel="font-picker"
      role="dialog"
      aria-modal="false"
      aria-labelledby="font-picker-panel-title"
      className="fixed bottom-0 left-16 top-0 z-30 flex w-80 flex-col border-r border-[var(--studio-border)] bg-[var(--studio-panel)] shadow-2xl shadow-black/40"
    >
      {/* ----- Header ----- */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--studio-border)] px-4">
        <h2
          id="font-picker-panel-title"
          className="text-sm font-medium text-white"
        >
          Font
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close font picker"
          title="Close font picker"
          className="focus-ring-dark rounded p-1 text-[var(--studio-text-muted)] transition-colors hover:bg-[var(--studio-hover)] hover:text-white"
        >
          <LX size={16} />
        </button>
      </header>

      {/* ----- Search ----- */}
      <div className="border-b border-[var(--studio-border)] px-4 py-3">
        <div className="relative">
          <LSearch
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--studio-text-faint)]"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fonts"
            aria-label="Search fonts"
            className="focus-ring-dark w-full rounded-md border border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] py-2 pl-9 pr-3 text-sm text-white placeholder:text-[var(--studio-input-placeholder)]"
          />
        </div>
      </div>

      {/* ----- Category chips ----- */}
      <div className="overflow-x-auto border-b border-[var(--studio-border)] px-4 py-2">
        <div className="flex gap-1.5 whitespace-nowrap">
          {CATEGORY_CHIPS.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                aria-pressed={isActive}
                className={`focus-ring-dark rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-gold-500 text-white"
                    : "bg-[var(--studio-input-bg)] text-[var(--studio-text-muted)] hover:bg-[var(--studio-hover)] hover:text-white"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* ----- Scrollable list ----- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Starred section */}
        <Section eyebrow="Starred">
          {starredOptions.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-[var(--studio-text-faint)]">
              Star fonts you use often to find them faster.
            </p>
          ) : (
            starredOptions.map((opt) => (
              <FontRow
                key={`starred-${opt.value}`}
                font={opt}
                isActive={opt.value === value}
                isStarred={true}
                onApply={onApply}
                onToggleStar={toggleStar}
              />
            ))
          )}
        </Section>

        {/* Document fonts section */}
        {documentOptions.length > 0 ? (
          <Section eyebrow="Document fonts">
            {documentOptions.map((opt) => (
              <FontRow
                key={`doc-${opt.value}`}
                font={opt}
                isActive={opt.value === value}
                isStarred={starred.has(opt.value)}
                onApply={onApply}
                onToggleStar={toggleStar}
              />
            ))}
          </Section>
        ) : null}

        {/* All fonts, grouped by category */}
        {groupedByCategory.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-[var(--studio-text-faint)]">
            No fonts match
            {query.trim() !== "" ? ` "${query.trim()}"` : ""}.
          </p>
        ) : (
          groupedByCategory.map((group) => (
            <Section
              key={group.label}
              eyebrow={group.label.toUpperCase()}
            >
              {group.options.map((opt) => (
                <FontRow
                  key={`${group.label}-${opt.value}`}
                  font={opt}
                  isActive={opt.value === value}
                  isStarred={starred.has(opt.value)}
                  onApply={onApply}
                  onToggleStar={toggleStar}
                />
              ))}
            </Section>
          ))
        )}
        {/* why: little tail so the last row doesn't stick to the panel bottom. */}
        <div className="h-3" aria-hidden="true" />
      </div>
    </aside>
  );
}

// ===========================================================================
// Section eyebrow wrapper
// ===========================================================================

function Section(props: {
  eyebrow: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
        {props.eyebrow}
      </div>
      <div>{props.children}</div>
    </section>
  );
}

// ===========================================================================
// FontRow
// ===========================================================================

function FontRow(props: {
  font: FontPickerOption;
  isActive: boolean;
  isStarred: boolean;
  onApply: (next: string) => void;
  onToggleStar: (next: string) => void;
}): JSX.Element {
  const { font, isActive, isStarred, onApply, onToggleStar } = props;
  return (
    <div
      className={`group flex items-center px-2 transition-colors ${
        isActive ? "bg-gold-500/10" : "hover:bg-[var(--studio-hover)]"
      }`}
    >
      <button
        type="button"
        onClick={() => onApply(font.value)}
        aria-pressed={isActive}
        className={`focus-ring-dark flex-1 truncate rounded px-2 py-2 text-left text-base ${
          isActive ? "text-white" : "text-white"
        }`}
        style={{ fontFamily: font.value }}
        title={font.label}
      >
        {font.label}
      </button>
      <button
        type="button"
        onClick={(e) => {
          // why: stopPropagation defends against any wrapper-level click
          // handlers; the row's apply button is a sibling not an ancestor,
          // so this is belt-and-braces.
          e.stopPropagation();
          onToggleStar(font.value);
        }}
        aria-label={
          isStarred ? `Unstar ${font.label}` : `Star ${font.label}`
        }
        title={
          isStarred ? "Remove from starred" : "Add to starred"
        }
        className="focus-ring-dark ml-1 shrink-0 rounded p-1.5 transition-colors hover:bg-[var(--studio-hover)]"
      >
        <LStar
          size={14}
          className={
            isStarred
              ? "fill-gold-500 text-gold-500"
              : "text-[var(--studio-text-faint)] group-hover:text-[var(--studio-text-muted)]"
          }
        />
      </button>
    </div>
  );
}
