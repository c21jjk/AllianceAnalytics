"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CanvasEditorOverlay from "@/lib/post-builder/canvas-editor/CanvasEditorOverlay";
import { mapListingToPayload } from "@/lib/post-builder/canvas-editor/mapListingToPayload";
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

/** Per-format canonical dimensions — matches the renderer's expectations. */
const FORMAT_DIMS: Record<PostFormat, { width: number; height: number }> = {
  square_1x1: { width: 1080, height: 1080 },
  portrait_4x5: { width: 1080, height: 1350 },
  story_9x16: { width: 1080, height: 1920 },
};

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

  // Resolve the schema to mount in the editor. If the template already
  // defines this format, mount the saved schema. Otherwise, build a
  // minimal starter so the canvas has something to render against.
  //
  // The starter is INTENTIONALLY almost-empty — we don't pre-populate
  // address/price layers because admins should design from scratch and
  // pick exactly which placeholders to bind. A blank canvas with the
  // right dimensions is the cleanest starting point.
  const schemaForEditor: CanvasTemplateSchema | null = useMemo(() => {
    if (!open) return null;
    const existing = template.schema[format];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      // why: cast at the boundary. We trust the stored schema is shaped
      // correctly (it was authored via this same editor or via the JSON
      // textarea fallback, both of which validate before persisting).
      return existing as unknown as CanvasTemplateSchema;
    }
    return buildStarterSchema(template, format);
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

/**
 * Construct a minimal CanvasTemplateSchema for an undefined format.
 *
 * The canvas-editor requires a fully-shaped schema object to mount. We
 * stamp the template's metadata + correct dimensions + an empty layer
 * list. Authors then add their own layers from the editor's UI.
 *
 * The `variant` and `category` fields are placeholders — the canvas
 * editor uses them for some internal routing, but for admin-authored
 * templates the picker keys off `template_definitions.id` (uuid) not
 * variant. Setting them to safe defaults keeps the editor happy without
 * misrepresenting the template's intent.
 */
function buildStarterSchema(
  template: TemplateDefinition,
  format: PostFormat,
): CanvasTemplateSchema {
  const dims = FORMAT_DIMS[format];
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    // why: 'just_listed' is the most generic category in the canvas-editor
    // enum. Admin-authored templates aren't pegged to a single category —
    // they're tagged via template_definitions.post_types (multi-select)
    // and the picker queries that array, not this field.
    category: "just_listed",
    // why: 'v8' Standard is the canvas-editor's most layout-agnostic
    // variant. Used as a placeholder so the type-check passes; the
    // Post Builder picker (Phase 2C) routes DB templates by template
    // id, not variant.
    variant: "v8",
    format,
    width: dims.width,
    height: dims.height,
    // Brand cream — matches Alliance's existing design tokens.
    backgroundColor: "#FCFCFB",
    layers: [],
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}
