/**
 * Data source switch.
 *
 * Until Phase 2 ingestion populates the `posts` and `post_metrics_daily`
 * tables, the dashboard reads from the typed mock fixtures shipped in
 * lib/fixtures/. Once real data is flowing, flip the env var:
 *
 *   ALLIANCE_DATA_SOURCE=db
 *
 * to switch every page over to live DB queries.
 *
 * The env var is server-side only (no NEXT_PUBLIC_ prefix) so flipping it
 * doesn't require a client redeploy — only the running Vercel server picks
 * up the change on next render.
 *
 * Default: "fixtures" (safe — preserves the working mock UI).
 */
export type DataSource = "fixtures" | "db";

export function getDataSource(): DataSource {
  const v = process.env.ALLIANCE_DATA_SOURCE?.toLowerCase();
  return v === "db" ? "db" : "fixtures";
}

export function isLive(): boolean {
  return getDataSource() === "db";
}
