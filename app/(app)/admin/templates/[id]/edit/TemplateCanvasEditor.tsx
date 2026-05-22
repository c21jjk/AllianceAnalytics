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

/**
 * Merge whatever's stored in `template_definitions.schema[format]` with
 * a fresh starter so every required CanvasTemplateSchema field has a
 * value. Stored fields win over starter defaults; missing fields fall
 * through cleanly to the starter.
 *
 * Forces structural fields (format, width, height, schemaVersion) to
 * known-good values because those are tied to the format choice and
 * shouldn't be overridable by stored data — keeps the editor mount
 * predictable even if a legacy seed has e.g. width: 0.
 *
 * Why "normalize" not "validate-and-reject": the editor is the user's
 * primary tool; if the stored schema is partially broken we'd rather
 * present a working canvas (with sensible defaults) than crash. The
 * author's next save overwrites the row with a clean schema.
 */
function normalizeOrBuildStarter(
  template: TemplateDefinition,
  format: PostFormat,
): CanvasTemplateSchema {
  const starter = buildStarterSchema(template, format);
  const stored = template.schema[format];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return starter;
  }
  const s = stored as Record<string, unknown>;
  const dims = FORMAT_DIMS[format];
  return {
    ...starter,
    // Stored fields override starter defaults for the soft fields.
    ...(typeof s.id === "string" && s.id.length > 0 ? { id: s.id } : {}),
    ...(typeof s.name === "string" && s.name.length > 0 ? { name: s.name } : {}),
    ...(typeof s.description === "string" ? { description: s.description } : {}),
    ...(typeof s.backgroundColor === "string"
      ? { backgroundColor: s.backgroundColor }
      : {}),
    ...(typeof s.backgroundImage === "string" || s.backgroundImage === null
      ? { backgroundImage: s.backgroundImage as string | null | undefined }
      : {}),
    ...(typeof s.updatedAt === "string" ? { updatedAt: s.updatedAt } : {}),
    // Layers must always be an array — coerce defensively.
    layers: Array.isArray(s.layers)
      ? (s.layers as CanvasTemplateSchema["layers"])
      : [],
    // Hard-force structural fields tied to the format choice. These can't
    // be overridden by stored data because they'd violate canvas-editor
    // invariants (width matching PLATFORM_DIMENSIONS, schemaVersion=1).
    format,
    width: dims.width,
    height: dims.height,
    schemaVersion: 1,
    // category + variant: use stored if they look like valid enum members,
    // otherwise fall back to starter defaults. The canvas editor validates
    // these internally, so a clearly-bad value would crash anyway.
    category:
      typeof s.category === "string"
        ? (s.category as CanvasTemplateSchema["category"])
        : starter.category,
    variant:
      typeof s.variant === "string"
        ? (s.variant as CanvasTemplateSchema["variant"])
        : starter.variant,
  };
}
