-- One-time links for account activation (invite) and password reset.
-- Only the SHA-256 of the token is stored; the raw token lives only in the
-- emailed URL. Service-role access only: RLS on, no policies.
-- Applied to prod via Supabase MCP on 2026-09-19.
create table if not exists public.account_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('invite', 'reset')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists account_link_tokens_user_created_idx
  on public.account_link_tokens (user_id, created_at desc);

alter table public.account_link_tokens enable row level security;

revoke all on public.account_link_tokens from anon, authenticated;
