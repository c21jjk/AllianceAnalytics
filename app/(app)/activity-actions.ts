"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Activity heartbeat — bumps profiles.last_active_at for the current user.
 *
 * Wired by <LastActiveBeacon /> in the authenticated layout. The beacon fires
 * once on mount + every 5 minutes while the tab is visible (visibilitychange-
 * aware).
 *
 * Server-side debounce:
 *   We rewrite last_active_at only when the existing value is older than
 *   DEBOUNCE_MS. This keeps a chatty client from hammering Postgres if a tab
 *   rapidly toggles foreground/background, and it caps the write rate to
 *   roughly one per user every 2 min regardless of beacon cadence.
 *
 * Auth + RLS:
 *   • supabase.auth.getUser() resolves the current user from the request
 *     cookies. No-op if the request is unauthenticated.
 *   • The UPDATE filters by `id = current_user_id` and the profiles RLS
 *     policy already allows a user to update their own row. No service-role
 *     client needed here.
 *
 * Return shape is intentionally minimal — the beacon doesn't surface results
 * to the user; failures degrade silently to a stale timestamp in the Users
 * page, which is acceptable for this signal.
 */

const DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes

export interface BumpLastActiveResult {
  ok: boolean;
  /** "skipped" when the existing timestamp is fresher than DEBOUNCE_MS. */
  reason?: "skipped" | "unauthenticated" | "db_error";
}

export async function bumpLastActiveAction(): Promise<BumpLastActiveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "unauthenticated" };

  // Read current value to apply the server-side debounce. One small SELECT
  // per heartbeat is cheaper than blind-writing and saturating WAL.
  //
  // why the type assertion: the @supabase/ssr + Database generic combo
  // sometimes infers the `.select("col")` response shape as `never` when
  // PostgrestVersion 14.5 is asserted — a known typing quirk that doesn't
  // affect runtime behavior. The cast tells TS what we know: this column
  // exists on the profiles row (verified by the lib/supabase/types.ts entry).
  const readResult = (await supabase
    .from("profiles")
    .select("last_active_at")
    .eq("id", user.id)
    .maybeSingle()) as {
    data: { last_active_at: string | null } | null;
    error: { message: string } | null;
  };

  if (readResult.error) {
    // why: don't bubble a read failure to the client — the beacon retries on
    // its next interval. Log + return ok:false so devs can spot patterns.
    console.warn(
      "[bumpLastActiveAction] profile read failed:",
      readResult.error.message,
    );
    return { ok: false, reason: "db_error" };
  }

  const now = Date.now();
  const prevIso = readResult.data?.last_active_at;
  const prevMs = prevIso ? Date.parse(prevIso) : 0;
  if (now - prevMs < DEBOUNCE_MS) {
    return { ok: true, reason: "skipped" };
  }

  // why: same Database-generic / never-inference issue on .update(). Casting
  // the payload narrows it for TS without changing behavior at runtime.
  const updatePayload = {
    last_active_at: new Date(now).toISOString(),
  } as { last_active_at: string };

  const { error: updateError } = await supabase
    .from("profiles")
    // @ts-expect-error — Database-generic narrowing returns `never` for the
    // update payload type; we know last_active_at is a valid column.
    .update(updatePayload)
    .eq("id", user.id);

  if (updateError) {
    console.warn(
      "[bumpLastActiveAction] profile update failed:",
      updateError.message,
    );
    return { ok: false, reason: "db_error" };
  }

  return { ok: true };
}
