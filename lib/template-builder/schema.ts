/**
 * Template Builder — type definitions.
 *
 * Mirrors the `template_definitions` table in Supabase. The format-keyed
 * `schema` field on a TemplateDefinition is a JSON document that wraps the
 * existing canvas-editor CanvasTemplateSchema once per format (Portrait,
 * Story). A template can define one or both formats; the picker filters
 * templates by which formats they support. Square 1:1 was retired
 * 2026-05-22.
 *
 * See `docs/adr/0001-template-builder.md` for the full design.
 */

import "server-only";
import type { PostType, PostFormat } from "@/lib/post-builder/types";

/**
 * Lifecycle of a template. Mirrors the DB check constraint.
 *
 *   draft     — mid-design; never appears in the picker
 *   published — live; appears in the picker
 *   archived  — no longer offered for NEW posts; existing posts that used
 *               this template keep their already-rendered output frozen
 */
export type TemplatePublishState = "draft" | "published" | "archived";

/**
 * Opaque value type for a template's per-format schema. The current
 * implementation reuses `CanvasTemplateSchema` from
 * `lib/post-builder/canvas-editor/types.ts`, but the template-builder
 * module deliberately keeps this as `unknown` at the module boundary so
 * the canvas-editor's internal schema can evolve without breaking this
 * module's public contract.
 *
 * Consumers that need to actually READ a schema (the renderer) cast it
 * to `CanvasTemplateSchema` at the point of use.
 */
export type FormatSchema = unknown;

/**
 * A template's schemas, keyed by format. Both keys are optional — a
 * template might launch with only Portrait, only Story, or both. Picker
 * filters templates by which formats they actually define.
 */
export interface TemplateSchemaFamily {
  portrait_4x5?: FormatSchema | null;
  story_9x16?: FormatSchema | null;
}

/**
 * The full row shape as stored in `template_definitions`.
 */
export interface TemplateDefinition {
  id: string;
  name: string;
  description: string | null;
  post_types: PostType[];
  schema: TemplateSchemaFamily;
  display_order: number;
  publish_state: TemplatePublishState;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

/**
 * Slim metadata shape used by the picker and admin list view. Excludes
 * the full schema (which can be large) — callers that need to render
 * fetch the full TemplateDefinition by ID.
 */
export interface TemplateMeta {
  id: string;
  name: string;
  description: string | null;
  post_types: PostType[];
  /** Which formats this template defines a schema for. */
  supported_formats: PostFormat[];
  display_order: number;
  publish_state: TemplatePublishState;
  updated_at: string;
  /**
   * Phase 2H/2I (2026-05-22) — adoption metric. Distinct
   * `generated_posts` rows that reference this template, across BOTH
   * surfaces:
   *   • Direct picks — `generated_posts.template_id = <uuid>`
   *   • Multi-OH per-slide — `slide_metadata[].db_template_id = <uuid>`
   * Deduped by post id, so a 9-slide carousel using one DB template
   * counts as one use (not nine). Templates only used by legacy
   * primitives (variant strings, not UUIDs) show 0 — their counts would
   * be meaningless since the template_id pattern is deterministic.
   *
   * Populated only by list/picker queries — getTemplateById doesn't fill
   * this field (its callers don't need it).
   */
  use_count?: number;
}

/**
 * Insert / Update shapes — fields the admin UI sends to storage. id +
 * timestamps + authorship are populated server-side.
 */
export interface TemplateInsert {
  name: string;
  description?: string | null;
  post_types: PostType[];
  schema?: TemplateSchemaFamily;
  display_order?: number;
  publish_state?: TemplatePublishState;
}

export interface TemplateUpdate {
  name?: string;
  description?: string | null;
  post_types?: PostType[];
  schema?: TemplateSchemaFamily;
  display_order?: number;
  publish_state?: TemplatePublishState;
}

/**
 * Helper — returns true if a template has a non-null schema for the
 * requested format. Centralized here so picker + renderer + admin agree
 * on what "supports this format" means.
 */
export function templateSupportsFormat(
  schema: TemplateSchemaFamily,
  format: PostFormat,
): boolean {
  const entry = schema[format];
  return entry !== null && entry !== undefined;
}

/**
 * Helper — list every format a template defines a schema for, in
 * canonical picker order (portrait, story).
 */
export function listSupportedFormats(
  schema: TemplateSchemaFamily,
): PostFormat[] {
  const out: PostFormat[] = [];
  if (templateSupportsFormat(schema, "portrait_4x5")) out.push("portrait_4x5");
  if (templateSupportsFormat(schema, "story_9x16")) out.push("story_9x16");
  return out;
}
