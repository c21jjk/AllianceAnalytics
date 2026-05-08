-- Phase 2 — Time-series snapshot table for post metrics.
--
-- The existing posts.metrics jsonb holds the latest snapshot for fast list
-- reads. This new table holds a daily history of those metrics so we can
-- render the 30-day reach sparkline on each PostListRow and the per-post
-- time-series on the post detail page.
--
-- Primary key (post_id, captured_date) gives us a natural upsert key — one
-- snapshot per post per day. The sync Edge Functions ON CONFLICT DO UPDATE
-- using this composite key.

CREATE TABLE public.post_metrics_daily (
  post_id           uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  captured_date     date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  captured_at       timestamptz NOT NULL DEFAULT now(),
  impressions       integer,
  reach             integer,
  likes             integer,
  comments          integer,
  shares            integer,
  saves             integer,
  plays             integer,
  link_clicks       integer,
  profile_visits    integer,
  follows           integer,
  engagement_rate   numeric(6,4),
  completion_rate   numeric(6,4),
  avg_watch_time_sec numeric(8,2),
  raw_payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (post_id, captured_date)
);

CREATE INDEX post_metrics_daily_captured_date_idx
  ON public.post_metrics_daily(captured_date DESC);

COMMENT ON TABLE public.post_metrics_daily IS
  'Daily snapshots of post performance. One row per post per day. Powers sparklines and time-series charts.';

-- Service-role-only access (matches the existing pattern from api_credentials).
-- Edge Functions use the service role key; UI reads happen via server-side
-- queries also using the service role.
ALTER TABLE public.post_metrics_daily ENABLE ROW LEVEL SECURITY;
