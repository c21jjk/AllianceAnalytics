-- 2026-10-16 (John): host chosen on the dashboard, per open-house occurrence.
-- MLS syncs upsert only the columns they send, so these survive every sync.
-- Applied to prod (Alliance Social) via Supabase MCP 2026-10-16.
alter table public.open_houses
  add column if not exists host_agent_name text,
  add column if not exists host_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists host_set_at timestamptz;
