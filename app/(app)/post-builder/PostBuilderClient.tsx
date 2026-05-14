"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PostBuilderListing,
  PostFormat,
  PostType,
  PostVariant,
  OutputMode,
  CaptionResponse,
  CaptionErrorResponse,
  RenderResponse,
  RenderErrorResponse,
  FBBundleResponse,
  FBBundleErrorResponse,
} from "@/lib/post-builder/types";
import { saveGeneratedPostAction } from "./actions";

// === Canvas Editor (Path C) — Phase 1, Step 2 wiring ===
// why: opt-in "Edit in Studio" path that opens the new Fabric.js editor in an
// overlay. Lives BESIDE the V1 click→render flow above; V1 is untouched.
import CanvasEditorOverlay from "@/lib/post-builder/canvas-editor/CanvasEditorOverlay";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import { mapListingToPayload } from "@/lib/post-builder/canvas-editor/mapListingToPayload";
import type {
  CanvasExportResult,
  CanvasTemplateSchema,
  MLSListingPayload,
} from "@/lib/post-builder/canvas-editor/types";

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
}

type PostPlatform = "facebook" | "instagram";

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
  caption: string;
  hashtags: string[];
  mls_hashtag: string;
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
const STORAGE_KEY_OUTPUT_MODE = "post-builder.output_mode";

const OUTPUT_MODES: { id: OutputMode; label: string; sub: string }[] = [
  { id: "ig_single", label: "Instagram", sub: "One designed image · 75 templates" },
  { id: "fb_multi", label: "Facebook", sub: "Hero card + real photos · bundled ZIP" },
];

interface BundleUiResult {
  bundle_url: string;
  asset_count: number;
  caption: string;
  hashtags: string[];
  mls_hashtag: string;
  mls_number: string;
  generated_post_id: string;
}

export default function PostBuilderClient({
  listingsByPostType,
  variantsByPostTypeAndFormat,
  formatMeta,
  isAdmin,
}: Props) {
  const [outputMode, setOutputMode] = useState<OutputMode>("ig_single");
  const [postType, setPostType] = useState<PostType>("just_listed");
  const [format, setFormat] = useState<PostFormat>("square_1x1");
  const [variantId, setVariantId] = useState<PostVariant>("v1");
  const [search, setSearch] = useState("");
  const [selectedMls, setSelectedMls] = useState<string | null>(null);
  // FB Native multi-photo state
  const [fbSelectedPhotos, setFbSelectedPhotos] = useState<Set<number>>(new Set([0, 1, 2, 3]));
  const [customFeature, setCustomFeature] = useState("");
  const [customFeatureSuggestion, setCustomFeatureSuggestion] = useState<string | null>(null);
  const [customFeatureLoading, setCustomFeatureLoading] = useState(false);
  const [bundleResult, setBundleResult] = useState<BundleUiResult | null>(null);
  const [bundleGenerating, setBundleGenerating] = useState(false);
  // Open House FB multi-property state (Phase 8) — set of MLS numbers
  const [ohMultiSelected, setOhMultiSelected] = useState<Set<string>>(new Set());
  // Phase 5A — Post Now state
  const [generatedPostId, setGeneratedPostId] = useState<string | null>(null);
  const [postNowOpen, setPostNowOpen] = useState(false);
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
  } | null>(null);
  // Render + caption state
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [captionResult, setCaptionResult] = useState<CaptionResult | null>(null);
  const [editedCaption, setEditedCaption] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [regeneratingCaption, setRegeneratingCaption] = useState(false);
  const [downloadSaving, setDownloadSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  // Restore last-used preferences on mount.
  useEffect(() => {
    const savedMode = localStorage.getItem(STORAGE_KEY_OUTPUT_MODE) as OutputMode | null;
    if (savedMode === "ig_single" || savedMode === "fb_multi") {
      setOutputMode(savedMode);
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
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_OUTPUT_MODE, outputMode);
  }, [outputMode]);

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
  // "Edit in Studio" button is disabled. Step 2 ships just_listed × v1 across
  // all 3 formats; everything else returns null until later phases author them.
  const studioTemplate = useMemo<CanvasTemplateSchema | null>(
    () => findCanvasTemplate(postType, variantId, format),
    [postType, variantId, format],
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
    setStudioContext({ template: studioTemplate, listing: payload });
    setStudioOpen(true);
  }, [selectedListing, studioTemplate, availablePhotos]);

  const handleStudioSave = useCallback(
    async (result: CanvasExportResult): Promise<void> => {
      // why: Step 2 only — download the rendered PNG locally so we can verify
      // the export pipeline visually. Step 3 will replace this with a Supabase
      // Storage upload + generated_posts row insert via a Server Action.
      const url = URL.createObjectURL(result.file);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = result.file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // why: revoke immediately after click — the browser has already
        // initiated the download and no longer needs the blob URL.
        URL.revokeObjectURL(url);
      }
      // why: log the schema so we can confirm bound-field hydration worked
      // end-to-end without inspecting the actual PNG bytes.
      console.log("[CanvasEditor Step 2 save]", {
        templateId: result.schema.id,
        dimensions: { width: result.width, height: result.height },
        bytes: result.file.size,
      });
    },
    [],
  );

  const handleStudioClose = useCallback((): void => {
    setStudioOpen(false);
  }, []);

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
    setError(null);
    // Reset FB state when listing changes
    setBundleResult(null);
    setFbSelectedPhotos(new Set([0, 1, 2, 3]));
    setCustomFeature("");
    setCustomFeatureSuggestion(null);
  }

  function toggleFbPhoto(index: number) {
    setFbSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    // Photo set change invalidates the bundle but not the caption.
    setBundleResult(null);
  }

  /** Fetch AI-suggested custom feature when listing changes (FB mode only). */
  useEffect(() => {
    if (outputMode !== "fb_multi" || !selectedListing) {
      setCustomFeatureSuggestion(null);
      return;
    }
    let cancelled = false;
    setCustomFeatureLoading(true);
    fetch("/api/post-builder/custom-feature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listing: selectedListing }),
    })
      .then((r) => r.json())
      .then((json: { ok?: boolean; suggestion?: string | null }) => {
        if (cancelled) return;
        const suggestion = json.ok && json.suggestion ? json.suggestion : null;
        setCustomFeatureSuggestion(suggestion);
        // Pre-fill the input with the suggestion, but only if user hasn't typed
        if (suggestion && !customFeature) {
          setCustomFeature(suggestion);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCustomFeatureLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: customFeature shouldn't re-trigger
  }, [outputMode, selectedListing?.mls_number]);

  async function regenerateCustomFeature() {
    if (!selectedListing) return;
    setCustomFeatureLoading(true);
    try {
      const r = await fetch("/api/post-builder/custom-feature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listing: selectedListing }),
      });
      const json = (await r.json()) as { ok?: boolean; suggestion?: string | null };
      const suggestion = json.ok && json.suggestion ? json.suggestion : null;
      setCustomFeatureSuggestion(suggestion);
      if (suggestion) setCustomFeature(suggestion);
    } catch {
      // ignore
    } finally {
      setCustomFeatureLoading(false);
    }
  }

  async function generateBundle() {
    if (!selectedListing) return;
    const sortedIndexes = [...fbSelectedPhotos].sort((a, b) => a - b);
    if (sortedIndexes.length < 2) {
      setError("Pick at least 2 photos for the FB gallery (the first one becomes the hero card).");
      return;
    }
    const realPhotoUrls = sortedIndexes
      .map((i) => availablePhotos[i]?.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    if (realPhotoUrls.length < 2) {
      setError("Could not resolve enough photo URLs. Try refreshing.");
      return;
    }
    setBundleGenerating(true);
    setError(null);
    setBundleResult(null);
    try {
      const res = await fetch("/api/post-builder/bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hero_template_id: "fb_new_listing_v1",
          caption_shape: "new_listing_single",
          listings: [
            {
              listing: selectedListing,
              real_photo_urls: realPhotoUrls,
              custom_feature: customFeature.trim() || null,
            },
          ],
        }),
      });
      const text = await res.text();
      let json: FBBundleResponse | FBBundleErrorResponse | null = null;
      try {
        json = JSON.parse(text) as FBBundleResponse | FBBundleErrorResponse;
      } catch {
        setError(`Bundle returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
        return;
      }
      if (!json.ok) {
        setError(`Bundle failed: ${json.error}`);
        return;
      }
      setBundleResult({
        bundle_url: json.bundle_url,
        asset_count: json.asset_count,
        caption: json.caption,
        hashtags: json.hashtags,
        mls_hashtag: json.mls_hashtag,
        mls_number: selectedListing.mls_number,
        generated_post_id: json.generated_post_id,
      });
      setGeneratedPostId(json.generated_post_id);
      setEditedCaption(json.caption);
    } catch (e) {
      setError(`Bundle generate threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBundleGenerating(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Phase 8 — Open House FB Multi-Property
  // ─────────────────────────────────────────────────────────────────
  const isOhMultiMode = postType === "open_house" && outputMode === "fb_multi";

  function toggleOhMulti(mls: string) {
    setOhMultiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mls)) next.delete(mls);
      else next.add(mls);
      return next;
    });
    setBundleResult(null);
  }

  async function generateOhBundle() {
    const selectedListings = listings.filter((l) => ohMultiSelected.has(l.mls_number));
    if (selectedListings.length < 2) {
      setError("Pick at least 2 open houses for the gallery.");
      return;
    }
    if (selectedListings.length > 15) {
      setError("Max 15 open houses per post (Facebook gallery limit).");
      return;
    }
    setBundleGenerating(true);
    setError(null);
    setBundleResult(null);
    try {
      const res = await fetch("/api/post-builder/bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hero_template_id: "fb_open_house_v1",
          caption_shape: "open_house_multi",
          listings: selectedListings.map((l) => ({
            listing: l,
            // For OH cards, only the hero photo matters (used as the photo
            // inside the designed card). No supporting photos shipped.
            real_photo_urls: l.hero_image_url ? [l.hero_image_url] : [],
            custom_feature: null,
          })),
        }),
      });
      const text = await res.text();
      let json: FBBundleResponse | FBBundleErrorResponse | null = null;
      try {
        json = JSON.parse(text) as FBBundleResponse | FBBundleErrorResponse;
      } catch {
        setError(`Bundle returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
        return;
      }
      if (!json.ok) {
        setError(`OH bundle failed: ${json.error}`);
        return;
      }
      setBundleResult({
        bundle_url: json.bundle_url,
        asset_count: json.asset_count,
        caption: json.caption,
        hashtags: json.hashtags,
        mls_hashtag: json.mls_hashtag,
        mls_number: selectedListings[0].mls_number,
        generated_post_id: json.generated_post_id,
      });
      setGeneratedPostId(json.generated_post_id);
      setEditedCaption(json.caption);
    } catch (e) {
      setError(`OH bundle threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBundleGenerating(false);
    }
  }

  // Reset OH selection when leaving OH+FB mode or changing post-type away from OH.
  useEffect(() => {
    if (!isOhMultiMode) {
      setOhMultiSelected(new Set());
    }
  }, [isOhMultiMode]);

  async function downloadBundle() {
    if (!bundleResult) return;
    try {
      const res = await fetch(bundleResult.bundle_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `c21-alliance_fb_${bundleResult.mls_number}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Bundle download failed: ${e instanceof Error ? e.message : String(e)}`);
    }
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
    // Default platform selection — both for IG-compatible outputs, FB-only
    // when the bundle has more than 10 photos (IG carousel cap).
    if (isOhMultiMode && ohMultiSelected.size > 10) {
      setPostNowPlatforms(new Set(["facebook"]));
    } else {
      setPostNowPlatforms(new Set(["facebook", "instagram"]));
    }
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
        if (outputMode === "fb_multi" && bundleResult) {
          // Bundle endpoint already saved — but somehow we don't have the id.
          // Should never happen since we set it in generateBundle/OhBundle.
          setError("Bundle was generated but no post id is set. Re-generate.");
          setPostNowSending(false);
          return;
        }
        id = await ensureGeneratedPostId();
        if (!id) {
          setPostNowSending(false);
          return;
        }
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

  // Reset Post Now state whenever the user changes the selection, output
  // mode, or rebuilds the bundle. Anything that invalidates the underlying
  // generated_posts row should also close the Post Now panel and clear
  // results.
  useEffect(() => {
    setPostNowOpen(false);
    setPostNowResults(null);
    setPostNowArmedAt(null);
  }, [selectedMls, outputMode, ohMultiSelected, bundleResult?.generated_post_id, renderResult?.image_url]);

  // If the listing only has N photos but the user has v4 (2) or v5 (3) selected,
  // auto-fall-back to v1 so the variant card grid never shows a selected-but-
  // disabled state. Only applies in IG mode.
  useEffect(() => {
    if (outputMode !== "ig_single") return;
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
  }, [availablePhotos.length, currentVariant?.photo_count, outputMode]);

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
        setEditedCaption,
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
    onCaptionText: (s: string) => void,
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
    };
    onSuccess(cap);
    onCaptionText(joinCaptionAndTags(cap.caption, cap.hashtags));
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
        };
        setCaptionResult(cap);
        setEditedCaption(joinCaptionAndTags(cap.caption, cap.hashtags));
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
      {/* Output mode toggle — Instagram (one designed image) vs Facebook (hero card + real photos bundled) */}
      <div className="card p-2 flex gap-1">
        {OUTPUT_MODES.map((mode) => {
          const active = mode.id === outputMode;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                setOutputMode(mode.id);
                setBundleResult(null);
                setRenderResult(null);
                setError(null);
              }}
              className={[
                "flex-1 px-4 py-3 rounded-lg transition text-left",
                active
                  ? "bg-neutral-900 text-white"
                  : "bg-white text-neutral-700 hover:bg-neutral-50 ring-1 ring-neutral-200",
              ].join(" ")}
            >
              <div className="text-sm font-semibold">{mode.label}</div>
              <div className={["text-xs mt-0.5", active ? "text-neutral-300" : "text-neutral-500"].join(" ")}>
                {mode.sub}
              </div>
            </button>
          );
        })}
      </div>

      {/* Post type segmented picker */}
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

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Left: Listing picker */}
        <section className="card p-4">
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
                const active = isOhMultiMode
                  ? ohMultiSelected.has(l.mls_number)
                  : l.mls_number === selectedMls;
                const showPrice =
                  postType === "just_sold" && typeof l.close_price === "number"
                    ? l.close_price
                    : l.list_price;
                return (
                  <button
                    key={l.mls_number}
                    type="button"
                    onClick={() =>
                      isOhMultiMode ? toggleOhMulti(l.mls_number) : pickListing(l.mls_number)
                    }
                    className={[
                      "w-full text-left rounded-lg border p-2.5 transition flex gap-3 items-start",
                      active
                        ? "border-gold-500 bg-gold-50/50 ring-2 ring-gold-500/30"
                        : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50",
                    ].join(" ")}
                  >
                    {isOhMultiMode ? (
                      <div
                        className={[
                          "w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition",
                          active
                            ? "bg-gold-500 border-gold-500"
                            : "bg-white border-neutral-300",
                        ].join(" ")}
                      >
                        {active ? (
                          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                            <path
                              d="M2 6l3 3 5-6"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </div>
                    ) : null}
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
                    <div className="min-w-0 flex-1">
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
                  </button>
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

        {/* Right: Format + Variant + Photo picker + Generate + Preview */}
        <section className="card p-5 min-h-[640px]">
          {isOhMultiMode ? (
            <OhMultiPanel
              selectedCount={ohMultiSelected.size}
              selectedListings={listings.filter((l) => ohMultiSelected.has(l.mls_number))}
              bundleGenerating={bundleGenerating}
              bundleResult={bundleResult}
              error={error}
              editedCaption={editedCaption}
              onEditedCaptionChange={setEditedCaption}
              onGenerate={generateOhBundle}
              onDownload={downloadBundle}
              onCopyCaption={copyCaption}
              copyState={copyState}
              isAdmin={isAdmin}
              onPostNow={isAdmin ? openPostNow : undefined}
            />
          ) : !selectedListing ? (
            <EmptyPreview />
          ) : (
            <div className="flex flex-col h-full">
              {/* Format + Variant (only shown in IG single-image mode) */}
              {outputMode === "ig_single" ? (
              <div className="mb-4 space-y-4">
                {/* Step 2 · Format — full-width row */}
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

                {/* Step 3 · Variant — full-width row, large previews on top */}
                <div>
                  <div className="eyebrow mb-2">
                    Step 3 · Variant{" "}
                    <span className="text-neutral-400 font-normal normal-case tracking-normal">
                      · live preview with this listing's photos
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {variants.map((v) => {
                      const active = v.variant === variantId;
                      const photosAvailable = availablePhotos.length;
                      const insufficient =
                        photosAvailable > 0 && photosAvailable < v.photo_count;
                      const disabled = insufficient;
                      // Build hero URL set for the preview. v1-v3 single photo,
                      // v4 takes 2, v5 takes 3 — slice from the rolling window.
                      const previewHeroUrls = availablePhotos.length > 0
                        ? Array.from({ length: v.photo_count }, (_, i) =>
                            availablePhotos[(selectedPhotoIndex + i) % availablePhotos.length]?.url
                          ).filter((u): u is string => !!u)
                        : selectedListing?.hero_image_url
                          ? [selectedListing.hero_image_url]
                          : [];
                      // why: "Edit in Studio" only renders under the active card
                      // AND only when a canvas-editor template exists for the
                      // current (postType, variant, format) tuple. Step 2 ships
                      // just_listed × v1 across 3 formats; other combinations
                      // hide the affordance until later phases add templates.
                      const studioAvailable =
                        active &&
                        !disabled &&
                        studioTemplate !== null &&
                        v.variant === studioTemplate.variant &&
                        !!selectedListing;
                      return (
                        <div key={v.template_id} className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (disabled) return;
                              changeVariant(v.variant as PostVariant);
                            }}
                            disabled={disabled}
                            title={
                              insufficient
                                ? `Needs ${v.photo_count} photos — this listing only has ${photosAvailable}.`
                                : v.description
                            }
                            className={[
                              "text-left rounded-xl border p-2.5 transition relative flex flex-col",
                              disabled
                                ? "border-neutral-200 bg-neutral-50 cursor-not-allowed opacity-60"
                                : active
                                  ? "border-gold-500 bg-gold-50/40 ring-2 ring-gold-500/30 shadow-sm"
                                  : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm",
                            ].join(" ")}
                          >
                            {/* Large preview on top */}
                            <VariantPreviewThumb
                              templateId={v.template_id}
                              listing={selectedListing}
                              heroUrls={previewHeroUrls}
                              format={format}
                              disabled={disabled}
                              size="large"
                            />
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
                                {v.display_name}
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
                                : v.description}
                            </div>
                          </button>
                          {/* === Canvas Editor (Path C) — Edit in Studio button === */}
                          {/* why: only renders when the current variant card is active
                              AND a canvas-editor template exists for this tuple. Full
                              width per design spec. Gold styling matches brand. */}
                          {studioAvailable ? (
                            <button
                              type="button"
                              onClick={openStudio}
                              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gold-500 bg-white px-3 py-2 text-sm font-semibold text-gold-800 transition-colors hover:bg-gold-50 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                              title="Open this variant in the Studio editor for fine-tuning"
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              ) : null}

              {/* FB-mode header: shows which template is in play */}
              {outputMode === "fb_multi" ? (
                <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Step 2 · Hero card
                    </div>
                    <div className="text-sm font-semibold text-neutral-900 mt-0.5">
                      NEW LISTING · Editorial card with photo + stats strip
                    </div>
                  </div>
                  <span className="text-xs font-mono text-neutral-500">fb_new_listing_v1</span>
                </div>
              ) : null}

              {/* Photo picker — single-select (IG) or multi-select (FB) */}
              {availablePhotos.length > 1 ? (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="eyebrow">
                      {outputMode === "fb_multi"
                        ? `Step 3 · Photos · ${fbSelectedPhotos.size} selected (FB gallery, first becomes hero card)`
                        : `Step 4 · ${photoCount === 1 ? "Hero photo" : `${photoCount} photos`}${
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
                      // Two selection models depending on output mode:
                      //   IG: rolling window from selectedPhotoIndex sized by photoCount
                      //   FB: free multi-select via fbSelectedPhotos Set
                      if (outputMode === "fb_multi") {
                        const isSelected = fbSelectedPhotos.has(i);
                        // Slot number reflects ORDER in the gallery (sorted ascending)
                        const slotNum = isSelected
                          ? [...fbSelectedPhotos].sort((a, b) => a - b).indexOf(i) + 1
                          : null;
                        return (
                          <button
                            key={`${p.sequence}-${i}`}
                            type="button"
                            onClick={() => toggleFbPhoto(i)}
                            className={[
                              "relative shrink-0 rounded-lg overflow-hidden transition",
                              isSelected
                                ? slotNum === 1
                                  ? "ring-2 ring-gold-500 ring-offset-2 ring-offset-white"
                                  : "ring-2 ring-emerald-500 ring-offset-1 ring-offset-white"
                                : "ring-1 ring-neutral-200 hover:ring-neutral-400 opacity-70 hover:opacity-100",
                            ].join(" ")}
                            title={
                              isSelected
                                ? slotNum === 1
                                  ? `Photo ${p.sequence} · HERO (becomes the designed card)`
                                  : `Photo ${p.sequence} · gallery slot ${slotNum}`
                                : `Photo ${p.sequence} — click to add`
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
                                slotNum === 1
                                  ? "bg-gold-500 text-neutral-900"
                                  : isSelected
                                    ? "bg-emerald-500 text-white"
                                    : "bg-black/55 text-white",
                              ].join(" ")}
                            >
                              {slotNum === 1
                                ? "HERO"
                                : isSelected
                                  ? `#${slotNum}`
                                  : p.sequence || "★"}
                            </span>
                          </button>
                        );
                      }

                      // IG single-image mode (original behavior)
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

              {/* FB-mode custom feature input + generate bundle */}
              {outputMode === "fb_multi" ? (
                <div className="mb-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-gold-700">
                        Step 4 · Custom feature (stat #3)
                      </label>
                      <button
                        type="button"
                        onClick={regenerateCustomFeature}
                        disabled={customFeatureLoading}
                        className="text-xs text-neutral-600 hover:text-neutral-900 font-medium disabled:opacity-40"
                      >
                        {customFeatureLoading ? "Thinking…" : "↻ AI suggest"}
                      </button>
                    </div>
                    <input
                      type="text"
                      className="input"
                      placeholder={customFeatureSuggestion || "e.g. SUNSET VIEWS"}
                      value={customFeature}
                      onChange={(e) => {
                        setCustomFeature(e.target.value);
                        setBundleResult(null);
                      }}
                      maxLength={30}
                    />
                    <div className="mt-1 text-[11px] text-neutral-500">
                      Appears on the hero card after BD/BA. ALL CAPS, 1-3 words. Falls back to property type if blank.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={generateBundle}
                    disabled={bundleGenerating || fbSelectedPhotos.size < 2}
                    className="btn-primary whitespace-nowrap"
                  >
                    {bundleGenerating ? "Building bundle…" : bundleResult ? "Rebuild bundle" : "Generate FB Bundle"}
                  </button>
                </div>
              ) : null}

              {outputMode === "ig_single" ? (
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
                  {generating ? "Generating…" : renderResult ? "Regenerate" : "Generate Post"}
                </button>
              </div>
              ) : null}

              {error ? (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1">
                {/* Preview pane (IG mode shows rendered image; FB mode shows bundle summary) */}
                <div className="flex flex-col">
                  <div className="eyebrow mb-2">
                    {outputMode === "fb_multi"
                      ? `Bundle · ${bundleResult ? `${bundleResult.asset_count} assets` : `${fbSelectedPhotos.size} photo${fbSelectedPhotos.size === 1 ? "" : "s"} selected`}`
                      : `Preview · ${dimensionsLabel(format)}`}
                  </div>
                  {outputMode === "fb_multi" ? (
                    <div className="relative rounded-xl bg-neutral-50 border border-neutral-200 overflow-hidden mx-auto w-full max-w-md aspect-square flex items-center justify-center text-center p-6">
                      {bundleGenerating ? (
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-10 h-10 rounded-full border-2 border-gold-500 border-t-transparent animate-spin" />
                          <div className="text-sm font-medium text-neutral-700">Building FB bundle…</div>
                          <div className="text-xs text-neutral-500 max-w-[260px]">
                            Rendering hero card, fetching {fbSelectedPhotos.size - 1} real photo{fbSelectedPhotos.size - 1 === 1 ? "" : "s"}, zipping everything.
                          </div>
                        </div>
                      ) : bundleResult ? (
                        <div className="flex flex-col items-center gap-3">
                          <div className="text-3xl">📦</div>
                          <div className="text-sm font-semibold text-neutral-900">
                            Bundle ready
                          </div>
                          <div className="text-xs text-neutral-600 max-w-[260px]">
                            {bundleResult.asset_count} files packaged. Download, unzip, drag photos to FB in numerical order, paste the caption.
                          </div>
                          <div className="flex flex-col items-stretch gap-2 w-full max-w-[260px] mx-auto mt-1">
                            <button
                              type="button"
                              onClick={downloadBundle}
                              className="btn-primary"
                            >
                              Download ZIP
                            </button>
                            {isAdmin ? (
                              <button
                                type="button"
                                onClick={openPostNow}
                                className="btn-secondary"
                              >
                                Post Now →
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-neutral-500">
                          {fbSelectedPhotos.size < 2
                            ? "Pick at least 2 photos to enable bundle generation."
                            : "Click Generate FB Bundle to package the caption + hero card + selected photos."}
                        </div>
                      )}
                    </div>
                  ) : (
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
                    {/* Cycle hero button — overlay on the preview when there's something to cycle */}
                    {availablePhotos.length > 1 ? (
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
                  )}
                  {outputMode === "ig_single" && renderResult ? (
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

                {/* Caption pane */}
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
                          title="Re-write the caption with AI (keeps the image)"
                        >
                          {regeneratingCaption ? "Rewriting…" : "↻ Regenerate"}
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
                  <textarea
                    className="input flex-1 min-h-[280px] font-mono text-[13px] leading-relaxed resize-y"
                    placeholder={
                      generating
                        ? "Generating caption…"
                        : "Caption + hashtags will appear here after Generate."
                    }
                    value={editedCaption}
                    onChange={(e) => setEditedCaption(e.target.value)}
                  />
                  {captionResult ? (
                    <div className="mt-3 text-xs text-neutral-500 leading-relaxed">
                      The MLS hashtag{" "}
                      <code className="font-mono text-neutral-700 bg-neutral-100 px-1 rounded">
                        {captionResult.mls_hashtag}
                      </code>{" "}
                      is baked in so once Larissa posts this to FB or IG, the
                      auto-linker ties it back to this listing automatically.
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
          outputMode={outputMode}
          isOhMulti={isOhMultiMode}
          assetCount={
            outputMode === "fb_multi"
              ? bundleResult?.asset_count ?? 0
              : 1
          }
          previewImageUrl={
            outputMode === "ig_single"
              ? renderResult?.image_url ?? null
              : null
          }
          listingLabel={
            isOhMultiMode
              ? `${ohMultiSelected.size} open house${ohMultiSelected.size === 1 ? "" : "s"}`
              : selectedListing
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
        />
      ) : null}
      {/* === Canvas Editor (Path C) — overlay portal ===
          why: rendered at the top level of the component's JSX so it covers
          all underlying UI including the PostNowModal. Unmounts entirely when
          closed (no idle Fabric memory cost). studioContext is hydrated at
          open-time so the editor's useEffect doesn't refire on parent renders. */}
      <CanvasEditorOverlay
        open={studioOpen}
        onClose={handleStudioClose}
        template={studioContext?.template ?? null}
        listing={studioContext?.listing ?? null}
        onSave={handleStudioSave}
        saveLabel="Download Post"
      />
    </div>
  );
}

interface PostNowModalProps {
  outputMode: OutputMode;
  isOhMulti: boolean;
  assetCount: number;
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
}

const POST_NOW_ARM_MS = 2000;

function PostNowModal(props: PostNowModalProps) {
  const {
    outputMode,
    isOhMulti,
    assetCount,
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
  } = props;

  const [, forceTick] = useState(0);
  // Tick every 50ms while arming so the progress bar animates smoothly.
  useEffect(() => {
    if (!armedAt || results) return;
    const elapsed = Date.now() - armedAt;
    if (elapsed >= POST_NOW_ARM_MS) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 50);
    return () => clearInterval(interval);
  }, [armedAt, results]);

  const armElapsed = armedAt ? Math.min(Date.now() - armedAt, POST_NOW_ARM_MS) : 0;
  const armed = armElapsed >= POST_NOW_ARM_MS;
  const armPct = Math.round((armElapsed / POST_NOW_ARM_MS) * 100);

  // IG carousel cap is 10 images. Disable IG checkbox when bundle exceeds it.
  const igDisabledReason: string | null =
    outputMode === "fb_multi" && assetCount > 10
      ? `Instagram carousel max is 10 images — this bundle has ${assetCount}.`
      : null;

  const canConfirm = platforms.size > 0 && armed && !sending && !results;

  // Trim caption preview for the modal (we have textarea on the main page).
  const captionShort = captionPreview.length > 280
    ? captionPreview.slice(0, 280).trimEnd() + "…"
    : captionPreview;

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
              <div className="eyebrow text-rose-700 mb-1">
                ⚠ Live publish · admin only
              </div>
              <h3 className="text-lg font-bold text-neutral-900">Post Now</h3>
              <div className="text-sm text-neutral-600 mt-0.5">
                Publishes this {outputMode === "fb_multi" ? "bundle" : "image"} directly to Meta. There is no preview step on Facebook or Instagram once submitted.
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
                {outputMode === "fb_multi"
                  ? `${assetCount} image${assetCount === 1 ? "" : "s"} · ${isOhMulti ? "Open House gallery" : "FB photo bundle"}`
                  : "1 designed image · IG single post"}
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
                  <div className="text-xs text-neutral-600 mt-0.5">
                    {outputMode === "fb_multi"
                      ? `Posts a ${assetCount}-photo gallery to the Alliance Page.`
                      : "Posts a single photo to the Alliance Page."}
                  </div>
                </div>
              </label>

              <label
                className={[
                  "flex items-start gap-3 rounded-lg p-3 transition ring-1",
                  igDisabledReason
                    ? "bg-neutral-50 ring-neutral-200 opacity-60 cursor-not-allowed"
                    : platforms.has("instagram")
                      ? "bg-pink-50 ring-pink-300 cursor-pointer"
                      : "bg-white ring-neutral-200 hover:bg-neutral-50 cursor-pointer",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={platforms.has("instagram")}
                  onChange={() => onTogglePlatform("instagram")}
                  disabled={sending || !!results || !!igDisabledReason}
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-neutral-900">Instagram Business</div>
                  <div className="text-xs text-neutral-600 mt-0.5">
                    {igDisabledReason ?? (outputMode === "fb_multi"
                      ? `Posts as a ${assetCount}-image carousel.`
                      : "Posts a single image to the Alliance IG.")}
                  </div>
                </div>
              </label>
            </div>
          </div>

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
                        : `I confirm — Post to ${[...platforms].map(p => p === "facebook" ? "FB" : "IG").join(" + ")}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface OhMultiPanelProps {
  selectedCount: number;
  selectedListings: PostBuilderListing[];
  bundleGenerating: boolean;
  bundleResult: BundleUiResult | null;
  error: string | null;
  editedCaption: string;
  onEditedCaptionChange: (s: string) => void;
  onGenerate: () => void;
  onDownload: () => void;
  onCopyCaption: () => void;
  copyState: "idle" | "copied";
  isAdmin: boolean;
  onPostNow?: () => void;
}

function OhMultiPanel(props: OhMultiPanelProps) {
  const {
    selectedCount,
    selectedListings,
    bundleGenerating,
    bundleResult,
    error,
    editedCaption,
    onEditedCaptionChange,
    onGenerate,
    onDownload,
    onCopyCaption,
    copyState,
  } = props;

  // Day-group the selected listings for the preview list (matches the caption shape)
  const grouped = useMemo(() => {
    const byDay = new Map<
      string,
      { label: string; rows: { listing: PostBuilderListing; time: string }[] }
    >();
    for (const l of selectedListings) {
      if (!l.oh_start_at) continue;
      const start = new Date(l.oh_start_at);
      if (Number.isNaN(start.getTime())) continue;
      const dayKey = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "America/New_York",
      }).format(start);
      const dayLabel = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: "America/New_York",
      }).format(start);
      const timeFmt = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: start.getUTCMinutes() === 0 ? undefined : "2-digit",
        hour12: true,
        timeZone: "America/New_York",
      });
      const timeStr = timeFmt.format(start);
      if (!byDay.has(dayKey)) byDay.set(dayKey, { label: dayLabel, rows: [] });
      byDay.get(dayKey)!.rows.push({ listing: l, time: timeStr });
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [selectedListings]);

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Open House Weekend · multi-property
        </div>
        <div className="text-sm text-emerald-900 mt-1">
          Multi-select listings from the left panel. Each selection becomes
          one designed "Open House" card in the FB gallery. The caption
          auto-builds with day-grouped addresses + times.
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="eyebrow mb-1">Step · Generate</div>
          <h2 className="text-lg font-semibold text-neutral-900">
            {selectedCount === 0
              ? "No listings selected"
              : `${selectedCount} open house${selectedCount === 1 ? "" : "s"} selected`}
          </h2>
          <div className="text-sm text-neutral-600">
            Each generates one designed card. Max 15 per post.
          </div>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={bundleGenerating || selectedCount < 2}
          className="btn-primary whitespace-nowrap"
        >
          {bundleGenerating ? "Building bundle…" : bundleResult ? "Rebuild" : "Generate OH Bundle"}
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1">
        {/* Selected listings preview (day-grouped) */}
        <div className="flex flex-col">
          <div className="eyebrow mb-2">Selected listings · grouped by OH day</div>
          <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-3 flex-1 overflow-y-auto min-h-[280px]">
            {grouped.length === 0 ? (
              <div className="text-sm text-neutral-500 italic text-center mt-12 px-4">
                Pick at least 2 listings from the left panel.
                <br />
                Each selected listing gets its own Open House card in the FB gallery.
              </div>
            ) : (
              grouped.map(([key, group]) => (
                <div key={key} className="mb-4 last:mb-0">
                  <div className="text-xs font-bold uppercase tracking-wide text-neutral-700 mb-1.5">
                    {group.label}
                  </div>
                  <ul className="space-y-1 text-sm text-neutral-700">
                    {group.rows.map((r) => (
                      <li key={r.listing.mls_number} className="flex items-baseline gap-2">
                        <span>📍</span>
                        <span className="flex-1 truncate">
                          {r.listing.address}, {r.listing.city}
                        </span>
                        <span className="text-xs text-neutral-500 font-mono">{r.time}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
          {bundleResult ? (
            <div className="mt-3 flex flex-col gap-2">
              <button type="button" onClick={onDownload} className="btn-primary">
                Download ZIP · {bundleResult.asset_count} cards
              </button>
              {props.isAdmin && props.onPostNow ? (
                <button
                  type="button"
                  onClick={props.onPostNow}
                  className="btn-secondary"
                  title="Publish directly to Facebook"
                >
                  Post Now →
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Caption preview / editor */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="eyebrow">Caption preview</div>
            {bundleResult ? (
              <button
                type="button"
                onClick={onCopyCaption}
                className="text-xs text-gold-700 font-medium hover:text-gold-800"
              >
                {copyState === "copied" ? "✓ Copied" : "Copy all"}
              </button>
            ) : null}
          </div>
          <textarea
            className="input flex-1 min-h-[280px] font-mono text-[13px] leading-relaxed resize-y"
            placeholder={
              bundleGenerating
                ? "Building bundle + caption…"
                : "Caption appears after Generate. Day-grouped addresses, times, and hashtags built automatically."
            }
            value={editedCaption}
            onChange={(e) => onEditedCaptionChange(e.target.value)}
          />
          {bundleResult ? (
            <div className="mt-3 text-xs text-neutral-500 leading-relaxed">
              First listing's MLS hashtag{" "}
              <code className="font-mono text-neutral-700 bg-neutral-100 px-1 rounded">
                {bundleResult.mls_hashtag}
              </code>{" "}
              is in the caption for auto-attribution.
            </div>
          ) : null}
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
