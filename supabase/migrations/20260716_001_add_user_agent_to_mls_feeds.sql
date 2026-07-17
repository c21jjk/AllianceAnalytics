-- Bright MLS is a RETS (Cornerstone) feed and requires its own User-Agent
-- ("Bright RETS Application/1.0"), unlike the Paragon feeds. Store the UA
-- per-feed so the sync functions can send the right header.
alter table public.mls_feeds add column if not exists user_agent text;
comment on column public.mls_feeds.user_agent is
  'Per-feed RETS User-Agent header. Bright requires "Bright RETS Application/1.0"; Paragon feeds default to AllianceAnalytics/1.0.';

-- Note: the bright mls_feeds row values (rets_url / username / password /
-- rets_version / user_agent / office_filter) and offices.bright_office_id are
-- set via the Supabase MCP (they contain a live credential and are not
-- committed here). office_filter holds the 6 Century 21 Alliance
-- ListOfficeMlsId codes: YALL02,YALL03,YALL05,YALL06,YALL10,C21ALLWW.
