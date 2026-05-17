import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Singleton system_config table — runtime feature flags. One row, id=1.
 *
 * Currently exposes `publish_test_mode`:
 *   - true  → new posts default to test_mode=true (hidden/draft publishes)
 *   - false → new posts default to test_mode=false (live publishes)
 *
 * The PER-POST `generated_posts.test_mode` column is what publishers
 * actually read at publish time. This global flag is ONLY the default for
 * new rows. Existing rows keep their own value.
 */
export interface SystemConfig {
  publish_test_mode: boolean;
  updated_at: string;
}

/**
 * Read the singleton row. Cached per-request via React's `cache` so
 * multiple server components on the same request share one DB round-trip.
 *
 * why: we read this from many places (PostBuilder default, settings banner,
 * post detail drawer); one query per request beats N queries per request.
 * Cross-request caching is a separate problem — Supabase is fast enough
 * that we don't need it yet.
 */
export const loadSystemConfig = cache(async (): Promise<SystemConfig> => {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("system_config")
    .select("publish_test_mode, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    // why: if the singleton row is somehow missing (migration didn't run,
    // local dev with empty DB), fall back to test_mode=true. Safer to
    // accidentally publish-as-test than to accidentally publish-as-live.
    console.warn(
      "[system-config] singleton row missing, defaulting to test_mode=true:",
      error?.message ?? "no row",
    );
    return { publish_test_mode: true, updated_at: new Date().toISOString() };
  }
  return {
    publish_test_mode: data.publish_test_mode === true,
    updated_at: data.updated_at,
  };
});

/**
 * Convenience wrapper for the most common read path.
 */
export async function getPublishTestMode(): Promise<boolean> {
  const cfg = await loadSystemConfig();
  return cfg.publish_test_mode;
}

/**
 * Update the singleton. Admin-only — callers must check auth before
 * invoking. The trigger on system_config refreshes updated_at automatically.
 */
export async function setPublishTestMode(
  value: boolean,
  updated_by: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("system_config")
    .update({ publish_test_mode: value, updated_by })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
