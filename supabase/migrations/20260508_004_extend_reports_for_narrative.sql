-- Phase 2 — Extend reports table to back the property-report UI we shipped.
--
-- - period_start / period_end: report covers a date range, not just a generation moment
-- - narrative: jsonb of {hero, reach_summary, closing} written by Claude
-- - kpis: cached aggregate so we don't recompute from post_metrics on every read
-- - audience: cached audience rollup across the report's posts
-- - post_ids: array of posts included in the report (snapshotted at gen time)
--
-- All additive. Existing rows (none currently) get safe defaults.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS period_start  timestamptz,
  ADD COLUMN IF NOT EXISTS period_end    timestamptz,
  ADD COLUMN IF NOT EXISTS post_ids      uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS kpis          jsonb  NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS audience      jsonb  NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS narrative     jsonb  NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.reports.period_start IS 'Start of the reporting window. Typically the date of the first post in the report.';
COMMENT ON COLUMN public.reports.period_end   IS 'End of the reporting window. Typically the date the report is generated or the listing closes.';
COMMENT ON COLUMN public.reports.post_ids     IS 'Snapshot of post IDs included at generation time. Frozen with is_locked=true.';
COMMENT ON COLUMN public.reports.kpis         IS 'Cached aggregate KPIs (PropertyReportKpis shape).';
COMMENT ON COLUMN public.reports.audience     IS 'Cached audience rollup (PropertyReport.audience shape).';
COMMENT ON COLUMN public.reports.narrative    IS 'Claude-authored narrative {hero, reach_summary, closing}. Regenerable until is_locked=true.';
