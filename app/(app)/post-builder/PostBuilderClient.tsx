"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CaptionsByPlatform,
  PostBuilderListing,
  PostFormat,
  PostType,
  PostVariant,
  CaptionResponse,
  CaptionErrorResponse,
  RenderResponse,
  RenderErrorResponse,
  ScheduledFor,
  SchedulablePlatform,
  SlideMetadata,
} from "@/lib/post-builder/types";
import { OPTIMAL_POSTING_WINDOWS } from "@/lib/post-builder/types";
import {
  archiveBrandAssetAction,
  listCustomTemplatesAction,
  saveCustomTemplateAction,
  saveGeneratedPostAction,
  schedulePostAction,
  setPostTestModeAction,
  updateGeneratedPostImageAction,
  updateGeneratedPostSlideAction,
  updatePostCaptionsAction,
  uploadBrandAssetAction,
  upsertGeneratedPostFromStudioAction,
  type CustomTemplateSummary,
} from "./actions";

// === Canvas Editor (Path C) — Phase 1, Step 2 wiring ===
// why: opt-in "Edit in Studio" path that opens the new Fabric.js editor in an
// overlay. Lives BESIDE the V1 click→render flow above; V1 is untouched.
import CanvasEditorOverlay from "@/lib/post-builder/canvas-editor/CanvasEditorOverlay";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import { mapListingToPayload } from "@/lib/post-builder/canvas-editor/mapListingToPayload";
// === AI Magic Design (Phase C.1) ===
// why: ✨ button on every listing card → fires Magic Design action →
// surfaces recommendation modal → applies state + opens Studio. The modal
// is rendered conditionally at the bottom of the component when
// magicDesignListing is non-null; this keeps the Magic Design flow fully
// self-contained without touching the existing render pipeline.
import MagicDesignModal, {
  type MagicDesignAppliedPayload,
} from "./MagicDesignModal";
import type {
  CanvasExportResult,
  CanvasTemplateSchema,
  CarouselSlide,
  MLSListingPayload,
} from "@/lib/post-builder/canvas-editor/types";
import type { CreatedPostResumeRow } from "@/lib/data/created-posts-db";

interface VariantOption {
  template_id: string;
  variant: string;
  display_name: string;
  description: string;
  /** How many hero photos this variant uses. v1-v3=1, v4=2, v5=3. */
  photo_count: number;
}

interface FormatMeta {
  display_name: string;
  description: string;
  aspect: string;
}

interface Props {
  listingsByPostType: Record<PostType, PostBuilderListing[]>;
  variantsByPostTypeAndFormat: Record<PostType, Record<PostFormat, VariantOption[]>>;
  formatMeta: Record<PostFormat, FormatMeta>;
  isAdmin: boolean;
  /**
   * Optional resume-edit row pre-fetched server-side from /post-builder?gp=<id>.
   * When present, the client pre-selects post_type/variant/format/listing,
   * stashes the row id in `generatedPostId`, and opens Studio with the
   * saved layer_tree (falling back to the factory template if layer_tree
   * is null on an older row).
   */
  initialResume?: CreatedPostResumeRow | null;
  /**
   * Optional fresh-build context from /post-builder?mls=X&postType=Y.
   * Used by the dashboard's "Build post" CTA so Larissa lands directly on
   * the right post_type with the right listing already selected. Validated
   * server-side; if the listing isn't in the requested bucket the page
   * passes null and the client falls back to its normal localStorage
   * preferences.
   */
  initialPick?: { postType: PostType; mls: string } | null;
  /**
   * Global publish_test_mode flag from system_config — the DEFAULT for
   * newly-created posts. Existing rows carry their own `test_mode` value;
   * the per-row state seeds from `initialResume.test_mode` when resuming,
   * or from this default for new posts.
   */
  globalTestModeDefault?: boolean;
  /** True when the system_config global flag is currently `true`. UI shows
   *  the global banner inline on the page when true. Allows users to see
   *  the default mode without having to navigate to /settings. */
  globalTestModeOn?: boolean;
}

type PostPlatform = "facebook" | "instagram" | "tiktok";

interface PostNowResult {
  platform: PostPlatform;
  ok: boolean;
  platform_post_id?: string;
  permalink?: string | null;
  error?: string;
  scope_error?: boolean;
}

interface RenderResult {
  image_url: string;
  image_path: string;
  template_id: string;
  width: number;
  height: number;
  hero_image_source_url: string;
}

interface CaptionResult {
  /** Legacy single-caption field — mirrors `captions.instagram.caption`. */
  caption: string;
  /** Legacy hashtags — mirrors `captions.instagram.hashtags`. */
  hashtags: string[];
  mls_hashtag: string;
  /**
   * Phase D — per-platform variants. Present when the response includes
   * the captions map; absent on older code paths (Magic Design's manual
   * stub seeding) where we synthesize a single-platform set on read.
   */
  captions?: CaptionsByPlatform;
}

/**
 * Phase D — schedulable platforms list. Pinned here so the captions UI
 * iterates the same set the publisher does. Order matters: it drives the
 * tab order in the caption pane (IG first since it's still the dominant
 * platform for property posts).
 */
const CAPTION_PLATFORMS: readonly SchedulablePlatform[] = [
  "instagram",
  "facebook",
  "tiktok",
] as const;

const CAPTION_PLATFORM_LABELS: Record<SchedulablePlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

/**
 * Build a fresh empty per-platform caption map. Used as the initial state
 * for `editedCaptions` so every platform key always exists (TS narrows
 * `editedCaptions[platform]` to `string`, not `string | undefined`).
 */
function emptyCaptionsByPlatform(): Record<SchedulablePlatform, string> {
  return { instagram: "", facebook: "", tiktok: "" };
}

interface PhotoOption {
  url: string;
  sequence: number;
  source: "paragon" | "storage";
}

interface PhotosResponse {
  ok: boolean;
  photos?: PhotoOption[];
  error?: string;
}

const POST_TYPES: { id: PostType; label: string; helper: string }[] = [
  { id: "just_listed", label: "Just Listed", helper: "Active · recent" },
  { id: "just_sold", label: "Just Sold", helper: "Sold · recent" },
  { id: "under_contract", label: "Under Contract", helper: "Pending" },
  { id: "open_house", label: "Open House", helper: "Upcoming OH" },
  { id: "price_reduction", label: "Price Reduced", helper: "Active · pick" },
];

const FORMATS: PostFormat[] = ["square_1x1", "portrait_4x5", "story_9x16"];

const STORAGE_KEY_POST_TYPE = "post-builder.post_type";
const STORAGE_KEY_VARIANT = "post-builder.variant";
const STORAGE_KEY_FORMAT = "post-builder.format";

/**
 * Inline duplicate of the same helper in lib/post-builder/captions.ts.
 * why: this file is "use client", and captions.ts is server-only. We need a
 * canonical hashtag here to seed Magic Design's captionResult so the
 * auto-linker can tie the post back to the listing on publish — same
 * contract as the existing caption flow.
 */
function canonicalMlsHashtagForListing(
  listing: PostBuilderListing,
): string {
  const normalized = listing.mls_number.replace(/^#/, "").trim();
  if (listing.source_mls === "cmc") return `#CMC${normalized}`;
  if (listing.source_mls === "sjsr") return `#SJSR${normalized}`;
  if (listing.source_mls === "bright" || /^NJ[A-Z]{2}\d+$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return `#${normalized}`;
}

export default function PostBuilderClient({
  listingsByPostType,
  variantsByPostTypeAndFormat,
  formatMeta,
  isAdmin,
  initialResume,
  initialPick,
  globalTestModeDefault = true,
  globalTestModeOn = false,
}: Props) {
  const [postType, setPostType] = useState<PostType>("just_listed");
  const [format, setFormat] = useState<PostFormat>("square_1x1");
  const [variantId, setVariantId] = useState<PostVariant>("v1");
  const [search, setSearch] = useState("");
  const [selectedMls, setSelectedMls] = useState<string | null>(null);
  // Phase 5A — Post Now state
  const [generatedPostId, setGeneratedPostId] = useState<string | null>(null);
  const [postNowOpen, setPostNowOpen] = useState(false);
  // 2026-05-16 — per-post test_mode state. Seeded from initialResume on
  // resume; otherwise from the global default. Persisted via
  // setPostTestModeAction the moment the user flips the toggle in
  // PostNowModal — the publish route reads row.test_mode at publish time.
  const [currentTestMode, setCurrentTestMode] = useState<boolean>(
    initialResume?.test_mode ?? globalTestModeDefault,
  );
  const [testModeSaving, setTestModeSaving] = useState(false);

  // why: server-action handler for the Test/Live toggle in PostNowModal.
  // Optimistically flips local state, then persists to the DB. Reverts on
  // failure so the UI never lies about what the publisher will see at fire
  // time. Only persists when a generated_post_id exists — pre-save flips
  // are kept local and apply when the row is created.
  const handleSetTestMode = useCallback(
    async (nextValue: boolean) => {
      setCurrentTestMode(nextValue);
      if (!generatedPostId) return; // no row yet — local-only flip
      setTestModeSaving(true);
      try {
        const res = await setPostTestModeAction({
          generated_post_id: generatedPostId,
          test_mode: nextValue,
        });
        if (!res.ok) {
          console.error("[set test_mode] failed:", res.error);
          // Revert on failure so the UI matches the DB.
          setCurrentTestMode(!nextValue);
        }
      } catch (e) {
        console.error("[set test_mode] threw:", e);
        setCurrentTestMode(!nextValue);
      } finally {
        setTestModeSaving(false);
      }
    },
    [generatedPostId],
  );
  // Path A Customize state was removed on 2026-05-14 — replaced by the Path C
  // canvas editor ("Edit in Studio"). The render pipeline still accepts an
  // optional customizations payload for backward compat; we just never send one.
  const [postNowPlatforms, setPostNowPlatforms] = useState<Set<PostPlatform>>(
    new Set(["facebook", "instagram"]),
  );
  const [postNowArmedAt, setPostNowArmedAt] = useState<number | null>(null);
  const [postNowSending, setPostNowSending] = useState(false);
  const [postNowResults, setPostNowResults] = useState<PostNowResult[] | null>(null);
  // Photo picker state
  const [availablePhotos, setAvailablePhotos] = useState<PhotoOption[]>([]);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number>(0);
  const [photosLoading, setPhotosLoading] = useState(false);
  // === Canvas Editor (Path C) — overlay open + cached hydrated context ===
  // why: studioContext is set at open-time so the overlay receives stable
  // template + listing references rather than re-deriving them on every render
  // (each re-derivation would force the editor to re-init the Fabric canvas).
  const [studioOpen, setStudioOpen] = useState<boolean>(false);
  const [studioContext, setStudioContext] = useState<{
    template: CanvasTemplateSchema;
    listing: MLSListingPayload;
    /**
     * When the canvas was hydrated from a custom template row, this
     * carries the row's id + metadata so the SaveAsTemplate modal can
     * default into UPDATE mode (keeping changes on the same row instead
     * of inserting a sibling each save).
     */
    customTemplate?: {
      id: string;
      name: string;
      isDefault: boolean;
      fabricJson: unknown;
    };
  } | null>(null);

  // === Custom Templates (2026-05-17) ===
  // why: user-authored canvas templates live in `custom_templates` and merge
  // into the variant grid below. We fetch the list for the CURRENT
  // (postType, format) tuple whenever either changes — the variant grid
  // re-renders once the data arrives. Default custom templates REPLACE
  // factory cards (matched by based_on_variant); non-default rows append
  // as additional cards after the 6 factory variants.
  const [customTemplates, setCustomTemplates] = useState<CustomTemplateSummary[]>(
    [],
  );
  const [customTemplatesLoading, setCustomTemplatesLoading] =
    useState<boolean>(false);

  /** Manual refetch trigger — called from the SaveAsTemplate onSaved callback. */
  const refetchCustomTemplates = useCallback(async (): Promise<void> => {
    setCustomTemplatesLoading(true);
    try {
      const res = await listCustomTemplatesAction(postType, format);
      if (res.ok) {
        setCustomTemplates(res.templates);
      } else {
        // why: don't surface as a top-level error — custom templates are an
        // additive feature; the variant grid still renders factory cards
        // when the fetch fails. Console-warn for diagnostics.
        console.warn("[customTemplates] fetch failed:", res.error);
        setCustomTemplates([]);
      }
    } finally {
      setCustomTemplatesLoading(false);
    }
  }, [postType, format]);

  useEffect(() => {
    void refetchCustomTemplates();
  }, [refetchCustomTemplates]);

  // Part 2 (Phase D) — Make-a-Reel follow-up prompt state. Populated by a
  // successful Studio save; when non-null, surfaces a modal asking the user
  // whether they want to also create a Reel version of the post they just
  // saved. The mls field deep-links into /post-builder/reel; gpId is kept
  // for future "open the saved post's Reel sibling" wiring (Phase D+).
  const [makeReelPromptState, setMakeReelPromptState] = useState<{
    mls: string;
    gpId: string | null;
  } | null>(null);

  // Next.js router — used by the Make-a-Reel and "+ Reel" entry points to
  // navigate from Post Builder → Reel Studio without a full page reload.
  const router = useRouter();
  // Phase 5 — carousel slides (slide 0 is the hero render; these are 1..N
  // supporting photos that will publish alongside it as an IG/FB carousel).
  // Lives at PostBuilder level — not inside the editor — because the slides
  // belong to the POST, not the design. Template swaps + resizes inside
  // Studio keep the slides intact (same listing, same supporting photos
  // still apply). Switching to a different listing OR a different post-type
  // clears them via the matching reset paths below.
  const [carouselSlides, setCarouselSlides] = useState<readonly CarouselSlide[]>(
    [],
  );
  // Phase 5 — per-slide source metadata (Multi-OH posts only).
  // Parallel array to carouselSlides — index N here matches slide N in the
  // carousel strip. Populated from initialResume.slide_metadata on a resume
  // load. Drives the Edit-slide-in-Studio flow: when the user clicks Edit
  // on a thumbnail, we look up that index here to know the source listing,
  // variant, format, and prior layer_tree (if any).
  //
  // Stays in sync with carouselSlides — both are seeded from initialResume,
  // and any subsequent save via updateGeneratedPostSlideAction patches BOTH
  // arrays at the same index.
  const [slideMetadata, setSlideMetadata] = useState<readonly SlideMetadata[]>(
    [],
  );
  // When set, the next Studio save updates that slide's image + layer_tree
  // (via updateGeneratedPostSlideAction) instead of the hero (via
  // upsertGeneratedPostFromStudioAction). Reset to null on every Studio
  // close so the next "Edit in Studio" click on the hero card lands on
  // the hero path again.
  const [editingSlideIndex, setEditingSlideIndex] = useState<number | null>(
    null,
  );
  // === AI Magic Design (Phase C.1) ===
  // why: when non-null, the MagicDesignModal mounts at the bottom of the
  // tree and fires the action against this listing. Photos for the listing
  // are loaded on-demand inside the modal flow by REUSING the same
  // /api/post-builder/photos endpoint the main picker uses — see the
  // useEffect below that hydrates `magicDesignPhotos` when the listing
  // changes. This keeps Magic Design independent from `selectedListing` so
  // Larissa can ✨ a listing she hasn't clicked into yet.
  const [magicDesignListing, setMagicDesignListing] =
    useState<PostBuilderListing | null>(null);
  const [magicDesignPhotos, setMagicDesignPhotos] = useState<string[]>([]);
  const [magicDesignPhotosLoading, setMagicDesignPhotosLoading] = useState(false);
  // Render + caption state
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [captionResult, setCaptionResult] = useState<CaptionResult | null>(null);
  // Phase D — per-platform caption editor state. Each value is the user's
  // edited "caption\n\nhashtags" string for that platform. Always carries
  // all three keys; pre-Generate they're empty strings. The active tab
  // (`activeCaptionPlatform`) drives which value the textarea shows.
  const [editedCaptions, setEditedCaptions] = useState<
    Record<SchedulablePlatform, string>
  >(emptyCaptionsByPlatform);
  const [activeCaptionPlatform, setActiveCaptionPlatform] =
    useState<SchedulablePlatform>("instagram");
  // why: derived view of the active platform's text. Single read site so a
  // future refactor (per-tab textareas instead of one + state swap) only
  // touches this line.
  const editedCaption = editedCaptions[activeCaptionPlatform];
  // why: legacy single-string setter, retained for paths that don't know
  // about platforms (Magic Design seed, clear-on-listing-change). Writes
  // to ALL three platform tabs so they stay in sync with the legacy
  // caption value. Per-tab edits use the inline setEditedCaptions call.
  const setEditedCaption = useCallback((next: string): void => {
    setEditedCaptions({
      instagram: next,
      facebook: next,
      tiktok: next,
    });
  }, []);
  const [generating, setGenerating] = useState(false);
  const [regeneratingCaption, setRegeneratingCaption] = useState(false);
  const [downloadSaving, setDownloadSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  // Restore last-used preferences on mount.
  // why: priority order is resume → fresh-build pick → localStorage. Both
  // resume and fresh-build pick are explicit user intents (clicked a saved
  // post / clicked "Build post" on the dashboard), so they win over the
  // last-used localStorage state. Resume wins over fresh-build pick because
  // resume carries more state (template, layer_tree, generated_post id).
  useEffect(() => {
    if (initialResume) {
      setPostType(initialResume.post_type);
      setFormat(initialResume.format);
      setVariantId(initialResume.variant);
      setSelectedMls(initialResume.mls_number);
      setGeneratedPostId(initialResume.id);
      // Phase 5 — rehydrate carousel slides from the saved row. The DB
      // column is jsonb, typed as `unknown | null` in the resume row to
      // keep the data layer lean; we narrow defensively here.
      if (Array.isArray(initialResume.additional_images)) {
        const parsed: CarouselSlide[] = [];
        for (const raw of initialResume.additional_images) {
          if (
            raw &&
            typeof raw === "object" &&
            typeof (raw as { url?: unknown }).url === "string" &&
            (raw as { url: string }).url.length > 0
          ) {
            const r = raw as Partial<CarouselSlide>;
            parsed.push({
              id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
              url: r.url as string,
              source: r.source === "upload" ? "upload" : "listing",
              listingPhotoSequence:
                typeof r.listingPhotoSequence === "number"
                  ? r.listingPhotoSequence
                  : undefined,
            });
          }
        }
        setCarouselSlides(parsed);
      } else {
        setCarouselSlides([]);
      }
      // why: rehydrate the parallel slide_metadata array. Each entry maps
      // 1:1 to a carousel slide. Narrow defensively — older rows (pre-
      // 2026-05-16 migration) won't carry this column at all, so we
      // tolerate null / non-array / sparse shapes and default to empty.
      if (Array.isArray(initialResume.slide_metadata)) {
        const parsedMeta: SlideMetadata[] = [];
        for (const raw of initialResume.slide_metadata) {
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            const r = raw as Record<string, unknown>;
            // why: accept every variant the SlideMetadata type permits.
            // Includes "v1" defensively for legacy rows persisted before
            // 2026-05-21 (when the multi-OH route hardcoded v1). New
            // writes use only the active set (v2/v3/v6/v8). Unknown
            // values fall through to the resume row's own variant rather
            // than blindly stamping v1.
            const validVariant =
              r.variant === "v1" ||
              r.variant === "v2" ||
              r.variant === "v3" ||
              r.variant === "v6" ||
              r.variant === "v8";
            const variant = validVariant
              ? (r.variant as SlideMetadata["variant"])
              : (initialResume.variant as SlideMetadata["variant"]);
            const format =
              r.format === "square_1x1" ||
              r.format === "portrait_4x5" ||
              r.format === "story_9x16"
                ? r.format
                : initialResume.format;
            parsedMeta.push({
              listing_mls:
                typeof r.listing_mls === "string"
                  ? r.listing_mls
                  : initialResume.mls_number,
              variant,
              format,
              hosting_agent_name:
                typeof r.hosting_agent_name === "string"
                  ? r.hosting_agent_name
                  : null,
              layer_tree: r.layer_tree ?? null,
            });
          } else {
            // why: pad with a sensible default so indexes still line up
            // with carouselSlides even if one metadata entry is malformed.
            // Defaults follow the resume row's own variant/format so the
            // entry is at least template-resolvable instead of stamping
            // v1 (retired) like the prior version did.
            parsedMeta.push({
              listing_mls: initialResume.mls_number,
              variant: initialResume.variant as SlideMetadata["variant"],
              format: initialResume.format,
              hosting_agent_name: null,
              layer_tree: null,
            });
          }
        }
        setSlideMetadata(parsedMeta);
      } else {
        setSlideMetadata([]);
      }
      // why: also pre-fill renderResult so the preview pane shows the
      // saved image as soon as Studio closes — the user sees the same
      // thing they clicked in the strip, no "regenerate to see it" beat.
      if (initialResume.image_url && initialResume.image_path) {
        setRenderResult({
          image_url: initialResume.image_url,
          image_path: initialResume.image_path,
          template_id: initialResume.template_id,
          width: 0,
          height: 0,
          hero_image_source_url: initialResume.hero_image_source_url ?? "",
        });
      }
      // Phase D — rehydrate the three caption tabs. Prefer the per-
      // platform variants when present (rows saved post-migration);
      // otherwise mirror the legacy single caption across all three
      // tabs so the user can still edit + the publish flow has data.
      hydrateCaptionsFromResume(
        initialResume,
        setCaptionResult,
        setEditedCaptions,
      );
      return;
    }
    if (initialPick) {
      // why: fresh-build deep link from the dashboard. Set the post_type and
      // pre-select the listing — and early-return so the localStorage block
      // below DOESN'T overwrite the post_type with the last-used value.
      // Format + variant still come from localStorage inside this branch so
      // the user's preferred output dimensions stay sticky across sessions.
      setPostType(initialPick.postType);
      setSelectedMls(initialPick.mls);
      const savedFmtPick = localStorage.getItem(STORAGE_KEY_FORMAT) as PostFormat | null;
      if (savedFmtPick && FORMATS.includes(savedFmtPick)) {
        setFormat(savedFmtPick);
      }
      const savedVPick = localStorage.getItem(STORAGE_KEY_VARIANT) as PostVariant | null;
      if (savedVPick && (savedVPick === "v1" || savedVPick === "v2" || savedVPick === "v3")) {
        setVariantId(savedVPick);
      }
      return;
    }
    const savedPT = localStorage.getItem(STORAGE_KEY_POST_TYPE) as PostType | null;
    if (savedPT && POST_TYPES.some((p) => p.id === savedPT)) {
      setPostType(savedPT);
    }
    const savedFmt = localStorage.getItem(STORAGE_KEY_FORMAT) as PostFormat | null;
    if (savedFmt && FORMATS.includes(savedFmt)) {
      setFormat(savedFmt);
    }
    const savedV = localStorage.getItem(STORAGE_KEY_VARIANT) as PostVariant | null;
    if (savedV && (savedV === "v1" || savedV === "v2" || savedV === "v3")) {
      setVariantId(savedV);
    }
  }, [initialResume, initialPick]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_POST_TYPE, postType);
  }, [postType]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_FORMAT, format);
  }, [format]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_VARIANT, variantId);
  }, [variantId]);

  const listings = listingsByPostType[postType] ?? [];
  const variants = variantsByPostTypeAndFormat[postType]?.[format] ?? [];

  /**
   * Merge factory variants with custom templates for the variant grid.
   *
   * Rules:
   *   1. For each factory variant card, if there's a custom template with
   *      `is_default = true` AND `based_on_variant === variant`, REPLACE
   *      the factory card with a custom card carrying the same variant
   *      key (so the selection model and "active" state still work).
   *   2. Append every non-default custom template AFTER the factory cards
   *      as standalone cards. Their variant key is suffixed with the row
   *      id so each appears as a distinct slot in the grid.
   *
   * The card shape adds a `customTemplate` discriminator: when present, the
   * card renders the preview_image_url as its thumbnail and carries the
   * fabric_json + id needed to open the custom template in Studio. Factory
   * cards have `customTemplate: null` and behave exactly as before.
   */
  type MergedVariantCard = VariantOption & {
    /** Per-card display name (custom card overrides the factory's). */
    card_display_name: string;
    /** Per-card description (custom card uses a "Custom template" marker). */
    card_description: string;
    /** When non-null, the card was sourced from a custom_templates row. */
    customTemplate: {
      id: string;
      name: string;
      fabricJson: unknown;
      previewImageUrl: string | null;
      isDefault: boolean;
    } | null;
  };

  const mergedVariantCards = useMemo<MergedVariantCard[]>(() => {
    const defaultsByVariant = new Map<string, CustomTemplateSummary>();
    const nonDefaults: CustomTemplateSummary[] = [];
    for (const ct of customTemplates) {
      if (ct.is_default) {
        // why: partial unique index ensures at most one default per slot,
        // but we coalesce defensively on the client too — first wins if
        // the DB ever ships two. Stable order matches the action's sort.
        if (!defaultsByVariant.has(ct.based_on_variant)) {
          defaultsByVariant.set(ct.based_on_variant, ct);
        }
      } else {
        nonDefaults.push(ct);
      }
    }

    const result: MergedVariantCard[] = [];
    for (const v of variants) {
      const override = defaultsByVariant.get(v.variant);
      if (override) {
        result.push({
          ...v,
          card_display_name: override.name,
          card_description: `Custom template · based on ${v.display_name}`,
          customTemplate: {
            id: override.id,
            name: override.name,
            fabricJson: override.fabric_json,
            previewImageUrl: override.preview_image_url,
            isDefault: true,
          },
        });
      } else {
        result.push({
          ...v,
          card_display_name: v.display_name,
          card_description: v.description,
          customTemplate: null,
        });
      }
    }
    // Append non-default custom templates as extra cards.
    for (const ct of nonDefaults) {
      // why: re-use the factory variant's photo_count when known so the
      // disable-on-insufficient-photos path stays consistent. Fall back to
      // 1 when no matching factory variant exists (shouldn't happen with
      // the v2/v3/v6/v8/v9/v10 allowlist, but defensive).
      const baseFactory = variants.find((v) => v.variant === ct.based_on_variant);
      result.push({
        template_id: `custom_${ct.id}`,
        variant: ct.based_on_variant,
        display_name: ct.name,
        description: `Custom template · based on ${baseFactory?.display_name ?? ct.based_on_variant}`,
        photo_count: baseFactory?.photo_count ?? 1,
        card_display_name: ct.name,
        card_description: `Custom template · based on ${baseFactory?.display_name ?? ct.based_on_variant}`,
        customTemplate: {
          id: ct.id,
          name: ct.name,
          fabricJson: ct.fabric_json,
          previewImageUrl: ct.preview_image_url,
          isDefault: false,
        },
      });
    }
    return result;
  }, [variants, customTemplates]);

  const currentVariant = useMemo(
    () => variants.find((v) => v.variant === variantId) ?? null,
    [variants, variantId],
  );

  // How many photo slots the current variant takes.
  const photoCount = currentVariant?.photo_count ?? 1;

  const templateId = useMemo(() => {
    return currentVariant?.template_id ?? `${postType}_${formatShortName(format)}_${variantId}`;
  }, [currentVariant, postType, format, variantId]);

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((l) => {
      const hay = [
        l.mls_number,
        l.address,
        l.city,
        l.state,
        l.zip,
        l.agent_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [listings, search]);

  const selectedListing = useMemo(
    () => listings.find((l) => l.mls_number === selectedMls) ?? null,
    [listings, selectedMls],
  );

  // === Canvas Editor (Path C) — template lookup + open/save/close handlers ===
  // why: lookup is by (postType, variantId, format) tuple — if no canvas-editor
  // template exists for the current selection, `studioTemplate` is null and the
  // "Edit in Studio" button is disabled. As of 2026-05-15, canvas-editor ships
  // v1 Hero Editorial, v2 Bold Stats, and v3 Side-by-Side across all 5 post
  // types × 3 formats (45 templates total). v6 Magazine Cover, v7 Polaroid,
  // and v8 Minimal Frame variant cards still return null and hide the button
  // until those factories are ported from the V1 HTML primitives.
  const studioTemplate = useMemo<CanvasTemplateSchema | null>(
    () => findCanvasTemplate(postType, variantId, format),
    [postType, variantId, format],
  );

  /**
   * Multi-property Open House mode.
   *
   * Set when a `?gp=<id>` resume loads a row whose template_id begins
   * with `multi_oh_event_` (the synthetic prefix the wizard's render
   * route stamps on the row). When true, the listing-picker column +
   * format-picker + variant-picker are hidden — those choices were
   * already made in the multi-OH wizard and can't be changed here
   * without re-rendering the entire carousel through the wizard's
   * pipeline. The preview pane, caption tabs, slide ribbon, Edit in
   * Studio, Download, and Post Now stay visible.
   *
   * 2026-05-21 — added to fix the duplicated picker UX after a multi-OH
   * carousel generates. The same row keys off `template_id` rather than
   * `slideMetadata.length > 0` because the latter is briefly empty
   * during the resume effect's hydration race.
   */
  const isMultiOHPost = useMemo<boolean>(
    () =>
      typeof renderResult?.template_id === "string" &&
      renderResult.template_id.startsWith("multi_oh_event_"),
    [renderResult?.template_id],
  );

  const openStudio = useCallback((): void => {
    // why: bail if either listing or template is missing — the button SHOULD
    // already be disabled in that case, but defending against a race where the
    // user changes selection mid-click avoids opening the overlay with stale
    // null inputs.
    if (!selectedListing || !studioTemplate) return;
    const payload = mapListingToPayload(selectedListing, {
      photos: availablePhotos.map((p) => p.url),
      // why: V1's listing carries listing_office_name on the row, but agent
      // fields are sparse. Pass what we have; the editor renders empty for
      // missing agent fields rather than erroring.
      agentName: selectedListing.agent_name ?? null,
      officeName: selectedListing.listing_office_name ?? null,
    });
    // why: when a custom default exists for the active variant slot, hydrate
    // Studio from its Fabric JSON instead of the factory schema. The
    // factory `studioTemplate` is still passed so dimensions + format
    // remain stable — only the layer content is overridden.
    const customDefault = customTemplates.find(
      (ct) =>
        ct.is_default &&
        ct.based_on_variant === variantId &&
        ct.post_type === postType &&
        ct.format === format,
    );
    if (customDefault) {
      setStudioContext({
        template: studioTemplate,
        listing: payload,
        customTemplate: {
          id: customDefault.id,
          name: customDefault.name,
          isDefault: true,
          fabricJson: customDefault.fabric_json,
        },
      });
    } else {
      setStudioContext({ template: studioTemplate, listing: payload });
    }
    setStudioOpen(true);
  }, [
    selectedListing,
    studioTemplate,
    availablePhotos,
    customTemplates,
    variantId,
    postType,
    format,
  ]);

  /**
   * Phase A.1 — Click-to-Studio variant launcher.
   *
   * Before: clicking a variant card only ACTIVATED that variant. Opening
   * Studio required a separate click on "Edit in Studio" under the active
   * card, and that button was hidden on every other card. So switching
   * variants was a two-step dance (click card → click button → repeat),
   * and the standalone button only ever showed on the first-row variant
   * the user happened to land on.
   *
   * After: every variant card whose canvas template exists is itself a
   * Studio launcher. Click any card → variant activates AND Studio opens.
   * One motion. Matches Canva's "every template tile is a launcher" model.
   *
   * Why a separate handler from `openStudio()`:
   *   - `openStudio()` reads from `studioTemplate` (the memo on the CURRENT
   *     variantId). Calling `setVariantId(next); openStudio()` in the same
   *     tick uses the STALE studioTemplate because state updates batch.
   *   - This handler resolves the template DIRECTLY for the clicked
   *     variant via findCanvasTemplate, sidestepping the race.
   *   - The downside is one extra registry lookup per click. Cheap.
   */
  const openStudioForVariant = useCallback(
    (nextVariant: PostVariant): void => {
      if (!selectedListing) return;
      const tpl = findCanvasTemplate(postType, nextVariant, format);
      if (!tpl) {
        // Card was clickable in the UI but no template exists for the tuple
        // — should be impossible (the disabled gate hides such cards), but
        // surface a clear error rather than silently doing nothing.
        setError(
          `No Studio template for ${postType} / ${nextVariant} / ${format}. Try a different variant.`,
        );
        return;
      }
      // Activate the variant in parallel with opening Studio so the chip
      // strip + photo-count badges reflect the user's pick when Studio
      // closes.
      setVariantId(nextVariant);
      setRenderResult(null);
      setError(null);
      const payload = mapListingToPayload(selectedListing, {
        photos: availablePhotos.map((p) => p.url),
        agentName: selectedListing.agent_name ?? null,
        officeName: selectedListing.listing_office_name ?? null,
      });
      // why: if a user marked a custom template as the default for this
      // slot, opening that factory variant should hydrate Studio from the
      // CUSTOM Fabric JSON instead of the factory schema. Mirrors the
      // variant-grid replacement logic — the default custom template is
      // the user's authoritative starting point for this slot.
      const customDefault = customTemplates.find(
        (ct) =>
          ct.is_default &&
          ct.based_on_variant === nextVariant &&
          ct.post_type === postType &&
          ct.format === format,
      );
      if (customDefault) {
        setStudioContext({
          template: tpl,
          listing: payload,
          customTemplate: {
            id: customDefault.id,
            name: customDefault.name,
            isDefault: true,
            fabricJson: customDefault.fabric_json,
          },
        });
      } else {
        setStudioContext({ template: tpl, listing: payload });
      }
      setStudioOpen(true);
    },
    [selectedListing, postType, format, availablePhotos, customTemplates],
  );

  /**
   * 2026-05-17 — Custom Templates entry point. The variant grid renders
   * custom-template cards either by REPLACING the factory card (when
   * is_default=true) or APPENDING after the factory variants. Both routes
   * land here.
   *
   * The editor still needs a CanvasTemplateSchema to bootstrap (it sets up
   * dimensions, format, the carousel strip, etc.) — we use the factory
   * baseline for `based_on_variant` as the scaffold, then ride the
   * `customTemplate` prop to make the editor load `customTemplate.fabricJson`
   * via `canvas.loadFromJSON()` instead of the schema-driven hydration. The
   * MLS-data re-bind happens on top of that load via the `boundField` data
   * Fabric preserves through toJSON/loadFromJSON.
   */
  const openStudioForCustomTemplate = useCallback(
    (customTpl: {
      id: string;
      name: string;
      fabricJson: unknown;
      isDefault: boolean;
      basedOnVariant: PostVariant;
    }): void => {
      if (!selectedListing) return;
      const baseTpl = findCanvasTemplate(
        postType,
        customTpl.basedOnVariant,
        format,
      );
      if (!baseTpl) {
        setError(
          `Custom template references missing factory variant ${customTpl.basedOnVariant} for ${postType} / ${format}.`,
        );
        return;
      }
      setVariantId(customTpl.basedOnVariant);
      setRenderResult(null);
      setError(null);
      const payload = mapListingToPayload(selectedListing, {
        photos: availablePhotos.map((p) => p.url),
        agentName: selectedListing.agent_name ?? null,
        officeName: selectedListing.listing_office_name ?? null,
      });
      setStudioContext({
        template: baseTpl,
        listing: payload,
        customTemplate: {
          id: customTpl.id,
          name: customTpl.name,
          isDefault: customTpl.isDefault,
          fabricJson: customTpl.fabricJson,
        },
      });
      setStudioOpen(true);
    },
    [selectedListing, postType, format, availablePhotos],
  );

  const handleStudioSave = useCallback(
    async (result: CanvasExportResult): Promise<void> => {
      // why: every Studio save now produces exactly ONE persistent
      // generated_posts row. First save in a session INSERTs (status='draft'),
      // every subsequent save in the same session UPDATEs the same row and
      // deletes the prior Storage image so we don't accumulate orphans.
      // The id is stashed in `generatedPostId` so the Post Now flow can
      // pick up the same row and flip it to status='posted' later.
      if (!selectedListing) {
        setError("Can't save — no listing selected.");
        return;
      }

      setError(null);

      // ===== Per-slide edit branch (Multi-OH) =====
      // why: when editingSlideIndex is set, the user is editing slide N of
      // a multi-OH carousel — NOT the hero. Save flow differs:
      //   1. Same canvas-save upload (one PNG to Storage).
      //   2. Different action: updateGeneratedPostSlideAction patches
      //      additional_images[N] + slide_metadata[N].layer_tree, leaving
      //      the hero (image_url / layer_tree) untouched.
      //   3. Update LOCAL carouselSlides + slideMetadata so the strip
      //      reflects the new image immediately (no re-fetch round-trip).
      //   4. Close the overlay.
      if (editingSlideIndex !== null) {
        if (!generatedPostId) {
          setError(
            "Can't save slide — no generated_posts row to update. Open the multi-OH post first.",
          );
          return;
        }
        try {
          // Upload the edited slide PNG.
          const form = new FormData();
          form.append("file", result.file);
          form.append("template_id", result.schema.id);
          form.append("mls_number", selectedListing.mls_number);
          const uploadRes = await fetch("/api/post-builder/canvas-save", {
            method: "POST",
            body: form,
          });
          const rawText = await uploadRes.text();
          type SaveResponse =
            | { ok: true; image_url: string; image_path: string; saved_at: string }
            | { ok: false; error: string };
          let parsed: SaveResponse | null = null;
          try {
            parsed = JSON.parse(rawText) as SaveResponse;
          } catch {
            parsed = null;
          }
          if (!parsed) {
            const snippet =
              rawText.replace(/\s+/g, " ").trim().slice(0, 140) ||
              "empty response";
            setError(
              `Slide save failed (HTTP ${uploadRes.status}): ${snippet}`,
            );
            return;
          }
          if (!uploadRes.ok || !parsed.ok) {
            const errMsg =
              !parsed.ok ? parsed.error : `HTTP ${uploadRes.status}`;
            setError(`Slide save failed: ${errMsg}`);
            return;
          }
          const uploadJson = parsed;

          // Patch the slide row server-side.
          const updRes = await updateGeneratedPostSlideAction({
            generated_post_id: generatedPostId,
            slide_index: editingSlideIndex,
            new_image_url: uploadJson.image_url,
            new_image_path: uploadJson.image_path,
            new_layer_tree: result.schema as unknown as Parameters<
              typeof updateGeneratedPostSlideAction
            >[0]["new_layer_tree"],
          });
          if (!updRes.ok) {
            setError(`Slide row update failed: ${updRes.error}`);
            return;
          }

          // why: patch local state so the carousel strip immediately
          // reflects the new image (the next render of the strip reads
          // from this array). Same parallel-index contract as the DB.
          setCarouselSlides((prev) => {
            const next = prev.slice();
            const prior = next[editingSlideIndex];
            if (!prior) return prev;
            next[editingSlideIndex] = {
              ...prior,
              url: uploadJson.image_url,
            };
            return next;
          });
          setSlideMetadata((prev) => {
            const next = prev.slice();
            const prior = next[editingSlideIndex];
            if (prior) {
              next[editingSlideIndex] = {
                ...prior,
                layer_tree: result.schema as unknown,
              };
            }
            return next;
          });

          // Close the overlay — the slide edit is done.
          setStudioOpen(false);
          setEditingSlideIndex(null);
        } catch (e) {
          setError(
            `Slide save threw: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return;
      }

      try {
        // ---- 1. Upload edited image (JPEG q92 from Studio) ----
        const form = new FormData();
        form.append("file", result.file);
        form.append("template_id", result.schema.id);
        form.append("mls_number", selectedListing.mls_number);
        const uploadRes = await fetch("/api/post-builder/canvas-save", {
          method: "POST",
          body: form,
        });

        // why: the response is normally JSON, but Vercel / Next.js can
        // return an HTML page when the request hits an edge-level limit
        // (body too large, function timeout, auth redirect, etc.). Read as
        // text first, then try to JSON-parse — if that fails, surface the
        // truncated HTML as a friendly error rather than letting JSON.parse
        // throw "Unexpected token <" at the user.
        const rawText = await uploadRes.text();
        type SaveResponse =
          | { ok: true; image_url: string; image_path: string; saved_at: string }
          | { ok: false; error: string };
        let parsed: SaveResponse | null = null;
        try {
          parsed = JSON.parse(rawText) as SaveResponse;
        } catch {
          parsed = null;
        }
        if (!parsed) {
          // why: trim to ~140 chars so we don't dump an entire HTML page
          // into the toast. Common case: "Request Entity Too Large" — we
          // surface that so the user knows to use the Download button or
          // contact us to bump the limit.
          const snippet =
            rawText.replace(/\s+/g, " ").trim().slice(0, 140) || "empty response";
          setError(
            `Studio save failed (HTTP ${uploadRes.status}): ${snippet}`,
          );
          return;
        }
        if (!uploadRes.ok || !parsed.ok) {
          const errMsg =
            !parsed.ok ? parsed.error : `HTTP ${uploadRes.status}`;
          setError(`Studio save failed: ${errMsg}`);
          return;
        }
        const uploadJson = parsed;

        // ---- 2. Upsert the generated_posts row ----
        // why: single canonical path now — UPDATE if we already have an id
        // for this Studio session, INSERT otherwise. On UPDATE the server
        // also deletes the prior image_path from Storage (Option B cleanup).
        //
        // Phase 4 note: post_type / variant / format come from result.schema
        // (not from parent state). When the user swaps templates inside
        // Studio, parent state DOES track via onTemplateSwitched, but
        // reading from the schema is defense-in-depth: it guarantees the
        // saved row's metadata never disagrees with the template_id, even
        // if some future consumer wires the editor without that callback.
        const upsertRes = await upsertGeneratedPostFromStudioAction({
          id: generatedPostId,
          mls_number: selectedListing.mls_number,
          source_mls: selectedListing.source_mls,
          property_id: selectedListing.id ?? null,
          post_type: result.schema.category,
          variant: result.schema.variant,
          format: result.schema.format,
          template_id: result.schema.id,
          image_url: uploadJson.image_url,
          image_path: uploadJson.image_path,
          hero_image_source_url: selectedListing.hero_image_url ?? null,
          // why: persisting the post-hydration schema enables "resume in
          // Studio" later from the Created Posts strip / library.
          layer_tree: result.schema as unknown as Parameters<
            typeof upsertGeneratedPostFromStudioAction
          >[0]["layer_tree"],
          // Phase 5 — supporting photos for the carousel post. Persisted
          // alongside the hero so the publish route can build the full
          // image_urls array (`[gp.image_url, ...gp.additional_images]`)
          // at post time. Empty array on a single-image post — the action
          // defaults `?? []` so passing `null` would also be fine, but
          // sending the explicit serialized state keeps audit-trail trivial.
          additional_images: carouselSlides as unknown as Parameters<
            typeof upsertGeneratedPostFromStudioAction
          >[0]["additional_images"],
          // Phase D — persist per-platform caption edits. Each tab's
          // text is re-parsed back into {caption, hashtags} via
          // parsePlatformText so a round-trip stays clean (hashtag
          // tokens reliably separated from prose regardless of how the
          // user rearranged the text in the textarea). Empty strings
          // produce empty {caption:"", hashtags:[]} entries which the
          // publish-side helper treats as "fall back to legacy".
          captions_by_platform: {
            instagram: parsePlatformText(editedCaptions.instagram),
            facebook: parsePlatformText(editedCaptions.facebook),
            tiktok: parsePlatformText(editedCaptions.tiktok),
          } as unknown as Parameters<
            typeof upsertGeneratedPostFromStudioAction
          >[0]["captions_by_platform"],
        });
        if (!upsertRes.ok) {
          // Non-fatal for the in-memory preview — image is uploaded, the
          // user sees their edit. Surface as a warning so they know the
          // row didn't persist.
          setError(`Image saved, but post row update failed: ${upsertRes.error}`);
        } else if (upsertRes.inserted) {
          // First save of this Studio session — stash the new id so the
          // next save updates instead of inserting again.
          setGeneratedPostId(upsertRes.id);
        }

        // ---- 3. Update the preview pane in-memory ----
        // why: reuse the existing renderResult shape so the rest of the UI
        // (download button, post-now flow, caption pane) keeps working
        // without knowing whether the image came from V1 render or Studio.
        setRenderResult((prev) =>
          prev
            ? {
                ...prev,
                image_url: uploadJson.image_url,
                image_path: uploadJson.image_path,
                template_id: result.schema.id,
                width: result.width,
                height: result.height,
              }
            : {
                image_url: uploadJson.image_url,
                image_path: uploadJson.image_path,
                template_id: result.schema.id,
                width: result.width,
                height: result.height,
                hero_image_source_url: selectedListing.hero_image_url ?? "",
              },
        );

        // ---- 4. Close the overlay ----
        setStudioOpen(false);

        // ---- 5. Part 2 (Phase D) — Make-a-Reel follow-up prompt ----
        // why: connect the canvas Studio flow to the Reel flow. Larissa
        // should see one natural pathway: "saved a post → want a Reel
        // version too?" — instead of two disconnected entry points.
        // Skipped on per-slide saves (editingSlideIndex non-null) since
        // the user is in the middle of editing a carousel, not finishing
        // a full post.
        if (
          editingSlideIndex === null &&
          selectedListing?.mls_number &&
          upsertRes.ok
        ) {
          setMakeReelPromptState({
            mls: selectedListing.mls_number,
            gpId: upsertRes.id ?? generatedPostId ?? null,
          });
        }
      } catch (e) {
        setError(
          `Studio save threw: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [
      selectedListing,
      generatedPostId,
      postType,
      variantId,
      format,
      carouselSlides,
      editingSlideIndex,
    ],
  );

  const handleStudioClose = useCallback((): void => {
    setStudioOpen(false);
    // why: clear the slide-edit context on every close so the next
    // "Edit in Studio" click on the hero card lands on the hero save
    // path, not the slide save path. The user explicitly clicks a slide
    // pencil to re-enter slide-edit mode.
    setEditingSlideIndex(null);
  }, []);

  // Part 2 (Phase D) — pivot from Post Builder to Reel Studio. Closes the
  // canvas overlay (if open), dismisses any pending Make-a-Reel prompt,
  // and navigates to /post-builder/reel?mls=<mls> so Reel Studio mounts
  // with the listing already selected. Used by BOTH the in-Studio "+
  // Reel" button AND the post-save prompt's "Make a Reel" action.
  const navigateToReelStudio = useCallback(
    (mls: string): void => {
      setStudioOpen(false);
      setEditingSlideIndex(null);
      setMakeReelPromptState(null);
      router.push(`/post-builder/reel?mls=${encodeURIComponent(mls)}`);
    },
    [router],
  );

  // why: bind the +Reel button to the currently-selected listing. Returns
  // undefined when there's no listing, which makes CanvasEditor hide the
  // button entirely (a +Reel without a listing has nothing to seed).
  const handleMakeReelFromStudio = useMemo<(() => void) | undefined>(() => {
    if (!selectedListing) return undefined;
    return () => navigateToReelStudio(selectedListing.mls_number);
  }, [selectedListing, navigateToReelStudio]);

  // why: Phase 4 — when the user swaps templates inside Studio via the
  // Templates panel, sync the parent's post-type / variant / format state
  // to match the new template. Without this:
  //   • The Post Builder chips at the top would lie about what's actually
  //     on the canvas (user picked Just Sold inside Studio, parent still
  //     says Just Listed).
  //   • Re-opening Studio from the same variant card would call
  //     findCanvasTemplate(staleTuple) and re-derive the OLD template,
  //     overwriting the user's swap silently.
  //   • Any post-close UI that reads parent state (preview pane label,
  //     download filename) would carry mismatched metadata.
  // The studioContext is also rebuilt so internal references stay clean.
  const handleStudioTemplateSwitched = useCallback(
    (template: CanvasTemplateSchema): void => {
      setPostType(template.category);
      setVariantId(template.variant);
      setFormat(template.format);
      setStudioContext((prev) => (prev ? { ...prev, template } : prev));
    },
    [],
  );

  // why: Phase 4 — Smart Resize. When the user picks a new aspect ratio
  // inside Studio, treat the resize as creating a SIBLING post, not
  // updating the current one. Steps:
  //   1. Update format chip (post_type + variant stay the same — resize
  //      preserves the design's identity, just changes the canvas size).
  //   2. Rebuild studioContext.template with the regenerated factory
  //      output at the new format.
  //   3. **Null out generatedPostId** — this is the key bit. The next
  //      Save inserts a fresh row instead of updating the original.
  //      Larissa ends up with two posts in the Created Posts strip:
  //      the original at format A, the resized at format B, both linked
  //      to the same listing via mls_number.
  //
  // Memory note: this differs from handleStudioTemplateSwitched, which
  // updates the existing row. Same listing, different design = iterate
  // in place. Same listing, same design, different format = sibling row.
  const handleStudioResize = useCallback(
    (template: CanvasTemplateSchema): void => {
      setFormat(template.format);
      setStudioContext((prev) => (prev ? { ...prev, template } : prev));
      setGeneratedPostId(null);
      // why: also clear the in-memory renderResult so the preview pane
      // doesn't show the OLD format's image after Studio closes. The next
      // Save populates renderResult fresh from the canvas-save response.
      setRenderResult(null);
    },
    [],
  );

  // ===================================================================
  // Phase 5 — Multi-OH per-slide edit handler
  // ===================================================================
  //
  // Called when the user clicks the pencil button on a carousel slide
  // thumbnail. Looks up that slide's source metadata (from slideMetadata,
  // populated on resume from the row's slide_metadata column), resolves
  // the template + listing payload, and opens Studio with that slide as
  // the active context.
  //
  // why: per-slide editing is fundamentally a different mode from hero
  // editing — same overlay, different save target. We stash the index in
  // `editingSlideIndex` and the save handler branches on it. The studio
  // overlay itself is the same component instance both ways.
  const handleSlideEditClick = useCallback(
    (slideIndex: number): void => {
      // why: bounds-check defensively — the strip's click handler should
      // already guarantee a valid index, but Studio is downstream of the
      // user's last action and the carousel might have been mutated
      // (remove, reorder) between the strip render and the click.
      if (slideIndex < 0 || slideIndex >= carouselSlides.length) {
        setError("Slide no longer exists. Refresh and try again.");
        return;
      }
      const meta = slideMetadata[slideIndex];
      if (!meta) {
        setError(
          "Slide source data missing. This post may pre-date per-slide editing — re-generate to enable.",
        );
        return;
      }

      // ---- Resolve the slide's listing ----
      // why: the slide's source listing may live in a different post-type
      // bucket than the parent's current `postType`. The slide_metadata
      // stores the listing's MLS number; we search every bucket to find
      // it. The wizard generates multi-OH posts with all properties from
      // listingsByPostType.open_house, so that bucket is the common case,
      // but we walk all buckets to be robust.
      let slideListing: PostBuilderListing | null = null;
      for (const pt of POST_TYPES) {
        const candidate = (listingsByPostType[pt.id] ?? []).find(
          (l) => l.mls_number === meta.listing_mls,
        );
        if (candidate) {
          slideListing = candidate;
          break;
        }
      }
      if (!slideListing) {
        setError(
          `Couldn't find listing ${meta.listing_mls} for this slide. It may have been delisted.`,
        );
        return;
      }

      // ---- Resolve the slide's template ----
      // why: prior edits win. If the user has previously saved this slide
      // in Studio, `meta.layer_tree` is the post-hydration schema —
      // re-use it directly so their edits stick. Otherwise fall through
      // to the factory template that originally produced the slide
      // (open_house + variant + format from slide_metadata, NOT from
      // the parent's currently-selected variant).
      let template: CanvasTemplateSchema | null = null;
      if (meta.layer_tree && typeof meta.layer_tree === "object") {
        template = meta.layer_tree as CanvasTemplateSchema;
      } else {
        // why: multi-OH slides are always open_house variants today. If
        // a future producer creates non-open_house slides, widen this by
        // adding a `category` field to SlideMetadata and reading it here.
        template = findCanvasTemplate("open_house", meta.variant, meta.format);
      }
      if (!template) {
        setError(
          `Couldn't load template for slide ${slideIndex + 1}. The format may have been removed.`,
        );
        return;
      }

      // ---- Build the slide's listing payload ----
      // why: the per-property card was generated with the wizard's
      // hosting_agent_name override (when set), NOT the listing's
      // agent_name. Preserve that override here so re-opening produces
      // the same card the user originally rendered.
      const payload = mapListingToPayload(slideListing, {
        // why: availablePhotos is loaded for the PARENT listing, not the
        // slide's listing. For correctness we should fetch the slide
        // listing's photos here — but that introduces async + a loading
        // state into a previously sync handler. The single hero photo
        // (from the listing row's `hero_image_url`) is what the V1 OH
        // template actually binds to anyway, and that's already on the
        // listing. Leaving photos empty falls through to that hero in
        // mapListingToPayload, which is the right outcome for the
        // visual-fidelity priority. If/when the slide template grows
        // photo_2 / photo_3 bindings, revisit this with an async fetch.
        photos: [],
        agentName: meta.hosting_agent_name ?? slideListing.agent_name ?? null,
        officeName: slideListing.listing_office_name ?? null,
      });

      setStudioContext({ template, listing: payload });
      setEditingSlideIndex(slideIndex);
      setStudioOpen(true);
    },
    [carouselSlides, slideMetadata, listingsByPostType],
  );

  // The current set of photo URLs to send to the render API. For single-
  // photo variants this is a 1-element array; for v4 it's 2 elements
  // starting from selectedPhotoIndex (wrapping); for v5 it's 3 elements.
  const currentHeroUrls: string[] = useMemo(() => {
    if (availablePhotos.length === 0) {
      return selectedListing?.hero_image_url ? [selectedListing.hero_image_url] : [];
    }
    const out: string[] = [];
    for (let i = 0; i < photoCount; i++) {
      const idx = (selectedPhotoIndex + i) % availablePhotos.length;
      out.push(availablePhotos[idx].url);
    }
    return out;
  }, [availablePhotos, selectedPhotoIndex, photoCount, selectedListing]);

  /** First URL in the chosen set — what we report as `hero_image_source_url`. */
  const currentHeroUrl: string | null = currentHeroUrls[0] ?? null;

  const previewAspectClass = useMemo(() => {
    switch (format) {
      case "square_1x1":
        return "aspect-square";
      case "portrait_4x5":
        return "aspect-[4/5]";
      case "story_9x16":
        return "aspect-[9/16]";
    }
  }, [format]);

  // why: track whether we've already auto-opened Studio for the resume
  // context. The effect that does the open watches selectedListing + photos,
  // both of which can re-fire (user navigates, photos refresh) — but we only
  // want to auto-open ONCE, on the first time everything is ready. After
  // the user closes Studio, navigating around shouldn't re-open it.
  const resumeAutoOpenedRef = useRef(false);

  // Auto-open Studio when the user arrived via /post-builder?gp=<id>.
  // Waits for: (1) resume context present, (2) listing is selected/loaded,
  // (3) photos finished loading. Uses the saved layer_tree from the row as
  // the template — falls back to the factory template when layer_tree is
  // null (older rows that pre-date the column being populated).
  useEffect(() => {
    if (!initialResume) return;
    if (resumeAutoOpenedRef.current) return;
    if (!selectedListing) return;
    if (photosLoading) return;
    // 2026-05-21 — multi-OH carousels have a pre-rendered hero image and
    // no factory template for the EVENT card (`multi_oh_event_*` isn't a
    // canvas-editor template). Auto-opening Studio for the hero would
    // either crash (no template) or open the wrong template (one of the
    // per-property variants). The user can click Edit in Studio
    // explicitly to open a per-property SLIDE for fine-tuning; the hero
    // itself stays as the rendered PNG until we ship a hero canvas
    // template.
    if (isMultiOHPost) {
      resumeAutoOpenedRef.current = true;
      return;
    }

    // Resolve the template: saved layer_tree wins; factory template is the
    // fallback so older rows still open in a usable state.
    let template: CanvasTemplateSchema | null = null;
    if (initialResume.layer_tree && typeof initialResume.layer_tree === "object") {
      template = initialResume.layer_tree as unknown as CanvasTemplateSchema;
    } else {
      template = findCanvasTemplate(
        initialResume.post_type,
        initialResume.variant,
        initialResume.format,
      );
    }
    if (!template) {
      setError(
        "Couldn't load the saved design. The template format may have been removed.",
      );
      resumeAutoOpenedRef.current = true;
      return;
    }

    const payload = mapListingToPayload(selectedListing, {
      photos: availablePhotos.map((p) => p.url),
      agentName: selectedListing.agent_name ?? null,
      officeName: selectedListing.listing_office_name ?? null,
    });
    setStudioContext({ template, listing: payload });
    setStudioOpen(true);
    resumeAutoOpenedRef.current = true;
  }, [initialResume, selectedListing, photosLoading, availablePhotos]);

  // Fetch photos when the selected listing changes.
  useEffect(() => {
    if (!selectedListing) {
      setAvailablePhotos([]);
      setSelectedPhotoIndex(0);
      return;
    }
    let cancelled = false;
    setPhotosLoading(true);
    fetch(`/api/post-builder/photos?mls=${encodeURIComponent(selectedListing.mls_number)}`)
      .then((r) => r.json())
      .then((json: PhotosResponse) => {
        if (cancelled) return;
        const photos = json.ok && json.photos ? json.photos : [];
        setAvailablePhotos(photos);
        // If there are no photos in the table but the listing has a hero,
        // synthesize a single-photo array so the picker shows at least the
        // current hero. Sequence=0 marks it as the cached hero.
        if (photos.length === 0 && selectedListing.hero_image_url) {
          setAvailablePhotos([
            {
              url: selectedListing.hero_image_url,
              sequence: 0,
              source: "paragon",
            },
          ]);
        }
        setSelectedPhotoIndex(0);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("photos fetch failed:", e);
        setAvailablePhotos(
          selectedListing.hero_image_url
            ? [{ url: selectedListing.hero_image_url, sequence: 0, source: "paragon" }]
            : [],
        );
        setSelectedPhotoIndex(0);
      })
      .finally(() => {
        if (!cancelled) setPhotosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedListing]);

  // === AI Magic Design — photo hydration for the ✨ listing ===
  // why: when the user clicks ✨ on a listing card we may not have its
  // photos loaded yet (selectedListing might be a DIFFERENT listing, or
  // nothing at all). Hit the same /api/post-builder/photos endpoint the
  // main picker uses so Claude gets the full gallery to pick a hero from.
  // The modal mounts immediately and shows a spinner; we feed it photos
  // as soon as the fetch resolves. If the fetch fails or returns empty,
  // we fall back to the listing's hero_image_url so Claude always has
  // at least one photo to choose from.
  useEffect(() => {
    if (!magicDesignListing) {
      setMagicDesignPhotos([]);
      setMagicDesignPhotosLoading(false);
      return;
    }
    let cancelled = false;
    setMagicDesignPhotosLoading(true);
    fetch(
      `/api/post-builder/photos?mls=${encodeURIComponent(magicDesignListing.mls_number)}`,
    )
      .then((r) => r.json())
      .then((json: PhotosResponse) => {
        if (cancelled) return;
        const photos = json.ok && json.photos ? json.photos : [];
        const urls = photos.map((p) => p.url);
        if (urls.length === 0 && magicDesignListing.hero_image_url) {
          setMagicDesignPhotos([magicDesignListing.hero_image_url]);
        } else {
          setMagicDesignPhotos(urls);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[magic-design] photos fetch failed:", e);
        setMagicDesignPhotos(
          magicDesignListing.hero_image_url
            ? [magicDesignListing.hero_image_url]
            : [],
        );
      })
      .finally(() => {
        if (!cancelled) setMagicDesignPhotosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [magicDesignListing]);

  /**
   * Apply Claude's Magic Design recommendation + open Studio.
   *
   * Flow:
   *   1. Apply post_type + format + selectedMls (the listing the user
   *      clicked ✨ on, NOT whatever was selected before).
   *   2. Seed captionResult/editedCaption so the Studio caption pane is
   *      pre-filled — and so the existing "Generate" affordance won't
   *      need to be clicked again before Post Now / Download.
   *   3. Seed selectedPhotoIndex with Claude's hero pick (clamped to the
   *      listing's actual photo count once the photos fetch resolves —
   *      magicDesignPhotos vs availablePhotos may differ briefly if the
   *      user hadn't selected this listing yet).
   *   4. Close the Magic Design modal.
   *   5. Open Studio for the recommended variant via the existing
   *      openStudioForVariant pathway. We need a brief microtask so the
   *      state updates above flush before openStudioForVariant reads
   *      `selectedListing` from its captured closure.
   */
  const handleMagicDesignApply = useCallback(
    (payload: MagicDesignAppliedPayload): void => {
      if (!magicDesignListing) return;

      // 1-3 — pre-apply all the recommendation state
      setPostType(payload.post_type);
      setFormat(payload.format);
      setVariantId(payload.variant);
      setSelectedMls(magicDesignListing.mls_number);

      // why: seed the existing caption pipeline. mls_hashtag is derived from
      // the listing exactly like captions.ts does it, so the canonical
      // auto-linker hashtag is always present even when Magic Design
      // returns a recommendation with no MLS hashtag in its set.
      const mlsHashtag = canonicalMlsHashtagForListing(magicDesignListing);
      const ensuredHashtags = payload.hashtags.some(
        (h) => h.toLowerCase() === mlsHashtag.toLowerCase(),
      )
        ? payload.hashtags
        : [...payload.hashtags, mlsHashtag];
      setCaptionResult({
        caption: payload.caption,
        hashtags: ensuredHashtags,
        mls_hashtag: mlsHashtag,
      });
      setEditedCaption(payload.caption);

      // Hero photo: index into magicDesignPhotos (what Claude saw). The
      // main picker's availablePhotos useEffect will refresh once
      // selectedListing changes; until then we apply the index as-is and
      // clamp once availablePhotos hydrates.
      const heroUrl = magicDesignPhotos[payload.hero_photo_index] ?? null;
      if (heroUrl) {
        // why: defer the photo-index sync to after the listing's own photo
        // useEffect resolves. We stash the recommended hero URL on a ref-
        // less local and clamp by matching url once availablePhotos
        // loads. For MVP, set the index directly — it's safe because
        // both useEffects read from /api/post-builder/photos with the
        // same MLS number and order.
        setSelectedPhotoIndex(payload.hero_photo_index);
      } else {
        setSelectedPhotoIndex(0);
      }

      // 4 — close the Magic Design modal so it doesn't sit behind Studio
      const listingForStudio = magicDesignListing;
      setMagicDesignListing(null);

      // 5 — open Studio. We can't call openStudioForVariant() directly
      // because it reads `selectedListing` from a memoized closure, which
      // won't have updated yet. Compute the studio context inline using
      // the listing we already have in hand.
      const tpl = findCanvasTemplate(
        payload.post_type,
        payload.variant,
        payload.format,
      );
      if (!tpl) {
        setError(
          `No Studio template for ${payload.post_type} / ${payload.variant} / ${payload.format}.`,
        );
        return;
      }
      // why: photos passed to mapListingToPayload should be magicDesignPhotos
      // — that's the exact list Claude saw and picked from. The main
      // picker's availablePhotos may briefly be stale (different listing,
      // fetch still in flight) during the cross-over.
      const studioPhotos = magicDesignPhotos.length > 0
        ? magicDesignPhotos
        : listingForStudio.hero_image_url
          ? [listingForStudio.hero_image_url]
          : [];
      const payloadML = mapListingToPayload(listingForStudio, {
        photos: studioPhotos,
        agentName: listingForStudio.agent_name ?? null,
        officeName: listingForStudio.listing_office_name ?? null,
      });
      setStudioContext({ template: tpl, listing: payloadML });
      setStudioOpen(true);
      setRenderResult(null);
      setError(null);
    },
    [magicDesignListing, magicDesignPhotos],
  );

  function changePostType(next: PostType) {
    setPostType(next);
    setSelectedMls(null);
    setRenderResult(null);
    setCaptionResult(null);
    setEditedCaption("");
    setError(null);
    setSearch("");
    setAvailablePhotos([]);
    setSelectedPhotoIndex(0);
    // why: a different post-type implies a different post entirely — the
    // previous carousel slides don't apply (often a different listing
    // category, different framing).
    setCarouselSlides([]);
    setSlideMetadata([]);
    setEditingSlideIndex(null);
    setGeneratedPostId(null);
  }

  function changeFormat(next: PostFormat) {
    setFormat(next);
    setRenderResult(null);
    setError(null);
  }

  function changeVariant(next: PostVariant) {
    setVariantId(next);
    setRenderResult(null);
    setError(null);
    // Keep the photo offset; the new variant just slices a different
    // window. If we end up beyond the wrap point that's fine — the slice
    // wraps modulo availablePhotos.length.
  }

  function pickListing(mls: string) {
    setSelectedMls(mls);
    setRenderResult(null);
    setCaptionResult(null);
    setEditedCaption("");
    // why: a different listing means a different set of supporting photos.
    // Keeping old carousel slides would publish photos of someone else's
    // house — clear instead.
    setCarouselSlides([]);
    setSlideMetadata([]);
    setEditingSlideIndex(null);
    setGeneratedPostId(null);
    setError(null);
  }

  // ─────────────────────────────────────────────────────────────────
  // Phase 5A — Post Now flow
  // ─────────────────────────────────────────────────────────────────

  /**
   * Save the IG single-image render to generated_posts if it hasn't been
   * saved yet, returning the row id. FB bundles already save inside the
   * bundle endpoint so this is only needed for the IG path.
   */
  async function ensureGeneratedPostId(): Promise<string | null> {
    if (generatedPostId) return generatedPostId;
    if (!renderResult || !selectedListing) return null;
    const save = await saveGeneratedPostAction({
      mls_number: selectedListing.mls_number,
      source_mls: selectedListing.source_mls,
      property_id: selectedListing.id,
      post_type: postType,
      variant: variantId,
      format,
      template_id: renderResult.template_id,
      image_url: renderResult.image_url,
      image_path: renderResult.image_path,
      hero_image_source_url: renderResult.hero_image_source_url,
      template_props: {
        listing: selectedListing,
        photo_count: photoCount,
        photo_sequences: photoCount === 1
          ? [availablePhotos[selectedPhotoIndex]?.sequence ?? null]
          : currentHeroUrls.map((url) => {
              const match = availablePhotos.find((p) => p.url === url);
              return match?.sequence ?? null;
            }),
        photo_urls: currentHeroUrls,
      },
      caption: captionResult?.caption ?? "",
      hashtags: captionResult?.hashtags ?? [],
      mls_hashtag: captionResult?.mls_hashtag ?? "",
    });
    if (!save.ok) {
      setError(`Save failed: ${save.error}`);
      return null;
    }
    setGeneratedPostId(save.id);
    return save.id;
  }

  function openPostNow() {
    setPostNowOpen(true);
    setPostNowArmedAt(Date.now());
    setPostNowResults(null);
    setPostNowPlatforms(new Set(["facebook", "instagram", "tiktok"]));
  }

  function togglePostNowPlatform(p: PostPlatform) {
    setPostNowPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function submitPostNow() {
    if (postNowPlatforms.size === 0) return;
    setPostNowSending(true);
    try {
      let id: string | null = generatedPostId;
      if (!id) {
        id = await ensureGeneratedPostId();
        if (!id) {
          setPostNowSending(false);
          return;
        }
      }

      // why: captions live in client state (editedCaptions per platform).
      // They only persist to the DB when the user saves from Studio. So
      // ANY Post Now click that follows a Generate-then-edit flow without
      // re-entering Studio would otherwise publish against a row whose
      // caption columns are empty — exactly the "no caption" gate error
      // seen on first publish attempts. Always flush captions to the row
      // here before firing the publish API.
      const parsedByPlatform = {
        facebook: parsePlatformText(editedCaptions.facebook),
        instagram: parsePlatformText(editedCaptions.instagram),
        tiktok: parsePlatformText(editedCaptions.tiktok),
      };
      // Pick the richest entry to mirror onto the legacy caption column
      // (the publish route's fallback path reads this). Instagram first
      // since it's the canonical surface, then FB, then TT, then a final
      // fallback to captionResult.caption if Larissa never edited the
      // textarea but the AI generated something.
      const legacyPick =
        parsedByPlatform.instagram.caption ||
        parsedByPlatform.facebook.caption ||
        parsedByPlatform.tiktok.caption ||
        captionResult?.caption ||
        "";
      const legacyHashtagsPick =
        parsedByPlatform.instagram.hashtags.length > 0
          ? parsedByPlatform.instagram.hashtags
          : parsedByPlatform.facebook.hashtags.length > 0
            ? parsedByPlatform.facebook.hashtags
            : parsedByPlatform.tiktok.hashtags.length > 0
              ? parsedByPlatform.tiktok.hashtags
              : (captionResult?.hashtags ?? []);
      const flushRes = await updatePostCaptionsAction({
        generated_post_id: id,
        legacy_caption: legacyPick,
        legacy_hashtags: legacyHashtagsPick,
        captions_by_platform: parsedByPlatform,
      });
      if (!flushRes.ok) {
        setError(`Could not save captions before publishing: ${flushRes.error}`);
        setPostNowSending(false);
        return;
      }

      const platforms = [...postNowPlatforms];
      const res = await fetch("/api/post-builder/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generated_post_id: id, platforms }),
      });
      const json = (await res.json()) as
        | { ok: true; results: PostNowResult[]; posted_to: PostPlatform[] }
        | { ok: false; error: string };
      if (!json.ok) {
        setError(`Post Now failed: ${json.error}`);
        setPostNowResults(null);
      } else {
        setPostNowResults(json.results);
      }
    } catch (e) {
      setError(`Post Now threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPostNowSending(false);
    }
  }

  /**
   * Schedule the current post for one or more platforms. Each platform's
   * pick is a UTC ISO timestamp keyed by platform name; the modal builds
   * this map from its native datetime-local inputs (which the modal
   * converts from the user's local timezone to UTC).
   *
   * On success we close the modal and toast the earliest scheduled time so
   * Larissa gets immediate feedback. The row's status flips to "scheduled"
   * server-side, which means it'll surface in the /saved-posts "Scheduled"
   * chip without any further client work.
   */
  async function submitSchedule(scheduledFor: ScheduledFor): Promise<void> {
    if (Object.keys(scheduledFor).length === 0) return;
    setPostNowSending(true);
    try {
      let id: string | null = generatedPostId;
      if (!id) {
        id = await ensureGeneratedPostId();
        if (!id) {
          setPostNowSending(false);
          return;
        }
      }

      // Mirror submitPostNow — flush current captions to the row so the
      // cron tick at fire time finds something to publish.
      const parsedByPlatform = {
        facebook: parsePlatformText(editedCaptions.facebook),
        instagram: parsePlatformText(editedCaptions.instagram),
        tiktok: parsePlatformText(editedCaptions.tiktok),
      };
      const legacyPick =
        parsedByPlatform.instagram.caption ||
        parsedByPlatform.facebook.caption ||
        parsedByPlatform.tiktok.caption ||
        captionResult?.caption ||
        "";
      const legacyHashtagsPick =
        parsedByPlatform.instagram.hashtags.length > 0
          ? parsedByPlatform.instagram.hashtags
          : parsedByPlatform.facebook.hashtags.length > 0
            ? parsedByPlatform.facebook.hashtags
            : parsedByPlatform.tiktok.hashtags.length > 0
              ? parsedByPlatform.tiktok.hashtags
              : (captionResult?.hashtags ?? []);
      const flushRes = await updatePostCaptionsAction({
        generated_post_id: id,
        legacy_caption: legacyPick,
        legacy_hashtags: legacyHashtagsPick,
        captions_by_platform: parsedByPlatform,
      });
      if (!flushRes.ok) {
        setError(`Could not save captions before scheduling: ${flushRes.error}`);
        setPostNowSending(false);
        return;
      }

      const result = await schedulePostAction({
        generated_post_id: id,
        scheduled_for: scheduledFor,
      });
      if (!result.ok) {
        setError(`Schedule failed: ${result.error}`);
        return;
      }
      // why: surface the earliest scheduled time as a one-shot inline
      // toast via the existing error-banner channel (no toast lib in
      // this codebase yet — repurposing the error banner with a clear
      // "Scheduled for…" prefix keeps scope tight).
      const earliestIso = Object.values(result.scheduled_for)
        .filter((v): v is string => typeof v === "string")
        .sort()[0];
      if (earliestIso) {
        const localStr = new Date(earliestIso).toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        setError(`Scheduled for ${localStr}`);
      }
      closePostNow();
    } catch (e) {
      setError(
        `Schedule threw: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPostNowSending(false);
    }
  }

  // Reset Post Now state whenever the user changes the selection. Anything
  // that invalidates the underlying generated_posts row should also close
  // the Post Now panel and clear results.
  useEffect(() => {
    setPostNowOpen(false);
    setPostNowResults(null);
    setPostNowArmedAt(null);
  }, [selectedMls, renderResult?.image_url]);

  // If the listing only has N photos but the user has v4 (2) or v5 (3) selected,
  // auto-fall-back to v1 so the variant card grid never shows a selected-but-
  // disabled state.
  useEffect(() => {
    if (availablePhotos.length === 0) return;
    if (!currentVariant) return;
    if (availablePhotos.length < currentVariant.photo_count) {
      // Switch to the first variant in the list that fits.
      const fallback = variants.find((v) => v.photo_count <= availablePhotos.length);
      if (fallback && fallback.variant !== variantId) {
        changeVariant(fallback.variant as PostVariant);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- changeVariant is stable enough for this pattern
  }, [availablePhotos.length, currentVariant?.photo_count]);

  function closePostNow() {
    setPostNowOpen(false);
    setPostNowArmedAt(null);
    // Keep results so user can see what just happened until they close.
  }

  // Path A "Customize" was removed on 2026-05-14 — replaced by Path C
  // "Edit in Studio" (canvas editor). The render API still accepts an
  // optional `customizations` field for backward-compat with historical
  // generated_posts rows; we just stop sending it from this client.

  function pickPhoto(index: number) {
    if (index < 0 || index >= availablePhotos.length) return;
    setSelectedPhotoIndex(index);
    // Photo change invalidates the render but keeps caption.
    setRenderResult(null);
  }

  function cyclePhoto() {
    if (availablePhotos.length === 0) return;
    pickPhoto((selectedPhotoIndex + 1) % availablePhotos.length);
  }

  async function generate() {
    if (!selectedListing) return;
    if (currentHeroUrls.length === 0) {
      setError("This listing has no hero photo. Pick another.");
      return;
    }
    setGenerating(true);
    setError(null);
    setRenderResult(null);
    setCaptionResult(null);
    setEditedCaption("");

    try {
      const heroUrls = currentHeroUrls;
      const [renderRes, captionRes] = await Promise.allSettled([
        fetch("/api/post-builder/render", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            template_id: templateId,
            listing: selectedListing,
            hero_image_urls: heroUrls,
          }),
        }),
        fetch("/api/post-builder/caption", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listing: selectedListing,
            post_type: postType,
          }),
        }),
      ]);

      // Render — defensively parse so a non-JSON response (Vercel HTML
      // 504 / proxy error / etc) surfaces a useful error instead of
      // silently swallowing the throw and leaving the UI in an empty state.
      const renderError = await safelyHandleRender(renderRes, heroUrls, setRenderResult);
      if (renderError) setError(renderError);

      // Caption — same defensive treatment. Caption is best-effort; if it
      // fails we don't block download but we DO surface the message so
      // the user knows.
      const captionError = await safelyHandleCaption(
        captionRes,
        setCaptionResult,
        setEditedCaptions,
      );
      if (captionError && !renderError) setError(captionError);
    } catch (e) {
      setError(`Generate threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Parse a render response defensively. Returns an error string if
   * anything went wrong, null on success (and side-effects setRenderResult).
   */
  async function safelyHandleRender(
    settled: PromiseSettledResult<Response>,
    heroUrls: string[],
    onSuccess: (r: RenderResult) => void,
  ): Promise<string | null> {
    if (settled.status === "rejected") {
      return `Render request failed (network): ${settled.reason}`;
    }
    const res = settled.value;
    let json: RenderResponse | RenderErrorResponse | null = null;
    let parseError: string | null = null;
    try {
      json = (await res.json()) as RenderResponse | RenderErrorResponse;
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
    if (!json) {
      const bodyPreview = await safelyReadText(res);
      return `Render returned non-JSON (HTTP ${res.status}). ${parseError ?? ""} Body: ${bodyPreview.slice(0, 200)}`;
    }
    if (!res.ok || !json.ok) {
      const errMsg = (json as RenderErrorResponse).error ?? `HTTP ${res.status}`;
      return `Render failed: ${errMsg}`;
    }
    onSuccess({
      image_url: json.image_url,
      image_path: json.image_path,
      template_id: json.template_id,
      width: json.width,
      height: json.height,
      hero_image_source_url: heroUrls[0],
    });
    return null;
  }

  async function safelyHandleCaption(
    settled: PromiseSettledResult<Response>,
    onSuccess: (c: CaptionResult) => void,
    onPlatformTexts: (texts: Record<SchedulablePlatform, string>) => void,
  ): Promise<string | null> {
    if (settled.status === "rejected") {
      return `Caption request failed (network): ${settled.reason}`;
    }
    const res = settled.value;
    let json: CaptionResponse | CaptionErrorResponse | null = null;
    try {
      json = (await res.json()) as CaptionResponse | CaptionErrorResponse;
    } catch {
      return `Caption returned non-JSON (HTTP ${res.status})`;
    }
    if (!res.ok || !json.ok) {
      return `Caption failed: ${(json as CaptionErrorResponse).error ?? `HTTP ${res.status}`}`;
    }
    const cap: CaptionResult = {
      caption: json.caption,
      hashtags: json.hashtags,
      mls_hashtag: json.mls_hashtag,
      captions: json.captions,
    };
    onSuccess(cap);
    // Phase D — fan out into all three platform tabs. Falls back to the
    // legacy single caption for any platform the API didn't fill (defends
    // against partial responses + older API versions).
    onPlatformTexts(buildPlatformTextsFromCaption(cap));
    return null;
  }

  async function safelyReadText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return "(could not read response body)";
    }
  }

  // Re-runs ONLY the caption API. Keeps the rendered image. Cheap — no
  // Chromium spin-up. Useful when the AI's first draft is meh.
  async function regenerateCaption() {
    if (!selectedListing) return;
    setRegeneratingCaption(true);
    setError(null);
    try {
      const res = await fetch("/api/post-builder/caption", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing: selectedListing,
          post_type: postType,
        }),
      });
      const json = (await res.json()) as CaptionResponse | CaptionErrorResponse;
      if (json.ok) {
        const cap: CaptionResult = {
          caption: json.caption,
          hashtags: json.hashtags,
          mls_hashtag: json.mls_hashtag,
          captions: json.captions,
        };
        setCaptionResult(cap);
        // Phase D — regenerate refreshes ALL three platform tabs in one
        // pass so the user gets a fresh set of variants to pick from.
        setEditedCaptions(buildPlatformTextsFromCaption(cap));
      } else {
        setError(`Caption regen failed: ${json.error}`);
      }
    } catch (e) {
      setError(`Caption regen failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegeneratingCaption(false);
    }
  }

  async function downloadPng() {
    if (!renderResult || !selectedListing) return;
    setDownloadSaving(true);
    setError(null);
    try {
      const save = await saveGeneratedPostAction({
        mls_number: selectedListing.mls_number,
        source_mls: selectedListing.source_mls,
        property_id: selectedListing.id,
        post_type: postType,
        variant: variantId,
        format,
        template_id: renderResult.template_id,
        image_url: renderResult.image_url,
        image_path: renderResult.image_path,
        hero_image_source_url: renderResult.hero_image_source_url,
        template_props: {
          listing: selectedListing,
          photo_count: photoCount,
          photo_sequences: photoCount === 1
            ? [availablePhotos[selectedPhotoIndex]?.sequence ?? null]
            : currentHeroUrls.map((url) => {
                const match = availablePhotos.find((p) => p.url === url);
                return match?.sequence ?? null;
              }),
          photo_urls: currentHeroUrls,
        },
        caption: captionResult?.caption ?? "",
        hashtags: captionResult?.hashtags ?? [],
        mls_hashtag: captionResult?.mls_hashtag ?? "",
        // why: customizations omitted intentionally — Path A is deprecated.
        // Phase D — write the per-platform captions Larissa has been
        // editing in the three tabs. The user's edits go to Storage even
        // on a Download PNG save, because the publish flow downstream
        // reads from the persisted row.
        captions_by_platform: {
          instagram: parsePlatformText(editedCaptions.instagram),
          facebook: parsePlatformText(editedCaptions.facebook),
          tiktok: parsePlatformText(editedCaptions.tiktok),
        },
      });
      if (!save.ok) {
        setError(`Saved-to-table failed: ${save.error}`);
      }

      const res = await fetch(renderResult.image_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `c21-alliance_${postType}_${selectedListing.mls_number}_${formatShortName(format)}_${variantId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloadSaving(false);
    }
  }

  async function copyCaption() {
    if (!editedCaption) return;
    try {
      await navigator.clipboard.writeText(editedCaption);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setError("Couldn't copy to clipboard. Select the text and copy manually.");
    }
  }

  return (
    <div className="space-y-5">
      {/* 2026-05-21 — Multi-OH header banner. Replaces the post-type
          segmented picker + listing picker for rows resumed from the
          multi-OH wizard: those choices were already made in the wizard
          and can't be changed here without re-rendering the entire
          carousel. The banner orients Larissa to what she's editing. */}
      {isMultiOHPost ? (
        <div className="card p-4 bg-gold-50/40 ring-1 ring-gold-200">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-700 mb-0.5">
                Multi-property Open House
              </div>
              <div className="text-sm text-neutral-900">
                Carousel post —{" "}
                <span className="font-semibold">
                  {carouselSlides.length + 1} slides
                </span>{" "}
                · {formatMeta[format]?.display_name ?? format}
              </div>
              <div className="text-xs text-neutral-600 mt-0.5">
                Format and per-property card style were chosen in the wizard. Edit captions below, or click Edit in Studio to fine-tune a slide.
              </div>
            </div>
            <Link
              href="/post-builder/multi-oh"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-gold-300 bg-white px-3 py-1.5 text-xs font-medium text-gold-800 hover:bg-gold-100/50 transition"
            >
              <span aria-hidden="true">↻</span>
              Start a new Multi-OH
            </Link>
          </div>
        </div>
      ) : null}

      {/* Post type segmented picker — hidden in multi-OH mode (the
          carousel is locked to "open_house" and the picker tabs would
          let Larissa wander out of the multi-OH context confusingly). */}
      {!isMultiOHPost ? (
      <div className="card p-2 flex flex-wrap gap-1">
        {POST_TYPES.map((pt) => {
          const active = pt.id === postType;
          const count = listingsByPostType[pt.id]?.length ?? 0;
          return (
            <button
              key={pt.id}
              type="button"
              onClick={() => changePostType(pt.id)}
              className={[
                "flex-1 min-w-[140px] px-4 py-3 rounded-lg transition text-left",
                active
                  ? "bg-gold-50 ring-2 ring-gold-500/40"
                  : "bg-white hover:bg-neutral-50 ring-1 ring-neutral-200",
              ].join(" ")}
            >
              <div
                className={[
                  "text-sm font-semibold",
                  active ? "text-gold-800" : "text-neutral-900",
                ].join(" ")}
              >
                {pt.label}
              </div>
              <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2">
                <span>{pt.helper}</span>
                <span
                  className={[
                    "ml-auto rounded-full px-1.5 py-px text-[10px] font-semibold",
                    active
                      ? "bg-gold-200 text-gold-900"
                      : "bg-neutral-100 text-neutral-600",
                  ].join(" ")}
                >
                  {count}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      ) : null}

      {/* Main grid. Multi-OH mode collapses to a single column (no
          listing picker on the left); single-listing mode keeps the
          two-column [300px | rest] layout. */}
      <div
        className={[
          "grid grid-cols-1 gap-6",
          isMultiOHPost ? "" : "lg:grid-cols-[300px_1fr]",
        ].join(" ")}
      >
        {/* Left: Listing picker — hidden in multi-OH mode. */}
        {!isMultiOHPost ? (
        <section className="card p-4">
          {/* 2026-05-21 — the Multi-property Open House entry point that
              used to live here was relocated to the dashboard's Open
              Houses card (components/UpcomingOpenHousesRow.tsx). That's
              where Larissa is already scanning open houses and deciding
              what to promote, so the affordance now sits right next to
              the list that drives the decision. */}
          <div className="eyebrow mb-2">Step 1 · Pick a listing</div>
          <input
            type="search"
            className="input mb-3"
            placeholder="Search MLS, address, city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {listings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
              No eligible listings for{" "}
              <span className="font-medium">
                {POST_TYPES.find((p) => p.id === postType)?.label}
              </span>
              {postType === "open_house"
                ? " in the next 14 days. Schedule an OH or pick a different post type."
                : ". Try a different post type or trigger a sync."}
            </div>
          ) : (
            <div className="max-h-[640px] overflow-y-auto -mx-2 px-2 space-y-1.5">
              {filteredListings.map((l) => {
                const active = l.mls_number === selectedMls;
                const showPrice =
                  postType === "just_sold" && typeof l.close_price === "number"
                    ? l.close_price
                    : l.list_price;
                return (
                  // why: listing cards used to be a single <button>, but the
                  // Magic Design ✨ affordance must be its own actionable
                  // element — nesting an <button> inside a <button> is
                  // invalid HTML and breaks click handling. Switched the
                  // outer container to a <div> with role="button" + key
                  // handlers preserved so a11y stays clean.
                  <div
                    key={l.mls_number}
                    role="button"
                    tabIndex={0}
                    onClick={() => pickListing(l.mls_number)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        pickListing(l.mls_number);
                      }
                    }}
                    className={[
                      "w-full text-left rounded-lg border p-2.5 transition flex gap-3 items-start relative cursor-pointer",
                      active
                        ? "border-gold-500 bg-gold-50/50 ring-2 ring-gold-500/30"
                        : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50",
                    ].join(" ")}
                  >
                    {l.hero_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.hero_image_url}
                        alt=""
                        className="w-14 h-14 rounded-md object-cover flex-shrink-0 bg-neutral-100"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-md bg-neutral-100 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1 pr-9">
                      <div className="text-sm font-medium text-neutral-900 truncate">
                        {l.address ?? l.mls_number}
                      </div>
                      <div className="text-xs text-neutral-600 truncate">
                        {[l.city, l.state].filter(Boolean).join(", ")}
                        {l.zip ? ` ${l.zip}` : ""}
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="font-mono uppercase tracking-wide">
                          {l.mls_number}
                        </span>
                        {typeof showPrice === "number" ? (
                          <span className="text-gold-700 font-medium">
                            ${showPrice.toLocaleString()}
                            {postType === "just_sold" ? " sold" : ""}
                          </span>
                        ) : null}
                      </div>
                      {postType === "open_house" && l.oh_start_at ? (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-emerald-50 ring-1 ring-emerald-200 px-2 py-1 text-[11px] font-medium text-emerald-800 leading-tight">
                          <span aria-hidden="true">🗓</span>
                          <span>{formatOhBadge(l.oh_start_at, l.oh_end_at ?? null)}</span>
                        </div>
                      ) : null}
                    </div>
                    {/* === AI Magic Design ✨ button (Phase C.1) ===
                        why: top-right corner so it's visible but doesn't
                        compete with the card's primary action (selecting
                        the listing). stopPropagation on click keeps the
                        parent's pickListing from firing — Magic Design has
                        its own listing context and shouldn't change which
                        listing is "selected" in the picker. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMagicDesignListing(l);
                      }}
                      title="Magic Design — let AI pick the best post for this listing"
                      aria-label={`Magic Design for ${l.address ?? l.mls_number}`}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-gold-50 text-gold-600 hover:bg-gold-100 hover:text-gold-700 ring-1 ring-gold-200/60 shadow-sm flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        aria-hidden="true"
                        className="w-4 h-4"
                      >
                        <path d="M8 1.5l1.6 4.4 4.4 1.6-4.4 1.6L8 13.5l-1.6-4.4L2 7.5l4.4-1.6z" />
                        <circle cx="13" cy="3" r="0.8" />
                        <circle cx="3" cy="13" r="0.8" />
                      </svg>
                    </button>
                  </div>
                );
              })}
              {filteredListings.length === 0 ? (
                <div className="text-sm text-neutral-500 px-2 py-6 text-center">
                  No listings match "{search}".
                </div>
              ) : null}
            </div>
          )}
        </section>
        ) : null}

        {/* Right: Format + Variant + Photo picker + Generate + Preview */}
        <section className="card p-5 min-h-[640px]">
          {!selectedListing ? (
            <EmptyPreview />
          ) : (
            <div className="flex flex-col h-full">
              <div className="mb-4 space-y-4">
                {/* Step 2 · Format — hidden in multi-OH mode (format was
                    chosen in the wizard and can't be changed here). */}
                {!isMultiOHPost ? (
                <div>
                  <div className="eyebrow mb-2">Step 2 · Format</div>
                  <div className="inline-flex rounded-lg ring-1 ring-neutral-200 bg-white overflow-hidden">
                    {FORMATS.map((fmt) => {
                      const active = fmt === format;
                      const meta = formatMeta[fmt];
                      return (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => changeFormat(fmt)}
                          className={[
                            "px-3.5 py-2 text-sm font-medium transition border-r border-neutral-200 last:border-r-0",
                            active
                              ? "bg-gold-100 text-gold-900"
                              : "text-neutral-700 hover:bg-neutral-50",
                          ].join(" ")}
                          title={meta.description}
                        >
                          {meta.display_name}
                          <span className="ml-1.5 text-[10px] opacity-60 font-mono">
                            {meta.aspect}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                ) : null}

                {/* Step 3 · Variant — hidden in multi-OH mode (per-property
                    card variant was chosen in the wizard). */}
                {!isMultiOHPost ? (
                <div>
                  <div className="eyebrow mb-2">
                    Step 3 · Variant{" "}
                    <span className="text-neutral-400 font-normal normal-case tracking-normal">
                      · live preview with this listing's photos
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {mergedVariantCards.map((v) => {
                      const isCustomCard = v.customTemplate !== null;
                      // why: for a custom card we still want to highlight
                      // it as "active" when the user has it selected. We
                      // track active by template_id (which is unique per
                      // card: factory id OR `custom_<uuid>`), not by
                      // variant — otherwise a non-default custom card
                      // would steal the active state from its factory
                      // sibling whenever both share `based_on_variant`.
                      const active = isCustomCard
                        ? false // custom-only "active" state TBD; for now custom cards never look pre-selected
                        : v.variant === variantId;
                      const photosAvailable = availablePhotos.length;
                      const insufficient =
                        photosAvailable > 0 && photosAvailable < v.photo_count;
                      const disabled = insufficient;
                      const previewHeroUrls = availablePhotos.length > 0
                        ? Array.from({ length: v.photo_count }, (_, i) =>
                            availablePhotos[(selectedPhotoIndex + i) % availablePhotos.length]?.url
                          ).filter((u): u is string => !!u)
                        : selectedListing?.hero_image_url
                          ? [selectedListing.hero_image_url]
                          : [];
                      const cardCanvasTemplate = findCanvasTemplate(
                        postType,
                        v.variant as PostVariant,
                        format,
                      );
                      const studioAvailable =
                        !disabled &&
                        cardCanvasTemplate !== null &&
                        !!selectedListing;
                      // why: clicking a custom card needs to bypass the
                      // factory-variant routing — the editor must load
                      // `fabric_json` instead of the factory schema. We
                      // open Studio directly via openStudioForCustomTemplate
                      // (no "activate then save" gating). Factory cards keep
                      // the original "activate variant only" click semantics
                      // so caption generation still routes through the
                      // factory variant path.
                      const handleCardClick = (): void => {
                        if (disabled) return;
                        if (isCustomCard && v.customTemplate) {
                          openStudioForCustomTemplate({
                            id: v.customTemplate.id,
                            name: v.customTemplate.name,
                            fabricJson: v.customTemplate.fabricJson,
                            isDefault: v.customTemplate.isDefault,
                            basedOnVariant: v.variant as PostVariant,
                          });
                          return;
                        }
                        changeVariant(v.variant as PostVariant);
                      };
                      return (
                        <button
                          key={v.template_id}
                          type="button"
                          onClick={handleCardClick}
                          disabled={disabled}
                          title={
                            insufficient
                              ? `Needs ${v.photo_count} photos — this listing only has ${photosAvailable}.`
                              : v.card_description
                          }
                          aria-label={
                            isCustomCard
                              ? `Open custom template ${v.card_display_name} in Studio`
                              : `Activate ${v.card_display_name}`
                          }
                          className={[
                            "group text-left rounded-xl border p-2.5 transition relative flex flex-col",
                            disabled
                              ? "border-neutral-200 bg-neutral-50 cursor-not-allowed opacity-60"
                              : active
                                ? "border-gold-500 bg-gold-50/40 ring-2 ring-gold-500/30 shadow-sm cursor-pointer hover:ring-gold-500/50"
                                : "border-neutral-200 bg-white cursor-pointer hover:border-gold-300 hover:ring-2 hover:ring-gold-300/40 hover:shadow-sm",
                          ].join(" ")}
                        >
                          {/* Large preview on top */}
                          <div className="relative">
                            {isCustomCard && v.customTemplate?.previewImageUrl ? (
                              // why: custom cards show the user-authored PNG
                              // captured at save-time. We render directly via
                              // <img> rather than VariantPreviewThumb because
                              // VariantPreviewThumb hits the HTML primitive
                              // renderer (factory variants only) — there's no
                              // equivalent runtime for Fabric custom JSON yet.
                              // The preview was captured at 0.5x multiplier so
                              // the file is small; we let it scale to fit.
                              <div className="relative aspect-square w-full overflow-hidden rounded-md bg-neutral-100 ring-1 ring-neutral-200">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={v.customTemplate.previewImageUrl}
                                  alt={`Preview of ${v.card_display_name}`}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                            ) : (
                              <VariantPreviewThumb
                                templateId={v.template_id}
                                listing={selectedListing}
                                heroUrls={previewHeroUrls}
                                format={format}
                                disabled={disabled}
                                size="large"
                              />
                            )}
                            {/* Custom indicator badge — top-left corner so it
                                doesn't collide with the hover-Edit affordance
                                (top-right). Gold pill matches the brand. */}
                            {isCustomCard ? (
                              <span
                                className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-gold-500/95 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-900 shadow-md backdrop-blur-sm"
                                aria-label={
                                  v.customTemplate?.isDefault
                                    ? "Custom default template"
                                    : "Custom template"
                                }
                                title={
                                  v.customTemplate?.isDefault
                                    ? "Custom · default for this slot"
                                    : "Custom template"
                                }
                              >
                                <svg
                                  width="10"
                                  height="10"
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                </svg>
                                {v.customTemplate?.isDefault ? "Default" : "Custom"}
                              </span>
                            ) : null}
                            {/* Factory cards keep the hover-Edit pill on
                                top-right. Custom cards don't render it
                                because clicking the card body already opens
                                Studio for them. */}
                            {!isCustomCard && studioAvailable ? (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openStudioForVariant(v.variant as PostVariant);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openStudioForVariant(
                                      v.variant as PostVariant,
                                    );
                                  }
                                }}
                                aria-label={`Edit ${v.card_display_name} in Studio (skip caption)`}
                                title={`Edit ${v.card_display_name} in Studio (skip caption)`}
                                className="absolute top-2 right-2 inline-flex cursor-pointer items-center gap-1 rounded-full bg-gold-500/95 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-900 opacity-0 shadow-md backdrop-blur-sm transition-opacity duration-150 hover:bg-gold-500 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 group-hover:opacity-100"
                              >
                                <svg
                                  width="10"
                                  height="10"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M11 2l3 3-9 9H2v-3l9-9z" />
                                  <path d="M9.5 3.5l3 3" />
                                </svg>
                                Edit
                              </span>
                            ) : null}
                          </div>
                          {/* Label row */}
                          <div className="mt-2 flex items-center justify-between gap-1">
                            <div
                              className={[
                                "text-sm font-semibold truncate",
                                disabled
                                  ? "text-neutral-500"
                                  : active
                                    ? "text-gold-800"
                                    : "text-neutral-900",
                              ].join(" ")}
                            >
                              {v.card_display_name}
                            </div>
                            <span
                              className={[
                                "text-[10px] font-mono px-1.5 py-px rounded-full flex-shrink-0",
                                disabled
                                  ? "bg-rose-100 text-rose-700"
                                  : v.photo_count > 1
                                    ? "bg-gold-100 text-gold-800"
                                    : "bg-neutral-100 text-neutral-600",
                              ].join(" ")}
                            >
                              {v.photo_count}📷
                            </span>
                          </div>
                          <div
                            className={[
                              "text-[11px] mt-1 leading-snug line-clamp-2",
                              disabled ? "text-rose-700" : "text-neutral-500",
                            ].join(" ")}
                          >
                            {insufficient
                              ? `Needs ${v.photo_count} photos · only ${photosAvailable} available`
                              : v.card_description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                ) : null}
              </div>

              {/* Photo picker — single-select. Hidden in multi-OH mode
                  (the hero render uses a designed graphic, not a chosen
                  hero photo; per-property slides each carry their own
                  photo already selected by the wizard). */}
              {!isMultiOHPost && availablePhotos.length > 1 ? (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="eyebrow">
                      {`Step 4 · ${photoCount === 1 ? "Hero photo" : `${photoCount} photos`}${
                        photoCount === 1
                          ? ` · ${selectedPhotoIndex + 1} of ${availablePhotos.length}`
                          : ` · slots ${(selectedPhotoIndex % availablePhotos.length) + 1}–${((selectedPhotoIndex + photoCount - 1) % availablePhotos.length) + 1}`
                      }`}
                    </div>
                    {photosLoading ? (
                      <span className="text-xs text-neutral-500">Loading…</span>
                    ) : null}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {availablePhotos.map((p, i) => {
                      // IG single-image rolling window from selectedPhotoIndex sized by photoCount
                      const slotPosition = computeSlotPosition(
                        i,
                        selectedPhotoIndex,
                        photoCount,
                        availablePhotos.length,
                      );
                      const inSlot = slotPosition !== null;
                      const isPrimary = slotPosition === 0;
                      return (
                        <button
                          key={`${p.sequence}-${i}`}
                          type="button"
                          onClick={() => pickPhoto(i)}
                          className={[
                            "relative shrink-0 rounded-lg overflow-hidden transition",
                            inSlot
                              ? isPrimary
                                ? "ring-2 ring-gold-500 ring-offset-2 ring-offset-white"
                                : "ring-2 ring-gold-300 ring-offset-1 ring-offset-white"
                              : "ring-1 ring-neutral-200 hover:ring-neutral-400",
                          ].join(" ")}
                          title={
                            inSlot
                              ? `Photo ${p.sequence} · slot ${slotPosition + 1}`
                              : `Photo ${p.sequence}`
                          }
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.url}
                            alt=""
                            className="w-24 h-24 object-cover bg-neutral-100"
                            loading="lazy"
                          />
                          <span
                            className={[
                              "absolute bottom-1 left-1 rounded-full px-1.5 py-px text-[10px] font-semibold",
                              isPrimary
                                ? "bg-gold-500 text-neutral-900"
                                : inSlot
                                  ? "bg-gold-300 text-neutral-900"
                                  : "bg-black/55 text-white",
                            ].join(" ")}
                          >
                            {inSlot && photoCount > 1
                              ? `#${slotPosition + 1}`
                              : p.sequence || "★"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Generate header + button — hidden in multi-OH mode.
                  Re-rendering a multi-OH carousel has to go through the
                  wizard pipeline (event hero render + per-property render
                  per slide), not the single-listing factory pipeline this
                  button drives. The multi-OH banner up top offers
                  "Start a new Multi-OH" instead. */}
              {!isMultiOHPost ? (
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="eyebrow mb-1">
                    Step {availablePhotos.length > 1 ? "5" : "4"} · Generate
                  </div>
                  <h2 className="text-lg font-semibold text-neutral-900">
                    {selectedListing.address ?? selectedListing.mls_number}
                  </h2>
                  <div className="text-sm text-neutral-600">
                    {POST_TYPES.find((p) => p.id === postType)?.label} ·{" "}
                    {formatMeta[format].display_name} ({formatMeta[format].aspect}) ·{" "}
                    {variants.find((v) => v.variant === variantId)?.display_name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating}
                  className="btn-primary"
                >
                  {generating ? "Generating…" : renderResult ? "Regenerate" : "Generate"}
                </button>
              </div>
              ) : null}

              {error ? (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1">
                {/* Preview pane */}
                <div className="flex flex-col">
                  <div className="eyebrow mb-2">
                    {`Preview · ${dimensionsLabel(format)}`}
                  </div>
                  <div
                    className={[
                      "relative rounded-xl bg-neutral-100 border border-neutral-200 overflow-hidden mx-auto w-full max-w-md",
                      previewAspectClass,
                    ].join(" ")}
                  >
                    {generating ? (
                      <PreviewSkeleton />
                    ) : renderResult ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={renderResult.image_url}
                        alt="Generated post preview"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500 px-6 text-center">
                        Click Generate Post to render.
                      </div>
                    )}
                    {/* Cycle hero button — overlay on the preview when
                        there's something to cycle. Hidden in multi-OH
                        mode (the hero is a designed graphic, not a
                        listing photo — cycling makes no sense). */}
                    {!isMultiOHPost && availablePhotos.length > 1 ? (
                      <button
                        type="button"
                        onClick={cyclePhoto}
                        className="absolute top-2 right-2 rounded-full bg-black/65 hover:bg-black/80 text-white text-xs font-medium px-3 py-1.5 backdrop-blur-sm transition"
                        title="Cycle to next photo"
                      >
                        Next photo →
                      </button>
                    ) : null}
                  </div>
                  {renderResult ? (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={downloadPng}
                        disabled={downloadSaving}
                        className="btn-primary flex-1 min-w-[120px]"
                      >
                        {downloadSaving ? "Saving…" : "Download PNG"}
                      </button>
                      {/* === Canvas Editor (Path C) — Edit in Studio on the preview screen ===
                          why: replaces the old V1 Customize button that lived here. Only shows
                          when a canvas template exists for the current (postType, variantId,
                          format) tuple AND a listing is selected. */}
                      {studioTemplate && selectedListing ? (
                        <button
                          type="button"
                          onClick={openStudio}
                          className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-gold-500 bg-white px-4 py-2.5 text-sm font-semibold text-gold-800 transition-colors hover:bg-gold-50 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                          title="Open this post in the Studio editor for fine-tuning"
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
                            <path d="M11 2l3 3-9 9H2v-3l9-9z" />
                            <path d="M9.5 3.5l3 3" />
                          </svg>
                          Edit in Studio
                        </button>
                      ) : null}
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={openPostNow}
                          className="btn-secondary flex-1 min-w-[120px]"
                          title="Publish directly to Facebook + Instagram"
                        >
                          Post Now →
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Caption pane — Phase D: per-platform tabs */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <div className="eyebrow">Caption + hashtags</div>
                    {captionResult ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={regenerateCaption}
                          disabled={regeneratingCaption}
                          className="text-xs text-neutral-600 font-medium hover:text-neutral-900 disabled:opacity-50"
                          title="Re-write all three platform captions with AI (keeps the image)"
                        >
                          {regeneratingCaption ? "Rewriting…" : "↻ Regenerate all"}
                        </button>
                        <button
                          type="button"
                          onClick={copyCaption}
                          className="text-xs text-gold-700 font-medium hover:text-gold-800"
                        >
                          {copyState === "copied" ? "✓ Copied" : "Copy all"}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Phase D — platform tabs. IG / FB / TikTok each have
                      independent edits. Tabs render even pre-Generate so
                      the structure is consistent (the textarea below
                      shows the platform-specific placeholder). */}
                  <div
                    role="tablist"
                    aria-label="Caption platform"
                    className="mb-2 flex gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1"
                  >
                    {CAPTION_PLATFORMS.map((p) => {
                      const active = activeCaptionPlatform === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setActiveCaptionPlatform(p)}
                          className={`flex-1 rounded text-xs font-semibold uppercase tracking-wider transition-colors py-1.5 ${
                            active
                              ? "bg-white text-neutral-900 shadow-sm"
                              : "text-neutral-500 hover:text-neutral-800"
                          }`}
                        >
                          {CAPTION_PLATFORM_LABELS[p]}
                        </button>
                      );
                    })}
                  </div>

                  <textarea
                    className="input flex-1 min-h-[260px] font-mono text-[13px] leading-relaxed resize-y"
                    placeholder={
                      generating
                        ? "Generating caption…"
                        : `${CAPTION_PLATFORM_LABELS[activeCaptionPlatform]} caption + hashtags will appear here after Generate.`
                    }
                    value={editedCaptions[activeCaptionPlatform]}
                    onChange={(e) =>
                      setEditedCaptions((prev) => ({
                        ...prev,
                        [activeCaptionPlatform]: e.target.value,
                      }))
                    }
                  />

                  {/* Phase D — Copy-from-IG bootstrap. Surfaces only on
                      the FB / TikTok tabs so the user can jump-start a
                      variant from the IG version when the AI's take
                      isn't quite right. Hidden on the IG tab itself
                      (would be a no-op). */}
                  {captionResult && activeCaptionPlatform !== "instagram" ? (
                    <button
                      type="button"
                      onClick={() =>
                        setEditedCaptions((prev) => ({
                          ...prev,
                          [activeCaptionPlatform]: prev.instagram,
                        }))
                      }
                      className="mt-2 self-start text-[11px] font-medium text-neutral-500 hover:text-gold-700"
                    >
                      ← Copy from Instagram
                    </button>
                  ) : null}

                  {captionResult ? (
                    <div className="mt-3 text-xs text-neutral-500 leading-relaxed">
                      The MLS hashtag{" "}
                      <code className="font-mono text-neutral-700 bg-neutral-100 px-1 rounded">
                        {captionResult.mls_hashtag}
                      </code>{" "}
                      is baked into every platform tab so once Larissa
                      posts, the auto-linker ties it back to this listing
                      automatically.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {postNowOpen ? (
        <PostNowModal
          previewImageUrl={renderResult?.image_url ?? null}
          listingLabel={
            selectedListing
              ? `${selectedListing.address ?? selectedListing.mls_number}`
              : ""
          }
          captionPreview={editedCaption}
          platforms={postNowPlatforms}
          onTogglePlatform={togglePostNowPlatform}
          armedAt={postNowArmedAt}
          sending={postNowSending}
          results={postNowResults}
          onCancel={closePostNow}
          onConfirm={submitPostNow}
          onSchedule={submitSchedule}
          testMode={currentTestMode}
          onSetTestMode={handleSetTestMode}
          testModeSaving={testModeSaving}
          globalTestModeOn={globalTestModeOn}
          error={error}
          onClearError={() => setError(null)}
          // why: pass the actual slide count so the platform cards' copy
          // can describe carousels accurately. hero (1) + extra slides.
          slideCount={1 + carouselSlides.length}
        />
      ) : null}
      {/* === Canvas Editor (Path C) — overlay portal ===
          why: rendered at the top level of the component's JSX so it covers
          all underlying UI including the PostNowModal. Unmounts entirely when
          closed (no idle Fabric memory cost). studioContext is hydrated at
          open-time so the editor's useEffect doesn't refire on parent renders. */}
      {/* === AI Magic Design modal (Phase C.1) ===
          why: rendered above Studio overlay because Magic Design ALWAYS
          closes itself before opening Studio (handleMagicDesignApply does
          setMagicDesignListing(null) then setStudioOpen(true)). So in
          practice the two are never visible at the same time; rendering
          order is mostly cosmetic. Mount-on-non-null pattern means the
          modal's first useEffect fires the design action automatically. */}
      {magicDesignListing ? (
        <MagicDesignModal
          listing={magicDesignListing}
          // why: officeProfile null for MVP — the post-builder page doesn't
          // currently load office data. Wiring office hand-off through
          // page.tsx → PostBuilderClient is a one-line addition once we
          // want sharper, market-scoped recommendations. The action +
          // prompt already handle the optional shape.
          officeProfile={null}
          // why: magicDesignPhotos hydrates async from /api/post-builder/photos
          // — pass an empty array while loading and the modal stays in
          // its spinner state. As soon as photos arrive the action fires.
          availablePhotos={magicDesignPhotos}
          onCancel={() => setMagicDesignListing(null)}
          onApply={handleMagicDesignApply}
        />
      ) : null}
      <CanvasEditorOverlay
        open={studioOpen}
        onClose={handleStudioClose}
        template={studioContext?.template ?? null}
        listing={studioContext?.listing ?? null}
        onSave={handleStudioSave}
        saveLabel="Save Post"
        onTemplateSwitched={handleStudioTemplateSwitched}
        onResize={handleStudioResize}
        onMakeReel={handleMakeReelFromStudio}
        isAdmin={isAdmin}
        onUploadBrandAsset={uploadBrandAssetAction}
        onArchiveBrandAsset={async (id) =>
          archiveBrandAssetAction({ id })
        }
        customTemplate={studioContext?.customTemplate}
        onSaveAsTemplate={async (input) => {
          const res = await saveCustomTemplateAction(input);
          if (res.ok) {
            // why: refresh the variant grid so the just-saved template
            // appears immediately. We also patch the live studioContext
            // when this was an INSERT, so subsequent saves from the same
            // session UPDATE the row instead of inserting a sibling.
            void refetchCustomTemplates();
            if (input.id === null) {
              setStudioContext((prev) =>
                prev
                  ? {
                      ...prev,
                      customTemplate: {
                        id: res.id,
                        name: input.name,
                        isDefault: input.makeDefault,
                        // keep the existing canvas state; the user can still
                        // edit until they explicitly close the editor.
                        fabricJson:
                          prev.customTemplate?.fabricJson ?? input.fabricJson,
                      },
                    }
                  : prev,
              );
            } else {
              setStudioContext((prev) =>
                prev
                  ? {
                      ...prev,
                      customTemplate: prev.customTemplate
                        ? {
                            ...prev.customTemplate,
                            name: input.name,
                            isDefault: input.makeDefault,
                          }
                        : prev.customTemplate,
                    }
                  : prev,
              );
            }
          }
          return res;
        }}
        carousel={{
          slides: carouselSlides,
          onSlidesChanged: setCarouselSlides,
          // why: availablePhotos is already loaded on listing-pick — same
          // source the in-canvas Photos panel reads from. Mapped to the
          // narrower {url, sequence} shape the picker expects.
          availableListingPhotos: availablePhotos.map((p) => ({
            url: p.url,
            sequence: p.sequence,
          })),
          // why: most-recently-saved hero render — drives the Preview
          // overlay's slide-0. Null when the user hasn't saved yet; Preview
          // surfaces a "Save first" placeholder in that case.
          heroImageUrl: renderResult?.image_url ?? null,
          // why: Multi-OH per-slide edit. Only surface the pencil
          // affordance on slides where we actually have source metadata
          // to drive a re-open — otherwise (single-listing carousel
          // where slides are raw listing photos) clicking pencil would
          // open Studio with nothing meaningful to edit.
          onSlideEditClick:
            slideMetadata.length > 0 ? handleSlideEditClick : undefined,
        }}
      />
      {/* Part 2 (Phase D) — Make-a-Reel follow-up prompt. Renders only
          when a Studio save just completed for a real listing. The user
          dismisses by clicking either button; "Skip" closes the prompt
          while "Make a Reel" navigates to Reel Studio with the listing
          pre-selected. Non-blocking modal — backdrop click dismisses to
          Skip. */}
      {makeReelPromptState ? (
        <MakeReelPromptModal
          mls={makeReelPromptState.mls}
          onMakeReel={() => navigateToReelStudio(makeReelPromptState.mls)}
          onSkip={() => setMakeReelPromptState(null)}
        />
      ) : null}
    </div>
  );
}

interface PostNowModalProps {
  previewImageUrl: string | null;
  listingLabel: string;
  captionPreview: string;
  platforms: Set<PostPlatform>;
  onTogglePlatform: (p: PostPlatform) => void;
  armedAt: number | null;
  sending: boolean;
  results: PostNowResult[] | null;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * Schedule callback. Receives a ScheduledFor map keyed by platform → ISO
   * UTC timestamp. Only platforms the user has both selected AND given a
   * valid future timestamp are present. Returns a Promise so the modal can
   * disable the button while the action runs.
   */
  onSchedule: (scheduledFor: ScheduledFor) => Promise<void>;
  /**
   * 2026-05-16 — per-post test_mode toggle.
   *   testMode        — current row state (true = drafts only).
   *   onSetTestMode   — flips the value; awaits the server write.
   *   testModeSaving  — true while the server action is in flight.
   *   globalTestModeOn — system_config.publish_test_mode; surfaces a
   *                     small "Test mode is the default" pill above the
   *                     toggle so the user understands where they are.
   */
  testMode: boolean;
  onSetTestMode: (next: boolean) => Promise<void>;
  testModeSaving: boolean;
  globalTestModeOn: boolean;
  /**
   * Latest error message from the parent (Save failed / Post Now threw /
   * scope error). Rendered inside the modal so it's visible to the user;
   * the page-level banner is hidden behind the modal overlay so any
   * failures during the publish flow would otherwise be invisible.
   */
  error: string | null;
  /** Callback to clear the parent's error state from inside the modal. */
  onClearError: () => void;
  /**
   * Total slides in the post (hero + extra carousel slides). Drives the
   * "single photo" vs "N-photo carousel" copy on the platform cards.
   */
  slideCount: number;
}

const POST_NOW_ARM_MS = 2000;

function PostNowModal(props: PostNowModalProps) {
  const {
    previewImageUrl,
    listingLabel,
    captionPreview,
    platforms,
    onTogglePlatform,
    armedAt,
    sending,
    results,
    onCancel,
    onConfirm,
    onSchedule,
    testMode,
    onSetTestMode,
    testModeSaving,
    globalTestModeOn,
    error,
    onClearError,
    slideCount,
  } = props;

  // why: drive the per-platform copy off the real slide count. 1 slide
  // → "single photo / image", 2+ → "N-photo carousel". TT photo accepts
  // up to 35; IG carousel caps at 10; FB has no hard limit.
  const isCarousel = slideCount >= 2;
  const fbCardCopy = isCarousel
    ? `Posts a ${slideCount}-photo album to the Alliance Page.`
    : `Posts a single photo to the Alliance Page.`;
  const igCardCopy = isCarousel
    ? slideCount > 10
      ? `Posts a 10-image carousel to the Alliance IG (IG caps carousels at 10; ${slideCount - 10} slide${slideCount - 10 === 1 ? "" : "s"} will be trimmed).`
      : `Posts a ${slideCount}-image carousel to the Alliance IG.`
    : `Posts a single image to the Alliance IG.`;

  const [, forceTick] = useState(0);
  // why: tab between Post Now and Schedule. Defaults to "now" so the
  // existing button-mash flow keeps working without an extra click. The
  // user explicitly switches to "schedule" for the new path.
  const [tab, setTab] = useState<"now" | "schedule">("now");

  // Per-platform datetime-local strings. Native input type="datetime-local"
  // gives "YYYY-MM-DDTHH:mm" in the user's LOCAL timezone. We hold them
  // here exactly as the input produces them and only convert to UTC ISO
  // on submit. Keys are platform names; missing key = empty input.
  const [scheduleInputs, setScheduleInputs] = useState<
    Partial<Record<PostPlatform, string>>
  >({});

  // Tick every 50ms while arming so the progress bar animates smoothly.
  useEffect(() => {
    if (!armedAt || results) return;
    const elapsed = Date.now() - armedAt;
    if (elapsed >= POST_NOW_ARM_MS) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 50);
    return () => clearInterval(interval);
  }, [armedAt, results]);

  // why: when the user switches to the Schedule tab OR toggles a platform
  // on while already in the Schedule tab, pre-fill that platform's input
  // with its next optimal window. This is the "highest-probability good
  // time" default — Larissa can override, but she shouldn't have to think
  // about it on the happy path.
  useEffect(() => {
    if (tab !== "schedule") return;
    setScheduleInputs((prev) => {
      const next = { ...prev };
      for (const p of platforms) {
        if (next[p]) continue;
        next[p] = computeDefaultScheduleInput(p);
      }
      // Remove inputs for platforms that have been unchecked.
      for (const k of Object.keys(next) as PostPlatform[]) {
        if (!platforms.has(k)) delete next[k];
      }
      return next;
    });
  }, [tab, platforms]);

  const armElapsed = armedAt ? Math.min(Date.now() - armedAt, POST_NOW_ARM_MS) : 0;
  const armed = armElapsed >= POST_NOW_ARM_MS;
  const armPct = Math.round((armElapsed / POST_NOW_ARM_MS) * 100);

  const canConfirm = platforms.size > 0 && armed && !sending && !results;

  // Trim caption preview for the modal (we have textarea on the main page).
  const captionShort = captionPreview.length > 280
    ? captionPreview.slice(0, 280).trimEnd() + "…"
    : captionPreview;

  // ---- Schedule tab derived state -------------------------------------
  // why: For the Schedule tab we count platforms with valid FUTURE
  // timestamps. We also flag any past timestamp so the button can show
  // a clear "fix the past time first" disabled state.
  const nowMs = Date.now();
  const scheduleEntries: Array<{
    platform: PostPlatform;
    localValue: string;
    iso: string | null;
    isFuture: boolean;
  }> = [...platforms].map((p) => {
    const localValue = scheduleInputs[p] ?? "";
    const parsed = localValue ? Date.parse(localValue) : NaN;
    const iso = !Number.isNaN(parsed) ? new Date(parsed).toISOString() : null;
    return {
      platform: p,
      localValue,
      iso,
      isFuture: iso !== null && parsed - nowMs > 60_000,
    };
  });
  const validFutureCount = scheduleEntries.filter((e) => e.isFuture).length;
  const anyPast = scheduleEntries.some(
    (e) => e.localValue !== "" && !e.isFuture,
  );

  /**
   * Build the ScheduledFor map from the current inputs and invoke the
   * parent's onSchedule. Skips platforms with empty / past timestamps —
   * the disabled button state should prevent the empty case, but we
   * defend in depth here too.
   */
  async function handleSchedule(): Promise<void> {
    const scheduledFor: ScheduledFor = {};
    for (const entry of scheduleEntries) {
      if (entry.isFuture && entry.iso) {
        scheduledFor[entry.platform] = entry.iso;
      }
    }
    if (Object.keys(scheduledFor).length === 0) return;
    await onSchedule(scheduledFor);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        // Click outside cancels (only when not mid-send).
        if (e.target === e.currentTarget && !sending) onCancel();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-neutral-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              {testMode ? (
                <div className="eyebrow text-amber-700 mb-1">
                  ⚑ Test mode · drafts only
                </div>
              ) : (
                <div className="eyebrow text-rose-700 mb-1">
                  ⚠ Live publish · admin only
                </div>
              )}
              <h3 className="text-lg font-bold text-neutral-900">Post Now</h3>
              <div className="text-sm text-neutral-600 mt-0.5">
                {testMode
                  ? "Publishes to platform drafts only — Page Drafts on FB, container-only on IG, app inbox on TikTok. Nothing public."
                  : "Publishes this image directly to Meta. There is no preview step on Facebook or Instagram once submitted."}
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={sending}
              className="text-neutral-400 hover:text-neutral-700 text-xl font-light disabled:opacity-40 flex-shrink-0"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* why: surface parent errors INSIDE the modal so a failing
              Post Now (save failed, network error, publish error) is
              visible to the user. Without this the error banner renders
              on the page underneath the modal overlay and is invisible
              while the modal is open — which produced the "click confirm
              and nothing happens" symptom. */}
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 break-words">{error}</div>
              <button
                type="button"
                onClick={onClearError}
                className="text-rose-700 hover:text-rose-900 text-xs font-semibold whitespace-nowrap"
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {/* Tab toggle — Post Now vs Schedule. Hidden once results land
              because by then the post-now flow is done. */}
          {!results ? (
            <div
              className="grid grid-cols-2 rounded-lg bg-neutral-100 p-1"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "now"}
                onClick={() => setTab("now")}
                disabled={sending}
                className={[
                  "px-3 py-1.5 rounded-md text-sm font-medium transition",
                  tab === "now"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-900",
                ].join(" ")}
              >
                Post Now
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "schedule"}
                onClick={() => setTab("schedule")}
                disabled={sending}
                className={[
                  "px-3 py-1.5 rounded-md text-sm font-medium transition",
                  tab === "schedule"
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-900",
                ].join(" ")}
              >
                Schedule
              </button>
            </div>
          ) : null}

          {/* Asset summary */}
          <div className="flex gap-3 items-start rounded-lg bg-neutral-50 ring-1 ring-neutral-200 p-3">
            {previewImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewImageUrl}
                alt=""
                className="w-16 h-16 rounded-md object-cover bg-neutral-100 flex-shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-md bg-gradient-to-br from-gold-100 to-gold-200 flex items-center justify-center flex-shrink-0">
                <span className="text-2xl">📦</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-neutral-900 truncate">
                {listingLabel}
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                1 designed image · IG single post
              </div>
            </div>
          </div>

          {/* 2026-05-16 — per-post Test / Live toggle. Test routes
              publishers through hidden/draft paths (FB Drafts, IG container
              only, TikTok app inbox); Live publishes for real. The current
              value is persisted to generated_posts.test_mode the moment
              the user flips, so any cron tick OR the Post Now button below
              both pick up the right value. */}
          <div className="rounded-lg ring-1 ring-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
                  Publish mode
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {testMode
                    ? "Test mode — drafts only, no follower sees this"
                    : "Live — this post goes public when you click Post Now"}
                </div>
                {globalTestModeOn ? (
                  <div className="mt-1 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 ring-1 ring-amber-300">
                    Global default: Test
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 rounded-md ring-1 ring-neutral-300 bg-white overflow-hidden">
                <button
                  type="button"
                  disabled={testModeSaving || sending}
                  onClick={() => {
                    if (!testMode) return; // already off
                    void onSetTestMode(false);
                  }}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold transition",
                    !testMode
                      ? "bg-emerald-600 text-white"
                      : "text-neutral-700 hover:bg-neutral-100",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                  aria-pressed={!testMode}
                >
                  Live
                </button>
                <button
                  type="button"
                  disabled={testModeSaving || sending}
                  onClick={() => {
                    if (testMode) return; // already on
                    void onSetTestMode(true);
                  }}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold transition border-l border-neutral-300",
                    testMode
                      ? "bg-amber-500 text-neutral-900"
                      : "text-neutral-700 hover:bg-neutral-100",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                  aria-pressed={testMode}
                >
                  Test
                </button>
              </div>
            </div>
          </div>

          {/* Platform pickers */}
          <div>
            <div className="eyebrow mb-2">Publish to</div>
            <div className="space-y-2">
              <label
                className={[
                  "flex items-start gap-3 rounded-lg p-3 cursor-pointer transition ring-1",
                  platforms.has("facebook")
                    ? "bg-blue-50 ring-blue-300"
                    : "bg-white ring-neutral-200 hover:bg-neutral-50",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={platforms.has("facebook")}
                  onChange={() => onTogglePlatform("facebook")}
                  disabled={sending || !!results}
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-neutral-900">Facebook Page</div>
                  <div className="text-xs text-neutral-600 mt-0.5">{fbCardCopy}</div>
                </div>
              </label>

              <label
                className={[
                  "flex items-start gap-3 rounded-lg p-3 transition ring-1",
                  platforms.has("instagram")
                    ? "bg-pink-50 ring-pink-300 cursor-pointer"
                    : "bg-white ring-neutral-200 hover:bg-neutral-50 cursor-pointer",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={platforms.has("instagram")}
                  onChange={() => onTogglePlatform("instagram")}
                  disabled={sending || !!results}
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-neutral-900">Instagram Business</div>
                  <div className="text-xs text-neutral-600 mt-0.5">{igCardCopy}</div>
                </div>
              </label>

              <label
                className={[
                  "flex items-start gap-3 rounded-lg p-3 transition ring-1",
                  platforms.has("tiktok")
                    ? "bg-neutral-900/10 ring-neutral-400 cursor-pointer"
                    : "bg-white ring-neutral-200 hover:bg-neutral-50 cursor-pointer",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={platforms.has("tiktok")}
                  onChange={() => onTogglePlatform("tiktok")}
                  disabled={sending || !!results}
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-neutral-900">TikTok</div>
                  <div className="text-xs text-neutral-600 mt-0.5">
                    {testMode
                      ? "Test mode → lands in the TikTok app drafts inbox (publish manually from the app)."
                      : "Posts to the Alliance TikTok account."}
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Schedule pane — only when Schedule tab is active AND at least
              one platform is selected. Each selected platform gets its own
              datetime-local input pre-filled with its optimal window. */}
          {tab === "schedule" && !results ? (
            <div>
              <div className="eyebrow mb-2">When to publish (ET)</div>
              {platforms.size === 0 ? (
                <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3 text-xs text-amber-900">
                  Pick at least one platform above to schedule it.
                </div>
              ) : (
                <div className="space-y-2">
                  {scheduleEntries.map((entry) => {
                    const window = OPTIMAL_POSTING_WINDOWS[entry.platform];
                    const hasInput = entry.localValue !== "";
                    const showPastWarning = hasInput && !entry.isFuture;
                    return (
                      <div
                        key={entry.platform}
                        className="rounded-lg ring-1 ring-neutral-200 bg-white p-3"
                      >
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <div className="text-sm font-semibold capitalize text-neutral-900">
                            {entry.platform}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            Optimal: {window.label}
                          </div>
                        </div>
                        <input
                          type="datetime-local"
                          value={entry.localValue}
                          min={getDateTimeLocalNow()}
                          disabled={sending}
                          onChange={(e) =>
                            setScheduleInputs((prev) => ({
                              ...prev,
                              [entry.platform]: e.target.value,
                            }))
                          }
                          className={[
                            "w-full rounded-md border px-3 py-2 text-sm font-mono transition",
                            showPastWarning
                              ? "border-rose-300 bg-rose-50 text-rose-900"
                              : "border-neutral-300 bg-white text-neutral-900 focus:border-gold-500 focus:ring-1 focus:ring-gold-500",
                          ].join(" ")}
                        />
                        {showPastWarning ? (
                          <div className="mt-1 text-[11px] text-rose-700">
                            Pick a time at least 1 minute in the future.
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {/* Caption preview */}
          <div>
            <div className="eyebrow mb-2">Caption</div>
            <div className="rounded-lg bg-neutral-50 ring-1 ring-neutral-200 p-3 text-xs font-mono text-neutral-700 max-h-[140px] overflow-y-auto whitespace-pre-wrap">
              {captionShort || <span className="italic text-neutral-400">(empty)</span>}
            </div>
          </div>

          {/* Results display */}
          {results ? (
            <div className="space-y-2">
              <div className="eyebrow">Results</div>
              {results.map((r) => (
                <div
                  key={r.platform}
                  className={[
                    "rounded-lg p-3 ring-1 text-sm",
                    r.ok
                      ? "bg-emerald-50 ring-emerald-200 text-emerald-900"
                      : "bg-rose-50 ring-rose-200 text-rose-900",
                  ].join(" ")}
                >
                  <div className="font-semibold capitalize">
                    {r.ok ? "✓" : "✗"} {r.platform}
                  </div>
                  {r.ok ? (
                    r.permalink ? (
                      <a
                        href={r.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline text-emerald-800 hover:text-emerald-900"
                      >
                        View post →
                      </a>
                    ) : (
                      <div className="text-xs text-emerald-800">
                        ID: <code className="font-mono">{r.platform_post_id}</code>
                      </div>
                    )
                  ) : (
                    <div className="text-xs mt-1 leading-relaxed">
                      {r.error}
                      {r.scope_error ? (
                        <div className="mt-1 font-medium">
                          → Re-authorize the Meta app in /settings.
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="p-5 border-t border-neutral-200 bg-neutral-50 rounded-b-2xl">
          {results ? (
            <button
              type="button"
              onClick={onCancel}
              className="btn-primary w-full"
            >
              Close
            </button>
          ) : tab === "schedule" ? (
            // Schedule tab — primary action queues to /api/cron drain.
            // No hold-to-confirm; scheduling is reversible (unschedule
            // before the cron tick fires) so it doesn't need the same
            // friction as Post Now.
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={sending}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSchedule();
                }}
                disabled={sending || validFutureCount === 0 || anyPast}
                className={[
                  "flex-[1.4] rounded-lg px-4 py-2.5 text-sm font-semibold transition",
                  sending || validFutureCount === 0 || anyPast
                    ? "bg-neutral-200 text-neutral-500 cursor-not-allowed"
                    : "bg-gold-600 text-white hover:bg-gold-700 shadow-sm",
                ].join(" ")}
              >
                {sending
                  ? "Scheduling…"
                  : platforms.size === 0
                    ? "Pick a platform"
                    : anyPast
                      ? "Fix past time(s)"
                      : validFutureCount === 0
                        ? "Set a future time"
                        : `Schedule ${validFutureCount} post${validFutureCount === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Arming progress bar */}
              {!armed && armedAt ? (
                <div>
                  <div className="text-xs text-neutral-600 mb-1.5 flex items-center justify-between">
                    <span>Confirming intent…</span>
                    <span className="font-mono">{Math.ceil((POST_NOW_ARM_MS - armElapsed) / 1000)}s</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-200 overflow-hidden">
                    <div
                      className="h-full bg-rose-500 transition-all"
                      style={{ width: `${armPct}%` }}
                    />
                  </div>
                </div>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={sending}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={!canConfirm}
                  className={[
                    "flex-[1.4] rounded-lg px-4 py-2.5 text-sm font-semibold transition",
                    canConfirm
                      ? "bg-rose-600 text-white hover:bg-rose-700 shadow-sm"
                      : "bg-neutral-200 text-neutral-500 cursor-not-allowed",
                  ].join(" ")}
                >
                  {sending
                    ? "Publishing…"
                    : !armed
                      ? "Hold to confirm"
                      : platforms.size === 0
                        ? "Pick a platform"
                        : `I confirm — Post to ${[...platforms]
                            .map((p) =>
                              p === "facebook"
                                ? "FB"
                                : p === "instagram"
                                  ? "IG"
                                  : "TT",
                            )
                            .join(" + ")}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Build the next-available optimal-window datetime-local string for a
 * platform. "datetime-local" inputs expect "YYYY-MM-DDTHH:mm" in the
 * user's LOCAL timezone — we generate exactly that shape so the value
 * round-trips cleanly through the input.
 *
 * Algorithm:
 *   1. Pick today + the next 7 days as candidates.
 *   2. For each candidate, check if its weekday is in the platform's
 *      preferredDays.
 *   3. The first candidate where weekday matches AND the resulting
 *      timestamp (window startHour today) is > now() wins.
 *   4. Fallback: 24 hours from now at startHour (handles edge case where
 *      preferredDays is empty for some future config change).
 */
function computeDefaultScheduleInput(platform: PostPlatform): string {
  const window = OPTIMAL_POSTING_WINDOWS[platform];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + dayOffset);
    candidate.setHours(window.startHour, 0, 0, 0);
    if (!window.preferredDays.includes(candidate.getDay())) continue;
    // why: at least 60s in the future so submitting the pre-fill doesn't
    // race the "must be in the future" validator in schedulePostAction.
    if (candidate.getTime() - now.getTime() < 60_000) continue;
    return toDateTimeLocalValue(candidate);
  }
  // Fallback — tomorrow at the start hour.
  const fallback = new Date(now);
  fallback.setDate(now.getDate() + 1);
  fallback.setHours(window.startHour, 0, 0, 0);
  return toDateTimeLocalValue(fallback);
}

/**
 * Format a Date as "YYYY-MM-DDTHH:mm" in the user's LOCAL timezone, which
 * is what `<input type="datetime-local">` expects and produces. We
 * deliberately don't use toISOString — that returns UTC.
 */
function toDateTimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Min value for the datetime-local input — "right now" in local time.
 * Native input enforcement is just a hint (Chrome ignores `min` for
 * keyboard entry), so the parent submit handler validates again.
 */
function getDateTimeLocalNow(): string {
  return toDateTimeLocalValue(new Date());
}

/**
 * Part 2 (Phase D) — Make-a-Reel follow-up prompt.
 *
 * Non-blocking modal that surfaces after a successful Studio save asking
 * whether the user wants to also create a Reel version of the post they
 * just saved. Connects the canvas Studio flow to Reel Studio so the two
 * stop feeling disconnected.
 *
 * Why a modal (not a toast): The choice is consequential ("do I want to
 * spend another 2 minutes making a Reel?"), and toasts auto-dismiss on
 * timer — bad for an ADHD user who might miss the prompt entirely. The
 * modal stays until explicitly resolved.
 *
 * Three resolution paths, all equivalent dismissals:
 *   • Click "Make a Reel" — navigates to Reel Studio, mls pre-selected.
 *   • Click "Skip" — closes the prompt; the saved post stays as-is.
 *   • Click the backdrop / ESC — same as Skip.
 */
interface MakeReelPromptModalProps {
  mls: string;
  onMakeReel: () => void;
  onSkip: () => void;
}

function MakeReelPromptModal(props: MakeReelPromptModalProps) {
  // ESC dismisses to Skip — standard modal contract.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="make-reel-prompt-title"
      onClick={(e) => {
        // Backdrop click → Skip. Inner card stops propagation below.
        if (e.target === e.currentTarget) props.onSkip();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 backdrop-blur-sm animate-fade-in-up"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-4 w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center gap-3">
          {/* Film/play glyph — visual cue that we're talking about Reels. */}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-100 text-gold-700">
            <svg
              width="20"
              height="20"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
              <path d="M7 6.5l3 1.5-3 1.5z" fill="currentColor" />
            </svg>
          </span>
          <div>
            <h3
              id="make-reel-prompt-title"
              className="text-base font-semibold text-neutral-900"
            >
              Make a Reel from this post?
            </h3>
            <p className="mt-0.5 text-xs text-neutral-600">
              Static posts get a fraction of the reach Reels do on IG, FB,
              and TikTok. Same listing, ~7 seconds of motion, ready in a
              minute.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onSkip}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={props.onMakeReel}
            className="rounded-md bg-gold-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gold-600"
          >
            Make a Reel
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="h-full min-h-[560px] flex flex-col items-center justify-center text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-gold-50 ring-1 ring-gold-200 flex items-center justify-center mb-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="w-7 h-7 text-gold-700"
          aria-hidden="true"
        >
          <rect
            x="3.5"
            y="3.5"
            width="17"
            height="17"
            rx="2.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M3.5 16l4.5-4.5 3.5 3.5 3-3 6 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="8.5" r="1.6" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-neutral-900 mb-1">
        Pick a listing to start
      </h3>
      <p className="text-sm text-neutral-600 max-w-sm">
        Choose any eligible listing. We'll fetch all available photos, render in
        your chosen format, and write a caption with the MLS hashtag baked in.
      </p>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-neutral-100 to-neutral-200">
      <div className="w-10 h-10 rounded-full border-2 border-gold-500 border-t-transparent animate-spin" />
      <div className="text-sm text-neutral-700 font-medium">
        Spinning up Chromium…
      </div>
      <div className="text-xs text-neutral-500 max-w-[280px] text-center">
        First render takes 6–10 seconds while the headless browser warms up.
      </div>
    </div>
  );
}

function joinCaptionAndTags(caption: string, hashtags: string[]): string {
  if (hashtags.length === 0) return caption;
  return `${caption.trim()}\n\n${hashtags.join(" ")}`;
}

/**
 * Phase D — turn a CaptionResult into the per-platform edited-text map
 * the textarea reads from. Uses the response's `captions` map when
 * available, falls back to mirroring the legacy single caption across
 * all three platforms when an older API version omitted the per-
 * platform field. The fallback keeps the UI usable but produces
 * identical text across tabs (the user can then edit each tab manually).
 */
function buildPlatformTextsFromCaption(
  cap: CaptionResult,
): Record<SchedulablePlatform, string> {
  const legacy = joinCaptionAndTags(cap.caption, cap.hashtags);
  if (!cap.captions) {
    return { instagram: legacy, facebook: legacy, tiktok: legacy };
  }
  return {
    instagram: joinCaptionAndTags(
      cap.captions.instagram.caption,
      cap.captions.instagram.hashtags,
    ),
    facebook: joinCaptionAndTags(
      cap.captions.facebook.caption,
      cap.captions.facebook.hashtags,
    ),
    tiktok: joinCaptionAndTags(
      cap.captions.tiktok.caption,
      cap.captions.tiktok.hashtags,
    ),
  };
}

/**
 * Phase D — seed captionResult + editedCaptions on resume. Reads the
 * row's `captions_by_platform` jsonb when present and narrows
 * defensively (the column is `unknown` at the data layer). Falls back
 * to the legacy single `caption`/`hashtags` columns when the per-
 * platform map is empty or missing entries.
 *
 * Why a helper (not inline): the resume useEffect already touches a
 * dozen setters; isolating the caption-rehydration math into one named
 * function keeps the effect body readable.
 */
function hydrateCaptionsFromResume(
  resume: {
    caption: string | null;
    hashtags: string[] | null;
    mls_hashtag?: string | null;
    captions_by_platform: unknown | null;
  },
  onSetCaptionResult: (c: CaptionResult | null) => void,
  onSetEditedCaptions: (next: Record<SchedulablePlatform, string>) => void,
): void {
  const legacyCaption = (resume.caption ?? "").trim();
  const legacyHashtags = Array.isArray(resume.hashtags)
    ? resume.hashtags
    : [];
  const legacyJoined = legacyCaption
    ? joinCaptionAndTags(legacyCaption, legacyHashtags)
    : "";

  // Empty row — no caption ever generated. Leave the captionResult null
  // so the textarea shows its "click Generate" placeholder.
  if (!legacyCaption && !resume.captions_by_platform) {
    onSetCaptionResult(null);
    onSetEditedCaptions(emptyCaptionsByPlatform());
    return;
  }

  // Narrow the per-platform map defensively. A row from before the
  // migration has captions_by_platform = '{}' (or null), which we
  // treat as "no variants — use the legacy single caption."
  const cbpRaw = resume.captions_by_platform;
  const cbp =
    cbpRaw && typeof cbpRaw === "object" && !Array.isArray(cbpRaw)
      ? (cbpRaw as Record<string, unknown>)
      : null;

  const readPlatform = (
    platform: SchedulablePlatform,
  ): { caption: string; hashtags: string[] } | null => {
    if (!cbp) return null;
    const entry = cbp[platform];
    if (!entry || typeof entry !== "object") return null;
    const e = entry as { caption?: unknown; hashtags?: unknown };
    if (typeof e.caption !== "string" || e.caption.trim().length === 0) {
      return null;
    }
    const tags = Array.isArray(e.hashtags)
      ? e.hashtags.filter((t): t is string => typeof t === "string")
      : [];
    return { caption: e.caption, hashtags: tags };
  };

  const ig = readPlatform("instagram");
  const fb = readPlatform("facebook");
  const tt = readPlatform("tiktok");

  // Seed captionResult so the regenerate / copy buttons surface.
  // mls_hashtag falls back to the legacy column or the canonical MLS
  // hashtag we can recover from the legacy hashtags list.
  onSetCaptionResult({
    caption: ig?.caption ?? legacyCaption,
    hashtags: ig?.hashtags ?? legacyHashtags,
    mls_hashtag:
      (resume.mls_hashtag ?? null) ??
      legacyHashtags.find((t) => /^#(CMC|SJSR|NJ)/i.test(t)) ??
      "",
    captions: ig && fb && tt
      ? {
          instagram: ig,
          facebook: fb,
          tiktok: tt,
        }
      : undefined,
  });

  // Per-platform textarea state. Each tab gets its variant if present;
  // missing platforms fall back to the legacy joined string so the user
  // has something to start from rather than an empty box.
  onSetEditedCaptions({
    instagram: ig ? joinCaptionAndTags(ig.caption, ig.hashtags) : legacyJoined,
    facebook: fb ? joinCaptionAndTags(fb.caption, fb.hashtags) : legacyJoined,
    tiktok: tt ? joinCaptionAndTags(tt.caption, tt.hashtags) : legacyJoined,
  });
}

/**
 * Phase D — opposite direction of buildPlatformTextsFromCaption: takes
 * the user's edited per-platform strings and parses each one back into
 * a {caption, hashtags} pair so we can persist `captions_by_platform`
 * on save. Hashtags are anything in the string that looks like `#word`;
 * everything else is treated as caption prose. why a single function:
 * keeps save + publish in sync about what counts as caption vs hashtag
 * in the user-edited string (the textarea shows "caption\n\nhashtags",
 * but the user can rearrange freely — we re-parse rather than assume
 * structure).
 */
function parsePlatformText(text: string): {
  caption: string;
  hashtags: string[];
} {
  const tokens = text.match(/#[A-Za-z0-9_]+/g) ?? [];
  // why: remove just the hashtag tokens from the prose. We do NOT collapse
  // whitespace beyond trimming because the user's line breaks are likely
  // intentional (paragraph structure in IG captions).
  let prose = text;
  for (const t of tokens) {
    prose = prose.replace(t, "");
  }
  // Collapse trailing whitespace + the standard "\n\n" separator we
  // emit from joinCaptionAndTags so a round-trip stays clean.
  prose = prose.replace(/\s+$/g, "");
  return { caption: prose, hashtags: tokens };
}

/**
 * Render a compact Open House badge: "Sat, 5/16 · 1–3pm".
 *
 * If end_at is missing/invalid, falls back to "Sat, 5/16 · 1pm" (start only).
 * If start_at is missing/invalid, returns "". Times collapse to hour-only
 * when on the hour (e.g. "1pm"); otherwise show "1:30pm". When start +
 * end share am/pm, the suffix is shown only on the end ("1–3pm");
 * otherwise both get a suffix ("11am–1pm").
 */
function formatOhBadge(start_at: string, end_at?: string | null): string {
  try {
    const start = new Date(start_at);
    if (Number.isNaN(start.getTime())) return "";
    const datePart = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      timeZone: "America/New_York",
    }).format(start);

    const end = end_at ? new Date(end_at) : null;
    const validEnd = end && !Number.isNaN(end.getTime()) ? end : null;

    const timePart = validEnd
      ? formatTimeRangeET(start, validEnd)
      : formatSingleTimeET(start);

    return timePart ? `${datePart} · ${timePart}` : datePart;
  } catch {
    return "";
  }
}

/** Returns "1pm" or "1:30pm" for a single date, NY time. */
function formatSingleTimeET(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    timeZone: "America/New_York",
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase();
  const period = dayPeriod.replace(/\s/g, "").replace(/\./g, "");
  return minute === "00" ? `${hour}${period}` : `${hour}:${minute}${period}`;
}

/**
 * Returns a compact range like "1–3pm" or "11am–1pm".
 *
 * Same am/pm: "1–3pm" (suffix on end only).
 * Different am/pm: "11am–1pm" (suffix on both).
 */
function formatTimeRangeET(start: Date, end: Date): string {
  const startParts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    timeZone: "America/New_York",
  }).formatToParts(start);
  const endParts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    timeZone: "America/New_York",
  }).formatToParts(end);

  const getPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const sH = getPart(startParts, "hour");
  const sM = getPart(startParts, "minute") || "00";
  const sP = (getPart(startParts, "dayPeriod") || "").toLowerCase().replace(/\s/g, "").replace(/\./g, "");
  const eH = getPart(endParts, "hour");
  const eM = getPart(endParts, "minute") || "00";
  const eP = (getPart(endParts, "dayPeriod") || "").toLowerCase().replace(/\s/g, "").replace(/\./g, "");

  const startStr = sM === "00" ? sH : `${sH}:${sM}`;
  const endStr = eM === "00" ? eH : `${eH}:${eM}`;

  if (sP === eP) {
    // Same period — suffix on the end only.
    return `${startStr}–${endStr}${eP}`;
  }
  return `${startStr}${sP}–${endStr}${eP}`;
}

function formatShortName(format: PostFormat): string {
  switch (format) {
    case "square_1x1":
      return "square";
    case "portrait_4x5":
      return "portrait";
    case "story_9x16":
      return "story";
  }
}

function dimensionsLabel(format: PostFormat): string {
  switch (format) {
    case "square_1x1":
      return "1080×1080";
    case "portrait_4x5":
      return "1080×1350";
    case "story_9x16":
      return "1080×1920";
  }
}

/**
 * Variant preview thumbnail.
 *
 * Fetches the actual template HTML from /api/post-builder/preview-html and
 * renders it inside an iframe at full template dimensions (1080×…), then
 * scales the iframe down via CSS transform to fit a small swatch.
 *
 * This is genuinely "what your post will look like" — not an approximation —
 * because we're literally rendering the same template the export pipeline
 * uses. Cached by browser since the HTML is identical for the same
 * (template_id, listing, hero_urls) combination.
 */
function VariantPreviewThumb({
  templateId,
  listing,
  heroUrls,
  format,
  disabled,
  size = "small",
}: {
  templateId: string;
  listing: PostBuilderListing | null;
  heroUrls: string[];
  format: PostFormat;
  disabled: boolean;
  /** "small" = 84px inline thumb. "large" = card-filling preview (responsive). */
  size?: "small" | "large";
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  // For small mode we hard-code 84px so the inline thumb has predictable
  // size. For large mode we measure the actual rendered width and scale
  // the iframe to match — this lets each card fill its grid column on any
  // viewport without overflow.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [measuredW, setMeasuredW] = useState<number>(size === "large" ? 280 : 84);

  useEffect(() => {
    if (size !== "large" || !wrapperRef.current) return;
    const el = wrapperRef.current;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setMeasuredW(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  // Native template dimensions per format.
  const nativeDims =
    format === "square_1x1"
      ? { w: 1080, h: 1080 }
      : format === "portrait_4x5"
        ? { w: 1080, h: 1350 }
        : { w: 1080, h: 1920 };

  // Display dimensions. Large mode: container is 100% width, height
  // derived from the aspect ratio. Small mode: fixed pixel box (legacy
  // callers — currently unused after the layout refactor, kept for the API).
  const longSide = size === "large" ? measuredW : 84;
  const dims = format === "square_1x1"
    ? { w: nativeDims.w, h: nativeDims.h, displayW: longSide, displayH: longSide }
    : format === "portrait_4x5"
      ? { w: nativeDims.w, h: nativeDims.h, displayW: longSide, displayH: Math.round(longSide * 1350 / 1080) }
      : { w: nativeDims.w, h: nativeDims.h, displayW: Math.round(longSide * 1080 / 1920), displayH: longSide };
  const scaleX = dims.displayW / dims.w;
  const scaleY = dims.displayH / dims.h;

  useEffect(() => {
    if (!listing || heroUrls.length === 0) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(false);
    fetch("/api/post-builder/preview-html", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        template_id: templateId,
        listing,
        hero_image_urls: heroUrls,
      }),
    })
      .then(async (r) => {
        if (!r.ok) {
          setErr(true);
          return null;
        }
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        setHtml(text);
      })
      .catch(() => {
        if (cancelled) return;
        setErr(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, listing?.mls_number, heroUrls.join("|")]);

  // Large mode: width:100% of the card column, height computed from the
  // measured width × the format aspect ratio. Small mode: fixed pixel box.
  const wrapperStyle: React.CSSProperties = size === "large"
    ? { width: "100%", height: dims.displayH }
    : { width: dims.displayW, height: dims.displayH };

  const wrapperClass = size === "large"
    ? "relative rounded-md overflow-hidden bg-neutral-100 ring-1"
    : "relative rounded-md overflow-hidden bg-neutral-100 ring-1 flex-shrink-0";

  return (
    <div
      ref={wrapperRef}
      className={[
        wrapperClass,
        disabled ? "ring-neutral-200 opacity-50" : "ring-neutral-300",
      ].join(" ")}
      style={wrapperStyle}
    >
      {html ? (
        <iframe
          title={`${templateId} preview`}
          srcDoc={html}
          sandbox="allow-same-origin"
          aria-hidden="true"
          // The iframe is rendered at full template dimensions, then scaled.
          // pointer-events:none so clicks pass through to the parent button.
          style={{
            border: 0,
            width: dims.w,
            height: dims.h,
            transform: `scale(${scaleX}, ${scaleY})`,
            transformOrigin: "0 0",
            pointerEvents: "none",
          }}
        />
      ) : loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={[
              "rounded-full border-2 border-gold-500 border-t-transparent animate-spin",
              size === "large" ? "w-6 h-6" : "w-4 h-4",
            ].join(" ")}
          />
        </div>
      ) : err ? (
        <div
          className={[
            "absolute inset-0 flex items-center justify-center text-neutral-400 text-center px-2",
            size === "large" ? "text-xs" : "text-[9px]",
          ].join(" ")}
        >
          preview unavailable
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-100 to-neutral-200" />
      )}
    </div>
  );
}

/**
 * Returns 0..photoCount-1 if photo `index` is in the active selection
 * window (rolling from selectedPhotoIndex with wrap-around), or null
 * if it isn't part of the current selection.
 */
function computeSlotPosition(
  index: number,
  selectedStart: number,
  photoCount: number,
  total: number,
): number | null {
  if (total === 0) return null;
  for (let i = 0; i < photoCount; i++) {
    if ((selectedStart + i) % total === index) return i;
  }
  return null;
}
