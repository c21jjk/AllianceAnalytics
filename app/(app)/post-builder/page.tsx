import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import {
  formatDisplayMeta,
  listSupportedFormats,
  listVariantsForPostType,
} from "@/lib/post-builder/templates/registry";
import { listTemplatesForPostType } from "@/lib/template-builder";
import type { TemplateMeta } from "@/lib/template-builder";
import { fetchCreatedPostResume } from "@/lib/data/created-posts-db";
import { loadSystemConfig } from "@/lib/data/system-config";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PostBuilderClient from "./PostBuilderClient";
import type {
  PostBuilderListing,
  PostFormat,
  PostType,
} from "@/lib/post-builder/types";

export const metadata = { title: "Post Builder — Alliance Social" };
export const dynamic = "force-dynamic";

interface SearchParamsShape {
  gp?: string | string[];
  /** Optional MLS number to pre-select in the listings list. */
  mls?: string | string[];
  /** Optional post type to default into ("just_listed", "open_house", etc.). */
  postType?: string | string[];
}

const POST_TYPES: PostType[] = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
];

function asStringParam(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Post Builder — Phase 3.
 *
 * Pick post type → pick a listing → pick a format → pick a variant →
 * render. Just Listed, Just Sold, Under Contract, and Open House each
 * have three variants × three formats = 9 templates per post type
 * (36 total). Square 1:1, Portrait 4:5, and Story 9:16 all ship.
 *
 * Caption + hashtags + canonical MLS hashtag bake in so the existing
 * /posts auto-linker ties posts back to the listing once Larissa
 * publishes.
 */
export default async function PostBuilderPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsShape>;
}) {
  const profile = await requireUser();
  const isAdmin = profile.role === "admin";

  // why: optional resume context — when the user clicked a saved post in
  // the Created Posts strip or library, ?gp=<id> tells us which row to
  // pre-load. Server-side fetch keeps the editor's first render trustworthy
  // (no flash of "wrong" picker state) and gates the lookup by created_by.
  const sp = await searchParams;
  const gpParam = Array.isArray(sp.gp) ? sp.gp[0] : sp.gp;
  const resume = gpParam
    ? await fetchCreatedPostResume(gpParam, profile.id)
    : null;

  const [justListed, justSold, underContract, openHouse, priceReduction] = await Promise.all([
    fetchListingsForPostBuilder({ post_type: "just_listed" }),
    fetchListingsForPostBuilder({ post_type: "just_sold" }),
    fetchListingsForPostBuilder({ post_type: "under_contract" }),
    fetchListingsForPostBuilder({ post_type: "open_house" }),
    fetchListingsForPostBuilder({ post_type: "price_reduction" }),
  ]);

  const listingsByPostType: Record<PostType, PostBuilderListing[]> = {
    just_listed: justListed,
    just_sold: justSold,
    under_contract: underContract,
    open_house: openHouse,
    price_reduction: priceReduction,
  };

  // Variants are the same set per format across all post types — but we
  // include the format-specific template_id, which differs. Build a nested
  // {post_type → format → VariantOption[]} map.
  const formats = listSupportedFormats();
  type VariantOption = {
    template_id: string;
    variant: string;
    display_name: string;
    description: string;
    photo_count: number;
  };
  const variantsByPostTypeAndFormat: Record<
    PostType,
    Record<PostFormat, VariantOption[]>
  > = {} as Record<PostType, Record<PostFormat, VariantOption[]>>;
  for (const pt of POST_TYPES) {
    const byFormat: Record<PostFormat, VariantOption[]> = {} as Record<
      PostFormat,
      VariantOption[]
    >;
    for (const fmt of formats) {
      byFormat[fmt] = listVariantsForPostType(pt, fmt);
    }
    variantsByPostTypeAndFormat[pt] = byFormat;
  }

  const formatMeta: Record<
    PostFormat,
    { display_name: string; description: string; aspect: string }
  > = {
    portrait_4x5: formatDisplayMeta("portrait_4x5"),
    story_9x16: formatDisplayMeta("story_9x16"),
  };

  // 2026-05-22 — Template Builder seam (Phase 1). Fetch DB-defined
  // templates per (post_type × format) alongside the legacy variant
  // fetch above. In Phase 1 this returns an empty array for every slot
  // (no DB templates have been authored yet), so picker behavior is
  // unchanged. Phase 2 lights up the picker UI to render these
  // alongside legacy variants once the visual editor + renderer ship.
  // See docs/adr/0001-template-builder.md.
  const dbTemplatesByPostTypeAndFormat: Record<
    PostType,
    Record<PostFormat, TemplateMeta[]>
  > = {} as Record<PostType, Record<PostFormat, TemplateMeta[]>>;
  for (const pt of POST_TYPES) {
    const byFormat: Record<PostFormat, TemplateMeta[]> = {} as Record<
      PostFormat,
      TemplateMeta[]
    >;
    for (const fmt of formats) {
      // why: caught at the registry level — if the lookup fails (DB
      // hiccup, no rows), we get an empty array, not an exception.
      byFormat[fmt] = await listTemplatesForPostType(pt, fmt);
    }
    dbTemplatesByPostTypeAndFormat[pt] = byFormat;
  }
  // Phase 1: pass-through is logged but not rendered. Phase 2 will wire
  // this into PostBuilderClient's variant card list.
  void dbTemplatesByPostTypeAndFormat;

  const totalEligible = POST_TYPES.reduce(
    (sum, t) => sum + listingsByPostType[t].length,
    0,
  );

  // why: optional initial-pick context — ?mls=X&postType=Y lets the
  // dashboard's "Build post" CTA deep-link straight to a pre-selected
  // listing. We validate server-side so the client only ever sees a
  // shape it can act on; if the listing isn't in the requested post_type
  // bucket (e.g., its status changed before Larissa clicked), we just
  // skip the pre-select and let the user pick manually.
  const mlsParam = asStringParam(sp.mls);
  const postTypeParam = asStringParam(sp.postType);
  const requestedPostType: PostType | null =
    postTypeParam && (POST_TYPES as string[]).includes(postTypeParam)
      ? (postTypeParam as PostType)
      : null;
  const initialPick: { postType: PostType; mls: string } | null =
    mlsParam && requestedPostType &&
    listingsByPostType[requestedPostType].some(
      (l) => l.mls_number === mlsParam,
    )
      ? { postType: requestedPostType, mls: mlsParam }
      : null;

  // why: pull the global publish_test_mode flag so PostBuilderClient can
  // seed new posts to the right default and render the inline banner.
  const systemConfig = await loadSystemConfig();

  return (
    <div>
      <PageHeader
        eyebrow={`${totalEligible} eligible listings · 36 templates · 3 formats`}
        title="Post Builder"
        description="Pick a post type, listing, format, and variant. Square for IG / FB feed, Portrait for IG feed preferred, Story 9:16 for IG/FB Stories — each format renders brand-perfect with the MLS hashtag baked in for auto-attribution."
        phaseTag="Phase 3"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Part 2 (Phase D, 2026-05-16) — Reel Studio is no longer
                accessed via this standalone header button. Reels are now
                offered as a follow-up to any Save Post via the "Make a
                Reel?" prompt, and from a "+ Reel" affordance inside
                Studio's header. The /post-builder/reel route still
                exists for deep-links and scheduled-task triggers, but it
                doesn't deserve a header-level entry point that competes
                with the canvas-Studio flow. */}
            {/* Phase D — Multi-property OH affordance moved from the page
                header into the Post Builder's "Pick a listing" column,
                where it only surfaces when the active post type is
                Open House. See PostBuilderClient.tsx. */}
            <Link
              href="/saved-posts"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
                <path d="M5.5 6.5h5M5.5 9h3" />
              </svg>
              Saved posts
            </Link>
          </div>
        }
      />
      <PostBuilderClient
        listingsByPostType={listingsByPostType}
        variantsByPostTypeAndFormat={variantsByPostTypeAndFormat}
        formatMeta={formatMeta}
        isAdmin={isAdmin}
        initialResume={resume}
        initialPick={initialPick}
        globalTestModeDefault={systemConfig.publish_test_mode}
        globalTestModeOn={systemConfig.publish_test_mode}
      />
    </div>
  );
}
