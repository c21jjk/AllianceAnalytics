"use client";

/**
 * SaveAsTemplateModal — Studio "Save as Template" flow
 * ----------------------------------------------------
 *
 * Modal that captures the metadata needed to persist the current canvas as a
 * reusable custom template. Rendered from CanvasEditor's header when the
 * user clicks the "Save as Template" button alongside Save Post.
 *
 * Inputs collected:
 *   • name           — short label (required, trimmed, max 80 chars)
 *   • makeDefault    — when true, this template replaces the factory variant
 *                      card for its (post_type, format, based_on_variant)
 *                      slot in the Post Builder variant grid.
 *
 * The canvas state itself (`fabricJson`) and the preview PNG data URI are
 * captured from the parent at submit-time via the `getCanvasState` callback —
 * the modal stays stateless about the canvas so it doesn't double-render the
 * Fabric instance.
 *
 * UX rules (ADHD-friendly):
 *   • Name input autofocuses on open so the user can start typing immediately.
 *   • One decision per screen — single text input + a single checkbox + the
 *     save/cancel pair. No nested config.
 *   • Inline error renders BELOW the form, not as a toast — failures stay
 *     visible while the modal is open so the user knows what to fix.
 *   • While submitting both buttons are disabled with a spinner on Save.
 */

import { type JSX, useEffect, useRef, useState } from "react";

import type { PostFormat, PostType, PostVariant } from "../types";
import type { CanvasTemplateSchema } from "./types";
import type { SaveCustomTemplateResult } from "@/app/(app)/post-builder/actions";

/**
 * Snapshot the modal asks the parent for at submit-time. Captured lazily so
 * the modal doesn't hold a Fabric reference; the parent passes a callback
 * that runs `reconstructSchemaFromCanvas(canvas, originalSchema)` +
 * `canvas.toDataURL(...)` on demand. `schemaJson` is a CanvasTemplateSchema
 * (the same shape factory templates use) so the saved row re-hydrates with
 * fresh listing data on each render.
 */
export interface CanvasStateSnapshot {
  schemaJson: CanvasTemplateSchema;
  previewImageDataUri: string;
}

export interface SaveAsTemplateModalProps {
  /** Display label for the base variant — surfaces in the checkbox copy. */
  variantDisplayName: string;
  /** Display label for the post type — surfaces in the help text below the checkbox. */
  postTypeDisplayName: string;
  /** Display label for the format — surfaces in the help text below the checkbox. */
  formatDisplayName: string;

  /** Tuple this template will be saved under. */
  postType: PostType;
  format: PostFormat;
  basedOnVariant: PostVariant;

  /**
   * Existing template id when the user is editing an already-saved custom
   * template (Update flow). null = new template (Insert flow). When set,
   * the modal pre-fills the name and defaults `makeDefault` based on whether
   * the existing row is already the slot's default.
   */
  existingTemplateId: string | null;
  existingName?: string;
  existingIsDefault?: boolean;

  /** Pull the latest Fabric state + preview from the parent at submit-time. */
  getCanvasState: () => CanvasStateSnapshot | null;

  /** Action wrapper the parent supplies. Lets the editor stay free of server-action imports. */
  onSubmit: (input: {
    id: string | null;
    name: string;
    postType: PostType;
    format: PostFormat;
    basedOnVariant: PostVariant;
    schemaJson: CanvasTemplateSchema;
    makeDefault: boolean;
    previewImageDataUri: string;
  }) => Promise<SaveCustomTemplateResult>;

  /** Called after a successful save — parent typically refreshes the variant grid. */
  onSaved: (id: string) => void;

  /** Cancel handler — closes the modal without saving. */
  onClose: () => void;
}

export default function SaveAsTemplateModal(
  props: SaveAsTemplateModalProps,
): JSX.Element {
  const [name, setName] = useState<string>(props.existingName ?? "");
  const [makeDefault, setMakeDefault] = useState<boolean>(
    props.existingIsDefault ?? false,
  );
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // 2026-05-28 — brief success confirmation. The old flow gave no feedback
  // and the page revalidation ejected the user to Final Review; now we keep
  // the editor open and flash "Saved" before the parent closes the modal.
  const [saved, setSaved] = useState<boolean>(false);

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // why: autofocus the name input on mount so the keyboard-driven flow is
  // smooth. We do it inside an effect (not the autoFocus attribute) because
  // the modal sometimes renders inside a parent that owns the focus on open
  // — the explicit focus() call wins.
  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Template name is required.");
      return;
    }
    if (trimmed.length > 80) {
      setError("Template name must be 80 characters or fewer.");
      return;
    }

    const snapshot = props.getCanvasState();
    if (!snapshot) {
      setError(
        "Couldn't read the canvas state. Close and reopen the editor, then try again.",
      );
      return;
    }
    // For Update flow (existing id provided) we accept an empty preview if
    // the canvas-to-data-URL call returned one — the server reuses the
    // existing preview when previewImageDataUri is "". For Insert we MUST
    // have a preview.
    if (
      props.existingTemplateId === null &&
      (!snapshot.previewImageDataUri ||
        !snapshot.previewImageDataUri.startsWith("data:image/png;base64,"))
    ) {
      setError(
        "Couldn't capture a preview image. This usually means a photo on " +
          "the slide isn't CORS-safe (a direct MLS-CDN image taints the " +
          "canvas). Re-pick the photo from the Photos panel (those are served " +
          "from our storage), then save again.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await props.onSubmit({
        id: props.existingTemplateId,
        name: trimmed,
        postType: props.postType,
        format: props.format,
        basedOnVariant: props.basedOnVariant,
        schemaJson: snapshot.schemaJson,
        makeDefault,
        previewImageDataUri: snapshot.previewImageDataUri,
      });
      if (!res.ok) {
        setError(res.error);
        setSubmitting(false);
        return;
      }
      // why (2026-05-28): flash a success confirmation, THEN let the parent
      // unmount. submitting stays true so the buttons remain disabled. The
      // editor itself stays open (the save action no longer revalidates the
      // route), so the user lands back on their canvas, not Final Review.
      setSaved(true);
      const savedId = res.id;
      window.setTimeout(() => props.onSaved(savedId), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const isUpdate = props.existingTemplateId !== null;
  const titleLabel = isUpdate ? "Update template" : "Save as template";
  const submitLabel = isUpdate ? "Update template" : "Save template";

  return (
    <div
      data-theme="dark"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 text-[var(--studio-text)]"
      // why: z-[60] sits ABOVE the CanvasEditorOverlay (z-50). The modal
      // launches from inside the editor, so it MUST render on top of the
      // editor chrome — otherwise the canvas captures the click first.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          props.onClose();
        }
      }}
    >
      <form
        onSubmit={handleSubmit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--studio-border)] bg-[var(--studio-popover)] p-5 shadow-2xl shadow-black/60 text-white"
      >
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gold-700">
            Custom template
          </div>
          <h3 className="text-base font-bold text-white">{titleLabel}</h3>
          <p className="mt-0.5 text-xs text-[var(--studio-text-muted)]">
            {isUpdate
              ? "Update the name + default behavior for this saved template. The current canvas replaces the saved design."
              : "Save the current canvas as a reusable template based on " +
                props.variantDisplayName +
                "."}
          </p>
        </div>

        <label className="block text-xs font-medium text-white">
          Template name
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            maxLength={80}
            placeholder={`e.g. ${props.variantDisplayName} — Larissa edit`}
            className="mt-1 block w-full rounded-lg border border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] px-3 py-2 text-sm text-white placeholder:text-[var(--studio-input-placeholder)] focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20 disabled:opacity-50"
          />
        </label>

        <label className="mt-4 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
            disabled={submitting}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--studio-input-border)] bg-[var(--studio-input-bg)] text-gold-500 focus:ring-gold-500"
          />
          <span className="text-xs text-[var(--studio-text-muted)]">
            <span className="font-semibold text-white">
              Make this the new default for {props.variantDisplayName}
            </span>
            <span className="mt-0.5 block text-[11px] text-[var(--studio-text-muted)]">
              When enabled, this template will replace{" "}
              {props.variantDisplayName} for new {props.postTypeDisplayName}{" "}
              posts at the {props.formatDisplayName} size.
            </span>
          </span>
        </label>

        {error ? (
          <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        ) : null}

        {saved ? (
          <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
            Saved ✓ — available now in the picker and the Template Builder.
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            disabled={submitting}
            className="inline-flex h-9 items-center rounded-md border border-[var(--studio-border)] bg-transparent px-3 text-sm font-medium text-white transition hover:bg-[var(--studio-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || name.trim().length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-gold-500 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <svg
                  className="h-3.5 w-3.5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="opacity-25"
                  />
                  <path
                    d="M4 12a8 8 0 0 1 8-8"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                Saving…
              </>
            ) : (
              submitLabel
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
