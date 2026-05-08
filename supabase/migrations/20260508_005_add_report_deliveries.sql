-- Phase 2 — Per-recipient delivery tracking for property reports.
--
-- The existing reports.report_token works fine for "one shareable URL per
-- report" but doesn't let us track which seller (or co-seller, or referral)
-- viewed which delivery, or how many times. Each forward becomes a new row
-- here with its own share_token.
--
-- Matches the ReportDelivery type already shipped in lib/types/report.ts.

CREATE TYPE public.delivery_channel AS ENUM ('email', 'link');
CREATE TYPE public.delivery_status  AS ENUM ('pending', 'sent', 'viewed');

CREATE TABLE public.report_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  recipient_name  text,
  recipient_email text,
  channel         public.delivery_channel NOT NULL DEFAULT 'email',
  status          public.delivery_status  NOT NULL DEFAULT 'pending',
  sent_at         timestamptz,
  viewed_at       timestamptz,
  view_count      integer NOT NULL DEFAULT 0,
  share_token     text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_deliveries_report_id_idx
  ON public.report_deliveries(report_id);
CREATE INDEX report_deliveries_status_sent_at_idx
  ON public.report_deliveries(status, sent_at DESC);

ALTER TABLE public.report_deliveries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.report_deliveries IS
  'One row per send/forward of a property report. Powers the deliveries table on /reports and the public /r/[token] route.';
