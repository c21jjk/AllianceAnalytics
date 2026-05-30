-- Idempotency + audit log for the weekly Owner Story email to listing agents.
--
-- The Monday cron emails the listing agent the live Owner Story link for each
-- eligible active listing, then re-sends every Monday until the listing leaves
-- "active". One row per (report, week) is the guard that a listing gets at
-- most one Owner Story email per Monday even if the cron retries or races.
--
-- NOTE: applied to the live project via Supabase MCP on 2026-05-29. This file
-- exists so the schema is reproducible from version control.

CREATE TABLE IF NOT EXISTS public.owner_story_email_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  property_id   uuid NOT NULL,
  -- Monday (America/New_York) of the send week, as a plain date.
  week_start    date NOT NULL,
  recipient_email text NOT NULL,
  social_reach  integer NOT NULL DEFAULT 0,
  portal_views  integer NOT NULL DEFAULT 0,
  post_count    integer NOT NULL DEFAULT 0,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  UNIQUE (report_id, week_start)
);

CREATE INDEX IF NOT EXISTS owner_story_email_sends_week_idx
  ON public.owner_story_email_sends (week_start);

ALTER TABLE public.owner_story_email_sends ENABLE ROW LEVEL SECURITY;

-- Server-only table: written exclusively by the cron via the service role
-- (which bypasses RLS). No anon/authenticated policies — nothing client-side
-- reads it. Mirrors the office_post_announcements posture.
