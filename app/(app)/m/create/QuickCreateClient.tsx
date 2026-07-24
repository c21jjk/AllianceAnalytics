"use client";

/**
 * Mobile Quick Create — phone-first post creation (July 2026).
 *
 * Flow: post type + listing → template → photos → caption → preview →
 * publish/schedule. The preview IS the published artifact: it's the PNG
 * produced by POST /api/post-builder/render — the same server-side
 * Chromium render path every published post goes through — so what
 * Larissa approves is byte-for-byte what posts.
 *
 * Carousel model matches the desktop Studio: the rendered template is
 * slide 0 (generated_posts.image_url); extra photos picked from the
 * listing's MLS set (or uploaded from the camera roll) become
 * additional_images slides 1..N with source "listing" / "upload".
 *
 * Camera-roll uploads are downscaled + converted to JPEG client-side
 * (canvas), which also normalizes iPhone HEIC before it reaches the
 * server. Uploads land in the shared listing_photos set (sequence
 * 1001+), so they're reusable from desktop too.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { TemplateMeta } from "@/lib/template-builder";
import type {
  PostFormat,
  PostType,
  SchedulablePlatform,
} from "@/lib/post-builder/types";
import type { PostBuilderListingWithOH } from "@/lib/post-builder/listing-html-utils";
import {
  upsertGeneratedPostFromStudioAction,
  schedulePostAction,
} from "@/app/(app)/post-builder/actions";

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS: Record<Step, string> = {
  1: "Listing",
  2: "Template",
  3: "Photos",
  4: "Caption",
  5: "Preview",
};

const POST_TYPES: Array<{ value: PostType; label: string }> = [
  { value: "just_listed", label: "Just Listed" },
  { value: "open_house", label: "Open House" },
  { value: "just_sold", label: "Just Sold" },
  { value: "under_contract", label: "Under Contract" },
  { value: "price_reduction", label: "Price Reduced" },
];

const FORMATS: Array<{ value: PostFormat; label: string }> = [
  { value: "square_1x1", label: "Square (feed)" },
  { value: "story_9x16", label: "Story 9:16" },
];

/** IG carousel ceiling is 10 — hero (slide 0) + 9 extra photos. */
const MAX_EXTRA_PHOTOS = 9;

const NY_TZ = "America/New_York";

interface ListingPhoto {
  url: string;
  sequence: number;
  source: "paragon" | "storage";
  caption: string | null;
}

interface CaptionBundle {
  caption: string;
  hashtags: string[];
  mls_hashtag: string;
  captions: Record<
    "facebook" | "instagram" | "tiktok",
    { caption: string; hashtags: string[] }
  >;
}

interface RenderResult {
  image_url: string;
  image_path: string;
  template_id: string;
  hero_image_source_url: string | null;
}

interface Props {
  isAdmin: boolean;
  initialListings: PostBuilderListingWithOH[];
  initialTemplates: TemplateMeta[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(value: number | null | undefined): string {
  if (value == null) return "";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * OH window label, pinned to America/New_York per the standing timezone
 * rule (every render-path date formatter pins ET). Mirrors the multi-OH
 * renderer's "Sat · 11:00 AM – 1:00 PM" semantics (en-dash range).
 */
function formatOhWindow(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string | null {
  if (!startIso) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: NY_TZ,
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: NY_TZ,
    }).format(d);
  const end = endIso ? new Date(endIso) : null;
  const endOk = end && !Number.isNaN(end.getTime());
  return endOk ? `${day} · ${time(start)} – ${time(end!)}` : `${day} · ${time(start)}`;
}

/**
 * Downscale + re-encode a camera-roll image to JPEG in the browser.
 * Normalizes iPhone HEIC (Safari decodes it natively into <img>/canvas)
 * so the server and Meta only ever see JPEG. Longest edge capped at
 * 2048px — plenty for FB/IG, small enough for cell upload.
 */
async function toUploadableJpeg(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that photo."));
      el.src = objectUrl;
    });
    const maxEdge = 2048;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that photo.");
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) throw new Error("Couldn't convert that photo.");
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** datetime-local string (user's local clock) → UTC ISO. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Default schedule slot: tomorrow 09:00 local, as a datetime-local value. */
function defaultScheduleValue(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuickCreateClient({
  isAdmin,
  initialListings,
  initialTemplates,
}: Props) {
  const router = useRouter();

  // -- Step machine --
  const [step, setStep] = useState<Step>(1);

  // -- Step 1: post type + listing --
  const [postType, setPostType] = useState<PostType>("just_listed");
  const [listings, setListings] = useState<PostBuilderListingWithOH[]>(initialListings);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingSearch, setListingSearch] = useState("");
  const [listing, setListing] = useState<PostBuilderListingWithOH | null>(null);

  // -- Step 2: template + format --
  const [format, setFormat] = useState<PostFormat>("square_1x1");
  const [templates, setTemplates] = useState<TemplateMeta[]>(initialTemplates);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(
    initialTemplates.find((t) => t.is_default)?.id ?? initialTemplates[0]?.id ?? null,
  );

  // -- Step 3: photos --
  const [photos, setPhotos] = useState<ListingPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [selectedPhotoUrls, setSelectedPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // -- Step 4: caption --
  const [captionBundle, setCaptionBundle] = useState<CaptionBundle | null>(null);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [captionText, setCaptionText] = useState<string>("");
  const captionListingRef = useRef<string | null>(null);

  // -- Step 5: render + save + publish --
  const [render, setRender] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState("");
  const [gpId, setGpId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renderKeyRef = useRef<string | null>(null);
  const savedKeyRef = useRef<string | null>(null);

  const [platforms, setPlatforms] = useState<Record<SchedulablePlatform, boolean>>({
    facebook: true,
    instagram: true,
    tiktok: false,
  });
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduleValue, setScheduleValue] = useState<string>(defaultScheduleValue);
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState<null | { kind: "posted" | "scheduled" | "draft"; detail: string }>(null);

  const [error, setError] = useState<string | null>(null);

  // -- Derived --
  const filteredListings = useMemo(() => {
    const q = listingSearch.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((l) =>
      [l.address, l.city, l.mls_number]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [listings, listingSearch]);

  const ohWindow = useMemo(
    () =>
      postType === "open_house" && listing
        ? formatOhWindow(listing.oh_start_at, listing.oh_end_at)
        : null,
    [postType, listing],
  );

  /** Anything that changes the rendered hero invalidates render + save. */
  const renderKey = listing
    ? `${listing.mls_number}|${templateId ?? "factory"}|${format}|${postType}`
    : null;
  /** Anything that changes the saved row invalidates the save. */
  const saveKey = renderKey
    ? `${renderKey}|${selectedPhotoUrls.join(",")}|${captionText}`
    : null;

  // -- Fetchers --

  const loadListings = useCallback(async (pt: PostType) => {
    setListingsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mobile/listings?post_type=${pt}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load listings");
      setListings(json.listings as PostBuilderListingWithOH[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load listings");
      setListings([]);
    } finally {
      setListingsLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async (pt: PostType, fmt: PostFormat) => {
    setTemplatesLoading(true);
    try {
      const res = await fetch(`/api/mobile/templates?post_type=${pt}&format=${fmt}`);
      const json = await res.json();
      const list: TemplateMeta[] = json.ok ? json.templates : [];
      setTemplates(list);
      setTemplateId(list.find((t) => t.is_default)?.id ?? list[0]?.id ?? null);
    } catch {
      setTemplates([]);
      setTemplateId(null);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const loadPhotos = useCallback(async (mls: string) => {
    setPhotosLoading(true);
    try {
      const res = await fetch(`/api/post-builder/photos?mls=${encodeURIComponent(mls)}`);
      const json = await res.json();
      setPhotos(json.ok ? (json.photos as ListingPhoto[]) : []);
    } catch {
      setPhotos([]);
    } finally {
      setPhotosLoading(false);
    }
  }, []);

  const generateCaption = useCallback(
    async (l: PostBuilderListingWithOH, pt: PostType) => {
      setCaptionLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/post-builder/caption", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listing: l, post_type: pt }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Caption generation failed");
        const bundle = json as CaptionBundle & { ok: true };
        setCaptionBundle(bundle);
        setCaptionText(bundle.captions?.instagram?.caption ?? bundle.caption ?? "");
        captionListingRef.current = `${l.mls_number}|${pt}`;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Caption generation failed");
      } finally {
        setCaptionLoading(false);
      }
    },
    [],
  );

  // -- Effects: reload dependent data when upstream picks change --

  useEffect(() => {
    // Post type changed → new listing pool, new templates, reset downstream.
    loadListings(postType);
    loadTemplates(postType, format);
    setListing(null);
    setSelectedPhotoUrls([]);
    setCaptionBundle(null);
    setCaptionText("");
    setRender(null);
    setGpId(null);
    setDone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postType]);

  useEffect(() => {
    loadTemplates(postType, format);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  useEffect(() => {
    if (!listing) return;
    loadPhotos(listing.mls_number);
    setSelectedPhotoUrls([]);
    // A different listing means a different generated_posts row — the
    // upsert action (correctly) refuses cross-listing overwrites.
    setRender(null);
    setGpId(null);
    setDone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.mls_number]);

  // Generate caption when entering the caption step (or regenerating).
  useEffect(() => {
    if (step !== 4 || !listing) return;
    const key = `${listing.mls_number}|${postType}`;
    if (captionListingRef.current === key && captionBundle) return;
    generateCaption(listing, postType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, listing?.mls_number, postType]);

  // Render the exact preview when entering step 5 (or when stale).
  useEffect(() => {
    if (step !== 5 || !listing || !renderKey) return;
    if (renderKeyRef.current === renderKey && render) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      setError(null);
      setRenderStatus("Populating your template…");
      const statusTimer = setInterval(() => {
        setRenderStatus((prev) =>
          prev === "Populating your template…"
            ? "Rendering the final image…"
            : "Almost there — polishing pixels…",
        );
      }, 6000);
      try {
        const body: Record<string, unknown> = {
          listing,
          format,
          post_type: postType,
        };
        if (templateId) body.template_id = templateId;
        if (postType === "open_house") {
          body.oh_window = ohWindow;
          body.open_house_start_utc = listing.oh_start_at ?? null;
          body.open_house_end_utc = listing.oh_end_at ?? null;
        }
        const res = await fetch("/api/post-builder/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Render failed");
        if (cancelled) return;
        setRender({
          image_url: json.image_url,
          image_path: json.image_path,
          template_id: json.template_id,
          hero_image_source_url: json.hero_image_source_url ?? listing.hero_image_url,
        });
        renderKeyRef.current = renderKey;
        savedKeyRef.current = null; // fresh render → row must be (re)saved
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Render failed");
        }
      } finally {
        clearInterval(statusTimer);
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, renderKey]);

  // -- Photo selection / upload --

  const togglePhoto = useCallback((url: string) => {
    setSelectedPhotoUrls((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= MAX_EXTRA_PHOTOS) return prev;
      return [...prev, url];
    });
    savedKeyRef.current = null;
  }, []);

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !listing) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          const blob = await toUploadableJpeg(file);
          const form = new FormData();
          form.set("mls", listing.mls_number);
          if (listing.source_mls) form.set("source_mls", listing.source_mls);
          form.set("file", new File([blob], "upload.jpg", { type: "image/jpeg" }));
          const res = await fetch("/api/mobile/upload-photo", {
            method: "POST",
            body: form,
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || "Upload failed");
          const photo = json.photo as ListingPhoto;
          setPhotos((prev) => [...prev, photo]);
          // Auto-select what she just shot — that's why she uploaded it.
          setSelectedPhotoUrls((prev) =>
            prev.length < MAX_EXTRA_PHOTOS ? [...prev, photo.url] : prev,
          );
        }
        savedKeyRef.current = null;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [listing],
  );

  // -- Save (upsert) — called before publish/schedule --

  const ensureSaved = useCallback(async (): Promise<string | null> => {
    if (!listing || !render || !captionBundle) return null;
    if (gpId && savedKeyRef.current === saveKey) return gpId;

    setSaving(true);
    try {
      // Per-platform captions: platform-tuned hashtags from the AI bundle,
      // body text = whatever Larissa approved/edited on the caption step.
      const captions_by_platform = Object.fromEntries(
        (["facebook", "instagram", "tiktok"] as const).map((p) => [
          p,
          {
            caption: captionText.trim() || captionBundle.captions[p]?.caption || captionBundle.caption,
            hashtags: captionBundle.captions[p]?.hashtags ?? captionBundle.hashtags,
          },
        ]),
      );

      const additional_images = selectedPhotoUrls.map((url) => {
        const photo = photos.find((p) => p.url === url);
        return {
          id: crypto.randomUUID(),
          url,
          source: photo?.source === "storage" ? "upload" : "listing",
          listingPhotoSequence: photo?.sequence,
        };
      });

      const result = await upsertGeneratedPostFromStudioAction({
        id: gpId,
        mls_number: listing.mls_number,
        source_mls: listing.source_mls,
        property_id: listing.id,
        post_type: postType,
        variant: "v1",
        format,
        template_id: render.template_id,
        image_url: render.image_url,
        image_path: render.image_path,
        hero_image_source_url: render.hero_image_source_url,
        layer_tree: null,
        additional_images: additional_images as never,
        slide_metadata: [] as never,
        captions_by_platform: captions_by_platform as never,
      });
      if (!result.ok) throw new Error(result.error);
      setGpId(result.id);
      savedKeyRef.current = saveKey;
      return result.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the post");
      return null;
    } finally {
      setSaving(false);
    }
  }, [listing, render, captionBundle, gpId, saveKey, captionText, selectedPhotoUrls, photos, postType, format]);

  // -- Publish / schedule / draft --

  const selectedPlatforms = (Object.keys(platforms) as SchedulablePlatform[]).filter(
    (p) => platforms[p],
  );

  const handlePostNow = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      const id = await ensureSaved();
      if (!id) return;
      const res = await fetch("/api/post-builder/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generated_post_id: id, platforms: selectedPlatforms }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Publish failed");
      const okPlatforms: string[] = Array.isArray(json.results)
        ? json.results
            .filter((r: { ok: boolean }) => r.ok)
            .map((r: { platform: string }) => r.platform)
        : [];
      const failed: string[] = Array.isArray(json.results)
        ? json.results
            .filter((r: { ok: boolean }) => !r.ok)
            .map((r: { platform: string; error?: string }) => `${r.platform}: ${r.error ?? "failed"}`)
        : [];
      if (okPlatforms.length === 0) {
        throw new Error(failed.join(" · ") || "Publish failed on every platform");
      }
      setDone({
        kind: "posted",
        detail:
          `Live on ${okPlatforms.join(" + ")}` +
          (failed.length ? ` — failed: ${failed.join(" · ")}` : ""),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }, [ensureSaved, selectedPlatforms]);

  const handleSchedule = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      const iso = localInputToIso(scheduleValue);
      if (!iso) throw new Error("Pick a valid date and time.");
      if (new Date(iso).getTime() < Date.now() + 60_000) {
        throw new Error("Schedule time must be at least a minute in the future.");
      }
      if (selectedPlatforms.length === 0) {
        throw new Error("Pick at least one platform.");
      }
      const id = await ensureSaved();
      if (!id) return;
      const scheduled_for = Object.fromEntries(
        selectedPlatforms.map((p) => [p, iso]),
      );
      const result = await schedulePostAction({
        generated_post_id: id,
        scheduled_for,
      });
      if (!result.ok) throw new Error(result.error);
      const local = new Date(iso).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: NY_TZ,
      });
      setDone({
        kind: "scheduled",
        detail: `Scheduled for ${local} ET on ${selectedPlatforms.join(" + ")}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scheduling failed");
    } finally {
      setPublishing(false);
    }
  }, [ensureSaved, scheduleValue, selectedPlatforms]);

  const handleSaveDraft = useCallback(async () => {
    setPublishing(true);
    setError(null);
    try {
      const id = await ensureSaved();
      if (!id) return;
      setDone({
        kind: "draft",
        detail: "Saved — finish it any time from Saved Posts.",
      });
    } finally {
      setPublishing(false);
    }
  }, [ensureSaved]);

  // -- Navigation guards --

  const canContinue: Record<Step, boolean> = {
    1: !!listing,
    2: templates.length === 0 || !!templateId, // no DB templates → factory fallback
    3: true, // extra photos optional
    4: !!captionBundle && captionText.trim().length > 0,
    5: false,
  };

  const goNext = () => setStep((s) => (s < 5 ? ((s + 1) as Step) : s));
  const goBack = () => {
    setDone(null);
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (done) {
    return (
      <div className="mx-auto max-w-md pt-8 pb-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gold-100">
          <Check className="h-8 w-8 text-gold-700" />
        </div>
        <h1 className="text-xl font-semibold text-neutral-900">
          {done.kind === "posted"
            ? "Posted!"
            : done.kind === "scheduled"
              ? "Scheduled!"
              : "Draft saved"}
        </h1>
        <p className="mt-2 text-sm text-neutral-600">{done.detail}</p>
        {render ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={render.image_url}
            alt="Post preview"
            className="mx-auto mt-6 w-56 rounded-xl border border-neutral-200 shadow-sm"
          />
        ) : null}
        <div className="mt-8 flex flex-col gap-3 px-6">
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setStep(1);
              setListing(null);
              setRender(null);
              setGpId(null);
              setCaptionBundle(null);
              setCaptionText("");
              setSelectedPhotoUrls([]);
            }}
            className="rounded-xl bg-gold-500 px-4 py-3.5 text-base font-semibold text-neutral-900 active:bg-gold-600"
          >
            Create another
          </button>
          <button
            type="button"
            onClick={() => router.push("/m/track")}
            className="rounded-xl border border-neutral-300 px-4 py-3.5 text-base font-medium text-neutral-700 active:bg-neutral-100"
          >
            Go to Track
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md pb-10">
      {/* Header + stepper */}
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-neutral-900">Quick Create</h1>
        <div className="mt-3 flex items-center gap-1">
          {([1, 2, 3, 4, 5] as Step[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => s < step && setStep(s)}
              disabled={s > step}
              className={clsx(
                "flex-1 rounded-full px-1 py-1.5 text-[11px] font-medium transition-colors",
                s === step
                  ? "bg-gold-500 text-neutral-900"
                  : s < step
                    ? "bg-gold-100 text-gold-800"
                    : "bg-neutral-100 text-neutral-400",
              )}
            >
              {STEP_LABELS[s]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Prefer the full builder?{" "}
          <Link href="/post-builder" className="text-gold-700 underline">
            Open Post Builder
          </Link>
          {" · "}
          <Link href="/post-builder/multi-oh" className="text-gold-700 underline">
            Multi-property Open House
          </Link>
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* ---- Step 1: type + listing ---- */}
      {step === 1 ? (
        <section>
          <div className="-mx-4 overflow-x-auto px-4">
            <div className="flex w-max gap-2 pb-1">
              {POST_TYPES.map((pt) => (
                <button
                  key={pt.value}
                  type="button"
                  onClick={() => setPostType(pt.value)}
                  className={clsx(
                    "whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium",
                    postType === pt.value
                      ? "border-gold-500 bg-gold-500/15 text-gold-800"
                      : "border-neutral-200 bg-white text-neutral-600",
                  )}
                >
                  {pt.label}
                </button>
              ))}
            </div>
          </div>

          <input
            type="search"
            inputMode="search"
            placeholder="Search address, town, or MLS #"
            value={listingSearch}
            onChange={(e) => setListingSearch(e.target.value)}
            className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none focus:border-gold-500"
          />

          {listingsLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading listings…
            </div>
          ) : filteredListings.length === 0 ? (
            <p className="py-12 text-center text-sm text-neutral-500">
              {postType === "open_house"
                ? "No listings with an upcoming open house in the next two weeks."
                : "No matching listings."}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {filteredListings.map((l) => {
                const selected = listing?.mls_number === l.mls_number;
                const oh =
                  postType === "open_house"
                    ? formatOhWindow(l.oh_start_at, l.oh_end_at)
                    : null;
                return (
                  <li key={l.mls_number}>
                    <button
                      type="button"
                      onClick={() => setListing(l)}
                      className={clsx(
                        "flex w-full items-center gap-3 rounded-2xl border bg-white p-2.5 text-left",
                        selected
                          ? "border-gold-500 ring-2 ring-gold-500/30"
                          : "border-neutral-200",
                      )}
                    >
                      {l.hero_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={l.hero_image_url}
                          alt=""
                          className="h-16 w-16 shrink-0 rounded-xl object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-16 w-16 shrink-0 rounded-xl bg-neutral-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-neutral-900">
                          {l.address}
                          {l.unit_number ? ` · ${l.unit_number}` : ""}
                        </p>
                        <p className="truncate text-xs text-neutral-500">
                          {l.city}
                          {l.list_price ? ` · ${fmtPrice(l.list_price)}` : ""}
                          {` · MLS ${l.mls_number}`}
                        </p>
                        {oh ? (
                          <p className="mt-0.5 text-xs font-medium text-gold-700">
                            OH {oh}
                          </p>
                        ) : null}
                      </div>
                      {selected ? (
                        <Check className="h-5 w-5 shrink-0 text-gold-600" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* ---- Step 2: template + format ---- */}
      {step === 2 ? (
        <section>
          <div className="mb-3 flex rounded-xl bg-neutral-100 p-1">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                className={clsx(
                  "flex-1 rounded-lg py-2 text-sm font-medium",
                  format === f.value
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {templatesLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading templates…
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
              <Wand2 className="mb-2 h-5 w-5 text-gold-600" />
              No published templates for this type + format yet — the
              Alliance default design will be used. You can continue.
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {templates.map((t) => {
                const selected = templateId === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTemplateId(t.id)}
                      className={clsx(
                        "w-full overflow-hidden rounded-2xl border bg-white text-left",
                        selected
                          ? "border-gold-500 ring-2 ring-gold-500/30"
                          : "border-neutral-200",
                      )}
                    >
                      {t.preview_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.preview_image_url}
                          alt=""
                          className={clsx(
                            "w-full object-cover",
                            format === "story_9x16" ? "aspect-[9/16]" : "aspect-square",
                          )}
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className={clsx(
                            "flex w-full items-center justify-center bg-neutral-100 text-neutral-400",
                            format === "story_9x16" ? "aspect-[9/16]" : "aspect-square",
                          )}
                        >
                          <Sparkles className="h-6 w-6" />
                        </div>
                      )}
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="truncate text-xs font-medium text-neutral-800">
                          {t.name}
                          {t.is_default ? " ★" : ""}
                        </span>
                        {selected ? (
                          <Check className="h-4 w-4 shrink-0 text-gold-600" />
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* ---- Step 3: photos ---- */}
      {step === 3 ? (
        <section>
          <p className="mb-3 text-sm text-neutral-600">
            The rendered design is always slide 1. Tap photos to add them as
            extra carousel slides (up to {MAX_EXTRA_PHOTOS}) — numbers show
            the order.
          </p>

          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-gold-400 bg-gold-50/50 px-4 py-3 text-sm font-medium text-gold-800 active:bg-gold-100 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Add from camera roll"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
          </div>

          {photosLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading photos…
            </div>
          ) : photos.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              No photos synced for this listing yet — you can still continue
              with just the designed slide, or add photos from your camera
              roll above.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map((p) => {
                const idx = selectedPhotoUrls.indexOf(p.url);
                const selected = idx >= 0;
                return (
                  <li key={`${p.sequence}-${p.url}`} className="relative">
                    <button
                      type="button"
                      onClick={() => togglePhoto(p.url)}
                      className={clsx(
                        "block w-full overflow-hidden rounded-xl border",
                        selected
                          ? "border-gold-500 ring-2 ring-gold-500/40"
                          : "border-neutral-200",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt=""
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                    {selected ? (
                      <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-gold-500 text-xs font-bold text-neutral-900 shadow">
                        {idx + 2}
                      </span>
                    ) : null}
                    {p.source === "storage" ? (
                      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        Added
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* ---- Step 4: caption ---- */}
      {step === 4 ? (
        <section>
          {captionLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-neutral-500">
              <Sparkles className="h-6 w-6 animate-pulse text-gold-500" />
              <p className="text-sm">Writing your caption…</p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <label
                  htmlFor="qc-caption"
                  className="text-sm font-medium text-neutral-800"
                >
                  Caption
                </label>
                <button
                  type="button"
                  onClick={() => listing && generateCaption(listing, postType)}
                  className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 active:bg-neutral-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                </button>
              </div>
              <textarea
                id="qc-caption"
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                rows={9}
                className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base leading-relaxed outline-none focus:border-gold-500"
              />
              {captionBundle ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(captionBundle.captions.instagram?.hashtags ?? captionBundle.hashtags)
                    .slice(0, 12)
                    .map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600"
                      >
                        {tag}
                      </span>
                    ))}
                </div>
              ) : null}
              <p className="mt-2 text-xs text-neutral-500">
                Hashtags are tuned per platform automatically and added on
                publish.
              </p>
            </>
          )}
        </section>
      ) : null}

      {/* ---- Step 5: preview + publish ---- */}
      {step === 5 ? (
        <section>
          {rendering ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-neutral-500">
              <Loader2 className="h-7 w-7 animate-spin text-gold-500" />
              <p className="text-sm">{renderStatus}</p>
              <p className="text-xs text-neutral-400">
                This is the exact image that will publish.
              </p>
            </div>
          ) : render ? (
            <>
              <div className="-mx-4 overflow-x-auto px-4">
                <div className="flex w-max gap-2">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={render.image_url}
                      alt="Designed slide"
                      className={clsx(
                        "rounded-xl border border-neutral-200 object-cover shadow-sm",
                        format === "story_9x16" ? "h-72 aspect-[9/16]" : "h-60 aspect-square",
                      )}
                    />
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      1 · Design
                    </span>
                  </div>
                  {selectedPhotoUrls.map((url, i) => (
                    <div key={url} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className={clsx(
                          "rounded-xl border border-neutral-200 object-cover",
                          format === "story_9x16" ? "h-72 aspect-[9/16]" : "h-60 aspect-square",
                        )}
                      />
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {i + 2}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
                  {captionText}
                </p>
              </div>

              {/* Platforms */}
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium text-neutral-800">Platforms</p>
                <div className="flex gap-2">
                  {(["facebook", "instagram", "tiktok"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setPlatforms((prev) => ({ ...prev, [p]: !prev[p] }))
                      }
                      className={clsx(
                        "flex-1 rounded-xl border py-2.5 text-sm font-medium capitalize",
                        platforms[p]
                          ? "border-gold-500 bg-gold-500/15 text-gold-800"
                          : "border-neutral-200 bg-white text-neutral-400",
                      )}
                    >
                      {p === "tiktok" ? "TikTok" : p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Now vs schedule */}
              <div className="mt-4 flex rounded-xl bg-neutral-100 p-1">
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setMode("now")}
                    className={clsx(
                      "flex-1 rounded-lg py-2 text-sm font-medium",
                      mode === "now"
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-500",
                    )}
                  >
                    Post now
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMode("schedule")}
                  className={clsx(
                    "flex-1 rounded-lg py-2 text-sm font-medium",
                    mode === "schedule" || !isAdmin
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-500",
                  )}
                >
                  Schedule
                </button>
              </div>

              {(mode === "schedule" || !isAdmin) && (
                <input
                  type="datetime-local"
                  value={scheduleValue}
                  onChange={(e) => setScheduleValue(e.target.value)}
                  className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base outline-none focus:border-gold-500"
                />
              )}

              <div className="mt-5 flex flex-col gap-3">
                <button
                  type="button"
                  disabled={publishing || saving || selectedPlatforms.length === 0}
                  onClick={mode === "now" && isAdmin ? handlePostNow : handleSchedule}
                  className="flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-3.5 text-base font-semibold text-neutral-900 active:bg-gold-600 disabled:opacity-50"
                >
                  {publishing || saving ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : null}
                  {publishing || saving
                    ? "Working…"
                    : mode === "now" && isAdmin
                      ? `Post now to ${selectedPlatforms.length} platform${selectedPlatforms.length === 1 ? "" : "s"}`
                      : "Schedule post"}
                </button>
                <button
                  type="button"
                  disabled={publishing || saving}
                  onClick={handleSaveDraft}
                  className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700 active:bg-neutral-100 disabled:opacity-50"
                >
                  Save as draft instead
                </button>
              </div>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-neutral-500">
              Preview couldn&rsquo;t be generated.{" "}
              <button
                type="button"
                className="text-gold-700 underline"
                onClick={() => {
                  renderKeyRef.current = null;
                  setStep(4);
                  // Re-entering step 5 re-triggers the render effect.
                  setTimeout(() => setStep(5), 0);
                }}
              >
                Try again
              </button>
            </p>
          )}
        </section>
      ) : null}

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={goBack}
            className="flex items-center gap-1 rounded-xl border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700 active:bg-neutral-100"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
        ) : (
          <span />
        )}
        {step < 5 ? (
          <button
            type="button"
            disabled={!canContinue[step]}
            onClick={goNext}
            className="flex items-center gap-1 rounded-xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white active:bg-neutral-700 disabled:opacity-40"
          >
            {step === 4 ? "Preview" : "Continue"} <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
