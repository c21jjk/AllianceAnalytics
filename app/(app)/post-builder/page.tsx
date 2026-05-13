import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import {
  formatDisplayMeta,
  listSupportedFormats,
  listVariantsForPostType,
} from "@/lib/post-builder/templates/registry";
import PageHeader from "@/components/PageHeader";
import PostBuilderClient from "./PostBuilderClient";
import type {
  PostBuilderListing,
  PostFormat,
  PostType,
} from "@/lib/post-builder/types";

export const metadata = { title: "Post Builder — Alliance Social" };
export const dynamic = "force-dynamic";

const POST_TYPES: PostType[] = ["just_listed", "just_sold", "under_contract", "open_house"];

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
export default async function PostBuilderPage() {
  await requireUser();

  const [justListed, justSold, underContract, openHouse] = await Promise.all([
    fetchListingsForPostBuilder({ post_type: "just_listed" }),
    fetchListingsForPostBuilder({ post_type: "just_sold" }),
    fetchListingsForPostBuilder({ post_type: "under_contract" }),
    fetchListingsForPostBuilder({ post_type: "open_house" }),
  ]);

  const listingsByPostType: Record<PostType, PostBuilderListing[]> = {
    just_listed: justListed,
    just_sold: justSold,
    under_contract: underContract,
    open_house: openHouse,
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
    square_1x1: formatDisplayMeta("square_1x1"),
    portrait_4x5: formatDisplayMeta("portrait_4x5"),
    story_9x16: formatDisplayMeta("story_9x16"),
  };

  const totalEligible = POST_TYPES.reduce(
    (sum, t) => sum + listingsByPostType[t].length,
    0,
  );

  return (
    <div>
      <PageHeader
        eyebrow={`${totalEligible} eligible listings · 36 templates · 3 formats`}
        title="Post Builder"
        description="Pick a post type, listing, format, and variant. Square for IG / FB feed, Portrait for IG feed preferred, Story 9:16 for IG/FB Stories — each format renders brand-perfect with the MLS hashtag baked in for auto-attribution."
        phaseTag="Phase 3"
      />
      <PostBuilderClient
        listingsByPostType={listingsByPostType}
        variantsByPostTypeAndFormat={variantsByPostTypeAndFormat}
        formatMeta={formatMeta}
      />
    </div>
  );
}
