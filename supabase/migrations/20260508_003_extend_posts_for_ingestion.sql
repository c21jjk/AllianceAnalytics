-- Phase 2 — Extend posts table with fields needed for full ingestion shape.
--
-- - hashtags: easier to filter/search on than re-parsing caption every time
-- - audience: jsonb of top_locations / age_buckets / gender_split per post
-- - thumbnail_url: separate from media_url (which may be a video). UI prefers
--   thumbnail for grid/list; media_url for inline playback.
--
-- All additive, all nullable with safe defaults. Backfill is not required.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS hashtags      text[]  NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS audience      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

COMMENT ON COLUMN public.posts.hashtags IS
  'Hashtags parsed from the caption at ingest time. Stored separately for fast filtering.';
COMMENT ON COLUMN public.posts.audience IS
  'Audience breakdown {top_locations, age_buckets, gender_split} from platform Insights APIs. Empty {} when unavailable (e.g. low-reach posts).';
COMMENT ON COLUMN public.posts.thumbnail_url IS
  'Preferred image to render in grid/list views. media_url is the playable asset (video, carousel, image).';
