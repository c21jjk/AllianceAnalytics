-- Coming Soon flag (applied 2026-09-02 via Supabase MCP on BOTH projects).
-- Bright's new RETS account (3401860) delivers Coming Soon listings;
-- bright-rets-sync maps them to status='active' so every dashboard card keeps
-- working, and this flag lets the UI label them.
--
-- Primary (rhkgowpjfpqbrdmgsccx):
alter table public.properties
  add column if not exists is_coming_soon boolean not null default false;
comment on column public.properties.is_coming_soon is
  'True when the MLS status is Coming Soon (Bright). status stays active; UI shows a banner.';

-- Listings project (umziekblnbobkezbbupg), same shape:
-- alter table public.active_listings
--   add column if not exists is_coming_soon boolean not null default false;
