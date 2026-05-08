import "server-only";
import type { AccountHealth, Post } from "@/lib/types/post";
import { isLive } from "./source";
import {
  POSTS as FIXTURE_POSTS,
  ACCOUNT_HEALTH as FIXTURE_HEALTH,
} from "@/lib/fixtures/posts";

/**
 * Single entry point for page components to fetch posts + account health.
 *
 * - When ALLIANCE_DATA_SOURCE=fixtures (default), returns the typed mock data.
 * - When ALLIANCE_DATA_SOURCE=db, queries Supabase via lib/data/posts-db.
 *
 * Pages call `getPosts()` / `getAccountHealth()` and remain agnostic.
 *
 * Migration plan:
 *   1. Run first sync → some real posts in `posts` table.
 *   2. Set ALLIANCE_DATA_SOURCE=db on Vercel.
 *   3. Pages render real data; mock fixtures still importable for tests.
 */
export async function getPosts(): Promise<Post[]> {
  if (!isLive()) return FIXTURE_POSTS;
  const { fetchPosts } = await import("./posts-db");
  const rows = await fetchPosts();
  // If DB is empty (fresh project), gracefully fall back to fixtures so the
  // dashboard isn't a wall of empty states during the cutover window.
  if (rows.length === 0) return FIXTURE_POSTS;
  return rows;
}

export async function getAccountHealth(): Promise<AccountHealth[]> {
  if (!isLive()) return FIXTURE_HEALTH;
  const { fetchAccountHealth } = await import("./posts-db");
  const rows = await fetchAccountHealth();
  if (rows.length === 0) return FIXTURE_HEALTH;
  return rows;
}
