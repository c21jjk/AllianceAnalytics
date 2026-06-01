"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CanvasEditorOverlay from "@/lib/post-builder/canvas-editor/CanvasEditorOverlay";
import { mapListingToPayload } from "@/lib/post-builder/canvas-editor/mapListingToPayload";
import { normalizeOrBuildStarter } from "@/lib/post-builder/canvas-editor/schema-normalize";
import type {
  CanvasTemplateSchema,
  CanvasExportResult,
} from "@/lib/post-builder/canvas-editor/types";
import type {
  PostBuilderListing,
  PostFormat,
} from "@/lib/post-builder/types";
import {
  saveTemplateSchemaForFormatAction,
  saveTemplateAsNewAction,
  setTemplateDefaultAction,
} from "../../actions";
import type { TemplateDefinition } from "@/lib/template-builder";

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

/**
 * Template-builder wrapper around CanvasEditorOverlay.
 *
 * Adapts the canvas editor — which was built to edit a SINGLE post
 * (template bound to a specific listing's data) — into a TEMPLATE
 * authoring surface:
 *
 *   • The "template" passed in is the saved schema for the active
 *     format (or a freshly-built starter when undefined).
 *   • The "listing" is a sample row provided server-side so the editor
 *     can show realistic photos + text while authoring. The author's
 *     edits to text are stored as the canvas-editor's bound-text or
 *     literal-text fields; at render time (Phase 2C) those get
 *     re-resolved against whatever listing the post is being generated
 *     for.
 *   • The save callback extracts JUST the schema from the editor's
 *     export result (we discard the rendered PNG — Phase 2C handles
 *     server-side rendering for actual post generation).
 *   • On save success, we router.refresh() so the parent page picks up
 *     the updated schema_family and the format-defined dot in the tab
 *     strip turns green.
 *
 * Session A scope (this component):
 *   ✓ Open/close lifecycle
 *   ✓ Starter schema construction when format is undefined
 *   ✓ Save round-trip to saveTemplateSchemaForFormatAction
 *   ✓ Error surfacing
 *
 * Out of scope (later sessions):
 *   • Placeholder picker UX (authors type `{address}` literally for now)
 *   • Sample-listing swap (pick a different listing to author against)
 *   • Multi-format edit-in-parallel (you save one format at a time)
 */

interface Props {
  template: TemplateDefinition;
  format: PostFormat;
  /** Sample listing to use as visual context. Null when the DB has no
   *  active listings (rare; the editor handles it). */
  sampleListing: PostBuilderListing | null;
  /** Caller controls open state so the format-switcher can re-open the
   *  editor with a fresh format selection without remounting the parent. */
  open: boolean;
  onClose: () => void;
}


export default function TemplateCanvasEditor({
  template,
  format,
  sampleListing,
  open,
  onClose,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // When the author clicks Save in the editor, we capture the exported
  // schema and open a choice dialog (save to this template vs. save as new,
  // plus an optional "set as default") instead of committing immediately.
  const [pendingSchema, setPendingSchema] = useState<unknown | null>(null);
  // The editor's rendered image (data URI), captured at save time so the
  // chosen save action can refresh the template's list thumbnail.
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);

  // Resolve the schema to mount in the editor. We MERGE the stored data
  // (whatever shape it's in) with a fresh starter to guarantee every
  // required CanvasTemplateSchema field has a sensible value. This
  // handles three scenarios:
  //   1. Format undefined → use starter wholesale.
  //   2. Format defined with complete schema → use as-is (starter
  //      provides backup for any newly-added required fields).
  //   3. Format defined with incomplete/legacy schema (e.g. seeded by
  //      SQL with just {width, height, layers}) → fill in id, name,
  //      category, variant, backgroundColor, updatedAt, schemaVersion
  //      from the starter so the editor mounts without crashing.
  //
  // The starter is INTENTIONALLY almost-empty — we don't pre-populate
  // address/price layers because admins should design from scratch and
  // pick exactly which placeholders to bind. A blank canvas with the
  // right dimensions is the cleanest starting point.
  const schemaForEditor: CanvasTemplateSchema | null = useMemo(() => {
    if (!open) return null;
    return normalizeOrBuildStarter(template, format);
  }, [template, format, open]);

  // The editor needs an MLSListingPayload; map our sample row through.
  const samplePayload = useMemo(() => {
    if (!open || !sampleListing) return null;
    return mapListingToPayload(sampleListing);
  }, [sampleListing, open]);

  // Editor "Save" → capture the schema and open the choice dialog. The PNG
  // (`result.file`, `result.dataUrl`) is for posts, not templates — template
  // rendering happens at post-generate time against live data, so we keep
  // only the schema.
  async function handleSave(result: CanvasExportResult): Promise<void> {
    setError(null);
    // why: persist the EDITED design. `result.editedSchema` is the live canvas
    // reconstructed into a CanvasTemplateSchema (the user's actual edits).
    // `result.schema` is the ORIGINAL pre-edit template the editor mounted —
    // saving THAT was the old data-loss bug, so we must NOT fall back to it.
    // If reconstruction failed (editedSchema null/undefined), refuse the save
    // and tell the author rather than silently writing the pre-edit design.
    const editedSchema = result.editedSchema;
    if (!editedSchema) {
      setError(
        "Could not read your edits from the canvas, so nothing was saved (your changes are still on screen). Please try saving again; if it keeps failing, reload and report it — we will not overwrite the template with the old design.",
      );
      return;
    }
    setPendingSchema(editedSchema as unknown);
    setPendingPreview(result.dataUrl ?? null);
  }

  // "Save Changes to Existing Template" (+ optional set-default).
  function commitSaveExisting(makeDefault: boolean): void {
    const schema = pendingSchema;
    if (schema === null) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await saveTemplateSchemaForFormatAction(
          template.id,
          format,
          schema,
          pendingPreview ?? undefined,
        );
        if (!response.ok) {
          setError(response.error ?? "Failed to save template schema.");
          return;
        }
        if (makeDefault) {
          const def = await setTemplateDefaultAction(template.id, true);
          if (!def.ok) {
            setError(def.error ?? "Saved, but failed to set as default.");
            return;
          }
        }
        setPendingSchema(null);
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // "Create New Template with these Changes" (+ optional set-default).
  function commitSaveAsNew(name: string, makeDefault: boolean): void {
    const schema = pendingSchema;
    if (schema === null) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await saveTemplateAsNewAction(
          template.id,
          format,
          schema,
          name,
          makeDefault,
          pendingPreview ?? undefined,
        );
        if (!response.ok) {
          setError(response.error ?? "Failed to create new template.");
          return;
        }
        setPendingSchema(null);
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <>
      <CanvasEditorOverlay
        open={open}
        onClose={onClose}
        template={schemaForEditor}
        listing={samplePayload}
        onSave={handleSave}
        saveLabel="Save template"
        isSaving={pending}
        templateAuthoring
        isAdmin
      />
      {pendingSchema !== null ? (
        <SaveOptionsModal
          templateName={template.name}
          postTypeLabel={
            template.post_types.length > 0
              ? prettyPostType(template.post_types[0])
              : "this post type"
          }
          saving={pending}
          onSaveExisting={commitSaveExisting}
          onSaveAsNew={commitSaveAsNew}
          onCancel={() => setPendingSchema(null)}
        />
      ) : null}
      {error ? (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900 shadow-lg"
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 text-rose-700 hover:text-rose-900 font-semibold"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}

function SaveOptionsModal({
  templateName,
  postTypeLabel,
  saving,
  onSaveExisting,
  onSaveAsNew,
  onCancel,
}: {
  templateName: string;
  postTypeLabel: string;
  saving: boolean;
  onSaveExisting: (makeDefault: boolean) => void;
  onSaveAsNew: (name: string, makeDefault: boolean) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [newName, setNewName] = useState<string>(`${templateName} (Copy)`);
  const [makeDefault, setMakeDefault] = useState<boolean>(false);

  const canConfirm = mode === "existing" || newName.trim().length > 0;

  function confirm(): void {
    if (saving || !canConfirm) return;
    if (mode === "existing") onSaveExisting(makeDefault);
    else onSaveAsNew(newName, makeDefault);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save options"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-900/70 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="border-b border-neutral-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-neutral-900">
            Save template
          </h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Choose how to save your changes to{" "}
            <span className="font-medium text-neutral-900">{templateName}</span>.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50">
            <input
              type="radio"
              name="save-mode"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-neutral-900">
                Save changes to this template
              </span>
              <span className="block text-xs text-neutral-600">
                Overwrites the current design of {templateName}.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50">
            <input
              type="radio"
              name="save-mode"
              checked={mode === "new"}
              onChange={() => setMode("new")}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-900">
                Create a new template with these changes
              </span>
              <span className="block text-xs text-neutral-600">
                Leaves {templateName} untouched and saves a separate, published
                template.
              </span>
              {mode === "new" ? (
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New template name"
                  className="mt-2 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500"
                />
              ) : null}
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-2.5 px-1 pt-1">
            <input
              type="checkbox"
              checked={makeDefault}
              onChange={(e) => setMakeDefault(e.target.checked)}
            />
            <span className="text-sm text-neutral-800">
              Set as the default {postTypeLabel} template
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={saving || !canConfirm}
            className="rounded-md bg-gold-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-gold-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "existing" ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

