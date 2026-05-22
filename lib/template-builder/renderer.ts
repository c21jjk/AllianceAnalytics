/**
 * Template Builder — render pipeline.
 *
 * Phase 1: STUB. The DB schema + storage layer + admin shell + picker
 * integration are all in place, but the actual render-a-DB-template
 * pipeline lands in Phase 2 (alongside the WYSIWYG editor). Until then,
 * any DB-defined template selected in the picker raises a "not yet
 * renderable" error at generate time.
 *
 * The legacy hand-coded primitives in lib/post-builder/templates/
 * primitives/ continue to render through their existing pipeline; this
 * stub only affects templates created via the admin builder.
 *
 * Phase 2 wiring (when this is implemented):
 *   1. Fetch the TemplateDefinition by id.
 *   2. Pick the schema entry for the requested PostFormat.
 *   3. Resolve placeholders against the listing + binding context.
 *   4. Hand off to the canvas-editor's Fabric.js renderer at
 *      lib/post-builder/canvas-editor/renderer.ts (existing).
 *   5. Capture as PNG, upload to Supabase Storage, return image_url +
 *      image_path the same shape lib/post-builder/render.ts uses.
 */

import "server-only";
import type { PostFormat, PostBuilderListing } from "@/lib/post-builder/types";
import type { BindingContext } from "./bindings";

export interface RenderResult {
  ok: true;
  image_url: string;
  image_path: string;
  width: number;
  height: number;
  rendered_at: string;
}

export interface RenderError {
  ok: false;
  error: string;
}

export type RenderOutcome = RenderResult | RenderError;

export interface RenderInput {
  template_id: string;
  listing: PostBuilderListing;
  format: PostFormat;
  context?: BindingContext;
}

/**
 * Phase 1 stub. Phase 2 wires this up to the canvas-editor renderer.
 * Returning an error here means the admin built a template but the
 * generate path can't materialize it yet — keeps the failure mode loud
 * instead of silently using fallback data.
 */
export async function renderDbTemplate(
  _input: RenderInput,
): Promise<RenderOutcome> {
  return {
    ok: false,
    error:
      "DB-defined template rendering is not yet implemented (Phase 1 stub). " +
      "The visual editor + renderer ship in Phase 2.",
  };
}
