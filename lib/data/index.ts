import "server-only";
import type { AccountHealth, Post } from "@/lib/types/post";
import {
  POSTS as FIXTURE_POSTS,
  ACCOUNT_HEALTH as FIXTURE_HEALTH,
  findPost as findFixturePost,
  PROPERTIES_BY_MLS,
  postsForMls,
} from "@/lib/fixtures/posts";
import type {
  FetchPropertiesOptions,
  PropertySummary,
} from "./properties-db";

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

export interface GetPostsOptions {
  office_short_code?: string | null;
  /** Inclusive lower bound on posted_at (ISO). */
  since?: string | null;
}

export async function getPosts(opts: GetPostsOptions = {}): Promise<Post[]> {
  if (isForcedFixtures()) {
    // Apply same filters in-memory against fixtures so demo mode behaves
    // like prod from the caller's perspective.
    let rows = FIXTURE_POSTS;
    if (opts.since) {
      const cutoff = new Date(opts.since).getTime();
      rows = rows.filter(
        (p) => new Date(p.posted_at).getTime() >= cutoff,
      );
    }
    return rows;
  }
  try {
    const { fetchPosts } = await import("./posts-db");
    const rows = await fetchPosts({
      office_short_code: opts.office_short_code ?? null,
      since: opts.since ?? null,
    });
    // Only fall back to fixtures when called with NO filter and DB is empty.
    if (
      rows.length === 0 &&
      !opts.office_short_code &&
      !opts.since
    ) {
      return FIXTURE_POSTS;
    }
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

/**
 * Property summaries for the /properties index. Live DB rows when present;
 * fixture fallback when the DB has nothing yet (cold-start case).
 *
 * Detail page (`/properties/[mls]`) is still on fixtures — when it migrates
 * we'll add a `getPropertyByMls` here too.
 */
export async function getProperties(
  opts: FetchPropertiesOptions = {},
): Promise<PropertySummary[]> {
  if (isForcedFixtures()) return fixturePropertySummaries();
  try {
    const { fetchProperties } = await import("./properties-db");
    const rows = await fetchProperties(opts);
    // When a filter is active and returns zero, return zero — don't fall
    // back to fixtures (the empty state is the correct answer).
    if (rows.length === 0 && !opts.office && !opts.sort) {
      return fixturePropertySummaries();
    }
    return rows;
  } catch (e) {
    console.error("getProperties: falling back to fixtures —", e);
    return fixturePropertySummaries();
  }
}

/**
 * Build PropertySummary[] from fixtures so the cold-start /properties index
 * still has something to render on a brand-new install.
 */
function fixturePropertySummaries(): PropertySummary[] {
  return Object.values(PROPERTIES_BY_MLS).map((p) => {
    const posts = postsForMls(p.mls);
    const totalReach = posts.reduce((s, post) => s + post.metrics.reach, 0);
    const totalEngagements = posts.reduce(
      (s, post) =>
        s +
        post.metrics.likes +
        post.metrics.comments +
        post.metrics.shares +
        post.metrics.saves,
      0,
    );
    return {
      id: p.mls, // fixtures don't have a uuid; mls doubles as the id
      mls_number: p.mls,
      address: p.address ?? null,
      city: null,
      state: null,
      zip: null,
      list_price: p.list_price ?? null,
      listing_date: null,
      agent_name: null,
      hero_image_url: p.hero_image_url ?? null,
      status: "active" as const,
      source_mls: null,
      listing_office_name: null,
      dom_days: null,
      property_type: null,
      bedrooms: null,
      bathrooms_full: null,
      bathrooms_half: null,
      public_remarks: null,
      post_count: posts.length,
      total_reach: totalReach,
      total_engagements: totalEngagements,
      updated_at: new Date(0).toISOString(),
    };
  });
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
