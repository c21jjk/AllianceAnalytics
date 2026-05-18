"use client";

/**
 * CustomTemplatesTable — interactive table for /templates.
 *
 * Rows are grouped by post_type. Each row shows preview thumbnail, name,
 * slot tuple, default badge, and three inline actions (rename, toggle
 * default, archive). All edits round-trip through server actions and
 * patch the in-memory state on success so the UI doesn't have to wait
 * for a full revalidate.
 *
 * Confirmation dialog is a minimal inline confirm (clicking Archive twice
 * before a 4-second timeout). No nested modal — keeps the surface
 * lightweight; Larissa is the primary user and this page is rarely
 * touched, so the simpler interaction is the right trade-off.
 */

import { type JSX, useState } from "react";

import {
  archiveCustomTemplateAction,
  renameCustomTemplateAction,
  setCustomTemplateDefaultAction,
  type CustomTemplateSummary,
} from "@/app/(app)/post-builder/actions";

const POST_TYPE_LABELS: Record<string, string> = {
  just_listed: "Just Listed",
  just_sold: "Just Sold",
  under_contract: "Under Contract",
  open_house: "Open House",
  price_reduction: "Price Reduced",
};

const VARIANT_LABELS: Record<string, string> = {
  v1: "Hero Editorial",
  v2: "Bold Stats",
  v3: "Excellence Collection",
  v4: "Two-Photo Diptych",
  v5: "Three-Photo Grid",
  v6: "Magazine Cover",
  v7: "Polaroid",
  v8: "Standard NEW LISTING",
  v9: "Just Sold Celebration",
  v10: "Coming Soon Teaser",
};

const FORMAT_LABELS: Record<string, string> = {
  square_1x1: "Square 1:1",
  portrait_4x5: "Portrait 4:5",
  story_9x16: "Story 9:16",
};

interface CustomTemplatesTableProps {
  initialTemplates: CustomTemplateSummary[];
}

export default function CustomTemplatesTable(
  props: CustomTemplatesTableProps,
): JSX.Element {
  const [templates, setTemplates] = useState<CustomTemplateSummary[]>(
    props.initialTemplates,
  );
  // Track which row is currently being renamed (id → working name).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  // Track per-row pending state so the buttons disable while server work runs.
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  // Track which row is "armed" for archive (clicked once; second click confirms).
  const [archiveArmedId, setArchiveArmedId] = useState<string | null>(null);
  // Top-level error banner for action failures.
  const [error, setError] = useState<string | null>(null);

  function startRename(t: CustomTemplateSummary): void {
    setEditingId(t.id);
    setEditingValue(t.name);
    setError(null);
  }

  function cancelRename(): void {
    setEditingId(null);
    setEditingValue("");
  }

  async function submitRename(id: string): Promise<void> {
    const trimmed = editingValue.trim();
    if (trimmed.length === 0) {
      setError("Template name is required.");
      return;
    }
    setPendingRowId(id);
    setError(null);
    try {
      const res = await renameCustomTemplateAction(id, trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTemplates((prev) =>
        prev.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
      );
      setEditingId(null);
      setEditingValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingRowId(null);
    }
  }

  async function toggleDefault(t: CustomTemplateSummary): Promise<void> {
    const nextValue = !t.is_default;
    setPendingRowId(t.id);
    setError(null);
    try {
      const res = await setCustomTemplateDefaultAction(t.id, nextValue);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Patch in-memory state. Setting to true also clears any other
      // default in the same slot — mirror the server-side update so the
      // UI doesn't temporarily show two defaults for the slot.
      setTemplates((prev) =>
        prev.map((row) => {
          if (row.id === t.id) {
            return { ...row, is_default: nextValue };
          }
          if (
            nextValue &&
            row.post_type === t.post_type &&
            row.format === t.format &&
            row.based_on_variant === t.based_on_variant
          ) {
            return { ...row, is_default: false };
          }
          return row;
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingRowId(null);
    }
  }

  async function archiveRow(id: string): Promise<void> {
    setPendingRowId(id);
    setError(null);
    try {
      const res = await archiveCustomTemplateAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setArchiveArmedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingRowId(null);
    }
  }

  function handleArchiveClick(id: string): void {
    if (archiveArmedId === id) {
      void archiveRow(id);
    } else {
      setArchiveArmedId(id);
      // why: auto-disarm after 4s so the user has time to confirm but
      // the page doesn't stay in a "next click deletes" state forever.
      setTimeout(() => {
        setArchiveArmedId((current) => (current === id ? null : current));
      }, 4000);
    }
  }

  // Group by post_type for the rendered sections.
  const grouped = new Map<string, CustomTemplateSummary[]>();
  for (const t of templates) {
    const existing = grouped.get(t.post_type) ?? [];
    existing.push(t);
    grouped.set(t.post_type, existing);
  }
  // Sort groups by the canonical post_type order in POST_TYPE_LABELS.
  const orderedGroups = Object.keys(POST_TYPE_LABELS)
    .filter((pt) => grouped.has(pt))
    .map((pt) => ({ post_type: pt, rows: grouped.get(pt)! }));

  if (templates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
        <p className="text-sm font-medium text-neutral-700">
          No custom templates yet
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Open a variant in the Post Builder Studio and click{" "}
          <span className="font-semibold">Save as Template</span> to start
          building your library.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {orderedGroups.map(({ post_type, rows }) => (
        <section key={post_type}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            {POST_TYPE_LABELS[post_type] ?? post_type}
          </h2>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-3 py-2 w-24">Preview</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Slot</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((t) => {
                  const isEditing = editingId === t.id;
                  const isPending = pendingRowId === t.id;
                  const isArchiveArmed = archiveArmedId === t.id;
                  return (
                    <tr
                      key={t.id}
                      className={isPending ? "opacity-50" : undefined}
                    >
                      <td className="px-3 py-2 align-middle">
                        {t.preview_image_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={t.preview_image_url}
                            alt={`Preview of ${t.name}`}
                            className="h-16 w-16 rounded-md border border-neutral-200 bg-neutral-100 object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-[10px] text-neutral-400">
                            no preview
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void submitRename(t.id);
                                } else if (e.key === "Escape") {
                                  cancelRename();
                                }
                              }}
                              autoFocus
                              maxLength={80}
                              className="block w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                            />
                            <button
                              type="button"
                              onClick={() => void submitRename(t.id)}
                              disabled={isPending}
                              className="rounded-md bg-gold-500 px-2 py-1 text-xs font-semibold text-white hover:bg-gold-600 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelRename}
                              disabled={isPending}
                              className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="font-medium text-neutral-900">
                            {t.name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle text-xs text-neutral-600">
                        <div>{FORMAT_LABELS[t.format] ?? t.format}</div>
                        <div className="text-neutral-400">
                          based on{" "}
                          {VARIANT_LABELS[t.based_on_variant] ??
                            t.based_on_variant}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {t.is_default ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-800">
                            Default
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                            Custom
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {!isEditing ? (
                            <button
                              type="button"
                              onClick={() => startRename(t)}
                              disabled={isPending}
                              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                            >
                              Rename
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void toggleDefault(t)}
                            disabled={isPending || isEditing}
                            className={[
                              "rounded-md px-2 py-1 text-xs font-medium",
                              t.is_default
                                ? "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                                : "bg-gold-100 text-gold-800 hover:bg-gold-200",
                              "disabled:opacity-50",
                            ].join(" ")}
                          >
                            {t.is_default ? "Unset default" : "Make default"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArchiveClick(t.id)}
                            disabled={isPending || isEditing}
                            className={[
                              "rounded-md px-2 py-1 text-xs font-medium",
                              isArchiveArmed
                                ? "bg-rose-600 text-white hover:bg-rose-700"
                                : "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
                              "disabled:opacity-50",
                            ].join(" ")}
                            title={
                              isArchiveArmed
                                ? "Click again to confirm archive"
                                : "Archive this template"
                            }
                          >
                            {isArchiveArmed ? "Confirm archive" : "Archive"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
