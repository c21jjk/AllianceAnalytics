/**
 * Defensive schema normalization for admin-authored DB templates.
 *
 * Background: `template_definitions.schema[format]` holds a JSONB blob
 * meant to be a `CanvasTemplateSchema`, but it CAN come from:
 *
 *   1. A freshly-saved admin row (complete, well-formed)
 *   2. A SQL seed / migration / hand-edited row (may be missing required
 *      fields like id, name, category, variant, schemaVersion)
 *   3. A legacy row written before a schema version bump
 *
 * The Fabric canvas editor refuses to mount any of those if a required
 * field is missing. To keep the editor reliable, we MERGE whatever's
 * stored with a fresh starter so every required field has a sane value.
 * Stored fields win over starter defaults for soft fields (name,
 * description, backgroundColor, layers). Structural fields tied to the
 * format choice (width, height, format, schemaVersion) are FORCED to
 * known-good values — the wrong width here causes the editor's invariant
 * check to fail at mount.
 *
 * Phase 2G (2026-05-22): extracted from
 * `app/(app)/admin/templates/[id]/edit/TemplateCanvasEditor.tsx` so the
 * Post Builder's Studio edit-slide path can apply the same normalization
 * when re-opening a DB-template-rendered carousel slide. Single source of
 * truth — both consumers (admin editor + Studio) call the same helper.
 *
 * Why this module is intentionally NOT "server-only": it's pure logic
 * (no DB / fetch / fs), used inside React client components on both the
 * admin and Studio surfaces.
 */

import type { CanvasTemplateSchema } from "./types";
import type {
  PostFormat,
  PostType,
  PostVariant,
} from "@/lib/post-builder/types";
import type { TemplateDefinition } from "@/lib/template-builder";

/** Per-format canonical dimensions — matches the renderer's expectations.
 *  Updated when PostFormat gains a new entry; kept here so the editor and
 *  the Studio edit-slide path share one source of truth. */
export const FORMAT_DIMS: Record<
  PostFormat,
  { width: number; height: number }
> = {
  square_1x1: { width: 1080, height: 1080 },
  story_9x16: { width: 1080, height: 1920 },
};

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
export function buildStarterSchema(
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
    category: "just_listed" satisfies PostType,
    // why: 'v8' Standard is the canvas-editor's most layout-agnostic
    // variant. Used as a placeholder so the type-check passes; the
    // Post Builder picker (Phase 2C) routes DB templates by template
    // id, not variant.
    variant: "v8" satisfies PostVariant,
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
export function normalizeOrBuildStarter(
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
    // why (2026-05-31): NAME is intentionally NOT overridable by the stored
    // inner schema. The canonical name is the Template Builder record name
    // (`template_definitions.name`, already baked into the starter via
    // buildStarterSchema). The inner schema.name was a separate copy that
    // drifted — a row renamed to "Just Listed - Template 1" still carried an
    // inner name of "Bold", so the Studio canvas header showed the stale name
    // while the library/picker/save-dialog showed the real one. Always use the
    // record name; the next save re-stamps the inner schema name to match.
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
