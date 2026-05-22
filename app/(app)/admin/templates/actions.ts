"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import type { PostType, PostFormat } from "@/lib/post-builder/types";
import type {
  TemplatePublishState,
  TemplateSchemaFamily,
} from "@/lib/template-builder";
import * as storage from "@/lib/template-builder/storage";

/**
 * Admin server actions for the Template Builder.
 *
 * Every action requires admin role (enforced by requireAdmin). Storage
 * writes go through `lib/template-builder/storage.ts` so the module's
 * contract stays clean — this file is just the auth + revalidation glue.
 *
 * See docs/adr/0001-template-builder.md.
 */

/** Result envelope for server actions that the form clients consume. */
export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Newly-created or affected template id, when relevant. */
  id?: string;
}

const VALID_POST_TYPES = new Set<PostType>([
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
]);

const VALID_PUBLISH_STATES = new Set<TemplatePublishState>([
  "draft",
  "published",
  "archived",
]);

function sanitizePostTypes(raw: unknown): PostType[] {
  if (!Array.isArray(raw)) return [];
  const out: PostType[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    if (VALID_POST_TYPES.has(value as PostType)) {
      out.push(value as PostType);
    }
  }
  return out;
}

/**
 * Create a new template as a draft.
 *
 * On success, redirects to /admin/templates/[id] so the author lands on
 * the metadata-edit view (and eventually the visual editor in Phase 2B).
 * On failure, returns the error envelope — the form client surfaces it
 * inline without navigation.
 *
 * Why redirect vs. return id+navigate-client-side: the redirect keeps
 * the post-create state on the server and avoids a flash of the new
 * page's empty state before the row hydrates.
 */
export async function createTemplateAction(
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const post_types = sanitizePostTypes(formData.getAll("post_types"));

  if (name.length === 0) {
    return { ok: false, error: "Name is required." };
  }
  if (post_types.length === 0) {
    return {
      ok: false,
      error:
        "Pick at least one post type — that's the picker(s) this template will appear in.",
    };
  }

  const created = await storage.createTemplate(
    {
      name,
      description: description.length > 0 ? description : null,
      post_types,
      // Empty schema family — author fills it in via the visual editor (Phase 2B).
      schema: {},
      publish_state: "draft",
    },
    profile.id,
  );
  if (!created) {
    return { ok: false, error: "Failed to create template." };
  }

  revalidatePath("/admin/templates");
  redirect(`/admin/templates/${created.id}`);
}

/**
 * Patch template metadata (name, description, post_types).
 *
 * Schema editing happens through a separate action (Phase 2B) so that the
 * lightweight metadata form can save without sending the full canvas
 * schema payload. Publish state has its own action too — see
 * setTemplateStateAction.
 */
export async function updateTemplateMetadataAction(
  templateId: string,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const post_types = sanitizePostTypes(formData.getAll("post_types"));

  if (name.length === 0) {
    return { ok: false, error: "Name can't be empty." };
  }
  if (post_types.length === 0) {
    return {
      ok: false,
      error: "Pick at least one post type.",
    };
  }

  const updated = await storage.updateTemplate(
    templateId,
    {
      name,
      description: description.length > 0 ? description : null,
      post_types,
    },
    profile.id,
  );
  if (!updated) {
    return { ok: false, error: "Failed to update template." };
  }

  revalidatePath("/admin/templates");
  revalidatePath(`/admin/templates/${templateId}`);
  return { ok: true, id: templateId };
}

/**
 * Transition a template between draft / published / archived states.
 *
 * Publishing a template makes it appear in the Post Builder + multi-OH
 * picker. Archiving removes it from the picker but preserves it for
 * historical lineage — never delete a published template; archive it.
 */
export async function setTemplateStateAction(
  templateId: string,
  state: TemplatePublishState,
): Promise<ActionResult> {
  const profile = await requireAdmin();

  if (!VALID_PUBLISH_STATES.has(state)) {
    return { ok: false, error: `Invalid publish state: ${state}` };
  }

  const updated = await storage.updateTemplate(
    templateId,
    { publish_state: state },
    profile.id,
  );
  if (!updated) {
    return { ok: false, error: "Failed to change template state." };
  }

  revalidatePath("/admin/templates");
  revalidatePath(`/admin/templates/${templateId}`);
  return { ok: true, id: templateId };
}

/**
 * Update a template's display_order — controls picker ordering within a
 * post type. The list view uses up/down arrow buttons to nudge by one
 * step; a "Move to position N" input could be added later.
 */
export async function reorderTemplateAction(
  templateId: string,
  newOrder: number,
): Promise<ActionResult> {
  const profile = await requireAdmin();

  if (!Number.isFinite(newOrder)) {
    return { ok: false, error: "Invalid display order." };
  }

  const updated = await storage.updateTemplate(
    templateId,
    { display_order: Math.round(newOrder) },
    profile.id,
  );
  if (!updated) {
    return { ok: false, error: "Failed to reorder template." };
  }

  revalidatePath("/admin/templates");
  return { ok: true, id: templateId };
}

/**
 * Clone an existing template. The clone is created as a DRAFT with
 * "(Copy)" suffixed on the name — so the original stays untouched and
 * the author can iterate on the new variant freely.
 *
 * Redirects to the clone's detail page on success so the author can
 * immediately start editing the new draft.
 */
export async function cloneTemplateAction(
  templateId: string,
): Promise<ActionResult> {
  const profile = await requireAdmin();

  const cloned = await storage.cloneTemplate(templateId, profile.id);
  if (!cloned) {
    return { ok: false, error: "Failed to clone template." };
  }

  revalidatePath("/admin/templates");
  redirect(`/admin/templates/${cloned.id}`);
}

const VALID_FORMATS = new Set<PostFormat>([
  "square_1x1",
  "portrait_4x5",
  "story_9x16",
]);

/**
 * Save the schema for ONE format on a template. The other formats are
 * left untouched — authors edit each format independently via the
 * format-switcher in the edit UI.
 *
 * Pass `null` for `schema` to UNDEFINE a format (e.g. "this template no
 * longer supports Story 9:16"). The DB column stores it as null and the
 * picker filters it out.
 *
 * Phase 2B's foundation: accepts a parsed schema JSON. The actual canvas
 * editor (next chunk of 2B) will produce that JSON via Fabric.js;
 * meanwhile, the JSON-textarea authoring mode in the edit UI lets us
 * test the save plumbing without the canvas wired up.
 */
export async function saveTemplateSchemaForFormatAction(
  templateId: string,
  format: PostFormat,
  schemaForFormat: unknown,
): Promise<ActionResult> {
  const profile = await requireAdmin();

  if (!VALID_FORMATS.has(format)) {
    return { ok: false, error: `Invalid format: ${format}` };
  }

  // Refetch the current schema family so we can patch just the requested
  // format without clobbering the other two.
  const row = await storage.getTemplateById(templateId);
  if (!row) return { ok: false, error: "Template not found." };

  // Defensive validation — schemaForFormat must be either null (undefine
  // the format) or an object. Arrays / primitives get rejected so a
  // garbled paste doesn't corrupt the row.
  if (
    schemaForFormat !== null &&
    (typeof schemaForFormat !== "object" || Array.isArray(schemaForFormat))
  ) {
    return {
      ok: false,
      error: "Schema must be a JSON object or null.",
    };
  }

  const nextSchema: TemplateSchemaFamily = {
    ...row.schema,
    [format]: schemaForFormat,
  };

  const updated = await storage.updateTemplate(
    templateId,
    { schema: nextSchema },
    profile.id,
  );
  if (!updated) {
    return { ok: false, error: "Failed to save schema." };
  }

  revalidatePath("/admin/templates");
  revalidatePath(`/admin/templates/${templateId}`);
  revalidatePath(`/admin/templates/${templateId}/edit`);
  return { ok: true, id: templateId };
}

/**
 * Hard delete. Only DRAFTS should be hard-deleted; published templates
 * should be archived instead. The action enforces this at the storage
 * level: we refetch the row first to confirm it's still in draft state.
 */
export async function deleteTemplateAction(
  templateId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const row = await storage.getTemplateById(templateId);
  if (!row) {
    return { ok: false, error: "Template not found." };
  }
  if (row.publish_state !== "draft") {
    return {
      ok: false,
      error:
        "Only drafts can be deleted. Archive published or archived templates instead.",
    };
  }

  const ok = await storage.deleteTemplate(templateId);
  if (!ok) {
    return { ok: false, error: "Failed to delete template." };
  }

  revalidatePath("/admin/templates");
  redirect("/admin/templates");
}
