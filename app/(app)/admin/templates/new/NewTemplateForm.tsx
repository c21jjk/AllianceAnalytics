"use client";

import { useState, useTransition } from "react";
import { createTemplateAction } from "../actions";

/**
 * Inline create-template form.
 *
 * Manages:
 *   - Name (required, free text)
 *   - Description (optional)
 *   - Post-types (multi-select checkboxes, required ≥1)
 *
 * Submit posts a FormData to createTemplateAction. On success the action
 * redirects server-side; the form never sees the success state. On
 * failure, the action returns { ok: false, error } which we surface
 * inline above the submit button.
 */

const POST_TYPE_OPTIONS = [
  { id: "just_listed", label: "Just Listed" },
  { id: "open_house", label: "Open House" },
  { id: "under_contract", label: "Under Contract" },
  { id: "just_sold", label: "Just Sold" },
  { id: "price_reduction", label: "Price Reduced" },
] as const;

export default function NewTemplateForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      // The action either redirects (success) or returns an error envelope.
      // Next.js throws a NEXT_REDIRECT internally when redirect() fires —
      // try/catch lets us swallow that and only surface real errors.
      try {
        const result = await createTemplateAction(formData);
        if (!result.ok) setError(result.error ?? "Failed to create template.");
      } catch (err) {
        // why: NEXT_REDIRECT throws are part of the success path — don't
        // surface them. Re-throw anything else.
        if (err && typeof err === "object" && "digest" in err) {
          const digest = (err as { digest?: string }).digest;
          if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
            throw err;
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-5">
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
          autoFocus
          placeholder="e.g. Open House — Editorial"
          className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
        />
        <div className="mt-1 text-xs text-neutral-500">
          Shown in the picker and the admin list. Keep it short and recognizable.
        </div>
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
          placeholder="Optional authoring notes (audience, design intent, etc.)"
          className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30 resize-y"
        />
        <div className="mt-1 text-xs text-neutral-500">
          Visible to admins only. The picker doesn&apos;t show this.
        </div>
      </div>

      <fieldset>
        <legend className="block text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 mb-2">
          Post types <span className="text-gold-700">*</span>
        </legend>
        <div className="text-xs text-neutral-500 mb-2">
          Tick every status this template can be used for. Most templates tag
          one; some (like a luxury editorial that works for both Just Listed and
          Open House) tag multiple.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {POST_TYPE_OPTIONS.map((pt) => (
            <label
              key={pt.id}
              className="inline-flex items-center gap-2.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 cursor-pointer hover:bg-neutral-50 transition-colors"
            >
              <input
                type="checkbox"
                name="post_types"
                value={pt.id}
                className="h-4 w-4 rounded border-neutral-300 text-gold-600 focus:ring-gold-500"
              />
              <span>{pt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <a
          href="/admin/templates"
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gold-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-gold-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? "Creating…" : "Create draft"}
        </button>
      </div>
    </form>
  );
}
