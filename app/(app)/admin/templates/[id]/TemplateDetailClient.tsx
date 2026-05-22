"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  updateTemplateMetadataAction,
  setTemplateStateAction,
  cloneTemplateAction,
  deleteTemplateAction,
} from "../actions";
import type { TemplateDefinition } from "@/lib/template-builder";

/**
 * Template detail / edit panel.
 *
 * Server component (`page.tsx`) fetches the row + hands it here. This
 * client component handles:
 *   - Inline rename + description edit
 *   - Post-types checkbox edit
 *   - Publish-state dropdown (draft / published / archived)
 *   - Clone button → action redirects to the new draft
 *   - Delete button (drafts only) → action redirects back to the list
 *   - "Open visual editor" link (Phase 2B target — stub in 2A)
 *
 * The visual canvas editor lives at /admin/templates/[id]/edit and is
 * built in Phase 2B. This panel covers everything BUT the canvas itself.
 */

const POST_TYPE_OPTIONS = [
  { id: "just_listed", label: "Just Listed" },
  { id: "open_house", label: "Open House" },
  { id: "under_contract", label: "Under Contract" },
  { id: "just_sold", label: "Just Sold" },
  { id: "price_reduction", label: "Price Reduced" },
] as const;

const STATE_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

interface Props {
  template: TemplateDefinition;
}

export default function TemplateDetailClient({ template }: Props) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [postTypes, setPostTypes] = useState<string[]>(template.post_types);
  const [state, setState] = useState(template.publish_state);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    name !== template.name ||
    description !== (template.description ?? "") ||
    !sameSet(postTypes, template.post_types);

  function togglePostType(id: string): void {
    setPostTypes((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function onMetadataSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setSaveError(null);
    setSaveMessage(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateTemplateMetadataAction(template.id, formData);
      if (result.ok) {
        setSaveMessage("Saved.");
        // Clear the success message after a moment so it doesn't linger.
        setTimeout(() => setSaveMessage(null), 2500);
      } else {
        setSaveError(result.error ?? "Failed to save.");
      }
    });
  }

  function onStateChange(next: string): void {
    if (next !== "draft" && next !== "published" && next !== "archived") return;
    // why: archiving a published template is a meaningful action — confirm
    // so an accidental click doesn't pull the template out of the picker
    // mid-day.
    if (template.publish_state === "published" && next === "archived") {
      const ok = window.confirm(
        `Archive "${template.name}"? It will be removed from the Post Builder picker. Existing posts that used it keep their rendered output. You can un-archive later by switching back to Published.`,
      );
      if (!ok) return;
    }
    setSaveError(null);
    setSaveMessage(null);
    startTransition(async () => {
      const result = await setTemplateStateAction(template.id, next);
      if (result.ok) {
        setState(next);
        setSaveMessage(`State changed to ${next}.`);
        setTimeout(() => setSaveMessage(null), 2500);
      } else {
        setSaveError(result.error ?? "Failed to change state.");
      }
    });
  }

  function onClone(): void {
    setSaveError(null);
    startTransition(async () => {
      try {
        const result = await cloneTemplateAction(template.id);
        if (!result.ok) setSaveError(result.error ?? "Failed to clone.");
      } catch (err) {
        if (isNextRedirect(err)) throw err;
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function onDelete(): void {
    const ok = window.confirm(
      `Permanently delete "${template.name}"? This can't be undone. Drafts can be deleted; published or archived templates should stay for historical lineage.`,
    );
    if (!ok) return;
    setSaveError(null);
    startTransition(async () => {
      try {
        const result = await deleteTemplateAction(template.id);
        if (!result.ok) setSaveError(result.error ?? "Failed to delete.");
      } catch (err) {
        if (isNextRedirect(err)) throw err;
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/templates"
          className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"
        >
          <span aria-hidden="true">←</span>
          Back to all templates
        </Link>
      </div>

      {/* Header strip */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-700 mb-1">
            Template
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 leading-tight">
            {template.name}
          </h1>
          <div className="mt-1 text-xs text-neutral-500 font-mono">
            {template.id}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Phase 2B target. Stub for 2A — link points to /edit which 2B
              builds as the canvas editor route. */}
          <Link
            href={`/admin/templates/${template.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-gold-600 transition-colors"
          >
            <PencilIcon />
            Open visual editor
          </Link>
          <button
            type="button"
            onClick={onClone}
            disabled={pending}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 transition-colors"
          >
            Clone
          </button>
          {template.publish_state === "draft" ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 transition-colors"
            >
              Delete draft
            </button>
          ) : null}
        </div>
      </div>

      {/* Status alert if any save error/success */}
      {saveError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {saveError}
        </div>
      ) : null}
      {saveMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {saveMessage}
        </div>
      ) : null}

      {/* Lifecycle card */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">
          Lifecycle
        </h2>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <label
              htmlFor="publish-state"
              className="block text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 mb-1"
            >
              Publish state
            </label>
            <select
              id="publish-state"
              value={state}
              onChange={(e) => onStateChange(e.target.value)}
              disabled={pending}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
            >
              {STATE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-neutral-500 max-w-md">
              {state === "draft"
                ? "Hidden from the picker. Authors can keep iterating without affecting users."
                : state === "published"
                  ? "Live in the picker — Larissa can pick this template when building a post."
                  : "Archived. Hidden from the picker; posts that used it keep their rendered output frozen."}
            </div>
          </div>

          <div className="text-xs text-neutral-500 leading-relaxed">
            <div>
              <span className="text-neutral-700 font-medium">Order:</span>{" "}
              {template.display_order}
            </div>
            <div>
              <span className="text-neutral-700 font-medium">Updated:</span>{" "}
              {new Date(template.updated_at).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Metadata edit form */}
      <form onSubmit={onMetadataSubmit} className="card p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Metadata</h2>
          {dirty ? (
            <span className="text-xs text-amber-700 italic">
              Unsaved changes
            </span>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="name"
            className="block text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 mb-1"
          >
            Template name <span className="text-gold-700">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 mb-1"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30 resize-y"
          />
        </div>

        <fieldset>
          <legend className="block text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 mb-2">
            Post types <span className="text-gold-700">*</span>
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {POST_TYPE_OPTIONS.map((pt) => {
              const checked = postTypes.includes(pt.id);
              return (
                <label
                  key={pt.id}
                  className="inline-flex items-center gap-2.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 cursor-pointer hover:bg-neutral-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    name="post_types"
                    value={pt.id}
                    checked={checked}
                    onChange={() => togglePostType(pt.id)}
                    className="h-4 w-4 rounded border-neutral-300 text-gold-600 focus:ring-gold-500"
                  />
                  <span>{pt.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="submit"
            disabled={pending || !dirty}
            className="rounded-md bg-gold-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-gold-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? "Saving…" : "Save metadata"}
          </button>
        </div>
      </form>

      {/* Schema summary — read-only in 2A; visual editor lands 2B */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-2">
          Schema
        </h2>
        <div className="text-xs text-neutral-600 mb-3">
          Defined formats:{" "}
          <span className="font-mono">
            {Object.keys(template.schema).length === 0
              ? "(none — empty schema)"
              : Object.keys(template.schema).join(", ")}
          </span>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
          The visual canvas editor opens at{" "}
          <code className="bg-amber-100 px-1 rounded">/edit</code> (Phase 2B). For now, schema edits happen via direct SQL through the Supabase MCP.
        </div>
      </div>
    </div>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function isNextRedirect(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: string }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
    </svg>
  );
}
