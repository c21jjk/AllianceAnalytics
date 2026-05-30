# Template Consolidation + Library-First Creation — New Thread Handoff

Prepared 2026-05-29. Read this first when starting the template thread.

## The goal (John's vision)

1. **Every post creation begins in the Template Library.** Before building, the user picks a template (from `template_definitions`), and the post is built from that schema. No post starts from a hardcoded default.
2. **Templates live in ONE place** (`template_definitions`), not the five they live in today.
3. **V1 is removed entirely.** Every new post starts from a template authored with the current (Path C / canvas-editor `CanvasTemplateSchema`) logic.
4. **Studio and Library stay tightly coupled.** Save from Studio → lands in the library (already true). Create for any status → pulls from the library (NOT true today).

## Current state (verified 2026-05-29)

**Save side is already library-backed (good):**
- One Studio host: `app/(app)/post-builder/PostBuilderClient.tsx` → `CanvasEditorOverlay` → `CanvasEditor`. Every "Edit/Create in Studio" link across the app funnels here.
- "Save as Template" is wired on that host (`PostBuilderClient` passes `onSaveAsTemplate` → `saveCustomTemplateAction`, `app/(app)/post-builder/actions.ts` ~3336). It writes `template_definitions` with `source='studio'` + `schema_json` + preview PNG.
- Library UIs: `/templates` (user, `source='studio'`) and `/admin/templates` (builder, `source='builder'`), both read `template_definitions`. Legacy `custom_templates` table is retired/bypassed.
- Admin Template Builder editor (`app/(app)/admin/templates/[id]/edit/TemplateCanvasEditor.tsx`) reuses the same `CanvasEditor` but saves via `saveTemplateSchemaForFormatAction` (saving there IS the template save, so no "save as template" button).

**Use side is NOT library-backed (the gap):**
- Status-driven generation resolves its design from a **hardcoded factory registry**, `findCanvasTemplate` (`lib/post-builder/canvas-editor/templates/index.ts` ~84), whose docstring says it ignores the DB by design.
- DB templates are only used when (a) an explicit `db_template_id` is passed (multi-OH wizard, `app/api/post-builder/multi-oh-generate/route.ts` ~372/802 `renderDbTemplate`), or (b) a caller opts into `fetchDefaultCustomTemplate` (`lib/data/custom-templates-db.ts` ~71). No automatic status → library mapping exists.

**The five places templates live today:**
1. `template_definitions` table — the only in-app-editable home (`source` = builder | studio). Migration `supabase/migrations/20260522133227_create_template_definitions.sql`.
2. Factory canvas registry (hardcoded) — `lib/post-builder/canvas-editor/templates/` (`placeholder-factory.ts`, `just-listed-square.ts`, `just-sold-square.ts`, `open-house-square.ts`; ~10 schemas, 5 post types × 2 formats). Resolved by `findCanvasTemplate`.
3. Reel template manifest (hardcoded) — `lib/post-builder/reel-templates/manifest.ts`.
4. Legacy V1 registry/shim + primitives — `lib/post-builder/templates/registry.ts` (stub) + `templates/primitives/`. **Target for removal.**
5. Skill-authored schemas — `skills/alliance-template-author/` authors `CanvasTemplateSchema` files (feeds #2, not the DB).

## Proposed plan (decide + sequence in the new thread)

1. **Status → template resolution model (core).** Add a "choose a template" step at the START of every post-creation flow, reading `template_definitions` filtered by status + format. Decide: always-pick vs. default-pre-selected-but-changeable (recommend the latter). Define the status set: just_listed, under_contract, just_sold, open_house, multi-OH, + reels.
2. **Migrate the factory schemas (#2) into `template_definitions`** as seeded rows (e.g. `source='factory'` or 'builder') so the registry is library-backed, then point generation at the DB.
3. **Generalize `db_template_id`** (already works for multi-OH) so the standard generation path resolves a chosen/default library template instead of `findCanvasTemplate`. Keep the factory only as an emergency fallback, or remove once migrated.
4. **Fold reels (#3) into the library** (with a reel/format flag) or decide they stay a parallel library — but library-backed either way.
5. **Remove V1 (#4) entirely.** Audit `per_property_variant` (v1/v2/v3/v6/v8) and `templates/registry.ts`/`primitives` usage; ensure no live path references them; confirm existing `generated_posts` still render after removal (BACKWARD-COMPAT GATE).
6. **Point the skill (#5)** at creating `template_definitions` rows, not files.
7. **Schema/columns check:** confirm `template_definitions` has the fields needed for status-driven lookup + the picker (status, format, source, schema_json, preview). Add what's missing.

## Key decisions for John

- Default-per-status with a changeable picker, or force a pick every time?
- Reels: same library or a parallel reel library?
- Naming/labels: how templates are categorized by status in the picker.
- Cutover: do existing/in-flight posts keep rendering from their stored schema while new ones go library-first? (Yes — don't retro-break.)

## Gotchas

- Removing V1 must not break already-created `generated_posts` (they store their own `schema_json`/variant). Verify the render path handles old rows.
- Render path must treat library-sourced and factory schemas uniformly (`lib/post-builder/canvas-editor/render-canvas-schema.ts`, `renderDbTemplate`).
- Format handling: square vs portrait/story vs reel.
- One editor only: Studio and admin Template Builder both use `CanvasEditor` — keep it that way.

## Fast-start file map

- Studio host: `app/(app)/post-builder/PostBuilderClient.tsx`; editor `lib/post-builder/canvas-editor/`
- Save: `saveCustomTemplateAction` (`app/(app)/post-builder/actions.ts`)
- Library reads: `listAllCustomTemplatesAction`; pages `/templates`, `/admin/templates`
- Table: `template_definitions` (migration 20260522133227)
- Status pull (to rewire): `findCanvasTemplate` (`lib/post-builder/canvas-editor/templates/index.ts`), `fetchDefaultCustomTemplate` (`lib/data/custom-templates-db.ts`), multi-OH `db_template_id` (`app/api/post-builder/multi-oh-generate/route.ts`)
- To remove: `lib/post-builder/templates/registry.ts` + `templates/primitives/`
- Reels: `lib/post-builder/reel-templates/manifest.ts`
- Skill: `skills/alliance-template-author/`
