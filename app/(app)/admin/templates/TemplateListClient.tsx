"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { reorderTemplateAction } from "./actions";
import type { TemplateMeta } from "@/lib/template-builder";

/**
 * Admin Template Builder — interactive list view.
 *
 * Phase 2A capabilities:
 *   - State filter pills (All / Draft / Published / Archived)
 *   - Up/down arrow reorder per row (calls reorderTemplateAction)
 *   - Row-level "Open →" link to the detail page
 *
 * Phase 2B+ replaces the arrow-button reorder with proper drag-and-drop
 * once we have enough templates that the affordance matters.
 */

// Phase 2K (2026-05-22) — added "unused" as a non-state filter. Admins
// want a one-click way to find templates that have never been picked
// (publish_state-agnostic; a never-used published template is shelfware,
// a never-used draft is in-progress, both are interesting answers to
// "what's earning its keep?"). The pill UX is the same as state filters.
type StateFilter =
  | "all"
  | "draft"
  | "published"
  | "archived"
  | "unused";

interface Props {
  templates: readonly TemplateMeta[];
}

export default function TemplateListClient({ templates }: Props) {
  const [filter, setFilter] = useState<StateFilter>("all");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Counts per state for the filter pills.
  const counts = useMemo(() => {
    const c = { all: 0, draft: 0, published: 0, archived: 0, unused: 0 };
    for (const t of templates) {
      // "All" is the default working view and intentionally EXCLUDES
      // archived rows — archived is reachable only via its own pill (the
      // "view archived" toggle). Keeps the day-to-day list free of retired
      // test/old templates.
      if (t.publish_state !== "archived") c.all += 1;
      if (t.publish_state === "draft") c.draft += 1;
      else if (t.publish_state === "published") c.published += 1;
      else if (t.publish_state === "archived") c.archived += 1;
      if ((t.use_count ?? 0) === 0) c.unused += 1;
    }
    return c;
  }, [templates]);

  const visible = useMemo(() => {
    // Default "All" hides archived — they only appear under the Archived pill.
    if (filter === "all")
      return templates.filter((t) => t.publish_state !== "archived");
    if (filter === "unused") {
      // why: orthogonal to publish_state — "unused" surfaces every
      // template that hasn't generated a post, regardless of whether it's
      // a draft, published, or archived row. Catches both "shelfware
      // shipped but nobody picks it" and "draft never published" in one
      // view.
      return templates.filter((t) => (t.use_count ?? 0) === 0);
    }
    return templates.filter((t) => t.publish_state === filter);
  }, [templates, filter]);

  function onMove(template: TemplateMeta, direction: "up" | "down"): void {
    // why: nudge by 10 so admins have headroom to insert in between two
    // adjacent rows later. The DB column is just an int — we don't worry
    // about renumbering as drift accumulates; can be cleaned up in bulk
    // if needed.
    const delta = direction === "up" ? -10 : 10;
    const next = template.display_order + delta;
    setError(null);
    startTransition(async () => {
      const result = await reorderTemplateAction(template.id, next);
      if (!result.ok) setError(result.error ?? "Failed to reorder.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <FilterPills filter={filter} counts={counts} onChange={setFilter} />
        <Link
          href="/admin/templates/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-gold-600 transition-colors"
        >
          <span aria-hidden="true">＋</span>
          New template
        </Link>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold w-20">
                  Order
                </th>
                <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                <th className="px-4 py-2.5 text-left font-semibold">
                  Post types
                </th>
                <th className="px-4 py-2.5 text-left font-semibold">Formats</th>
                <th className="px-4 py-2.5 text-left font-semibold">State</th>
                <th className="px-4 py-2.5 text-left font-semibold">Uses</th>
                <th className="px-4 py-2.5 text-left font-semibold">Updated</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {visible.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  onMove={onMove}
                  disabled={pending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterPills({
  filter,
  counts,
  onChange,
}: {
  filter: StateFilter;
  counts: {
    all: number;
    draft: number;
    published: number;
    archived: number;
    unused: number;
  };
  onChange: (f: StateFilter) => void;
}) {
  const options: Array<{ id: StateFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: counts.all },
    { id: "published", label: "Published", count: counts.published },
    { id: "draft", label: "Drafts", count: counts.draft },
    { id: "archived", label: "Archived", count: counts.archived },
    // Phase 2K — orthogonal "never used" filter. Sits at the end of the
    // group so the publish-state pills cluster naturally to the left.
    { id: "unused", label: "Never used", count: counts.unused },
  ];
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-1">
      {options.map((opt) => {
        const active = filter === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={[
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600 hover:text-neutral-900",
            ].join(" ")}
          >
            {opt.label}
            <span className="ml-1.5 text-neutral-400 tabular-nums">
              {opt.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TemplateRow({
  template,
  onMove,
  disabled,
}: {
  template: TemplateMeta;
  onMove: (t: TemplateMeta, dir: "up" | "down") => void;
  disabled: boolean;
}) {
  return (
    <tr className="hover:bg-neutral-50/60 transition-colors">
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(template, "up")}
            disabled={disabled}
            title="Move up"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label={`Move ${template.name} up`}
          >
            <ArrowUpIcon />
          </button>
          <span className="text-xs text-neutral-600 tabular-nums w-6 text-center">
            {template.display_order}
          </span>
          <button
            type="button"
            onClick={() => onMove(template, "down")}
            disabled={disabled}
            title="Move down"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label={`Move ${template.name} down`}
          >
            <ArrowDownIcon />
          </button>
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/admin/templates/${template.id}`}
          className="font-medium text-neutral-900 hover:text-gold-800"
        >
          {template.name}
        </Link>
        {template.description ? (
          <div className="text-xs text-neutral-500 mt-0.5 line-clamp-1 max-w-md">
            {template.description}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {template.post_types.map((pt) => (
            <span
              key={pt}
              className="inline-flex items-center rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-medium text-gold-800 ring-1 ring-gold-200"
            >
              {prettyPostType(pt)}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          {template.supported_formats.length === 0 ? (
            <span className="text-xs text-neutral-400 italic">—</span>
          ) : (
            template.supported_formats.map((fmt) => (
              <FormatChip key={fmt} format={fmt} />
            ))
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <PublishStateBadge state={template.publish_state} />
      </td>
      <td className="px-4 py-3">
        <UseCountBadge count={template.use_count} />
      </td>
      <td className="px-4 py-3 text-neutral-600 text-xs">
        {new Date(template.updated_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/admin/templates/${template.id}`}
          className="text-xs font-semibold text-gold-700 hover:text-gold-900 hover:underline"
        >
          Open →
        </Link>
      </td>
    </tr>
  );
}

function EmptyState({ filter }: { filter: StateFilter }) {
  // Phase 2K — friendlier copy for the "never used" filter; "no never used
  // templates" reads as a double negative + minor celebration ("everything
  // is earning its keep") so we write it out explicitly.
  const headline =
    filter === "all"
      ? "No templates created yet."
      : filter === "unused"
        ? "Every template has at least one use. Nice."
        : `No ${filter} templates.`;
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 px-6 py-12 text-center">
      <div className="text-base font-semibold text-neutral-900">{headline}</div>
      <div className="mt-1 text-sm text-neutral-600 max-w-md mx-auto">
        Click <span className="font-medium">New template</span> above to create
        a draft. You can edit metadata + lifecycle now; the visual canvas
        editor opens from each row's detail page.
      </div>
    </div>
  );
}

function FormatChip({ format }: { format: string }) {
  const label =
    format === "portrait_4x5"
      ? "4:5"
      : format === "story_9x16"
        ? "9:16"
        : format;
  return (
    <span className="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-neutral-700">
      {label}
    </span>
  );
}

/**
 * Phase 2H/2I (2026-05-22) — adoption metric. Renders "Never used" for 0,
 * "1 use" for singular, "N uses" otherwise. Counts BOTH direct picks
 * (`generated_posts.template_id`) AND Multi-OH per-slide references
 * (`slide_metadata[].db_template_id`), deduped by post id.
 */
function UseCountBadge({ count }: { count: number | undefined }) {
  const n = count ?? 0;
  if (n === 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 ring-1 ring-neutral-200">
        Never used
      </span>
    );
  }
  const label = n === 1 ? "1 use" : `${n} uses`;
  return (
    <span
      className="inline-flex items-center rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-medium text-gold-900 ring-1 ring-gold-200 tabular-nums"
      title="Posts generated using this template — direct picks + Multi-OH carousel slides"
    >
      {label}
    </span>
  );
}

function PublishStateBadge({ state }: { state: string }) {
  const styles =
    state === "published"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : state === "draft"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-neutral-100 text-neutral-600 ring-neutral-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${styles}`}
    >
      {state}
    </span>
  );
}

function prettyPostType(pt: string): string {
  switch (pt) {
    case "just_listed":
      return "Just Listed";
    case "open_house":
      return "Open House";
    case "under_contract":
      return "Under Contract";
    case "just_sold":
      return "Just Sold";
    case "price_reduction":
      return "Price Reduced";
    default:
      return pt;
  }
}

function ArrowUpIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M4 9l4 4 4-4" />
    </svg>
  );
}
