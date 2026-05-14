import Link from "next/link";

import { requireUser } from "@/lib/auth";
import {
  fetchCreatedPostsLibrary,
  type CreatedPostsLibraryQuery,
} from "@/lib/data/created-posts-db";
import type { PostType, SourceMls } from "@/lib/post-builder/types";
import CreatedPostsLibrary from "./CreatedPostsLibrary";

/**
 * Saved Posts library — every Studio save across every listing, filterable
 * + paginated. Lives at /saved-posts (NOT under /posts/*) so it doesn't get
 * intercepted by the parallel-route drawer at app/(app)/@modal/(.)posts/[id]
 * — that intercept treats any segment under /posts as a single-post id.
 *
 * URL contract — every filter is a query param so the page is shareable +
 * back-button friendly:
 *
 *   ?q=               text search (mls_number + caption ilike)
 *   ?postType=        repeated; one of the 5 post types
 *   ?status=          repeated; "draft" | "scheduled" | "posted" | ...
 *   ?sourceMls=       repeated; "cmc" | "sjsr" | "bright" | "manual"
 *   ?since=           ISO date (inclusive lower bound on updated_at)
 *   ?page=            zero-indexed page number
 *
 * The server-side fetch + count happens here so the user lands on a fully-
 * rendered page (good for SEO + perceived speed). The client component
 * `CreatedPostsLibrary` owns the filter form + delete interactions.
 */

interface SearchParamsShape {
  q?: string | string[];
  postType?: string | string[];
  status?: string | string[];
  sourceMls?: string | string[];
  since?: string | string[];
  page?: string | string[];
}

const VALID_POST_TYPES: PostType[] = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
];

const VALID_SOURCE_MLS: Exclude<SourceMls, null>[] = [
  "cmc",
  "sjsr",
  "bright",
  "manual",
];

function asStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function asString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

interface PageProps {
  searchParams: Promise<SearchParamsShape>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: "Saved Posts — Alliance Social" };
}

export default async function SavedPostsPage({ searchParams }: PageProps) {
  await requireUser();
  const sp = await searchParams;

  const postTypes = asStringArray(sp.postType).filter((s): s is PostType =>
    VALID_POST_TYPES.includes(s as PostType),
  );
  const statuses = asStringArray(sp.status);
  const sourceMls = asStringArray(sp.sourceMls).filter(
    (s): s is Exclude<SourceMls, null> =>
      VALID_SOURCE_MLS.includes(s as Exclude<SourceMls, null>),
  );
  const pageRaw = Number.parseInt(asString(sp.page) ?? "0", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? pageRaw : 0;

  const query: CreatedPostsLibraryQuery = {
    q: asString(sp.q),
    postTypes: postTypes.length > 0 ? postTypes : undefined,
    statuses: statuses.length > 0 ? statuses : undefined,
    sourceMls: sourceMls.length > 0 ? sourceMls : undefined,
    updatedSince: asString(sp.since),
    page,
    pageSize: 24,
  };

  const result = await fetchCreatedPostsLibrary(query);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/" className="hover:text-neutral-800">
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Saved posts</span>
      </div>

      <header>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
          Saved posts
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every post you&rsquo;ve saved in Studio, across every listing.
          Drafts you haven&rsquo;t posted yet live here too — pick one up
          to keep editing.
        </p>
      </header>

      <CreatedPostsLibrary initialResult={result} initialQuery={query} />
    </div>
  );
}
