"use client";

/**
 * ReelTemplatesPanel — picker for the Reel Template Library.
 * --------------------------------------------------------------------------
 *
 * Mirrors the canvas-editor `TemplatesPanel` pattern: a scrollable card
 * grid grouped by post type, with the active template highlighted. Lives
 * inside Reel Studio as an opt-in overlay — Larissa clicks "Templates" in
 * the workspace header to open it, picks a template, the parent swaps
 * the composition.
 *
 * No real thumbnails for Phase C — producing one requires firing the
 * worker per template (cold-start cost ≈ 10s × 15 templates) or a
 * client-side Fabric mini-render (non-trivial). The 9:16 aspect tile
 * with eyebrow chip + nominal duration is enough signal for now; real
 * thumbnails can drop in later without changing the panel's contract.
 *
 * Confirmation rule:
 *   When `hasUnsavedEdits` is true the panel surfaces a `window.confirm`
 *   before firing `onTemplatePicked` — same pattern the canvas
 *   TemplatesPanel uses for its identical concern.
 */

import { type JSX, useState } from "react";

import { getReelTemplatesByPostType } from "@/lib/post-builder/reel-templates/manifest";
import {
  REEL_POST_TYPE_META,
  type ReelPostTypeMeta,
  type ReelTemplate,
} from "@/lib/post-builder/reel-templates/types";
import type { PostType } from "@/lib/post-builder/types";

interface Props {
  /**
   * id of the template that originally seeded the current composition,
   * if any. Highlighted in the grid with a "Current" badge. Null for
   * the default composition or a resume from a saved row that didn't
   * persist a template id.
   */
  currentTemplateId: string | null;
  /**
   * True when the user has modified the composition relative to its
   * template seed. Triggers a confirm prompt before swapping.
   */
  hasUnsavedEdits: boolean;
  /** Called when the user picks a template — parent applies it. */
  onTemplatePicked: (template: ReelTemplate) => void;
  /** Close the panel without picking (X button + ESC). */
  onClose: () => void;
}

type CategoryFilter = PostType | "all";

export default function ReelTemplatesPanel({
  currentTemplateId,
  hasUnsavedEdits,
  onTemplatePicked,
  onClose,
}: Props): JSX.Element {
  const [category, setCategory] = useState<CategoryFilter>("all");

  const groups = getReelTemplatesByPostType();
  const visibleGroups =
    category === "all"
      ? groups
      : groups.filter((g) => g.postType === category);

  function handlePick(template: ReelTemplate): void {
    if (template.id === currentTemplateId) {
      // No-op when the user clicks the active template.
      return;
    }
    if (hasUnsavedEdits) {
      const ok = window.confirm(
        "Switch templates? Your edits to this Reel will be replaced.\n\n" +
          "Save first if you want to keep this version, then come back and switch.",
      );
      if (!ok) return;
    }
    onTemplatePicked(template);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reel templates"
      className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-900/60 backdrop-blur-sm"
      onClick={(e) => {
        // why: dismiss on backdrop click (the inner panel stops propagation).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl">
        {/* ---- Header ---------------------------------------------------- */}
        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              Reel templates
            </h2>
            <p className="text-xs text-neutral-600">
              Pick a vibe — the listing + photos fill in automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close template picker"
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.75}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </header>

        {/* ---- Filter chips --------------------------------------------- */}
        <div className="flex flex-wrap gap-1.5 border-b border-neutral-200 px-5 py-3">
          <CategoryChip
            label="All"
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {(Object.keys(REEL_POST_TYPE_META) as PostType[]).map((pt) => (
            <CategoryChip
              key={pt}
              label={REEL_POST_TYPE_META[pt].label}
              active={category === pt}
              onClick={() => setCategory(pt)}
            />
          ))}
        </div>

        {/* ---- Grouped grid --------------------------------------------- */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {visibleGroups.map((group) => {
            if (group.templates.length === 0) return null;
            const meta = REEL_POST_TYPE_META[group.postType];
            return (
              <section key={group.postType} className="mb-6 last:mb-0">
                <header className="mb-3 flex items-center gap-2">
                  <span
                    className="rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest shadow-sm"
                    style={{
                      backgroundColor: meta.chipBg,
                      color: meta.chipFg,
                    }}
                  >
                    {meta.eyebrow}
                  </span>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    {meta.label}
                  </h3>
                </header>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {group.templates.map((t) => (
                    <ReelTemplateCard
                      key={t.id}
                      template={t}
                      meta={meta}
                      isCurrent={t.id === currentTemplateId}
                      onClick={() => handlePick(t)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {visibleGroups.every((g) => g.templates.length === 0) ? (
            <p className="px-1 py-12 text-center text-sm text-neutral-500">
              No templates match this filter.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
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
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        props.active
          ? "bg-gold-500 text-neutral-900 shadow-sm"
          : "border border-neutral-200 bg-white text-neutral-600 hover:border-gold-300 hover:text-gold-800"
      }`}
    >
      {props.label}
    </button>
  );
}

function ReelTemplateCard(props: {
  template: ReelTemplate;
  meta: ReelPostTypeMeta;
  isCurrent: boolean;
  onClick: () => void;
}): JSX.Element {
  const { template, meta, isCurrent, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Use Reel template: ${template.name}`}
      className={`group flex flex-col gap-2 rounded-lg border bg-white p-2 text-left transition-all ${
        isCurrent
          ? "border-gold-500 ring-2 ring-gold-200"
          : "border-neutral-200 hover:border-gold-300 hover:shadow-sm"
      }`}
    >
      <div
        className="relative w-full overflow-hidden rounded-md"
        style={{ aspectRatio: "9 / 16", backgroundColor: "#1F2937" }}
      >
        {/* Eyebrow chip — matches the in-canvas post-type label */}
        <span
          className="absolute left-2 top-2 rounded-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest shadow-sm"
          style={{ backgroundColor: meta.chipBg, color: meta.chipFg }}
        >
          {meta.eyebrow}
        </span>

        {/* Duration pill — bottom-right */}
        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
          ~{template.durationSec}s
        </span>

        {/* Current badge */}
        {isCurrent ? (
          <span className="absolute right-2 top-2 rounded-full bg-gold-500 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-neutral-900 shadow">
            Current
          </span>
        ) : null}

        {/* Photo-scene-count chip — bottom-left */}
        <span className="absolute bottom-2 left-2 rounded-full bg-white/15 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-widest text-white/80 backdrop-blur-sm">
          {template.photoSceneCount}{" "}
          {template.photoSceneCount === 1 ? "photo" : "photos"}
        </span>

        {/* Bottom scrim — gives a layered look without firing a render */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
      </div>
      <div className="px-0.5">
        <div
          className={`text-[12px] font-semibold leading-tight ${
            isCurrent ? "text-gold-800" : "text-neutral-800"
          }`}
        >
          {template.name}
        </div>
        <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-neutral-500">
          {template.description}
        </div>
      </div>
    </button>
  );
}
