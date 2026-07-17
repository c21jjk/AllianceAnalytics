-- Cron wrapper + schedule for the Bright RETS feed (bright-rets-sync Edge
-- Function). Mirrors invoke_mls_rets_sync but targets bright-rets-sync with a
-- fixed feed_short_code='bright'. Runs every 4h at :40 (the MLS block; cmc=:30,
-- sjsr=:50), so all three RETS feeds sync on the same 4-hourly cadence.
create or replace function public.invoke_bright_rets_sync()
returns bigint language plpgsql security definer
set search_path to 'public','extensions','vault' as $function$
declare srk text; request_id bigint;
begin
  select decrypted_secret into srk from vault.decrypted_secrets
  where name = 'supabase_service_role_key' limit 1;
  if srk is null then raise exception 'vault secret supabase_service_role_key not set'; end if;
  select net.http_post(
    url := 'https://rhkgowpjfpqbrdmgsccx.supabase.co/functions/v1/bright-rets-sync',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || srk),
    body := jsonb_build_object('feed_short_code','bright'),
    timeout_milliseconds := 180000
  ) into request_id;
  return request_id;
end;
$function$;

-- Schedule (idempotent-ish: unschedule if present, then schedule).
select cron.unschedule('mls-rets-sync-bright-every-4h')
where exists (select 1 from cron.job where jobname = 'mls-rets-sync-bright-every-4h');
select cron.schedule('mls-rets-sync-bright-every-4h', '40 1-23/4 * * *',
  'SELECT public.invoke_bright_rets_sync();');
