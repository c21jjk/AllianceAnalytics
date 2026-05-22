-- Migration: 20260522034020_create_post_listings_join_table
-- Applied via Supabase MCP. Captured into the repo on 2026-05-22 for traceability.
--
-- post_listings — many-to-many between posts and properties.
--
-- Motivation: multi-property Open House carousel posts cover multiple
-- listings in a single post. The legacy posts.property_id single-FK can
-- only anchor on one. With this join table every featured listing's
-- Owner Story can show the same post + share the metrics.
--
-- posts.property_id is preserved for backward compat — it carries the
-- "primary/anchor" listing (the one explicitly marked is_primary=true
-- here). Existing readers can keep working off posts.property_id while
-- new code (Owner Story, /properties/[mls], /r/[token]) reads through
-- post_listings.

CREATE TABLE public.post_listings (
  post_id      UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  property_id  UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  link_method  public.post_link_method NOT NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, property_id)
);

COMMENT ON TABLE public.post_listings IS
  'Many-to-many link between posts and properties. Created 2026-05-21 to support multi-property Open House carousels appearing in every featured listing''s Owner Story. posts.property_id stays as the convenience anchor (mirrors the row here marked is_primary=true).';

COMMENT ON COLUMN public.post_listings.is_primary IS
  'TRUE exactly once per post — the anchor listing. Matches posts.property_id by convention.';

-- Property-side lookup is the most common access pattern (Owner Story
-- for listing X joins through this table). Primary key already covers
-- post-side lookups.
CREATE INDEX idx_post_listings_property ON public.post_listings (property_id);

-- Partial index to make "find the primary listing of post X" fast — used
-- by readers that still want a single anchor (e.g. /posts/[id] header).
CREATE INDEX idx_post_listings_post_primary
  ON public.post_listings (post_id)
  WHERE is_primary;

-- Enforce at most one primary per post. Using a unique index instead of
-- a CHECK so the constraint covers all rows globally (Postgres CHECKs
-- can't span rows).
CREATE UNIQUE INDEX idx_post_listings_one_primary_per_post
  ON public.post_listings (post_id)
  WHERE is_primary;

-- RLS — read-only for authenticated users (mirrors the posts policy:
-- service role writes, app reads). Adjust if writers need direct access.
ALTER TABLE public.post_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_listings_read_authenticated
  ON public.post_listings
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role bypasses RLS — no explicit policy needed for writes.

-- Backfill from existing posts.property_id. Every post that already has
-- a property_id gets one row marked is_primary=true. Posts with NULL
-- property_id stay empty in this table (they were never linked).
INSERT INTO public.post_listings (post_id, property_id, link_method, is_primary)
SELECT
  p.id,
  p.property_id,
  COALESCE(p.link_method, 'auto_mls'::public.post_link_method),
  true
FROM public.posts p
WHERE p.property_id IS NOT NULL
ON CONFLICT (post_id, property_id) DO NOTHING;
