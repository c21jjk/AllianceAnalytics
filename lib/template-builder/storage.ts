/**
 * Template Builder — storage layer.
 *
 * Thin wrapper over the `template_definitions` Supabase table. All writes
 * go through here so the rest of the module never touches the raw client.
 * Reads are intentionally permissive (returns rows in any publish_state)
 * — the picker/registry layer applies the published-only filter.
 *
 * Uses the admin (service-role) client so server actions don't have to
 * juggle RLS. RLS is still enforced for any direct API access from the
 * client (the policy in the migration restricts writes to admin role).
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  TemplateDefinition,
  TemplateInsert,
  TemplateUpdate,
  TemplatePublishState,
} from "./schema";
import type { PostType } from "@/lib/post-builder/types";

/**
 * Internal — row shape returned by Supabase before we narrow it into a
 * TemplateDefinition. Mirrors the table 1:1 with permissive `unknown`
 * for the JSON column.
 */
interface DbTemplateRow {
  id: string;
  name: string;
  description: string | null;
  post_types: string[];
  schema: unknown;
  display_order: number;
  publish_state: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

const SELECT_COLUMNS =
  "id, name, description, post_types, schema, display_order, publish_state, created_at, updated_at, created_by, updated_by";

/**
 * Narrow a raw DB row into our typed shape. Defensive — bad data shouldn't
 * crash the caller; the row is returned with safe defaults.
 */
function toDefinition(row: DbTemplateRow): TemplateDefinition {
  // why: cast post_types to PostType[] without runtime validation. The DB
  // doesn't constrain the array entries to the PostType union (the union
  // is a TS concept), so an admin who writes a bad entry would leak here.
  // For Phase 1 we trust the admin UI to send valid entries.
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    post_types: row.post_types as PostType[],
    schema:
      row.schema && typeof row.schema === "object" && !Array.isArray(row.schema)
        ? (row.schema as TemplateDefinition["schema"])
        : {},
    display_order: row.display_order,
    publish_state: normalizePublishState(row.publish_state),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    updated_by: row.updated_by,
  };
}

function normalizePublishState(raw: string): TemplatePublishState {
  if (raw === "published" || raw === "draft" || raw === "archived") return raw;
  // Any unknown value defaults to draft so a bad row never accidentally
  // surfaces in a user-facing picker.
  return "draft";
}

/**
 * List every template, ordered for the admin list view.
 *
 * Returns rows in `display_order` ascending; admins see drafts + archives
 * mixed in with published. Use `listTemplatesForPostType` for the picker
 * surface (which filters to published).
 */
export async function listAllTemplates(): Promise<TemplateDefinition[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("template_definitions")
    .select(SELECT_COLUMNS)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.error("[template-builder/storage] listAllTemplates:", error);
    return [];
  }
  return (data ?? []).map((r) => toDefinition(r as DbTemplateRow));
}

/**
 * Picker query — fetch every PUBLISHED template tagged for the given
 * post_type, in display order. Used by the Post Builder picker and the
 * multi-OH wizard variant card list.
 */
export async function listPublishedTemplatesForPostType(
  postType: PostType,
): Promise<TemplateDefinition[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("template_definitions")
    .select(SELECT_COLUMNS)
    .contains("post_types", [postType])
    .eq("publish_state", "published")
    .order("display_order", { ascending: true });
  if (error) {
    console.error(
      `[template-builder/storage] listPublishedTemplatesForPostType(${postType}):`,
      error,
    );
    return [];
  }
  return (data ?? []).map((r) => toDefinition(r as DbTemplateRow));
}

/**
 * Fetch a single template by id. Returns null when missing — callers
 * decide whether to treat that as an error or fall through to a legacy
 * primitive.
 */
export async function getTemplateById(
  id: string,
): Promise<TemplateDefinition | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("template_definitions")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(
      `[template-builder/storage] getTemplateById(${id}):`,
      error,
    );
    return null;
  }
  return data ? toDefinition(data as DbTemplateRow) : null;
}

/**
 * Insert a new template row. created_by + updated_by are stamped from
 * the caller-supplied actor id. Defaults:
 *   • publish_state = 'draft' (authors don't accidentally publish)
 *   • schema = {} (empty schema family until they design something)
 *   • display_order = 0 (admin UI can drag-to-reorder afterward)
 */
export async function createTemplate(
  payload: TemplateInsert,
  actor_id: string,
): Promise<TemplateDefinition | null> {
  const supabase = createAdminClient();
  // why: the Supabase generated types narrow the schema column to `Json`
  // (their union of primitive + object). Our TemplateSchemaFamily IS a
  // JSON-compatible shape but TS can't structurally prove it against the
  // generic `Json` type. Cast at the boundary; the storage layer is the
  // single place this lives so the cast is contained.
  const insertRow = {
    name: payload.name,
    description: payload.description ?? null,
    post_types: payload.post_types,
    schema: (payload.schema ?? {}) as unknown as Record<string, unknown>,
    display_order: payload.display_order ?? 0,
    publish_state: payload.publish_state ?? "draft",
    created_by: actor_id,
    updated_by: actor_id,
  };
  const { data, error } = await supabase
    .from("template_definitions")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(insertRow as any)
    .select(SELECT_COLUMNS)
    .single();
  if (error) {
    console.error("[template-builder/storage] createTemplate:", error);
    return null;
  }
  return toDefinition(data as DbTemplateRow);
}

/**
 * Patch fields on an existing template. updated_by stamped from actor.
 * Pass undefined for fields you don't want to change.
 */
export async function updateTemplate(
  id: string,
  patch: TemplateUpdate,
  actor_id: string,
): Promise<TemplateDefinition | null> {
  const supabase = createAdminClient();
  const update: Record<string, unknown> = { updated_by: actor_id };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.post_types !== undefined) update.post_types = patch.post_types;
  if (patch.schema !== undefined) update.schema = patch.schema;
  if (patch.display_order !== undefined) update.display_order = patch.display_order;
  if (patch.publish_state !== undefined) update.publish_state = patch.publish_state;

  const { data, error } = await supabase
    .from("template_definitions")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(update as any)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) {
    console.error(`[template-builder/storage] updateTemplate(${id}):`, error);
    return null;
  }
  return toDefinition(data as DbTemplateRow);
}

/**
 * Clone an existing template. The new row is created as a DRAFT with
 * "(Copy)" suffixed on the name so it doesn't collide with the original
 * in admin lists. Schema, post_types, description, and display_order are
 * copied verbatim; publish_state resets to draft.
 *
 * Useful when an author wants to create a variant of an existing design
 * without overwriting the original (per ADR Decision 8 — versioning).
 */
export async function cloneTemplate(
  sourceId: string,
  actor_id: string,
): Promise<TemplateDefinition | null> {
  const source = await getTemplateById(sourceId);
  if (!source) return null;
  return createTemplate(
    {
      name: `${source.name} (Copy)`,
      description: source.description,
      post_types: source.post_types,
      schema: source.schema,
      display_order: source.display_order,
      publish_state: "draft",
    },
    actor_id,
  );
}

/**
 * Phase 2H/2I (2026-05-22) — unified usage counts.
 *
 * Returns a map of `template_id → COUNT(distinct generated_posts.id)` for
 * every template_id that has at least one referencing post. A given post
 * counts ONCE per template even if it references the template across
 * multiple slides — the metric is "how many posts use this template,"
 * not "how many slide-references exist."
 *
 * Two sources are summed:
 *   1. Direct picks — `generated_posts.template_id = <uuid>`. This is the
 *      regular Post Builder flow when an admin template is selected.
 *   2. Multi-OH per-slide — every entry in
 *      `generated_posts.slide_metadata[]` whose `db_template_id` matches.
 *      A 9-slide carousel all using the same DB template counts as ONE
 *      use of that template (deduped by post id).
 *
 * Implementation: parallel fetches into JS for both surfaces, group +
 * dedupe by post id, then aggregate counts. Both queries select only the
 * columns we need so the payload stays compact. The post-id dedupe
 * happens in a `Set<post_id>` per template — that's the bookkeeping
 * required to give the metric a stable meaning across surfaces.
 */
export async function getTemplateUseCounts(): Promise<Record<string, number>> {
  const supabase = createAdminClient();
  const [directRes, multiRes] = await Promise.all([
    supabase
      .from("generated_posts")
      .select("id, template_id")
      .not("template_id", "is", null),
    supabase
      .from("generated_posts")
      .select("id, slide_metadata")
      .not("slide_metadata", "is", null),
  ]);

  if (directRes.error) {
    console.error(
      "[template-builder/storage] getTemplateUseCounts direct:",
      directRes.error,
    );
  }
  if (multiRes.error) {
    console.error(
      "[template-builder/storage] getTemplateUseCounts multi-oh:",
      multiRes.error,
    );
  }

  // template_id → Set<post_id>. The set guarantees a post is only counted
  // once per template even when both surfaces (direct + slide) reference
  // the same template from the same post.
  const usage = new Map<string, Set<string>>();

  const bump = (templateId: string, postId: string): void => {
    if (!templateId || !postId) return;
    let set = usage.get(templateId);
    if (!set) {
      set = new Set();
      usage.set(templateId, set);
    }
    set.add(postId);
  };

  for (const row of directRes.data ?? []) {
    const id = row.template_id;
    const postId = row.id;
    if (typeof id !== "string" || typeof postId !== "string") continue;
    bump(id, postId);
  }

  // Multi-OH path: slide_metadata is a JSONB array. Each entry can carry
  // `db_template_id` (set by Phase 2E's wizard pick). We tolerate every
  // misshape — null entries, malformed objects, missing field — by
  // skipping silently. The data layer is defensive against any historical
  // row written before the field existed or by a buggy producer.
  for (const row of multiRes.data ?? []) {
    const postId = row.id;
    if (typeof postId !== "string") continue;
    const meta = row.slide_metadata;
    if (!Array.isArray(meta)) continue;
    for (const entry of meta) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const tid = e.db_template_id;
      if (typeof tid === "string" && tid.length > 0) {
        bump(tid, postId);
      }
    }
  }

  const counts: Record<string, number> = {};
  for (const [tid, ids] of usage) {
    counts[tid] = ids.size;
  }
  return counts;
}

/**
 * Hard delete. Use sparingly — archiving (publish_state='archived') is
 * almost always the right choice because it preserves historical posts'
 * lineage. Deletion is here for cleaning up drafts that were created in
 * error.
 */
export async function deleteTemplate(id: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("template_definitions")
    .delete()
    .eq("id", id);
  if (error) {
    console.error(`[template-builder/storage] deleteTemplate(${id}):`, error);
    return false;
  }
  return true;
}
