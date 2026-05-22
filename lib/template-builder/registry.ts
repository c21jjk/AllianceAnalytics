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
    .map(templateMetaFromDefinition);
}

/**
 * Admin list view query. Returns EVERY template regardless of state.
 * Use this from /admin/templates/page.tsx.
 */
export async function listAllTemplates(): Promise<TemplateMeta[]> {
  const rows = await storage.listAllTemplates();
  return rows.map(templateMetaFromDefinition);
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
  };
}
