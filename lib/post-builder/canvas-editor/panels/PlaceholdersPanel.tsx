"use client";

/**
 * PlaceholdersPanel — Template Builder authoring sidebar tab.
 * ----------------------------------------------------------
 *
 * Lists the bound-field placeholders an author can drop onto the canvas,
 * grouped (Listing / Photos / Agent / Open House / Office & Brand). Clicking
 * one inserts a placeholder layer that re-populates with the live listing's
 * data on every post.
 *
 * Authoring-only: the parent (CanvasEditor) renders this tab only when
 * `templateAuthoring` is true (Template Builder). Larissa's post-building
 * Studio never sees it.
 *
 * Also surfaces a "Bind selected layer" affordance (Phase C) when a single
 * text/image layer is selected, so a literal layer can be converted into a
 * placeholder without re-creating it.
 */

import { type JSX } from "react";

import {
  placeholderGroupsFor,
  type PlaceholderField,
  type SeparatorChar,
} from "../placeholder-insert";

export interface PlaceholdersPanelProps {
  /** Insert a fresh placeholder layer for the field. */
  onInsert: (field: PlaceholderField) => void;
  /**
   * Phase C — when a single bindable (text/image) layer is selected, the
   * panel shows a "Bind selected → <field>" action per matching-kind field.
   * `selectedKind` is the kind of the current selection, or null when
   * nothing bindable is selected.
   */
  selectedKind: "text" | "image" | null;
  /** Bind the currently selected layer to the field (Phase C). */
  onBindSelected: (field: PlaceholderField) => void;
  /** Insert a literal separator ("—" or "|") text layer to divide inline stats. */
  onInsertSeparator: (char: SeparatorChar) => void;
  /**
   * 2026-08-06 — the template's post-type category, used to narrow the agent
   * placeholders to the ones that actually resolve for this kind of post.
   * An Open House card attributes its HOST, so it gets the `hosting_agent_*`
   * fields; offering the generic `agent_photo` / `agent_phone` alongside them
   * let two OH templates ship with layers the renderer could never fill.
   */
  category: string | null;
}

export default function PlaceholdersPanel({
  onInsert,
  selectedKind,
  onBindSelected,
  onInsertSeparator,
  category,
}: PlaceholdersPanelProps): JSX.Element {
  const groups = placeholderGroupsFor(category);
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3">
      <p className="mb-3 text-xs leading-relaxed text-[var(--studio-text-muted)]">
        Drop a placeholder onto the canvas. It fills with each listing&apos;s
        real data when a post is created.
        {selectedKind ? (
          <>
            {" "}
            A <span className="font-semibold">{selectedKind}</span> layer is
            selected — use “Bind” to turn it into a placeholder.
          </>
        ) : null}
      </p>

      <div className="mb-4">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
          Separators
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onInsertSeparator("—")}
            title="Insert an em-dash to separate stats (e.g. Bedrooms — Bathrooms — Square Ft)"
            className="focus-ring-dark flex w-full items-center justify-between rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-2.5 py-1.5 text-left text-sm text-[var(--studio-text)] transition-colors hover:bg-[var(--studio-hover)]"
          >
            <span>Em Dash &nbsp;—</span>
            <span className="ml-2 shrink-0 rounded bg-[var(--studio-hover)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--studio-text-muted)]">
              text
            </span>
          </button>
          <button
            type="button"
            onClick={() => onInsertSeparator("|")}
            title="Insert a vertical bar to separate stats (e.g. Bedrooms | Bathrooms | Square Ft)"
            className="focus-ring-dark flex w-full items-center justify-between rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-2.5 py-1.5 text-left text-sm text-[var(--studio-text)] transition-colors hover:bg-[var(--studio-hover)]"
          >
            <span>Vertical Bar &nbsp;|</span>
            <span className="ml-2 shrink-0 rounded bg-[var(--studio-hover)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--studio-text-muted)]">
              text
            </span>
          </button>
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.group} className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
            {group.group}
          </div>
          <div className="flex flex-col gap-1">
            {group.fields.map((field) => {
              const canBind = selectedKind === field.kind;
              return (
                <div
                  key={field.field}
                  className="flex items-center gap-1"
                >
                  <button
                    type="button"
                    onClick={() => onInsert(field)}
                    title={`Insert ${field.label} placeholder`}
                    className="focus-ring-dark flex flex-1 items-center justify-between rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-2.5 py-1.5 text-left text-sm text-[var(--studio-text)] transition-colors hover:bg-[var(--studio-hover)]"
                  >
                    <span>{field.label}</span>
                    <span className="ml-2 shrink-0 rounded bg-[var(--studio-hover)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--studio-text-muted)]">
                      {field.kind}
                    </span>
                  </button>
                  {canBind ? (
                    <button
                      type="button"
                      onClick={() => onBindSelected(field)}
                      title={`Bind the selected layer to ${field.label}`}
                      className="focus-ring-dark shrink-0 rounded-md border border-gold-500/60 bg-gold-500/10 px-2 py-1.5 text-[11px] font-semibold text-gold-300 transition-colors hover:bg-gold-500/20"
                    >
                      Bind
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
