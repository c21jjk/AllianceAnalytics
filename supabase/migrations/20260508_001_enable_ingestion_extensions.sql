-- Phase 2 — Enable extensions needed for scheduled platform syncs.
--
-- pg_cron schedules the daily sync. pg_net is what pg_cron calls to trigger
-- the Edge Functions over HTTP. Both are listed in extensions but not yet
-- installed on Alliance Social.
--
-- Safe to apply on prod: enabling extensions doesn't touch existing rows.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;
