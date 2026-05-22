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
import { saveTemplateSchemaForFormatAction } from "../../actions";
import type { TemplateDefinition } from "@/lib/template-builder";

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

  async function handleSave(result: CanvasExportResult): Promise<void> {
    setError(null);
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          // why: extract just the schema. The rendered PNG (`result.file`,
          // `result.dataUrl`) is for posts, not templates — template
          // rendering happens at post-generate time against live data.
          const response = await saveTemplateSchemaForFormatAction(
            template.id,
            format,
            result.schema as unknown,
          );
          if (!response.ok) {
            setError(response.error ?? "Failed to save template schema.");
            resolve();
            return;
          }
          // Refresh server data + close the overlay so the parent's
          // format-defined dot turns green.
          router.refresh();
          onClose();
          resolve();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          resolve();
        }
      });
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
      />
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

