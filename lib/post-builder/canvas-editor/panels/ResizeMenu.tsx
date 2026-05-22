"use client";

/**
 * ResizeMenu — Smart Resize affordance inside Studio
 * --------------------------------------------------------------------------
 *
 * A small dropdown that opens to the two formats Larissa ISN'T currently
 * editing. Clicking one of them resizes the active design to that format
 * (regenerated from the same factory at the new aspect ratio) — see the
 * editor's `handleResizePicked` for the swap mechanics and parent state
 * sync.
 *
 * UX shape — chosen to feel like Canva's "Resize" menu without the cost of
 * implementing the full Magic Switch:
 *   • Button labeled "Resize" with a small chevron, sits next to Save in
 *     the editor header.
 *   • Click opens a popover anchored under the button.
 *   • Two rows (current format is omitted). Each row shows:
 *       - aspect-ratio mini-glyph on the left (square / portrait / story
 *         outline, sized to read at a glance)
 *       - format label ("Square 1:1" / "Portrait 4:5" / "Story 9:16")
 *       - platform hint ("IG/FB feed", "IG feed preferred", "Stories +
 *         TikTok") so the choice surfaces context, not just dimensions
 *   • A row is DISABLED with a soft tooltip when the target template
 *     doesn't exist (e.g., user is on v6 Magazine Cover and that
 *     factory only ships 2 of 3 formats today).
 *   • Clicking outside the popover closes it. ESC closes it. Both
 *     standard popover affordances.
 *
 * Why no in-component confirmation:
 *   The unsaved-edits gate is the editor's job — same shape as the
 *   Templates panel's swap confirm. ResizeMenu only emits the picked
 *   format; the editor decides whether to surface `window.confirm` first.
 *   Keeps this component a pure UI surface.
 */

import { type JSX, useEffect, useRef, useState } from "react";

import type { PostFormat } from "../types";

// ---------------------------------------------------------------------------
// Format metadata — same labels the Templates panel uses, plus a platform
// hint we don't surface there. Single source of truth would be cleanest;
// for now we keep it scoped here since the hint copy is presentation, not
// data.
// ---------------------------------------------------------------------------

interface FormatMeta {
  label: string;
  aspectStyle: { width: number; height: number };
  platformHint: string;
}

const FORMAT_META: Record<PostFormat, FormatMeta> = {
  portrait_4x5: {
    label: "Portrait 4:5",
    aspectStyle: { width: 16, height: 20 },
    platformHint: "IG feed preferred",
  },
  story_9x16: {
    label: "Story 9:16",
    aspectStyle: { width: 12, height: 21 },
    platformHint: "Stories · TikTok",
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ResizeMenuOption {
  format: PostFormat;
  /**
   * When false, the row renders disabled. This is how the editor signals
   * "no canvas template exists for this (category, variant, target format)
   * tuple" — typically because the variant only ships at 2 of 3 formats
   * (an in-progress factory port).
   */
  available: boolean;
  /**
   * Optional tooltip shown when the row is disabled. The editor sets a
   * generic "Not yet available for this variant" message; we expose the
   * prop so different contexts can customize.
   */
  disabledReason?: string;
}

export interface ResizeMenuProps {
  /** The format the editor is currently rendering at. Omitted from the menu. */
  currentFormat: PostFormat;
  /** All other formats with their availability + disabled reasons. */
  options: readonly ResizeMenuOption[];
  /** Fired when the user picks an available format. */
  onPick: (format: PostFormat) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ResizeMenu(props: ResizeMenuProps): JSX.Element {
  const { currentFormat, options, onPick } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // -------------------------------------------------------------------------
  // Close on outside click + ESC
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent): void {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // -------------------------------------------------------------------------
  // Visible options (always omit current format)
  // -------------------------------------------------------------------------
  const visibleOptions = options.filter((o) => o.format !== currentFormat);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-gold-300 hover:bg-gold-50/40 hover:text-gold-800"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Make a version of this design at another aspect ratio"
      >
        <ResizeIcon />
        Resize
        <ChevronIcon open={open} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Resize to format"
          className="absolute right-0 z-40 mt-1.5 w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-elevated"
        >
          <div className="border-b border-neutral-100 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Resize to
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-500">
              Creates a sibling post at the new aspect ratio. Your current
              version stays as is.
            </div>
          </div>
          <ul className="py-1">
            {visibleOptions.map((opt) => {
              const meta = FORMAT_META[opt.format];
              const disabled = !opt.available;
              return (
                <li key={opt.format}>
                  <button
                    type="button"
                    onClick={() => {
                      if (disabled) return;
                      setOpen(false);
                      onPick(opt.format);
                    }}
                    disabled={disabled}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      disabled
                        ? "cursor-not-allowed opacity-50"
                        : "hover:bg-gold-50/50"
                    }`}
                    title={
                      disabled
                        ? opt.disabledReason ??
                          "Not yet available for this variant"
                        : undefined
                    }
                  >
                    <AspectGlyph
                      width={meta.aspectStyle.width}
                      height={meta.aspectStyle.height}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-neutral-900">
                        {meta.label}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {meta.platformHint}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons — kept inline so the menu is one file
// ---------------------------------------------------------------------------

function ResizeIcon(): JSX.Element {
  return (
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
      {/* why: two overlapping rectangles read as "convert between formats"
          without leaning on either a square or portrait shape alone. */}
      <rect x="2" y="3.5" width="7" height="6" rx="1" />
      <rect x="7" y="6.5" width="7" height="6" rx="1" />
    </svg>
  );
}

function ChevronIcon(props: { open: boolean }): JSX.Element {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform ${props.open ? "rotate-180" : ""}`}
    >
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}

function AspectGlyph(props: { width: number; height: number }): JSX.Element {
  // why: render a small rectangle at the actual aspect ratio so the user
  // can scan the menu visually — "the tall one is Story" etc. The widths
  // are deliberately small (≤21px) so each glyph fits in the row gutter
  // without throwing off the row's vertical rhythm.
  const maxDim = Math.max(props.width, props.height);
  return (
    <span
      className="flex-shrink-0"
      style={{ width: maxDim, height: maxDim }}
      aria-hidden="true"
    >
      <span
        className="block rounded-sm border border-neutral-300 bg-neutral-100"
        style={{
          width: props.width,
          height: props.height,
          marginLeft: (maxDim - props.width) / 2,
          marginTop: (maxDim - props.height) / 2,
        }}
      />
    </span>
  );
}
