-- Dedupe ledger for the Monday weekly social report blast.
-- One row per covered week (Monday of the covered Mon→Sun week, NY time).
-- The cron INSERTs as a claim before sending; a unique violation means
-- this week was already sent (or is being sent) and the tick is a no-op.
-- Applied to live DB via Supabase MCP 2026-06-10 (weekly_report_sends_dedupe).
create table if not exists public.weekly_report_sends (
  week_start date primary key,
  sent_at timestamptz not null default now(),
  message_id text,
  recipient_count integer
);

-- Service-role only (the cron uses the admin client). Deny anon/authenticated.
alter table public.weekly_report_sends enable row level security;
