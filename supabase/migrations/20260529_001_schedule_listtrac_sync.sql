-- ListTrac portal-traffic sync, twice daily.
--
-- Until now listtrac-sync only ran on a single ad-hoc pg_cron job
-- ('listtrac-sync-daily' @ 09:00 UTC, created outside version control) plus
-- the manual "Sync now" button on /settings. Portal data went stale between
-- runs. Replace the single ad-hoc job with a twice-daily pair that uses the
-- same invoke_sync_function() helper as the FB/IG/TT platform syncs.
--
-- Times are UTC (pg_cron). 10:00 UTC ~= 6 AM ET, 22:00 UTC ~= 6 PM ET.
-- The 10:00 run lands well before the Monday 13:00 UTC report emails, so the
-- weekly social report + owner-story sends always read fresh portal counts.
--
-- NOTE: applied to the live project via Supabase MCP on 2026-05-29. This file
-- exists so the schedule is reproducible from version control.

-- Remove the old single-run job if present (created directly via SQL editor).
SELECT cron.unschedule('listtrac-sync-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'listtrac-sync-daily');

SELECT cron.schedule(
  'listtrac_sync_am',
  '0 10 * * *',
  $$ SELECT public.invoke_sync_function('listtrac-sync'); $$
);

SELECT cron.schedule(
  'listtrac_sync_pm',
  '0 22 * * *',
  $$ SELECT public.invoke_sync_function('listtrac-sync'); $$
);
