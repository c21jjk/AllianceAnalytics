-- Phase 2 — Categorize posts (not all are property-related) and track how
-- the property link was made.
--
-- Categories cover the main social-marketing buckets we observed in the
-- 335 real Alliance posts (just-listed, market updates, agent spotlights,
-- educational tips, etc).
--
-- link_method distinguishes manually-linked posts from auto-linked ones,
-- so we can audit linker quality + know when a human override exists.

CREATE TYPE public.post_category AS ENUM (
  'property',     -- Tied to a specific listing (sets property_id)
  'educational',  -- Tips, advice, market explainers
  'marketing',    -- Brand promo, agent spotlight, open-house teasers
  'community',    -- Local events, neighborhood content
  'sold',         -- Just-sold celebration (may also have property_id)
  'other'
);

CREATE TYPE public.post_link_method AS ENUM (
  'manual',                -- Human linked via UI
  'auto_mls',              -- Auto-linker matched NJ MLS regex
  'auto_address_full',     -- Auto-linker matched the full address substring
  'auto_address_partial'   -- Auto-linker matched street # + name fragment
);

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS category    public.post_category,
  ADD COLUMN IF NOT EXISTS link_method public.post_link_method;

COMMENT ON COLUMN public.posts.category IS
  'Editorial category. Property posts also have property_id; non-property posts (educational, marketing, etc) do not.';
COMMENT ON COLUMN public.posts.link_method IS
  'How the property_id was set. NULL = no link. manual overrides auto-* if human edited later.';
