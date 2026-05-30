/**
 * Template Builder — public registry surface.
 *
 * This file is the ONLY module that downstream consumers (Post Builder
 * picker, multi-OH wizard, future surfaces) should import from. Everything
 * else inside `lib/template-builder/` is implementation detail.
 *
 * Phase 1 functions:
 *   • listTemplatesForPostType — picker query: published templates tagged
 *     for the given post type that support the user's selected format.
 *   • getTemplateById — fetch the full TemplateDefinition (schema + meta).
 *   • templateMetaFromDefinition — convert a full row to the slim Meta
 *     shape the picker UI consumes.
 *
 * See `docs/adr/0001-template-builder.md` for the full design.
 */

import "server-only";
import type { PostType, PostFormat } from "@/lib/post-builder/types";
import {
  type TemplateDefinition,
  type TemplateMeta,
  listSupportedFormats,
  templateSupportsFormat,
} from "./schema";
import * as storage from "./storage";

/**
 * Picker query: every PUBLISHED template that
 *   (a) is tagged for the given post_type, AND
 *   (b) defines a schema for the given format.
 *
 * Returns the slim TemplateMeta shape — full schema bodies aren't sent
 * to the picker because they can be large. Picker calls getTemplateById
 * when the user actually selects one and we need to render.
 *
 * The picker UI should still call listVariantsForPostType (legacy) and
 * merge the two lists during the coexistence period (Phase 1-3).
 */
export async function listTemplatesForPostType(
  post_type: PostType,
  format: PostFormat,
): Promise<TemplateMeta[]> {
  const rows = await storage.listPublishedTemplatesForPostType(post_type);
  return rows
    .filter((row) => templateSupportsFormat(row.schema, format))
    // 2026-05-30 library-first consolidation — surface EVERY approved
    // (published) template for the slot in the single picker, regardless of
    // author (studio or builder). Larissa picks from approved designs only;
    // the picker is the start of post creation. Default first so it reads as
    // the pre-selected choice, then display_order, then name.
    .map(templateMetaFromDefinition)
    .sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      if (a.display_order !== b.display_order)
        return a.display_order - b.display_order;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Picker lane for Studio-saved templates (source='studio'). Returns full
 * TemplateDefinition rows so the Post Builder can map them into the
 * "custom template" card shape it already renders.
 */
export async function listStudioTemplatesForSlot(
  post_type: PostType,
  format: PostFormat,
): Promise<TemplateDefinition[]> {
  return storage.listStudioTemplatesForSlot(post_type, format);
}

/**
 * Persist a Studio "Save as Template" into the unified table. Thin
 * passthrough so server actions import only from the registry.
 */
export async function saveStudioTemplate(
  input: storage.StudioTemplateSaveInput,
  actor_id: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return storage.saveStudioTemplate(input, actor_id);
}

/**
 * Admin list view query. Returns EVERY template regardless of state.
 * Use this from /admin/templates/page.tsx.
 *
 * Phase 2H/2I — also fetches unified usage counts in parallel and stamps
 * each meta's `use_count`. The count covers BOTH the direct
 * `generated_posts.template_id = <uuid>` path (regular Post Builder)
 * AND the Multi-OH per-slide path (`slide_metadata[].db_template_id`).
 * Deduped by post id so a multi-slide carousel using the same template
 * counts as one use, not nine.
 */
export async function listAllTemplates(): Promise<TemplateMeta[]> {
  const [rows, useCounts] = await Promise.all([
    storage.listAllTemplates(),
    storage.getTemplateUseCounts(),
  ]);
  return rows.map((row) => ({
    ...templateMetaFromDefinition(row),
    use_count: useCounts[row.id] ?? 0,
  }));
}

/**
 * Fetch the full definition (schema included) for a single template.
 * Returns null when missing — callers decide whether to error or fall
 * through to the legacy primitive registry.
 */
export async function getTemplateById(
  id: string,
): Promise<TemplateDefinition | null> {
  return storage.getTemplateById(id);
}

/**
 * Convert a full TemplateDefinition into the slim TemplateMeta the picker
 * UI uses. Centralized here so picker + admin list view + future surfaces
 * all see the same field set.
 */
export function templateMetaFromDefinition(
  def: TemplateDefinition,
): TemplateMeta {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    post_types: def.post_types,
    supported_formats: listSupportedFormats(def.schema),
    display_order: def.display_order,
    publish_state: def.publish_state,
    updated_at: def.updated_at,
    preview_image_url: def.preview_image_url,
    is_default: def.is_default,
    source: def.source,
  };
}
