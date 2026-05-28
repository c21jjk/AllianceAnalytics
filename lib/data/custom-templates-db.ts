/**
 * custom-templates-db — server-side reads for user-authored canvas templates.
 * ---------------------------------------------------------------------------
 *
 * Why this file exists
 *   `findCanvasTemplate(category, variant, format)` in
 *   `lib/post-builder/canvas-editor/templates/index.ts` is a SYNCHRONOUS,
 *   in-memory lookup over the factory `CANVAS_TEMPLATES` array. The vast
 *   majority of call sites (the editor's mount path, the parent post-builder
 *   client, the Reel studio) are synchronous and need to stay that way to
 *   keep render flows fast and React-friendly.
 *
 *   Server-side render routes, however, MUST consult the
 *   `custom_templates` table first: when Larissa saves a tuned Open House
 *   layout and marks it as default, every subsequent OH render should pick
 *   up HER layout, not the factory placeholder. This helper performs that
 *   async DB-read at the route boundary and falls back to the synchronous
 *   factory lookup when no default custom template exists for the tuple.
 *
 *   Keeping the async path OUT of `findCanvasTemplate` is intentional:
 *     • Async ripple would force callers across the codebase to await — the
 *       editor's mount path, useMemo selectors in PostBuilderClient, the
 *       Reel template manifest, etc.
 *     • Server contexts (render routes, the multi-OH generate route) are
 *       the only ones that can/should hit the DB. Client contexts can't
 *       reach `createAdminClient()` at all.
 *
 * Integration pattern
 *   ```ts
 *   const schema =
 *     (await fetchDefaultCustomTemplate("open_house", input.format, "v1")) ??
 *     findCanvasTemplate("open_house", "v1", input.format);
 *   ```
 *   The custom-template wins when present; the factory placeholder is the
 *   ultimate fallback.
 *
 * Back-compat
 *   Rows saved before 2026-05-28 have `fabric_json` populated but
 *   `schema_json = null`. This helper IGNORES those rows — they can't be
 *   re-hydrated with fresh listing data (the saved Fabric snapshot bakes
 *   in the original photos + text). The factory placeholder runs instead,
 *   which is the SAME behavior those rows had pre-2026-05-28 (no lookup
 *   existed at all). When Larissa re-saves a custom template under the
 *   new flow, the row's `schema_json` is populated and the lookup picks
 *   it up automatically.
 */

import "server-only";

import type {
  CanvasTemplateSchema,
  PostFormat,
  PostType,
  PostVariant,
} from "@/lib/post-builder/canvas-editor/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Look up the user-authored DEFAULT custom template for a given
 * (post_type, format, based_on_variant) tuple.
 *
 * Returns null when no default exists OR the row has no `schema_json`
 * populated (pre-2026-05-28 fabric_json-only rows are ignored — see the
 * file-level docblock for why).
 *
 * Defensive shape check: the returned schema must have an `id`, a
 * `layers` array, and numeric `width`/`height`. Malformed rows are
 * treated as misses so the caller falls through to the factory template
 * rather than crashing downstream.
 */
export async function fetchDefaultCustomTemplate(
  postType: PostType,
  format: PostFormat,
  variant: PostVariant,
): Promise<CanvasTemplateSchema | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("custom_templates")
    .select("schema_json")
    .eq("post_type", postType)
    .eq("format", format)
    .eq("based_on_variant", variant)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();

  if (error) {
    // why: a transient DB error shouldn't break rendering. Log and let
    // the caller fall through to the factory schema. This matches the
    // memory rule about avoiding hidden state — we surface the failure
    // in logs rather than silently swapping to a different design.
    console.warn(
      "[custom-templates-db] fetchDefaultCustomTemplate query failed",
      {
        postType,
        format,
        variant,
        error: error.message,
      },
    );
    return null;
  }

  if (!data || !data.schema_json) {
    return null;
  }

  const schema = data.schema_json as unknown;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }
  const s = schema as Record<string, unknown>;
  if (
    typeof s.id !== "string" ||
    typeof s.width !== "number" ||
    typeof s.height !== "number" ||
    !Array.isArray(s.layers)
  ) {
    console.warn(
      "[custom-templates-db] default custom template has malformed schema_json; falling back to factory",
      { postType, format, variant },
    );
    return null;
  }

  return schema as CanvasTemplateSchema;
}
