-- 2026-07-24 — Mobile PWA build, Phase D (web push).
-- Adds 'web_push' to the credential_platform enum so VAPID keys can live
-- in api_credentials (DB-first secret pattern, same as 'render_token' —
-- the Vercel MCP exposes no env-var write tools).
-- Applied to the live project via Supabase MCP on 2026-07-24.
ALTER TYPE public.credential_platform ADD VALUE IF NOT EXISTS 'web_push';
