-- The builder's caption-independent record of which homes a post features.
-- Populated at generate time (multi-OH from the carousel slides, single-property
-- posts from their one listing). The sync ingest reads this as a fallback when a
-- post's caption carries no MLS#, so Open House posts (which omit MLS# hashtags)
-- still link to every featured property in post_listings.
--
-- Applied to the live project via Supabase MCP on 2026-05-29.
ALTER TABLE public.generated_posts
  ADD COLUMN IF NOT EXISTS linked_property_ids uuid[];

COMMENT ON COLUMN public.generated_posts.linked_property_ids IS
  'Properties the post features, selected in the builder. Caption-independent source for post_listings linking (esp. Open House posts that omit MLS# hashtags).';
