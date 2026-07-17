-- Widen open_houses.feed_short_code beyond the two Paragon feeds.
--  'bright' — for the Bright OH pass once Bright removes the "Restrict Open
--             House" group from RETS account 3399514 (blocked as of 2026-07-16).
--  'manual' — OHs transcribed from Bright's Matrix client portal (Larissa's
--             "Open Houses in BrightMLS" saved search) until the feed unlocks.
-- Applied to BOTH projects via Supabase MCP on 2026-07-16: AllianceAnalytics
-- (rhkgowpjfpqbrdmgsccx) and Alliance Listings (umziekblnbobkezbbupg).
alter table public.open_houses drop constraint open_houses_feed_short_code_check;
alter table public.open_houses add constraint open_houses_feed_short_code_check
  check (feed_short_code = any (array['cmc'::text, 'sjsr'::text, 'bright'::text, 'manual'::text]));
