import { requireUser } from "@/lib/auth";
import { fetchListingsForPostBuilder } from "@/lib/post-builder/listings";
import {
  formatDisplayMeta,
  listSupportedFormats,
} from "@/lib/post-builder/format-meta";
import {
  getTemplateById,
  listTemplatesForPostType,
  type TemplateDefinition,
} from "@/lib/template-builder";
import type { TemplateMeta } from "@/lib/template-builder";
import { fetchCreatedPostResume } from "@/lib/data/created-posts-db";
import { loadSystemConfig } from "@/lib/data/system-config";
import Link from "next/link";
import { FileText } from "lucide-react";
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
 * Pick post type → pick a listing → pick a variant → render. Every post
 * is generated in both formats (Portrait 4:5 for feed, Story 9:16 for
 * Stories/Reels/TikTok) so Larissa never has to choose between them.
 * Five post types × six active variants × two formats = 60 templates
 * lit up via the registry.
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

  // Phase 2F (2026-05-22) — when the resuming row's slide_metadata
  // references admin-authored DB templates, batch-fetch them here so
  // Studio's "Edit slide" path can mount the correct schema instead of
  // falling back to a legacy registry lookup. Distinct ids only (a
  // Multi-OH event renders every slide with the SAME db_template_id by
  // design today, so this is usually 0-1 fetch).
  const dbTemplatesForSlides = await fetchDbTemplatesForSlides(resume);

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
      // 2026-05-30 — factory/V1 variants are gone; the legacy variant grid
      // is retired in favor of the unified "Choose a template" picker. Always
      // empty; kept as a slot so the prop shape PostBuilderClient expects
      // stays stable.
      byFormat[fmt] = [] as VariantOption[];
    }
    variantsByPostTypeAndFormat[pt] = byFormat;
  }

  const formatMeta: Record<
    PostFormat,
    { display_name: string; description: string; aspect: string }
  > = {
    square_1x1: formatDisplayMeta("square_1x1"),
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
  // Phase 2C (2026-05-22): the picker now surfaces DB templates alongside
  // legacy variants. The prop carries a `TemplateMeta[]` per (post_type,
  // format) bucket; PostBuilderClient renders them in the same grid as
  // legacy variant cards. See PostBuilderClient's "DB templates" branch.

  // 2026-05-30 — Generate ↔ Edit-in-Studio parity. The picker list above is
  // the slim TemplateMeta shape (no schema body), so when a DB template like
  // "Bold" produced the render, "Edit in Studio" had no schema to mount and
  // fell back to the in-code factory template (a DIFFERENT design). Pre-fetch
  // each surfaced DB template's FULL definition (schema included), keyed by id,
  // so the client can open the SAME template that generated the preview.
  // Mirrors the dbTemplatesForSlides pattern used by the resume path.
  const dbTemplateDefIds = new Set<string>();
  for (const pt of POST_TYPES) {
    for (const fmt of formats) {
      for (const meta of dbTemplatesByPostTypeAndFormat[pt][fmt]) {
        dbTemplateDefIds.add(meta.id);
      }
    }
  }
  const dbTemplateDefsById: Record<string, TemplateDefinition> = {};
  const dbTemplateDefs = await Promise.all(
    [...dbTemplateDefIds].map((id) => getTemplateById(id)),
  );
  for (const def of dbTemplateDefs) {
    if (def) dbTemplateDefsById[def.id] = def;
  }

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

  // 2026-05-28 — when the resume row is a multi-OH carousel, the dedicated
  // MultiOhFinalStage screen carries its own header chrome (title, subtitle,
  // hosts line). Suppress the generic Post Builder PageHeader + Saved-posts
  // link so the Final Stage page reads as a focused review surface rather
  // than a "Post Builder with extra stuff stapled on top." Mirrors the
  // client-side `isMultiOHPost` memo at PostBuilderClient.tsx ~line 1159.
  const isMultiOHResume =
    typeof resume?.template_id === "string" &&
    resume.template_id.startsWith("multi_oh_event_");

  return (
    <div>
      {!isMultiOHResume ? (
        <PageHeader
          eyebrow={`${totalEligible} eligible listings · 60 legacy templates · 2 formats`}
          title="Post Builder"
          description="Pick a post type, listing, and variant. Every post auto-renders in both formats — Square 1080 × 1080 for IG/FB feed, Story 9:16 for Stories/Reels/TikTok — with the MLS hashtag baked in for auto-attribution."
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
                className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-gold-300 hover:text-gold-800 hover:bg-gold-50/40 transition focus-ring"
              >
                <FileText size={14} aria-hidden="true" />
                Saved posts
              </Link>
            </div>
          }
        />
      ) : null}
      <PostBuilderClient
        listingsByPostType={listingsByPostType}
        variantsByPostTypeAndFormat={variantsByPostTypeAndFormat}
        dbTemplatesByPostTypeAndFormat={dbTemplatesByPostTypeAndFormat}
        dbTemplateDefsById={dbTemplateDefsById}
        dbTemplatesForSlides={dbTemplatesForSlides}
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

/**
 * Phase 2F — collect every distinct `db_template_id` referenced by the
 * resuming row's slide_metadata and batch-fetch the corresponding
 * `template_definitions` rows. Returns a map keyed by template id so
 * Studio's Edit-slide handler can resolve schemas in O(1).
 *
 * Returns an empty map when there's no resume context, the slide_metadata
 * is missing/malformed, or none of the slides carry a db_template_id (the
 * common case — legacy slides + Multi-OH events authored before Phase 2E
 * shipped). Bad ids that fail the DB lookup get silently dropped from the
 * map; the client-side handler falls back to findCanvasTemplate.
 */
async function fetchDbTemplatesForSlides(
  resume: Awaited<ReturnType<typeof fetchCreatedPostResume>> | null,
): Promise<Record<string, TemplateDefinition>> {
  if (!resume || !Array.isArray(resume.slide_metadata)) return {};
  const ids = new Set<string>();
  for (const raw of resume.slide_metadata) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.db_template_id === "string" && r.db_template_id.length > 0) {
      ids.add(r.db_template_id);
    }
  }
  if (ids.size === 0) return {};
  const idList = [...ids];
  const results = await Promise.all(idList.map((id) => getTemplateById(id)));
  const out: Record<string, TemplateDefinition> = {};
  results.forEach((tpl, i) => {
    if (tpl) out[idList[i]] = tpl;
  });
  return out;
}
