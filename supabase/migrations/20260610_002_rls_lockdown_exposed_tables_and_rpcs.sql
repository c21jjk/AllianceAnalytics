-- Audit 2026-06-10 security hardening.
-- Applied to live DB via Supabase MCP 2026-06-10 (rls_lockdown_exposed_tables_and_rpcs).
-- 1) Enable RLS (deny-by-default, no policies) on tables that were exposed
--    via PostgREST without RLS. The app accesses all of these exclusively
--    through the service-role client, which bypasses RLS, so this changes
--    nothing for the app and closes anon/authenticated REST access.
alter table public.mls_agents enable row level security;
alter table public.email_subscribers enable row level security;
alter table public.office_post_announcements enable row level security;
alter table public.listing_portal_metrics enable row level security;
alter table public.render_schema_cache enable row level security;
alter table public.portal_bundles enable row level security;
alter table public.portal_bundle_members enable row level security;

-- 2) Revoke EXECUTE on SECURITY DEFINER functions from anon/authenticated.
--    These are operational RPCs invoked only by pg_cron (runs as postgres)
--    or the service-role client; the public anon key could previously
--    trigger RETS syncs, ListTrac backfills, linker/grouper runs, etc.
revoke execute on function public.invoke_edge_function(text) from anon, authenticated;
revoke execute on function public.invoke_mls_rets_sync(text) from anon, authenticated;
revoke execute on function public.run_auto_linker() from anon, authenticated;
revoke execute on function public.run_post_grouper() from anon, authenticated;
revoke execute on function public.link_property_offices() from anon, authenticated;
revoke execute on function public.ensure_owner_story_tokens() from anon, authenticated;
-- is_admin() is referenced by RLS policies evaluated as `authenticated`, so
-- it keeps EXECUTE for authenticated; anon has no business calling it.
revoke execute on function public.is_admin() from anon;
