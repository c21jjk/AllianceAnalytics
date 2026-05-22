"use client";

/**
 * TemplatesPanel — left-sidebar grid of canvas-editor templates.
 * --------------------------------------------------------------------------
 *
 * Renders the fourth tab in the editor's left sidebar (Brand / Agents /
 * Photos / Templates). Lets Larissa swap to a different template without
 * leaving Studio. Clicking a tile asks the orchestrator to re-init the canvas
 * with the chosen template; the parent (CanvasEditor.tsx) is responsible for
 * the actual swap and history reset.
 *
 * Confirmation rule:
 *   When `hasUnsavedEdits` is true, the panel surfaces a `window.confirm`
 *   before firing `onTemplatePicked`. Native confirm is intentional — keeps
 *   the surface small and matches every other browser-level "you'll lose
 *   work" prompt the user already understands. A styled modal can replace it
 *   later without changing this contract.
 *
 * Why no rendered thumbnails:
 *   Producing a real thumbnail per template requires either the Chromium
 *   render pipeline (slow, server-only) or a client-side mini-render (Fabric
 *   in a hidden canvas — non-trivial). For Phase 4 MVP we ship colored
 *   aspect-ratio cards with a category-tinted eyebrow chip. Real thumbnails
 *   are a worthwhile follow-up but not in scope tonight.
 *
 * Filtering:
 *   Defaults to "current format only" — switching aspect ratio mid-edit is
 *   disorienting. A toggle exposes all formats when the user genuinely wants
 *   to adapt a square design into a story (or vice versa).
 */

import { type JSX, useMemo, useState } from "react";

import type {
  CanvasTemplateCategory,
  CanvasTemplateSchema,
  PostFormat,
} from "../types";
import type { TemplatesPanelProps } from "../contracts";

// ---------------------------------------------------------------------------
// Category metadata — labels + eyebrow color per post type
// ---------------------------------------------------------------------------
//
// why: the cards show a small eyebrow chip in the top-left of each preview
// matching the in-template status label (JUST LISTED / JUST SOLD / etc.). We
// keep these synced with hero-editorial-factory's POST_TYPE_CONFIGS by hand
// — adding a new category requires updating both files in lockstep, and
// missing one will produce a "default gold" eyebrow which is visibly wrong.

interface CategoryMeta {
  /** Visible chip + filter label. */
  label: string;
  /** Status-label text matching the in-canvas eyebrow ("JUST LISTED" etc). */
  eyebrow: string;
  /** Background color for the eyebrow chip. */
  chipBg: string;
  /** Foreground color for the eyebrow chip. */
  chipFg: string;
}

const CATEGORY_META: Record<CanvasTemplateCategory, CategoryMeta> = {
  just_listed: {
    label: "Just Listed",
    eyebrow: "JUST LISTED",
    // why: gold-500 on dark — matches the in-canvas eyebrow rule for these.
    chipBg: "#C9A961",
    chipFg: "#18181B",
  },
  just_sold: {
    label: "Just Sold",
    eyebrow: "JUST SOLD",
    // why: matches the red SOLD stamp from POST_TYPE_CONFIGS.
    chipBg: "#B91C1C",
    chipFg: "#FFFFFF",
  },
  under_contract: {
    label: "Under Contract",
    eyebrow: "UNDER CONTRACT",
    // why: amber — reads as "pending" without claiming Sold or Active.
    chipBg: "#B45309",
    chipFg: "#FFFFFF",
  },
  open_house: {
    label: "Open House",
    eyebrow: "OPEN HOUSE",
    // why: ink — neutral foreground that doesn't compete with the gold rule
    // already inside the template. Matches the gold-text-on-dark pattern used
    // by the in-canvas open-house line itself.
    chipBg: "#18181B",
    chipFg: "#C9A961",
  },
  price_reduction: {
    label: "Price Reduced",
    eyebrow: "PRICE REDUCED",
    // why: matches the green ↓ NEW PRICE stamp from POST_TYPE_CONFIGS.
    chipBg: "#15803D",
    chipFg: "#FFFFFF",
  },
};

// ---------------------------------------------------------------------------
// Format metadata — display name + aspect ratio string
// ---------------------------------------------------------------------------

const FORMAT_META: Record<
  PostFormat,
  Readonly<{ label: string; aspect: string }>
> = {
  portrait_4x5: { label: "Portrait 4:5", aspect: "4 / 5" },
  story_9x16: { label: "Story 9:16", aspect: "9 / 16" },
};

// ---------------------------------------------------------------------------
// Filter state — local to this panel
// ---------------------------------------------------------------------------

type CategoryFilter = CanvasTemplateCategory | "all";

interface FilterState {
  currentFormatOnly: boolean;
  category: CategoryFilter;
}

export default function TemplatesPanel(
  props: TemplatesPanelProps,
): JSX.Element {
  const {
    templates,
    currentTemplateId,
    currentFormat,
    hasUnsavedEdits,
    onTemplatePicked,
  } = props;

  const [filter, setFilter] = useState<FilterState>({
    currentFormatOnly: true,
    // why: default the category filter to "all" — we don't know the user's
    // intent (they might be browsing for inspiration or swapping deliberately).
    // The current template's category will show its "Current" badge regardless.
    category: "all",
  });

  // -------------------------------------------------------------------------
  // Filtered list
  // -------------------------------------------------------------------------
  // why: useMemo keyed on filter + inputs so we're not re-sorting + re-filtering
  // on every parent re-render. The base list is small (15 today, ~75 once all
  // variants ship) but this is the right shape.
  const visibleTemplates = useMemo<readonly CanvasTemplateSchema[]>(() => {
    let list = templates.slice();
    if (filter.currentFormatOnly) {
      list = list.filter((t) => t.format === currentFormat);
    }
    if (filter.category !== "all") {
      list = list.filter((t) => t.category === filter.category);
    }
    // why: sort by category first, then by format (so cards group together
    // visually when "All formats" is on). Categories are sorted by the order
    // they appear in CATEGORY_META — matches the chip strip order.
    const catOrder: Record<CanvasTemplateCategory, number> = {
      just_listed: 0,
      just_sold: 1,
      under_contract: 2,
      open_house: 3,
      price_reduction: 4,
    };
    const fmtOrder: Record<PostFormat, number> = {
      portrait_4x5: 0,
      story_9x16: 1,
    };
    list.sort((a, b) => {
      const c = catOrder[a.category] - catOrder[b.category];
      if (c !== 0) return c;
      return fmtOrder[a.format] - fmtOrder[b.format];
    });
    return list;
  }, [templates, filter, currentFormat]);

  // -------------------------------------------------------------------------
  // Click handler — confirm-if-dirty gate before firing onTemplatePicked
  // -------------------------------------------------------------------------
  function handlePick(template: CanvasTemplateSchema): void {
    // why: don't prompt when the user clicks the current template — that's
    // a no-op. Saves a confusing confirm dialog that would do nothing.
    if (template.id === currentTemplateId) return;

    if (hasUnsavedEdits) {
      // why: native confirm. Maps directly to what the user already
      // recognizes as "you'll lose work" from every other web app. A future
      // styled modal can replace this without changing the panel's contract.
      const ok = window.confirm(
        "Switch templates? Your edits to this design will be lost.\n\n" +
          "Save first if you want to keep this version, then come back and switch.",
      );
      if (!ok) return;
    }
    onTemplatePicked(template);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Filter row — format toggle on the left, category chips below */}
      <div className="flex flex-col gap-2 border-b border-neutral-200 px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Templates
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-neutral-600 hover:text-neutral-900">
            <input
              type="checkbox"
              checked={filter.currentFormatOnly}
              onChange={(e) =>
                setFilter((s) => ({
                  ...s,
                  currentFormatOnly: e.target.checked,
                }))
              }
              className="h-3.5 w-3.5 cursor-pointer rounded border-neutral-300 text-gold-500 focus:ring-gold-500"
            />
            {FORMAT_META[currentFormat].label} only
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CategoryChip
            label="All"
            active={filter.category === "all"}
            onClick={() =>
              setFilter((s) => ({ ...s, category: "all" }))
            }
          />
          {(
            Object.keys(CATEGORY_META) as CanvasTemplateCategory[]
          ).map((cat) => (
            <CategoryChip
              key={cat}
              label={CATEGORY_META[cat].label}
              active={filter.category === cat}
              onClick={() =>
                setFilter((s) => ({ ...s, category: cat }))
              }
            />
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {visibleTemplates.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-neutral-500">
            No templates match the current filter. Toggle off "
            {FORMAT_META[currentFormat].label} only" to see all formats, or
            switch the category filter.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {visibleTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                isCurrent={t.id === currentTemplateId}
                onClick={() => handlePick(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents — chip + card
// ---------------------------------------------------------------------------

function CategoryChip(props: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        props.active
          ? "bg-gold-500 text-neutral-900 shadow-sm"
          : "border border-neutral-200 bg-white text-neutral-600 hover:border-gold-300 hover:text-gold-800"
      }`}
    >
      {props.label}
    </button>
  );
}

function TemplateCard(props: {
  template: CanvasTemplateSchema;
  isCurrent: boolean;
  onClick: () => void;
}): JSX.Element {
  const { template, isCurrent, onClick } = props;
  const catMeta = CATEGORY_META[template.category];
  const fmtMeta = FORMAT_META[template.format];

  // why: the card's preview box mimics the template's base look — a tinted
  // background with the eyebrow chip at top-left. Real thumbnails are a
  // follow-up; this gets us the "feels like Canva" grid in <1s of layout
  // without firing a render pipeline.
  const previewBg =
    template.backgroundColor === "transparent" || !template.backgroundColor
      ? "#1F2937" // why: neutral dark fallback so the chip stays visible
      : template.backgroundColor === "#FFFFFF" ||
          template.backgroundColor.toLowerCase() === "#ffffff"
        ? "#27272A"
        : template.backgroundColor;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col gap-1.5 rounded-md border bg-white p-1.5 text-left transition-all ${
        isCurrent
          ? "border-gold-500 ring-2 ring-gold-200"
          : "border-neutral-200 hover:border-gold-300 hover:shadow-sm"
      }`}
      aria-label={`Switch to ${template.name}`}
    >
      <div
        className="relative w-full overflow-hidden rounded-sm"
        style={{
          aspectRatio: fmtMeta.aspect,
          backgroundColor: previewBg,
        }}
      >
        {/* Eyebrow chip — matches the in-canvas status label vibe */}
        <span
          className="absolute left-2 top-2 rounded-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest shadow-sm"
          style={{
            backgroundColor: catMeta.chipBg,
            color: catMeta.chipFg,
          }}
        >
          {catMeta.eyebrow}
        </span>
        {isCurrent ? (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-gold-500 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-neutral-900 shadow">
            Current
          </span>
        ) : null}
        {/* Bottom scrim mimic — gives the card a "this is a layered post"
            visual hint without firing a real render. */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />
      </div>
      <div className="px-0.5">
        <div
          className={`text-[11px] font-semibold leading-tight ${
            isCurrent ? "text-gold-800" : "text-neutral-800"
          }`}
        >
          {template.name}
        </div>
        <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-neutral-500">
          {fmtMeta.label}
        </div>
      </div>
    </button>
  );
}
