/**
 * Template Builder — public module surface.
 *
 * Downstream consumers (Post Builder picker, multi-OH wizard, future
 * dashboards) import from THIS file only. Internal modules (storage,
 * renderer, bindings) are implementation detail; importing them
 * directly is fine within the module but should not happen from
 * outside.
 *
 * See `docs/adr/0001-template-builder.md` for the full design.
 */

export {
  listTemplatesForPostType,
  listAllTemplates,
  getTemplateById,
  templateMetaFromDefinition,
} from "./registry";

export {
  templateSupportsFormat,
  listSupportedFormats,
  type TemplateDefinition,
  type TemplateMeta,
  type TemplateSchemaFamily,
  type TemplatePublishState,
  type TemplateInsert,
  type TemplateUpdate,
} from "./schema";

export {
  TEMPLATE_PLACEHOLDERS,
  PLACEHOLDER_LABELS,
  resolvePlaceholders,
  type TemplatePlaceholder,
  type BindingContext,
} from "./bindings";

export {
  renderDbTemplate,
  type RenderOutcome,
  type RenderResult,
  type RenderError,
  type RenderInput as RenderDbTemplateInput,
} from "./renderer";

// Storage CRUD is not re-exported through the public surface — admin
// write actions import from "./storage" directly. The picker side only
// needs the read functions exposed via registry.ts.
