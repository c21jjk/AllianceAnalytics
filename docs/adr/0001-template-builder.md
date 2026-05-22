# 0001 — Template Builder Admin Tool

- **Status:** Proposed
- **Date:** 2026-05-22
- **Authors:** John Koch (product direction) + Claude (architecture)
- **Affected code:** `lib/post-builder/templates/`, `lib/post-builder/canvas-editor/`, post-builder UI, future `lib/template-builder/`, future `app/(app)/admin/templates/`

## Context

Templates are how every Post Builder post gets its visual identity. Today they are hand-coded HTML/CSS primitives in `lib/post-builder/templates/primitives/` — 12 files (6 active variants × 2 formats), one per (variant × format) combination. Editing a template means editing TypeScript, pushing to GitHub, and deploying. Adding a new template requires two new primitive files (one per format) plus registry wiring.

This works but constrains the system:

1. **Larissa can't author templates herself.** Visual design shouldn't require React/TypeScript.
2. **Iteration is slow.** Tweaking a font, color, or spacing value requires a deploy.
3. **Hard-coded variant lists** in `MultiOHWizardClient.tsx` and `PostBuilderClient.tsx` are tightly coupled to the primitive code — the "v1 was retired" bug rippled across three files because the variant identifier was duplicated in too many places.
4. **No per-post-type visual identity.** Open House posts currently use the same variants as Just Listed and Just Sold, just re-themed. There's no path to "OH posts look STRUCTURALLY different from Just Listed posts" without writing new primitive code.

The product goal is a **Template Builder admin tool** where John (and eventually Larissa) can browse all existing templates, edit any template's design, author new templates from scratch, tag each template to one or more post types, reorder templates within a post type's picker, and archive templates without deleting them — all from inside the app, no deploys.

## Decisions

### 1. Module isolation

A new module at `lib/template-builder/` owns ALL template authoring, storage, and the JSON-schema renderer.

The existing post-builder UI, publish pipeline, dashboards, and multi-OH wizard become **consumers** of this module through a small public API:

```ts
listTemplatesForPostType(post_type, format) → TemplateMeta[]
getTemplateById(id)                          → TemplateDefinition
renderTemplate(id, listingData, format)      → { image_url, image_path }
```

Code inside `lib/template-builder/` can be redesigned, refactored, or replaced without breaking downstream consumers — only the contract above is fixed.

### 2. Storage

A new `template_definitions` table in the Analytics Supabase project holds every template as a row.

```sql
CREATE TABLE public.template_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  post_types      TEXT[] NOT NULL CHECK (array_length(post_types, 1) > 0),
  schema          JSONB NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  publish_state   TEXT NOT NULL DEFAULT 'draft'
                  CHECK (publish_state IN ('draft', 'published', 'archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_template_definitions_post_types ON public.template_definitions USING GIN (post_types);
CREATE INDEX idx_template_definitions_state      ON public.template_definitions (publish_state)
  WHERE publish_state = 'published';
```

### 3. Template = format family

Each template row is a **family** that defines both supported formats (Portrait 4:5 + Story 9:16) inside one `schema` JSON document, keyed by format:

```json
{
  "portrait_4x5": { ...CanvasTemplateSchema },
  "story_9x16":   { ...CanvasTemplateSchema }
}
```

Square 1:1 was retired 2026-05-22 — see `lib/post-builder/types.ts`.

A template doesn't have to define both formats. Partial families are valid (an OH-specific template might launch Portrait-only). Templates that don't define the user's selected format are filtered out of the picker.

### 4. Post-type tagging — multi-select

`post_types` is a multi-select text array. Each template can be tagged for one or more of: `just_listed`, `open_house`, `under_contract`, `just_sold`, `price_reduction`.

Picker query:

```sql
SELECT * FROM template_definitions
WHERE 'open_house' = ANY(post_types) AND publish_state = 'published'
ORDER BY display_order;
```

### 5. No default template

Per product decision: there is no auto-selected default per post type. Larissa manually picks each time. The post-type field is **required** when authoring a template — must tag at least one.

### 6. Display order

`display_order` (INT) controls picker ordering within a post type. The admin UI exposes drag-to-reorder. When a template is tagged for multiple post types, the same `display_order` applies across all of them (acceptable per product).

### 7. Publish state

Enum `draft | published | archived`:

- **draft** — author is mid-design; not shown in picker
- **published** — live; shown in picker
- **archived** — no longer offered for new posts; existing posts that used it keep their already-rendered output

### 8. Versioning — edits are edits, not versions

Editing a published template is an EDIT, not a new version. Existing posts that used it keep their already-rendered PNG (stored in Supabase Storage) — the visual output is frozen at the time of original generation.

If Larissa wants a structurally different variant, she **clones** the existing template (first-class operation) and edits the clone. The old template stays untouched.

Rationale: full version history adds schema complexity (versions table, "which version did this post use" lookups). Most edits are tweaks; freezing the rendered output is the natural protection against retroactive change.

### 9. Schema format

The template schema reuses (and extends) `CanvasTemplateSchema` from `lib/post-builder/canvas-editor/types.ts`. That's already a JSON-based layered template format with text, image, shape primitives, and data-binding placeholders — the Path C foundation since 2026-05-14.

### 10. Data-binding contract

Templates reference listing data through a fixed placeholder vocabulary. Locked down so authors can't introduce data dependencies the binding layer doesn't fulfill.

| Placeholder         | Source                                    |
|---------------------|-------------------------------------------|
| `{address}`         | `properties.address` (with unit suffix)   |
| `{city}`            | `properties.city`                         |
| `{state}`           | `properties.state`                        |
| `{zip}`             | `properties.zip`                          |
| `{price}`           | formatted `properties.list_price`         |
| `{sold_price}`      | formatted `properties.close_price`        |
| `{beds}`            | `properties.bedrooms`                     |
| `{baths}`           | `properties.bathrooms_full`               |
| `{half_baths}`      | `properties.bathrooms_half`               |
| `{property_type}`   | `properties.property_type`                |
| `{unit_number}`     | `properties.unit_number`                  |
| `{agent_name}`      | listing or hosting agent (context-aware)  |
| `{hosting_agent}`   | resolved hosting agent (open house only)  |
| `{oh_window}`       | "Sat · 10 AM–12 PM"                       |
| `{oh_day}`          | "Sat"                                     |
| `{oh_time}`         | "10 AM–12 PM"                             |
| `{mls_hashtag}`     | "#NJCM261228" / "#CMC261228"              |
| `{hero_photo}`      | listing's hero image URL                  |
| `{photo_n}`         | photo at index n                          |
| `{brand_logo}`      | C21 Alliance logo (variant per context)   |
| `{agent_headshot}`  | listing agent's headshot                  |

Additional placeholders can be added via ADR amendment.

### 11. Brand asset binding

`{brand_logo}` and `{agent_headshot}` resolve through the existing Studio brand-asset library (`brand_assets` table). Template authors pick which logo variant or which agent assignment; the binding layer fetches the live URL at render time.

Swap the C21 brand logo file once and every template using `{brand_logo}` gets the new file on next render — no template edits needed.

### 12. Permissions

Phase 1: admin-only. `/admin/templates/*` routes are gated to `profiles.role = 'admin'`. Larissa gets `editor` role later (Phase 3+).

### 13. Migration path — coexistence, not big-bang

The 12 hand-coded primitives in `lib/post-builder/templates/primitives/` (6 active variants × 2 formats — portrait_4x5 + story_9x16) are NOT migrated automatically. They keep working through the legacy registry, coexisting with DB-defined templates during the build.

The picker queries BOTH sources and merges. Legacy primitives surface with their existing variant IDs (v2, v3, v6, v8, v9, v10); DB templates surface by UUID with their authored name.

Lazily, each primitive gets ported to a JSON definition in Phase 4. When all are ported, the legacy registry is deprecated and the primitives directory deleted.

### 14. Renderer parity

`lib/template-builder/renderer.ts` consumes the JSON schema and produces an image. It must produce visually equivalent output to the existing HTML/Chromium pipeline so migrating a primitive doesn't change the published look.

Phase 1 the renderer reuses the existing Fabric.js canvas renderer from `lib/post-builder/canvas-editor/`. Long term, the two consolidate into one renderer owned by `lib/template-builder/`.

## Consequences

**Positive:**

- New OH-dedicated templates ship without code changes.
- Larissa authors templates herself once Phase 3 lands.
- The "v1 was retired" class of bug disappears — templates referenced by UUID, not hand-shared string IDs.
- Post-builder UI, dashboard, publish pipeline, multi-OH wizard need zero changes when templates change.
- New post types in the future (`for_rent`, `coming_soon`, etc.) get their own template ecosystem for free.

**Negative / cost:**

- 8-12 weeks of focused work to complete all 5 phases.
- New module + admin UI to maintain.
- Careful management during the dual-registry period (Phase 1-3) when both legacy primitives and DB templates are live.
- JSON-schema templates express LESS than hand-coded HTML/CSS (no CSS animations, no complex pseudo-element effects). Some primitives may not port cleanly and will need design simplification.

## Phasing

### Phase 0 — Discovery & ADR ← THIS DOCUMENT
Lock down decisions above.

### Phase 1 — Foundation (1-2 weeks)
- Migration: `template_definitions` table + indexes
- Module skeleton: `lib/template-builder/{schema,storage,registry,renderer,bindings}.ts`
- Admin UI shell at `/admin/templates`: list view, filter by post_type, no editor yet
- Read path: existing pickers query both DB templates AND legacy primitives, merging the results
- Permission gate: admin-only

### Phase 2 — Visual editor (3-4 weeks)
- WYSIWYG editor at `/admin/templates/[id]/edit`
- Drag-drop placeholders, text styling, layout grid, snap-to
- Live preview against a sample listing
- Save / draft / publish workflow
- Drag-to-reorder + archive UI
- Clone-template action
- Built on top of existing `CanvasEditorOverlay`

### Phase 3 — Brand asset binding + Larissa access (1-2 weeks)
- `{brand_logo}` + `{agent_headshot}` placeholders resolved through Studio asset library
- Asset picker UI inside the editor
- `editor` role; Larissa onboarded

### Phase 4 — Primitive migration (2-3 weeks)
- Port v2/v3/v6/v8/v9/v10 to JSON definitions
- Delete `lib/post-builder/templates/primitives/`
- Deprecate legacy registry
- All templates now admin-editable

### Phase 5 — Polish + multi-OH hero (1-2 weeks)
- Port `multi-oh-render.ts` event hero to the JSON pipeline
- Template test gallery (preview any template against any listing)
- Final UX audit

## Alternatives considered

### A. Polotno SDK
Paid commercial template editor (~$300/mo). Rejected 2026-05-14 for cost + vendor lock-in.

### B. Continue hand-coding templates in TypeScript
Status quo. Rejected because of the four pain points in Context.

### C. Per-template canvas-editor only, no admin route
Use the existing `CanvasEditorOverlay` for per-template authoring; skip the separate admin surface. Rejected because:
- Doesn't solve template DISCOVERY (browsing all templates)
- Doesn't solve template LIFECYCLE (draft / published / archived / reorder)
- Mixes "edit a specific post" with "edit the template the post is based on" — different mental models that confuse the UX
