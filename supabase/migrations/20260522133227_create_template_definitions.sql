-- Migration: 20260522133227_create_template_definitions
-- Applied via Supabase MCP. Captured into the repo on 2026-05-22 for traceability.
--
-- template_definitions — the storage for the Template Builder admin tool.
--
-- See docs/adr/0001-template-builder.md for the full decision record. Short
-- version: every visual template (Just Listed, Open House, Sold, etc.) lives
-- as a row here. The Template Builder admin UI at /admin/templates is the
-- only place these rows are created/edited. The Post Builder picker and the
-- multi-OH wizard query this table (alongside the legacy hand-coded primitives
-- in lib/post-builder/templates/primitives/ during the coexistence period).
--
-- NOTE: The schema JSON's `square_1x1` key was retired 2026-05-22 in a
-- separate cleanup pass (see lib/post-builder/types.ts). The DDL below is
-- preserved as-applied; later code strips that key from any existing rows.

CREATE TABLE public.template_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-readable label shown in the admin list + the picker.
  name            TEXT NOT NULL,
  -- Optional longer description / authoring notes.
  description     TEXT,
  -- Multi-select tags — which post-type pickers show this template.
  -- Must contain at least one entry (templates that don't apply anywhere
  -- shouldn't exist; they're either archived or deleted).
  post_types      TEXT[] NOT NULL CHECK (array_length(post_types, 1) > 0),
  -- Format-keyed schema family. JSON shape:
  --   {
  --     "square_1x1":   { ...CanvasTemplateSchema } | null,
  --     "portrait_4x5": { ...CanvasTemplateSchema } | null,
  --     "story_9x16":   { ...CanvasTemplateSchema } | null
  --   }
  -- A template doesn't have to define all three formats. Picker filters
  -- out templates that don't define the user's current format.
  schema          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Picker ordering within a post type. Drag-to-reorder in admin UI.
  display_order   INTEGER NOT NULL DEFAULT 0,
  -- Lifecycle state.
  --   draft     — mid-design; never shown in picker
  --   published — live; shown in picker
  --   archived  — no longer offered for new posts; existing posts that
  --               used it keep their already-rendered output
  publish_state   TEXT NOT NULL DEFAULT 'draft'
                  CHECK (publish_state IN ('draft', 'published', 'archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Authorship — both UUIDs reference auth.users. created_by is set on
  -- insert and never changes; updated_by is set on every write.
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.template_definitions IS
  'Template Builder storage. Each row is a visual template family (Square/Portrait/Story) tagged to one or more post types. See docs/adr/0001-template-builder.md.';

-- Picker query pattern: `WHERE 'open_house' = ANY(post_types) AND publish_state = 'published'`.
-- GIN supports the ANY() operator on text[] efficiently.
CREATE INDEX idx_template_definitions_post_types
  ON public.template_definitions
  USING GIN (post_types);

-- Partial index — picker only ever queries published rows. Drafts and
-- archives never hit this hot path, so excluding them keeps the index lean.
CREATE INDEX idx_template_definitions_published
  ON public.template_definitions (display_order)
  WHERE publish_state = 'published';

-- updated_at auto-bump trigger so admin writes don't have to remember it.
CREATE OR REPLACE FUNCTION public.template_definitions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER template_definitions_set_updated_at
  BEFORE UPDATE ON public.template_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.template_definitions_set_updated_at();

-- RLS — Phase 1 contract:
--   • Authenticated users SELECT every row (the picker reads them).
--   • Only admins can INSERT/UPDATE/DELETE (template authoring is admin-only
--     in Phase 1; Larissa's editor role lands Phase 3).
--   • Service role bypasses RLS for server-side writes.
ALTER TABLE public.template_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_definitions_read_authenticated
  ON public.template_definitions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY template_definitions_admin_write
  ON public.template_definitions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );
