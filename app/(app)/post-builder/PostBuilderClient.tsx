"use client";

import { useEffect, useMemo, useState } from "react";
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
}

export default function PostBuilderClient({
  listingsByPostType,
  variantsByPostTypeAndFormat,
  formatMeta,
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
  // Photo picker state
  const [availablePhotos, setAvailablePhotos] = useState<PhotoOption[]>([]);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number>(0);
  const [photosLoading, setPhotosLoading] = useState(false);
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
      });
      setEditedCaption(json.caption);
    } catch (e) {
      setError(`Bundle generate threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBundleGenerating(false);
    }
  }

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

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
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
                const active = l.mls_number === selectedMls;
                const showPrice =
                  postType === "just_sold" && typeof l.close_price === "number"
                    ? l.close_price
                    : l.list_price;
                return (
                  <button
                    key={l.mls_number}
                    type="button"
                    onClick={() => pickListing(l.mls_number)}
                    className={[
                      "w-full text-left rounded-lg border p-2.5 transition flex gap-3 items-start",
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
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-neutral-900 truncate">
                        {l.address ?? l.mls_number}
                      </div>
                      <div className="text-xs text-neutral-600 truncate">
                        {[l.city, l.state].filter(Boolean).join(", ")}
                        {l.zip ? ` ${l.zip}` : ""}
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2">
                        <span className="font-mono uppercase tracking-wide">
                          {l.mls_number}
                        </span>
                        {typeof showPrice === "number" ? (
                          <span className="text-gold-700 font-medium">
                            ${showPrice.toLocaleString()}
                            {postType === "just_sold" ? " sold" : ""}
                          </span>
                        ) : null}
                        {postType === "open_house" && l.oh_start_at ? (
                          <span className="text-emerald-700 font-medium">
                            OH {formatOhBadge(l.oh_start_at)}
                          </span>
                        ) : null}
                      </div>
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
          {!selectedListing ? (
            <EmptyPreview />
          ) : (
            <div className="flex flex-col h-full">
              {/* Format + Variant (only shown in IG single-image mode) */}
              {outputMode === "ig_single" ? (
              <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 mb-4">
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
                <div>
                  <div className="eyebrow mb-2">Step 3 · Variant</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {variants.map((v) => {
                      const active = v.variant === variantId;
                      return (
                        <button
                          key={v.template_id}
                          type="button"
                          onClick={() => changeVariant(v.variant as PostVariant)}
                          className={[
                            "text-left rounded-lg border p-3 transition",
                            active
                              ? "border-gold-500 bg-gold-50/40 ring-1 ring-gold-500/20"
                              : "border-neutral-200 bg-white hover:border-neutral-300",
                          ].join(" ")}
                        >
                          <div
                            className={[
                              "text-sm font-semibold",
                              active ? "text-gold-800" : "text-neutral-900",
                            ].join(" ")}
                          >
                            {v.display_name}
                          </div>
                          <div className="text-xs text-neutral-500 mt-1 leading-snug line-clamp-2">
                            {v.description}
                          </div>
                        </button>
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
                              className="w-20 h-20 object-cover bg-neutral-100"
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
                            className="w-20 h-20 object-cover bg-neutral-100"
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
                          <button
                            type="button"
                            onClick={downloadBundle}
                            className="btn-primary mt-1"
                          >
                            Download ZIP
                          </button>
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
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={downloadPng}
                        disabled={downloadSaving}
                        className="btn-primary flex-1"
                      >
                        {downloadSaving ? "Saving…" : "Download PNG"}
                      </button>
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

function formatOhBadge(start_at: string): string {
  try {
    const d = new Date(start_at);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      timeZone: "America/New_York",
    }).format(d);
  } catch {
    return "";
  }
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
