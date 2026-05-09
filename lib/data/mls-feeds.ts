import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export type MlsFeedRow = Database["public"]["Tables"]["mls_feeds"]["Row"];
export type MlsFeedUpdate = Database["public"]["Tables"]["mls_feeds"]["Update"];
export type MlsFeedType = Database["public"]["Enums"]["mls_feed_type"];

/**
 * mls_feeds RLS policies require is_admin(); the public anon client can't
 * read these rows. All accessors below use the service-role client.
 */

export async function listMlsFeeds(): Promise<MlsFeedRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mls_feeds")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    console.error("listMlsFeeds:", error);
    return [];
  }
  return data ?? [];
}

export async function getMlsFeed(
  shortCode: string,
): Promise<MlsFeedRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mls_feeds")
    .select("*")
    .eq("short_code", shortCode)
    .maybeSingle();
  if (error) {
    console.error("getMlsFeed:", error);
    return null;
  }
  return data;
}

/**
 * Heuristic for whether a feed is "Configured":
 * - feed_type=rets:           rets_url + username + password all present
 * - feed_type=reso_web_api:   base_url + api_key all present
 */
export function isFeedConfigured(row: MlsFeedRow): boolean {
  if (row.feed_type === "rets") {
    return Boolean(
      (row.rets_url ?? "").trim() &&
        (row.username ?? "").trim() &&
        (row.password ?? "").trim(),
    );
  }
  // reso_web_api
  return Boolean(
    (row.base_url ?? "").trim() && (row.api_key ?? "").trim(),
  );
}
