-- 2026-07-24 — Mobile PWA build, Phase D (web push).
-- One row per browser push subscription (a profile may have several:
-- iPhone PWA, desktop Chrome, …). Server-only table: RLS enabled with no
-- anon/authenticated policies — all reads/writes go through the
-- service-role client (lib/push/send.ts, /api/push/subscribe), matching
-- the owner_story_email_sends posture.
-- Applied to the live project via Supabase MCP on 2026-07-24.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Push-service endpoint URL — globally unique per subscription.
  endpoint text NOT NULL UNIQUE,
  -- Client public key + auth secret from PushSubscription.toJSON().keys.
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  -- Tombstone: set when the push service returns 404/410 (expired /
  -- revoked). Kept instead of deleted for debugging; sender filters on
  -- disabled_at IS NULL.
  disabled_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id)
  WHERE disabled_at IS NULL;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
