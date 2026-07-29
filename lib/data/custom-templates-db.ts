/**
 * custom-templates-db — server-side resolution of the LIBRARY template for a
 * status, with a hidden current-code factory fallback.
 * ---------------------------------------------------------------------------
 *
 * Why this file exists
 *   `findCanvasTemplate(category, variant, format)` in
 *   `lib/post-builder/canvas-editor/templates/index.ts` is a SYNCHRONOUS,
 *   in-memory lookup over the factory `CANVAS_TEMPLATES` array. It's kept as
 *   a FROZEN hidden fallback only (never surfaced in the picker), so client
 *   call sites that need a synchronous schema can stay synchronous.
 *
 *   Server-side render routes resolve the LIBRARY template first (the
 *   `template_definitions` source of truth) via `resolveTemplateForStatus`,
 *   falling back to the synchronous factory lookup only when no approved
 *   library template defines the format. Keeping the async DB read OUT of
 *   `findCanvasTemplate` avoids rippling `await` through client call sites
 *   (editor mount, PostBuilderClient selectors, Reel manifest) that can't
 *   reach `createAdminClient()` anyway.
 *
 * Integration pattern (server routes only)
 *   ```ts
 *   const schema =
 *     (await resolveTemplateForStatus("open_house", input.format)) ??
 *     findCanvasTemplate("open_house", "v1", input.format);
 *   ```
 *   The approved library template wins when present; the hidden factory
 *   schema is the ultimate fallback.
 */

import "server-only";

import type {
  CanvasTemplateSchema,
  PostFormat,
  PostType,
} from "@/lib/post-builder/canvas-editor/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Extract + validate the per-format CanvasTemplateSchema out of a
 * `template_definitions.schema` family JSON. Returns null when the family
 * doesn't define the format or the stored schema is malformed (the caller
 * then falls through to the next candidate / the factory). The shape check
 * mirrors the factory invariants: id (string), width/height (number),
 * layers (array).
 */
function extractFormatSchema(
  family: unknown,
  format: PostFormat,
): CanvasTemplateSchema | null {
  if (!family || typeof family !== "object" || Array.isArray(family)) {
    return null;
  }
  const entry = (family as Record<string, unknown>)[format];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const s = entry as Record<string, unknown>;
  if (
    typeof s.id !== "string" ||
    typeof s.width !== "number" ||
    typeof s.height !== "number" ||
    !Array.isArray(s.layers)
  ) {
    return null;
  }
  return entry as CanvasTemplateSchema;
}

/**
 * 2026-07-29: Resolved library template WITH row provenance. `schema` is
 * the per-format CanvasTemplateSchema; `template_row_id` is the
 * `template_definitions.id` (v4 UUID) the schema came from. Callers that
 * persist a template_id (render route -> generated_posts) must use the row
 * UUID, NOT schema.id; the inner schema's id can be a stale copy of a
 * different template (the 7/28 open_house mislabel came from exactly that).
 */
export interface ResolvedLibraryTemplate {
  schema: CanvasTemplateSchema;
  template_row_id: string;
}

/**
 * Resolve the LIBRARY template for a (post_type, format) slot, returning
 * both the schema and the library row's UUID.
 *
 * Library-first consolidation (2026-05-30): every status-driven render
 * resolves its design from `template_definitions` — the single source of
 * truth — before falling back to the in-code factory schema.
 *
 * Resolution order among PUBLISHED rows tagged for the post type
 * (source-agnostic: studio- and builder-authored both count as "approved"):
 *   1. the row flagged `is_default`
 *   2. then lowest `display_order`
 *   3. then most recently created
 * The first candidate that actually DEFINES the requested format wins (a
 * default that only defines square won't block a portrait render — we keep
 * scanning for a published row that defines portrait).
 *
 * Returns null when no published library template defines the format; the
 * caller falls through to `findCanvasTemplate` (the current-code factory),
 * which is NEVER surfaced in the user picker. The factory is a hidden
 * generation fallback only, so statuses without an approved design still
 * render rather than 404.
 */
export async function resolveTemplateRowForStatus(
  postType: PostType,
  format: PostFormat,
): Promise<ResolvedLibraryTemplate | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("template_definitions")
    .select("id, schema, is_default, display_order, created_at")
    .contains("post_types", [postType])
    .eq("publish_state", "published")
    .order("is_default", { ascending: false })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    // why: a transient DB error shouldn't break rendering. Log and let the
    // caller fall through to the factory schema rather than silently
    // swapping to a different design.
    console.warn("[custom-templates-db] resolveTemplateForStatus query failed", {
      postType,
      format,
      error: error.message,
    });
    return null;
  }

  for (const row of data ?? []) {
    const schema = extractFormatSchema(
      (row as { schema?: unknown }).schema,
      format,
    );
    const rowId = (row as { id?: unknown }).id;
    if (schema && typeof rowId === "string") {
      return { schema, template_row_id: rowId };
    }
  }
  return null;
}

/**
 * Schema-only convenience wrapper: the original public shape, kept so the
 * other render surfaces (multi-OH, rerender-carousel, design-and-render,
 * auto-reel) don't need signature churn. New callers that persist a
 * template_id should prefer `resolveTemplateRowForStatus` (2026-07-29).
 */
export async function resolveTemplateForStatus(
  postType: PostType,
  format: PostFormat,
): Promise<CanvasTemplateSchema | null> {
  const resolved = await resolveTemplateRowForStatus(postType, format);
  return resolved?.schema ?? null;
}
