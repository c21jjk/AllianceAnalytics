import "server-only";
import type { AccountHealth, Post } from "@/lib/types/post";
import {
  POSTS as FIXTURE_POSTS,
  ACCOUNT_HEALTH as FIXTURE_HEALTH,
  findPost as findFixturePost,
} from "@/lib/fixtures/posts";

/**
 * Single entry point for page components to fetch posts + account health.
 *
 * Auto-detects: tries Supabase first; falls back to fixtures if the DB
 * returns 0 rows (cold-start case) OR if the admin client isn't configured
 * (preview deploys without service-role-key, etc).
 *
 * No env var required — the presence of real rows in the DB is what flips
 * the dashboard from mock to live.
 *
 * To force fixtures (for screenshots, demos, etc) set:
 *   ALLIANCE_DATA_SOURCE=fixtures
 */
function isForcedFixtures(): boolean {
  return process.env.ALLIANCE_DATA_SOURCE?.toLowerCase() === "fixtures";
}

export async function getPosts(): Promise<Post[]> {
  if (isForcedFixtures()) return FIXTURE_POSTS;
  try {
    const { fetchPosts } = await import("./posts-db");
    const rows = await fetchPosts();
    if (rows.length === 0) return FIXTURE_POSTS;
    return rows;
  } catch (e) {
    console.error("getPosts: falling back to fixtures —", e);
    return FIXTURE_POSTS;
  }
}

export async function getPostById(id: string): Promise<Post | undefined> {
  if (isForcedFixtures()) return findFixturePost(id);
  try {
    const { fetchPostById } = await import("./posts-db");
    const post = await fetchPostById(id);
    if (post) return post;
    // Fall back to fixtures only if the id matches a fixture id (for cold-start)
    return findFixturePost(id);
  } catch (e) {
    console.error("getPostById: falling back to fixtures —", e);
    return findFixturePost(id);
  }
}

export async function getAccountHealth(): Promise<AccountHealth[]> {
  if (isForcedFixtures()) return FIXTURE_HEALTH;
  try {
    const { fetchAccountHealth } = await import("./posts-db");
    const rows = await fetchAccountHealth();
    if (rows.length === 0) return FIXTURE_HEALTH;
    return rows;
  } catch (e) {
    console.error("getAccountHealth: falling back to fixtures —", e);
    return FIXTURE_HEALTH;
  }
}
