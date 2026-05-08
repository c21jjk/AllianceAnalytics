-- Phase 2 — Schedule daily ingestion runs.
--
-- pg_cron + pg_net call the three platform Edge Functions once a day at
-- 4:00 AM America/New_York (08:00 UTC during EST, 09:00 UTC during EDT —
-- pg_cron uses UTC, so we accept the 1-hour drift across DST).
--
-- The functions verify auth via the service role key passed in the
-- Authorization header. The service role key is read from a Postgres GUC
-- (custom database parameter) so it can be set once via the Supabase
-- dashboard — see the migration comment below.
--
-- IMPORTANT: Before this cron runs successfully, you must set:
--   ALTER DATABASE postgres SET app.settings.service_role_key TO '...';
-- on the project. Set the GUC via the dashboard's SQL Editor (one-time)
-- since the key shouldn't live in a versioned migration file.

-- Helper to invoke an Edge Function asynchronously via pg_net
CREATE OR REPLACE FUNCTION public.invoke_sync_function(fn_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_id bigint;
  service_key text;
  project_url text;
BEGIN
  service_key := current_setting('app.settings.service_role_key', true);
  project_url := current_setting('app.settings.project_url', true);

  IF service_key IS NULL OR project_url IS NULL THEN
    RAISE NOTICE 'Service role key or project URL not set; skipping %', fn_name;
    RETURN NULL;
  END IF;

  SELECT extensions.http_post(
    url := project_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  ) INTO request_id;

  RETURN request_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_sync_function(text) IS
  'Helper for pg_cron jobs: invokes a Supabase Edge Function with the service role key. Reads service_role_key and project_url from Postgres GUCs set once via SQL Editor.';

-- Schedule each platform's daily sync. Spaced 5 minutes apart so we don't
-- thunder against Graph API quotas all at once.
SELECT cron.schedule(
  'ig_sync_daily',
  '0 8 * * *', -- 08:00 UTC = 04:00 ET (EST)
  $$ SELECT public.invoke_sync_function('ig-sync'); $$
);

SELECT cron.schedule(
  'fb_sync_daily',
  '5 8 * * *',
  $$ SELECT public.invoke_sync_function('fb-sync'); $$
);

SELECT cron.schedule(
  'tt_sync_daily',
  '10 8 * * *',
  $$ SELECT public.invoke_sync_function('tt-sync'); $$
);
