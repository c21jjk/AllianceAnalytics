"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MOTION_PRESETS,
  REEL_CAPS,
  type AudioTrack,
  type PostBuilderListing,
  type PostType,
  type SchedulablePlatform,
  type Scene,
  type TransitionType,
  type VideoComposition,
} from "@/lib/post-builder/types";
import {
  triggerReelRenderAction,
  getReelRenderStatusAction,
  persistRenderedReelAction,
  adaptHeroCardToReelAction,
} from "@/app/(app)/post-builder/actions";
import { findCanvasTemplate } from "@/lib/post-builder/canvas-editor/templates";
import type { CanvasTemplateSchema } from "@/lib/post-builder/canvas-editor/types";
import {
  buildEndCardScene,
  snapScenesToBeat,
} from "@/lib/post-builder/reel-templates/build-from-carousel";
import type { ScenePropertiesPanelProps } from "@/lib/post-builder/canvas-editor/contracts";
// Real imports — the two sibling components shipped on 2026-05-16 alongside
// this shell. Earlier drafts of this file stubbed both as () => null so the
// orchestrator could ship the shell before the panels existed; that scaffold
// is removed now that all three Day-3 deliverables are in place.
import TimelineStrip from "@/lib/post-builder/canvas-editor/panels/TimelineStrip";
import ScenePropertiesPanel from "@/lib/post-builder/canvas-editor/panels/ScenePropertiesPanel";
// Day 4 — real-time canvas-based playback preview replaces the Day 3 static
// frame-0 representation. Lives in panels/ alongside the other Studio panels
// even though it's Reel-specific (single panel namespace, no Reel-specific
// subfolder yet).
import ReelPreview from "@/lib/post-builder/canvas-editor/panels/ReelPreview";
// Day 5 — music picker (background-music selection + volume + fades). Mounted
// in the right sidebar below ScenePropertiesPanel so the controls Larissa
// reaches for less often live below the per-scene controls she reaches for
// every edit.
import MusicPicker from "@/lib/post-builder/canvas-editor/panels/MusicPicker";
import type { ReelResumeRow } from "@/lib/data/created-posts-db";
// Reel Template Library — picker overlay + manifest. Lets Larissa swap the
// active composition for a pre-composed template (Cinematic Tour, Price Drop
// Punch, etc.) without rebuilding scene-by-scene. See
// `lib/post-builder/reel-templates/manifest.ts` for the 15-template catalog.
import ReelTemplatesPanel from "./ReelTemplatesPanel";
import type { ReelTemplate } from "@/lib/post-builder/reel-templates/types";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface Props {
  listings: PostBuilderListing[];
  /** Optional MLS number to pre-select on mount (from `?mls=` deep link). */
  preSelectedMls?: string | null;
  /**
   * Optional saved-Reel resume row (from `?gp=<id>`). When present:
   *   - The listing-picker step is skipped — we auto-select the row's
   *     `mls_number` if the listing is in `listings`.
   *   - The composition state is seeded from `composition_json` instead of
   *     being built from `buildDefaultComposition`.
   *   - The Generate button label flips to "Re-generate Reel" — re-renders
   *     create a sibling row, NOT update the existing one, matching the
   *     carousel + multi-OH pattern.
   * Null on fresh-start navigations to /post-builder/reel.
   */
  initialResume?: ReelResumeRow | null;
}

/**
 * Photo URL list keyed off the active listing. Empty array is a valid state
 * (listing with no photos yet — the warning chip surfaces inline).
 */
type AvailablePhotos = readonly string[];

/** Toast shape for the lightweight inline toast above the workspace. */
interface ToastState {
  kind: "info" | "warn" | "error";
  message: string;
}

/**
 * Phases of the Generate Reel flow. Distinct phases (not a boolean) so the
 * overlay can render different copy + show progress only when meaningful.
 *
 *   idle        — nothing in flight; the Generate button is enabled.
 *   submitting  — the POST /render is in flight; no job_id yet.
 *   polling     — we have a job_id and are polling for status.
 *   persisting  — render succeeded; we're inserting the generated_posts row.
 *   error       — surfaced a worker / persist failure; the overlay shows it
 *                 with a Dismiss action that resets to idle.
 */
type GenerateState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | {
      phase: "polling";
      jobId: string;
      /** Last status the worker reported. Used to decide what overlay copy
       *  to show (queued vs processing) and whether to show progress. */
      status: "queued" | "processing";
      /** 0..100. Meaningful while status === "processing". */
      progressPct: number;
      /** Rotating "composing... / encoding... / uploading..." message. */
      messageIndex: number;
    }
  | { phase: "persisting" }
  | { phase: "error"; message: string };

// ---------------------------------------------------------------------------
// Constants — local defaults that don't belong in the schema
// ---------------------------------------------------------------------------

/** Default per-scene duration when seeding a fresh composition (ms). */
const DEFAULT_SCENE_DURATION_MS = 1_500;
/** Default outro duration — slightly shorter than the body scenes. */
const DEFAULT_OUTRO_DURATION_MS = 1_000;

/**
 * Global pace presets (2026-06-05). One tap rescales EVERY photo scene's
 * duration so the whole Reel speeds up / slows down without touching each
 * slide individually. Design scenes (hero / outro) keep their own timing —
 * pace is about the photo-slide rhythm. Per-scene fine-tuning still lives in
 * ScenePropertiesPanel; this is the coarse "feel" control.
 */
const PACE_PHOTO_MS = {
  // 2026-06-05 — slowed across the board; the old values panned too fast.
  // Old fast(1800) dropped; old standard(3000) is now Fast, old slow(4500)
  // is now Standard, and Slow goes slower still.
  slow: 6_000,
  standard: 4_500,
  fast: 3_000,
} as const;
type PaceKey = keyof typeof PACE_PHOTO_MS;
const PACE_ORDER: readonly PaceKey[] = ["slow", "standard", "fast"];
const PACE_LABEL: Readonly<Record<PaceKey, string>> = {
  slow: "Slow",
  standard: "Standard",
  fast: "Fast",
};
/**
 * Derive the audio post-type from the selected listing's status so the reel
 * builder can auto-pick a fitting Audio Library track. The composition itself
 * doesn't carry a post type; the listing status is the best client-side signal
 * (active = just listed, pending = under contract, sold = just sold).
 */
const AUDIO_POST_TYPE_BY_LISTING_STATUS: Readonly<
  Record<PostBuilderListing["status"], PostType>
> = {
  active: "just_listed",
  pending: "under_contract",
  sold: "just_sold",
  expired: "just_listed",
};

/** Reels publish across all three networks; auto-audio logs usage per platform. */
const REEL_AUDIO_PLATFORMS: readonly SchedulablePlatform[] = [
  "instagram",
  "facebook",
  "tiktok",
];

/** Default transition durations by type — overrideable per scene later. */
const DEFAULT_TRANSITION_MS_BY_TYPE: Readonly<Record<TransitionType, number>> = {
  cut: 0,
  fade: 400,
  dissolve: 300,
  fade_white: 300,
  slide_left: 350,
  slide_right: 350,
  slide_up: 350,
  slide_down: 350,
  wipe_left: 350,
  smooth_left: 400,
  smooth_right: 400,
  circle_open: 500,
  zoom_blur: 400,
};

/**
 * Global transition style options (label + value) for the header dropdown.
 * 2026-06-06 — transitions are now ONE choice for the whole Reel, not per
 * scene. Labels mirror the old per-scene panel so nothing reads differently.
 */
const TRANSITION_STYLE_OPTIONS: ReadonlyArray<{
  value: TransitionType;
  label: string;
}> = [
  { value: "cut", label: "Cut (none)" },
  { value: "fade", label: "Crossfade" },
  { value: "dissolve", label: "Dip to black" },
  { value: "fade_white", label: "Dip to white" },
  { value: "slide_left", label: "Slide left" },
  { value: "slide_right", label: "Slide right" },
  { value: "slide_up", label: "Slide up" },
  { value: "slide_down", label: "Slide down" },
  { value: "wipe_left", label: "Wipe" },
  { value: "smooth_left", label: "Whip left" },
  { value: "smooth_right", label: "Whip right" },
  { value: "circle_open", label: "Circle" },
  { value: "zoom_blur", label: "Zoom blur" },
];

/**
 * Global transition speed options, in ms. Must include every value any seed
 * path emits (300 = Standard) so the header dropdown always has a match.
 */
const TRANSITION_SPEED_OPTIONS: ReadonlyArray<{
  value: number;
  label: string;
}> = [
  { value: 200, label: "Quick · 0.2s" },
  { value: 300, label: "Standard · 0.3s" },
  { value: 400, label: "Smooth · 0.4s" },
  { value: 600, label: "Slow · 0.6s" },
  { value: 1000, label: "Dramatic · 1.0s" },
];

/** Cycle order for `onCycleTransition` taps in the timeline. */
const TRANSITION_CYCLE: readonly TransitionType[] = [
  "cut",
  "fade",
  "dissolve",
  "fade_white",
  "slide_left",
  "slide_right",
  "slide_up",
  "slide_down",
  "wipe_left",
  "smooth_left",
  "smooth_right",
  "circle_open",
  "zoom_blur",
];

// ---------------------------------------------------------------------------
// Reel render flow constants (Day 6)
// ---------------------------------------------------------------------------

/**
 * Poll interval between status calls in ms. why 1500ms: the worker advances
 * progress_pct in roughly 5% increments during the render loop — polling
 * more often than that produces a stream of identical responses; polling
 * less often makes the progress bar feel stalled.
 */
const REEL_POLL_INTERVAL_MS = 1_500;

/**
 * Maximum total wait before giving up on a render in ms. 180s = 3 minutes,
 * comfortably above the worker's typical 10-30s render time even with cold
 * start. Past this we surface a "render timed out" message rather than
 * polling forever — protects against a stuck worker eating session battery.
 */
const REEL_POLL_MAX_DURATION_MS = 180_000;

/**
 * Rotating status messages shown during the wait. Cycles every 4s so the
 * user sees motion even when progress_pct doesn't advance. Order matches
 * the actual worker pipeline (compose → encode → upload → almost there).
 */
const REEL_STATUS_MESSAGES: readonly string[] = [
  "Composing frames...",
  "Encoding video...",
  "Uploading...",
  "Almost there...",
];
const REEL_STATUS_ROTATION_MS = 4_000;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Recompute each scene's `startMs` by walking the scenes in order and
 * accumulating durations minus the transition overlap into the prior scene.
 *
 * why: transitions overlap the END of the previous scene by `transitionMs`,
 * so the next scene's start = prevStart + prevDuration - thisTransitionMs.
 * The first scene always starts at 0 regardless of its transitionMs (the
 * first transition is "into the timeline" from black, not between scenes).
 *
 * Returns a new array with the same Scene identity for any unchanged fields —
 * only `startMs` is rewritten. Also returns the total composition duration
 * in ms so callers can update `composition.totalDurationMs` in one pass.
 */
function recomputeTimeline(
  scenes: readonly Scene[],
): { scenes: readonly Scene[]; totalDurationMs: number } {
  if (scenes.length === 0) return { scenes: [], totalDurationMs: 0 };
  const out: Scene[] = [];
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!;
    // First scene always starts at 0. Subsequent scenes subtract their
    // transitionMs from the previous scene's end (the overlap).
    const overlap = i === 0 ? 0 : Math.min(s.transitionMs, scenes[i - 1]!.durationMs);
    const startMs = i === 0 ? 0 : cursor - overlap;
    out.push({ ...s, startMs });
    cursor = startMs + s.durationMs;
  }
  return { scenes: out, totalDurationMs: cursor };
}

/**
 * Pick the Nth photo with wrap-around so a listing with only 1 photo still
 * fills a 3-photo composition gracefully (every body scene reuses photos[0]).
 * Returns null only when the photos array is genuinely empty.
 */
function pickPhotoCycling(
  photos: AvailablePhotos,
  index: number,
): string | null {
  if (photos.length === 0) return null;
  return photos[index % photos.length] ?? null;
}

/**
 * Build a sensible 5-scene default composition when the user first picks a
 * listing. Structure: hero card (1.5s) → 3 photo scenes with motion (1.5s
 * each) → hero card outro (1.0s). Total nominal ≈ 7.0s before transition
 * overlaps, lands ~6.0s after.
 *
 * why these defaults: 7s is the IG Reels sweet spot for static-property
 * content (long enough to absorb 3-4 photos, short enough to keep watch-
 * through above the algorithm's distribution threshold). Zoom-in/zoom-out/
 * pan-left alternation gives visual rhythm without being chaotic.
 */
/**
 * Narrow a `composition_json` JSONB value back into a `VideoComposition`.
 *
 * The DB layer types this as `unknown` because Supabase's jsonb column
 * has no schema. Day 1 of the Reel build wrote the column from a
 * type-checked VideoComposition source, so any row we INSERTED is
 * structurally valid; this helper exists for defense-in-depth against
 * a hand-mutated row or a future schema change.
 *
 * Returns null on any of:
 *   - null / undefined input (fresh-start: no resume)
 *   - non-object input (wrong jsonb shape)
 *   - missing or non-array scenes
 *   - empty scenes
 *
 * On null return, the caller falls back to buildDefaultComposition so the
 * workspace still renders.
 */
function resumeCompositionFromJson(
  raw: unknown,
): VideoComposition | null {
  if (!raw || typeof raw !== "object") return null;
  // why: cast is structurally validated by the checks below — the runtime
  // shape is what matters. The TS narrow won't catch all of it (jsonb is
  // permissive) so we trust + verify.
  const comp = raw as Partial<VideoComposition>;
  if (!Array.isArray(comp.scenes) || comp.scenes.length === 0) return null;
  if (typeof comp.totalDurationMs !== "number") return null;
  return comp as VideoComposition;
}

function buildDefaultComposition(
  listing: PostBuilderListing,
  photos: AvailablePhotos,
): VideoComposition {
  // why: design scenes embed the canvas-editor template schema by value.
  // We resolve the just_listed_v1_story_9x16 template because Reels are
  // 9:16 and v1 is the most photo-forward variant — the best visual match
  // for a Reel cover frame. If the template can't be found (shouldn't
  // happen in practice — the registry covers all combos) we fall back to
  // null and the design scene will render the placeholder card.
  const heroTemplate = findCanvasTemplate("just_listed", "v1", "story_9x16");

  const heroPhotoFallback = listing.hero_image_url ?? null;
  const photo0 = pickPhotoCycling(photos, 0) ?? heroPhotoFallback;
  const photo1 = pickPhotoCycling(photos, 1) ?? heroPhotoFallback;
  const photo2 = pickPhotoCycling(photos, 2) ?? heroPhotoFallback;

  const scenes: Scene[] = [
    {
      id: crypto.randomUUID(),
      startMs: 0,
      durationMs: DEFAULT_SCENE_DURATION_MS,
      content: { kind: "design", template: heroTemplate },
      transitionIn: "cut",
      transitionMs: 0,
    },
    {
      id: crypto.randomUUID(),
      startMs: 0,
      durationMs: DEFAULT_SCENE_DURATION_MS,
      content: photo0
        ? { kind: "photo", photoUrl: photo0, motion: MOTION_PRESETS.zoom_in! }
        : { kind: "design", template: heroTemplate },
      transitionIn: "dissolve",
      transitionMs: DEFAULT_TRANSITION_MS_BY_TYPE.dissolve,
    },
    {
      id: crypto.randomUUID(),
      startMs: 0,
      durationMs: DEFAULT_SCENE_DURATION_MS,
      content: photo1
        ? { kind: "photo", photoUrl: photo1, motion: MOTION_PRESETS.zoom_out! }
        : { kind: "design", template: heroTemplate },
      transitionIn: "dissolve",
      transitionMs: DEFAULT_TRANSITION_MS_BY_TYPE.dissolve,
    },
    {
      id: crypto.randomUUID(),
      startMs: 0,
      durationMs: DEFAULT_SCENE_DURATION_MS,
      content: photo2
        ? { kind: "photo", photoUrl: photo2, motion: MOTION_PRESETS.pan_left! }
        : { kind: "design", template: heroTemplate },
      transitionIn: "dissolve",
      transitionMs: DEFAULT_TRANSITION_MS_BY_TYPE.dissolve,
    },
    {
      id: crypto.randomUUID(),
      startMs: 0,
      durationMs: DEFAULT_OUTRO_DURATION_MS,
      content: { kind: "design", template: heroTemplate },
      // 2026-06-06 — uniform with the body scenes so the global transition
      // control reflects the true (single) transition on load.
      transitionIn: "dissolve",
      transitionMs: DEFAULT_TRANSITION_MS_BY_TYPE.dissolve,
    },
  ];

  const timed = recomputeTimeline(scenes);

  return {
    schemaVersion: 1,
    width: 1080,
    height: 1920,
    frameRate: 30,
    totalDurationMs: timed.totalDurationMs,
    scenes: timed.scenes,
    audio: null satisfies AudioTrack | null,
    sourceListingMls: listing.mls_number,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Pretty-print total duration in seconds with 1 decimal (e.g., "6.0s").
 */
function formatTotalSeconds(totalMs: number): string {
  return `${(totalMs / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Photos fetch hook
// ---------------------------------------------------------------------------

interface PhotosFetchState {
  photos: AvailablePhotos;
  isLoading: boolean;
  error: string | null;
}

/**
 * GET /api/post-builder/photos response shape. Keeps the parsing local so we
 * don't tightly couple to whatever wider type lives in the API module.
 */
interface PhotosApiOk {
  ok: true;
  photos: ReadonlyArray<{ url: string; sequence: number; source?: string }>;
}
interface PhotosApiErr {
  ok: false;
  error: string;
}
type PhotosApiResponse = PhotosApiOk | PhotosApiErr;

function isPhotosApiResponse(value: unknown): value is PhotosApiResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.ok === true) return Array.isArray(v.photos);
  if (v.ok === false) return typeof v.error === "string";
  return false;
}

// ---------------------------------------------------------------------------
// Element-size hook — measures the center stage so ReelPreview can fill the
// available height responsively (no page scroll). Returns a ref to attach to
// the measured element + its rounded content-box width/height.
// ---------------------------------------------------------------------------

function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  // why a CALLBACK ref (not useRef + useEffect): the measured stage element
  // mounts LATER than this component (only after a listing is picked), so a
  // one-shot mount effect would observe a null ref and never re-attach,
  // leaving the preview at 0×0 forever. A callback ref fires whenever the node
  // attaches/detaches, so the observer always binds to the real element and
  // seeds an initial size synchronously.
  const ref = useCallback((node: T | null) => {
    roRef.current?.disconnect();
    if (!node) {
      roRef.current = null;
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]!.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(node);
    roRef.current = ro;
    const r = node.getBoundingClientRect();
    setSize({ w: Math.round(r.width), h: Math.round(r.height) });
  }, []);
  return [ref, size] as const;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Reel Studio workspace shell. Owns composition state, mounts TimelineStrip
 * + ScenePropertiesPanel as siblings, and provides the listing picker /
 * preview area. The actual video rendering pipeline is owned by the worker
 * (Day 6 wires the POST to it).
 */
export default function ReelStudioClient({
  listings,
  preSelectedMls,
  initialResume,
}: Props) {
  // ---- selection state -------------------------------------------------
  // why: when resuming a saved Reel, auto-select its listing on mount. The
  // listing-picker step is skipped entirely; the workspace renders directly.
  const [selectedListingMls, setSelectedListingMls] = useState<string | null>(
    initialResume?.mls_number ?? null,
  );

  // why: track whether the user is editing a resumed Reel so the Generate
  // button label flips to "Re-generate Reel" and downstream messaging is
  // honest. The state is set once on mount from `initialResume` — flipping
  // back to a fresh-start state requires a route change, not a state flip,
  // because the listing-picker step relies on `selectedListingMls === null`.
  const isResume = initialResume !== null && initialResume !== undefined;

  // ---- composition state ----------------------------------------------
  const [composition, setComposition] = useState<VideoComposition | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  // ---- Reel Template Library state ------------------------------------
  // why: tracks the template that LAST seeded the composition so the picker
  // can highlight it as Current. Local state (not persisted on the
  // composition itself) because resuming a saved row doesn't carry the
  // template id, and the user may have mutated scenes since picking — the
  // "Current" badge is informational only.
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);
  const [showTemplatesPicker, setShowTemplatesPicker] = useState<boolean>(false);
  // why: tracks whether the user has mutated scenes since the last template
  // pick / initial seed, so the picker can prompt before swapping. Set on
  // every applySceneMutation; cleared on template-pick or listing-change.
  const [hasUnsavedTemplateEdits, setHasUnsavedTemplateEdits] = useState<boolean>(false);

  // ---- photos state ----------------------------------------------------
  const [photosState, setPhotosState] = useState<PhotosFetchState>({
    photos: [],
    isLoading: false,
    error: null,
  });

  // ---- toast state -----------------------------------------------------
  const [toast, setToast] = useState<ToastState | null>(null);

  // ---- generate flow state (Day 6) ------------------------------------
  // why: a single state object instead of N booleans so the overlay can
  // render any one of these phases without an inconsistent intermediate
  // state (e.g., generating=true but no progress shown).
  const [generateState, setGenerateState] = useState<GenerateState>({
    phase: "idle",
  });

  // why: refs (not state) for the polling control — mutating them inside
  // the polling closure shouldn't trigger re-renders. The cleanup effect
  // reads them on unmount to cancel an in-flight render gracefully.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCancelledRef = useRef<boolean>(false);

  const router = useRouter();

  // ---- derived ---------------------------------------------------------

  const listingsByMls = useMemo(() => {
    const map = new Map<string, PostBuilderListing>();
    for (const l of listings) map.set(l.mls_number, l);
    return map;
  }, [listings]);

  const selectedListing = selectedListingMls
    ? (listingsByMls.get(selectedListingMls) ?? null)
    : null;

  const selectedScene = useMemo<Scene | null>(() => {
    if (!composition || !selectedSceneId) return null;
    return composition.scenes.find((s) => s.id === selectedSceneId) ?? null;
  }, [composition, selectedSceneId]);

  const totalDurationSec = composition
    ? formatTotalSeconds(composition.totalDurationMs)
    : "0.0s";

  // ---- center-stage measurement (fit-to-viewport preview) -------------
  // why: the preview must fill the available stage height without scrolling
  // the page. We measure the stage div and pass derived max dimensions to
  // ReelPreview, which keeps 9:16 within both. The -24/-96 padding reserves
  // room for the stage padding + ReelPreview's play/scrub controls.
  const [stageRef, stageSize] = useElementSize<HTMLDivElement>();
  const stageW = Math.max(160, stageSize.w - 24);
  const stageH = Math.max(240, stageSize.h - 96);

  // ---- effects: pre-selection + photos fetch --------------------------

  // why: on mount, honor the ?mls= deep link by auto-selecting that listing
  // (only if it's actually in the listings array — stale link = no-op).
  useEffect(() => {
    if (!preSelectedMls) return;
    if (!listingsByMls.has(preSelectedMls)) return;
    setSelectedListingMls(preSelectedMls);
    // why: intentionally an empty dep array — this only runs once on mount.
    // listingsByMls is stable for the lifetime of the page (server-fetched).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // why: whenever a listing is (re)selected, fetch its photos and seed a
  // fresh default composition. We seed BEFORE photos arrive (using just the
  // hero_image_url) so the workspace renders immediately; once photos land,
  // the user can manually swap individual scenes in via the side panel
  // (Day 4+ — out of Day 3 scope).
  useEffect(() => {
    if (!selectedListing) {
      setComposition(null);
      setSelectedSceneId(null);
      setPhotosState({ photos: [], isLoading: false, error: null });
      // why: a listing-change resets the template-tracking state — the
      // composition for the new listing wasn't seeded by any template.
      setCurrentTemplateId(null);
      setHasUnsavedTemplateEdits(false);
      return;
    }

    // why: when resuming a saved Reel, seed the composition from the row's
    // composition_json instead of rebuilding the default. Defensive narrow
    // because the column is typed `unknown` at the DB boundary — we accept
    // any object with a scenes array (the worker validated structurally on
    // generation, so this row was once-valid; structural drift is unlikely
    // but possible if the user manually edited the DB).
    const resumedComp = resumeCompositionFromJson(initialResume?.composition_json);
    if (resumedComp) {
      setComposition(resumedComp);
      setSelectedSceneId(resumedComp.scenes[0]?.id ?? null);
      // why: photos fetch still proceeds below so the picker / preview have
      // the listing's gallery available for ADDING new scenes mid-edit. The
      // existing scenes' photoUrls are baked into the saved composition.
    } else {
      // Seed an immediate-render composition using only the hero photo. When
      // the fetch completes we rebuild with the full photo set so the default
      // 5-scene composition gets distinct photos in scenes 2/3/4.
      const initialComp = buildDefaultComposition(
        selectedListing,
        selectedListing.hero_image_url ? [selectedListing.hero_image_url] : [],
      );
      setComposition(initialComp);
      setSelectedSceneId(initialComp.scenes[0]?.id ?? null);
    }

    let cancelled = false;
    setPhotosState({ photos: [], isLoading: true, error: null });

    (async () => {
      try {
        const res = await fetch(
          `/api/post-builder/photos?mls=${encodeURIComponent(
            selectedListing.mls_number,
          )}`,
          { method: "GET" },
        );
        const parsed: unknown = await res.json();
        if (cancelled) return;
        if (!isPhotosApiResponse(parsed)) {
          setPhotosState({
            photos: [],
            isLoading: false,
            error: "Unexpected response shape from /api/post-builder/photos",
          });
          return;
        }
        if (!parsed.ok) {
          setPhotosState({ photos: [], isLoading: false, error: parsed.error });
          return;
        }
        const urls: string[] = parsed.photos.map((p) => p.url);
        setPhotosState({ photos: urls, isLoading: false, error: null });

        // why: rebuild the composition with the full photo set so scenes
        // 2/3/4 use photos[0..2] instead of all sharing the hero. We only
        // do this when photos.length > 0 — otherwise the hero-only seed is
        // already correct.
        //
        // Skip entirely on a resume — the saved composition's scenes
        // already carry their photoUrls baked in, and blowing them away
        // with the default 5-scene template would discard the user's
        // prior edits (motion presets, durations, transitions, scene
        // count). Day 8+ may add an explicit "Reset to defaults" button
        // for the resume case.
        if (urls.length > 0 && !resumedComp) {
          const refreshed = buildDefaultComposition(selectedListing, urls);
          setComposition(refreshed);
          setSelectedSceneId(refreshed.scenes[0]?.id ?? null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Fetch failed";
        setPhotosState({ photos: [], isLoading: false, error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedListing]);

  // ---- composition mutation helpers -----------------------------------

  /**
   * Apply a transform to the composition's scenes array and re-time the
   * whole timeline + total duration in one pass. Single source of truth for
   * any scene-level mutation.
   */
  const applySceneMutation = useCallback(
    (mutate: (prev: readonly Scene[]) => readonly Scene[]) => {
      setComposition((prev) => {
        if (!prev) return prev;
        const next = mutate(prev.scenes);
        const timed = recomputeTimeline(next);
        return {
          ...prev,
          scenes: timed.scenes,
          totalDurationMs: timed.totalDurationMs,
          updatedAt: new Date().toISOString(),
        };
      });
      // why: any scene-level mutation invalidates the "this composition
      // matches its template" invariant — flip the dirty flag so the
      // template picker prompts before swapping.
      setHasUnsavedTemplateEdits(true);
    },
    [],
  );

  // ---- global pace (2026-06-05) ---------------------------------------
  // why: "speed up / slow down the slides" without editing each scene. Sets
  // every PHOTO scene to the chosen preset duration in one pass (design
  // scenes keep their timing). `pace` is the last-applied preset, used only
  // to highlight the active segment — per-scene edits afterward may diverge
  // from it, which is fine (it's a coarse control, not a lock).
  const [pace, setPace] = useState<PaceKey>("standard");
  const applyPace = useCallback(
    (next: PaceKey) => {
      setPace(next);
      applySceneMutation((prev) =>
        prev.map((s) =>
          s.content.kind === "photo"
            ? { ...s, durationMs: PACE_PHOTO_MS[next] }
            : s,
        ),
      );
    },
    [applySceneMutation],
  );
  const hasPhotoScenes =
    composition?.scenes.some((s) => s.content.kind === "photo") ?? false;

  // ---- global transition (2026-06-06) ---------------------------------
  // why: the team never varies transition style/speed per slide within a
  // post — one choice applies to the whole Reel. We DERIVE the current value
  // from the first body scene (every scene after the opener carries the same
  // transition) so there's a single source of truth, and write changes to ALL
  // scenes except the opener (scene 0 has no incoming transition — nothing
  // precedes it). This replaces the old per-scene controls, which were a dead
  // end on the first scene and let scenes drift out of sync.
  const globalTransitionType: TransitionType =
    composition?.scenes[1]?.transitionIn ?? "dissolve";
  const globalTransitionMs: number =
    composition?.scenes[1]?.transitionMs ??
    DEFAULT_TRANSITION_MS_BY_TYPE.dissolve;
  const hasMultipleScenes = (composition?.scenes.length ?? 0) > 1;

  // Bumped on every global-transition change to trigger the preview auto-demo.
  const [transitionDemoNonce, setTransitionDemoNonce] = useState(0);

  const applyGlobalTransition = useCallback(
    (type: TransitionType, ms: number) => {
      const effectiveMs = type === "cut" ? 0 : ms;
      applySceneMutation((prev) =>
        prev.map((s, i) =>
          i === 0
            ? s
            : { ...s, transitionIn: type, transitionMs: effectiveMs },
        ),
      );
      // Fire the auto-demo so the change is instantly visible (#5).
      setTransitionDemoNonce((n) => n + 1);
    },
    [applySceneMutation],
  );

  // 2026-06-05 — append a closing CTA end-card scene. 2026-06-06 — the new
  // scene adopts the Reel's current global transition so transitions stay
  // uniform across every slide.
  const handleAddEndCard = useCallback(() => {
    const endCard = buildEndCardScene();
    const tuned: Scene = {
      ...endCard,
      transitionIn: globalTransitionType,
      transitionMs: globalTransitionType === "cut" ? 0 : globalTransitionMs,
    };
    applySceneMutation((prev) => [...prev, tuned]);
    setSelectedSceneId(tuned.id);
  }, [applySceneMutation, globalTransitionType, globalTransitionMs]);

  // 2026-06-05 — beat-sync wiring. BPM auto-fills from the chosen music track
  // once the library lands (composition.audio); until then it's a manual
  // field. "Snap" aligns every scene cut to the beat grid.
  const [bpm, setBpm] = useState(100);
  const handleSnapToBeat = useCallback(() => {
    applySceneMutation((prev) => snapScenesToBeat(prev, bpm));
  }, [applySceneMutation, bpm]);

  // ---- AI-adapt my card (E, 2026-06-05) -------------------------------
  // why: the Reel hero defaults to a pre-built 9:16 template. When the Reel
  // was seeded from a carousel post we also stashed that post's SQUARE card
  // design (initialResume.source_square_card). This button reflows it to a
  // native 9:16 layout via Claude and swaps it onto the first design (hero)
  // scene. Opt-in — the default hero stands until the user asks.
  const squareCard = initialResume?.source_square_card ?? null;
  const canAdaptCard =
    squareCard != null &&
    typeof squareCard === "object" &&
    Array.isArray((squareCard as { layers?: unknown }).layers);
  const [adaptingCard, setAdaptingCard] = useState(false);
  const handleAdaptCard = useCallback(async () => {
    if (!canAdaptCard) return;
    setAdaptingCard(true);
    try {
      const res = await adaptHeroCardToReelAction(
        squareCard as CanvasTemplateSchema,
      );
      if (!res.ok) {
        setToast({ kind: "error", message: `Couldn't adapt your card: ${res.error}` });
        return;
      }
      // Swap the reflowed schema onto the FIRST design (hero) scene.
      setComposition((prev) => {
        if (!prev) return prev;
        let swapped = false;
        const scenes = prev.scenes.map((s) => {
          if (!swapped && s.content.kind === "design") {
            swapped = true;
            return {
              ...s,
              content: { kind: "design" as const, template: res.schema },
            };
          }
          return s;
        });
        return { ...prev, scenes, updatedAt: new Date().toISOString() };
      });
      setHasUnsavedTemplateEdits(true);
      setToast({ kind: "info", message: "Adapted your card to the Reel's vertical hero." });
    } catch (e) {
      setToast({
        kind: "error",
        message: `Adapt card threw: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setAdaptingCard(false);
    }
  }, [canAdaptCard, squareCard]);

  // ---- template-pick handler -------------------------------------------
  // why: applying a template replaces the entire scenes array with the
  // factory's output. The dirty flag clears because the new composition
  // IS the template's emission — no edits yet.
  const handleTemplatePicked = useCallback(
    (template: ReelTemplate) => {
      if (!selectedListing) return;
      const newComp = template.build(
        selectedListing,
        photosState.photos,
      );
      setComposition(newComp);
      setSelectedSceneId(newComp.scenes[0]?.id ?? null);
      setCurrentTemplateId(template.id);
      setHasUnsavedTemplateEdits(false);
      setShowTemplatesPicker(false);
    },
    [selectedListing, photosState.photos],
  );

  // ---- handlers wired into siblings -----------------------------------

  const handleSelectScene = useCallback((sceneId: string) => {
    setSelectedSceneId(sceneId);
  }, []);

  const handleReorderScenes = useCallback(
    (newOrder: readonly string[]) => {
      applySceneMutation((prev) => {
        const byId = new Map(prev.map((s) => [s.id, s] as const));
        const reordered: Scene[] = [];
        for (const id of newOrder) {
          const s = byId.get(id);
          if (s) reordered.push(s);
        }
        // why: if newOrder is missing an id (defensive against a buggy
        // sibling), append any unseen scenes at the end so we never lose
        // data silently. The else-branch is purely a safety net.
        if (reordered.length !== prev.length) {
          for (const s of prev) {
            if (!newOrder.includes(s.id)) reordered.push(s);
          }
        }
        return reordered;
      });
    },
    [applySceneMutation],
  );

  const handleAddScene = useCallback(() => {
    if (!composition) return;
    if (composition.scenes.length >= REEL_CAPS.maxScenes) {
      setToast({
        kind: "warn",
        message: `Reels are capped at ${REEL_CAPS.maxScenes} scenes — remove one to add another.`,
      });
      return;
    }
    // Cycle the next available photo by the current scene count.
    const photoUrl =
      pickPhotoCycling(photosState.photos, composition.scenes.length) ??
      selectedListing?.hero_image_url ??
      null;
    const newScene: Scene = {
      id: crypto.randomUUID(),
      startMs: 0,
      durationMs: DEFAULT_SCENE_DURATION_MS,
      content: photoUrl
        ? { kind: "photo", photoUrl, motion: MOTION_PRESETS.zoom_in! }
        : // why: fall back to a design scene with the same template if the
          // listing has no photos at all. Better than refusing to add.
          {
            kind: "design",
            template: findCanvasTemplate("just_listed", "v1", "story_9x16"),
          },
      transitionIn: globalTransitionType,
      transitionMs: globalTransitionType === "cut" ? 0 : globalTransitionMs,
    };
    applySceneMutation((prev) => [...prev, newScene]);
    setSelectedSceneId(newScene.id);
  }, [
    composition,
    photosState.photos,
    selectedListing,
    applySceneMutation,
    globalTransitionType,
    globalTransitionMs,
  ]);

  const handleRemoveScene = useCallback(
    (sceneId: string) => {
      if (!composition) return;
      if (composition.scenes.length <= 1) {
        // why: matches allowEmpty:false default on the TimelineStrip contract.
        setToast({
          kind: "warn",
          message: "A Reel needs at least 1 scene — add another before removing this one.",
        });
        return;
      }
      applySceneMutation((prev) => prev.filter((s) => s.id !== sceneId));
      if (selectedSceneId === sceneId) setSelectedSceneId(null);
    },
    [composition, selectedSceneId, applySceneMutation],
  );

  // 2026-06-06 — tapping the timeline's between-scene glyph cycles the GLOBAL
  // transition (style only; speed keeps its current value), keeping every
  // slide uniform. The sceneId arg is ignored — transitions aren't per-scene.
  const handleCycleTransition = useCallback(
    (_sceneId: string) => {
      const currentIdx = TRANSITION_CYCLE.indexOf(globalTransitionType);
      const nextIdx = (currentIdx + 1) % TRANSITION_CYCLE.length;
      const nextType = TRANSITION_CYCLE[nextIdx]!;
      const nextMs =
        nextType === "cut"
          ? 0
          : globalTransitionMs || DEFAULT_TRANSITION_MS_BY_TYPE[nextType];
      applyGlobalTransition(nextType, nextMs);
    },
    [applyGlobalTransition, globalTransitionType, globalTransitionMs],
  );

  const handleSceneChanged = useCallback<
    ScenePropertiesPanelProps["onSceneChanged"]
  >(
    (sceneId, patch) => {
      applySceneMutation((prev) =>
        prev.map((s) => {
          if (s.id !== sceneId) return s;
          // why: motionPreset is a derived patch field — translate it to a
          // full MotionPath on the photo scene's content. Silently ignored
          // for design scenes (motion is meaningless there in MVP).
          let nextContent = s.content;
          if (patch.motionPreset && s.content.kind === "photo") {
            const preset = MOTION_PRESETS[patch.motionPreset];
            if (preset) {
              nextContent = { ...s.content, motion: preset };
            }
          }
          return {
            ...s,
            durationMs: patch.durationMs ?? s.durationMs,
            transitionIn: patch.transitionIn ?? s.transitionIn,
            transitionMs: patch.transitionMs ?? s.transitionMs,
            // 2026-06-05 — textOverlays replace wholesale when present.
            textOverlays: patch.textOverlays ?? s.textOverlays,
            content: nextContent,
          };
        }),
      );
    },
    [applySceneMutation],
  );

  // ---- audio handler (Day 5) ------------------------------------------

  /**
   * Replace the composition's audio track (or clear it when next === null).
   * why we always bump updatedAt: any change to the composition — including
   * audio — should mark the document dirty so the autosave / "Generate" flow
   * persists the latest version.
   */
  const handleAudioTrackChanged = useCallback(
    (next: AudioTrack | null) => {
      setComposition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          audio: next,
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [],
  );

  // ---- generate handler (Day 6 — wired to worker) ---------------------

  /**
   * Cancel any in-flight polling timer. Called on:
   *   • Component unmount (cleanup effect below)
   *   • Render failure (so we don't keep polling a known-bad job)
   *   • Render success (terminal state reached)
   * The pollCancelledRef flag is also flipped so any already-scheduled
   * callback that fires after cancellation bails before re-scheduling.
   */
  const cancelPolling = useCallback(() => {
    pollCancelledRef.current = true;
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // why: stop polling on unmount. Without this, a user navigating away
  // mid-render would leak a setTimeout chain that continues calling the
  // status server action long after the component is gone.
  useEffect(() => {
    return () => cancelPolling();
  }, [cancelPolling]);

  const handleGenerateReel = useCallback(async () => {
    if (!composition) return;
    if (generateState.phase !== "idle" && generateState.phase !== "error") {
      // why: defensive — the button is disabled during these phases, but
      // a fast double-click or keyboard activation can sneak through.
      return;
    }
    // Reset any stale cancel flag from a previous run.
    pollCancelledRef.current = false;

    // ---- Step 1: validate the composition has a source listing -------
    if (!composition.sourceListingMls) {
      setGenerateState({
        phase: "error",
        message:
          "This Reel isn't linked to a listing — pick a listing first, then try again.",
      });
      return;
    }
    if (!selectedListing) {
      setGenerateState({
        phase: "error",
        message:
          "Selected listing data is missing — refresh the page and pick the listing again.",
      });
      return;
    }
    if (!selectedListing.hero_image_url) {
      setGenerateState({
        phase: "error",
        message:
          "This listing has no hero photo to use as the Reel cover — add a photo to the listing first.",
      });
      return;
    }

    // ---- Step 2: submit to the worker --------------------------------
    // Auto-audio: when the user hasn't picked a track in the MusicPicker,
    // the reel builder selects a fitting Audio Library track by post type +
    // platform and embeds it. autoAttachAudio is a no-op when composition.audio
    // is already set, so a manual pick always wins.
    setGenerateState({ phase: "submitting" });
    const submit = await triggerReelRenderAction(composition, {
      postType: AUDIO_POST_TYPE_BY_LISTING_STATUS[selectedListing.status],
      platforms: REEL_AUDIO_PLATFORMS,
    });
    if (!submit.ok) {
      setGenerateState({ phase: "error", message: submit.error });
      return;
    }

    // ---- Step 3: poll until terminal ---------------------------------
    setGenerateState({
      phase: "polling",
      jobId: submit.job_id,
      status: "queued",
      progressPct: 0,
      messageIndex: 0,
    });

    const pollStart = Date.now();

    // why: recursive setTimeout (not setInterval) so each poll waits for
    // the previous one to complete before scheduling the next — avoids
    // a backlog of in-flight requests if the worker slows down.
    const pollOnce = async (): Promise<void> => {
      if (pollCancelledRef.current) return;

      // Hard timeout — stop polling and surface a clear message.
      if (Date.now() - pollStart > REEL_POLL_MAX_DURATION_MS) {
        cancelPolling();
        setGenerateState({
          phase: "error",
          message:
            "Render timed out — the worker may be slow. Refresh and try again.",
        });
        return;
      }

      const statusRes = await getReelRenderStatusAction(submit.job_id);
      if (pollCancelledRef.current) return;

      if (!statusRes.ok) {
        cancelPolling();
        setGenerateState({ phase: "error", message: statusRes.error });
        return;
      }

      const job = statusRes.job;

      if (job.status === "failed") {
        cancelPolling();
        setGenerateState({
          phase: "error",
          message:
            job.error ?? "Worker reported the render failed without a message.",
        });
        return;
      }

      if (job.status === "succeeded") {
        cancelPolling();
        // ---- Step 4: persist the generated_posts row ----------------
        if (
          !job.video_url ||
          !job.video_path ||
          typeof job.duration_ms !== "number"
        ) {
          // why: the worker contract says these are populated on succeeded.
          // If they're missing, the job state is malformed — surface the
          // exact gap rather than crashing on the insert below.
          setGenerateState({
            phase: "error",
            message:
              "Worker reported success but didn't return a video URL — try regenerating.",
          });
          return;
        }
        setGenerateState({ phase: "persisting" });
        // why: prefer the worker's first-frame cover when available so the
        // IG Reels grid thumbnail matches the designed hero card. Fall back
        // to the listing's hero photo only when the worker degraded
        // (older worker version, cover upload failed, missing first frame)
        // so we never persist a Reel without a cover.
        const coverImageUrl =
          job.cover_url ?? selectedListing.hero_image_url!;
        const persist = await persistRenderedReelAction({
          composition,
          video_url: job.video_url,
          video_path: job.video_path,
          duration_ms: job.duration_ms,
          cover_image_url: coverImageUrl,
        });
        if (!persist.ok) {
          setGenerateState({
            phase: "error",
            message: `Saved the render but couldn't write the post row: ${persist.error}`,
          });
          return;
        }

        // ---- Step 5: navigate to Post Builder with the new gp -------
        // why: gp= deep-link is the canonical resume-edit entry point
        // for any generated_posts row — matches the multi-OH wizard's
        // post-render redirect.
        router.push(
          `/post-builder?gp=${encodeURIComponent(persist.generated_post_id)}`,
        );
        return;
      }

      // Still queued or processing — update overlay state + schedule next poll.
      // why: explicit narrow to the two non-terminal statuses keeps the
      // GenerateState union honest (the polling variant excludes
      // succeeded/failed, which were already returned above).
      const nonTerminalStatus: "queued" | "processing" =
        job.status === "queued" ? "queued" : "processing";
      setGenerateState((prev) => {
        // why: only mutate when we're still in the polling phase. If the
        // user dismissed or another flow changed phase mid-poll, the
        // updater is a no-op (keeps state coherent).
        if (prev.phase !== "polling") return prev;
        return {
          phase: "polling",
          jobId: submit.job_id,
          status: nonTerminalStatus,
          progressPct: job.progress_pct,
          // why: rotate the message every REEL_STATUS_ROTATION_MS based
          // on wall-clock since pollStart, not on poll count — keeps the
          // cadence steady regardless of poll interval drift.
          messageIndex:
            Math.floor(
              (Date.now() - pollStart) / REEL_STATUS_ROTATION_MS,
            ) % REEL_STATUS_MESSAGES.length,
        };
      });

      pollTimerRef.current = setTimeout(() => {
        void pollOnce();
      }, REEL_POLL_INTERVAL_MS);
    };

    // Kick off the first poll on the next tick so React commits the
    // initial polling state before the network call lands.
    pollTimerRef.current = setTimeout(() => {
      void pollOnce();
    }, REEL_POLL_INTERVAL_MS);
  }, [
    composition,
    generateState.phase,
    selectedListing,
    cancelPolling,
    router,
  ]);

  /**
   * Reset the generate flow to idle. Used by the error overlay's Dismiss
   * button so the user can fix the issue and try again without a reload.
   */
  const handleDismissGenerateError = useCallback(() => {
    cancelPolling();
    setGenerateState({ phase: "idle" });
  }, [cancelPolling]);

  // ---- empty-state: no listings ---------------------------------------

  if (listings.length === 0) {
    return (
      <div data-theme="dark" className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-bg)] p-8 text-center">
        <h2 className="text-lg font-semibold text-[var(--studio-text)]">
          No active listings available
        </h2>
        <p className="mt-2 text-[var(--studio-text-muted)]">
          Reels need an active listing to compose from. Add one to your inventory
          first.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center rounded-md bg-gold-600 px-4 py-2 text-sm font-medium text-white hover:bg-gold-700"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  // ---- main render -----------------------------------------------------

  const renderInFlight =
    generateState.phase === "submitting" ||
    generateState.phase === "polling" ||
    generateState.phase === "persisting";

  return (
    <div
      data-theme="dark"
      className="flex h-[calc(100dvh-13rem)] min-h-[600px] flex-col gap-2 rounded-xl bg-[var(--studio-bg)] p-3"
    >
      {/* ---- Reel Template Library picker overlay --------------------- */}
      {showTemplatesPicker ? (
        <ReelTemplatesPanel
          currentTemplateId={currentTemplateId}
          hasUnsavedEdits={hasUnsavedTemplateEdits}
          onTemplatePicked={handleTemplatePicked}
          onClose={() => setShowTemplatesPicker(false)}
        />
      ) : null}

      {/* ---- Render overlay (Day 6) ----------------------------------- */}
      {generateState.phase !== "idle" ? (
        <RenderOverlay
          state={generateState}
          onDismissError={handleDismissGenerateError}
        />
      ) : null}

      {/* ---- Toast ------------------------------------------------------- */}
      {toast ? (
        <ToastBar toast={toast} onDismiss={() => setToast(null)} />
      ) : null}

      {/* ---- Listing picker (no selection yet) --------------------------- */}
      {!selectedListing ? (
        <ListingPicker
          listings={listings}
          onPick={(mls) => setSelectedListingMls(mls)}
        />
      ) : (
        <>
          {/* ---- (a) Slim top bar ----------------------------------- */}
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-panel)] px-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="h-5 w-1 shrink-0 rounded-full bg-gold-600"
              />
              <span className="shrink-0 text-sm font-medium text-[var(--studio-text)]">
                Reel Studio
              </span>
              <span className="truncate rounded-md bg-[var(--studio-hover)] px-2 py-0.5 text-xs text-[var(--studio-text-muted)]">
                {selectedListing.address ?? selectedListing.mls_number}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedListingMls(null);
                  setComposition(null);
                  setSelectedSceneId(null);
                }}
                className="shrink-0 text-xs font-medium text-gold-700 underline-offset-2 hover:underline"
              >
                Change listing
              </button>
            </div>
            {composition ? (
              <div className="flex shrink-0 items-center gap-2">
                {/* AI-adapt my card — reflow the source post's square card
                    into a native 9:16 hero. Shown only when the Reel was
                    seeded from a carousel post that carried its design. */}
                {canAdaptCard ? (
                  <button
                    type="button"
                    onClick={() => {
                      void handleAdaptCard();
                    }}
                    disabled={adaptingCard || !composition}
                    aria-label="Adapt my square card design into the Reel's vertical hero with AI"
                    title="Reflow your exact post card into the 9:16 Reel hero (AI)"
                    className="inline-flex items-center gap-1.5 rounded-md border border-gold-300 bg-[var(--studio-panel)] px-2.5 py-1.5 text-xs font-medium text-gold-700 shadow-sm transition hover:border-gold-500 hover:bg-gold-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                      className="h-4 w-4"
                    >
                      <path d="M11.999 2.25l1.9 5.151 5.151 1.9-5.151 1.9-1.9 5.151-1.9-5.151-5.151-1.9 5.151-1.9 1.9-5.151zM18.75 14.25l.95 2.575 2.575.95-2.575.95-.95 2.575-.95-2.575-2.575-.95 2.575-.95.95-2.575z" />
                    </svg>
                    {adaptingCard ? "Adapting…" : "AI-adapt my card"}
                  </button>
                ) : null}
                {/* Templates button — opens the Reel Template Library picker. */}
                <button
                  type="button"
                  onClick={() => setShowTemplatesPicker(true)}
                  disabled={!selectedListing || renderInFlight}
                  aria-label="Open the Reel template picker"
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--studio-border)] bg-[var(--studio-panel)] px-2.5 py-1.5 text-xs font-medium text-[var(--studio-text)] shadow-sm transition hover:border-gold-400 hover:text-gold-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.75}
                    stroke="currentColor"
                    aria-hidden="true"
                    className="h-4 w-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 6.75A2.25 2.25 0 016 4.5h12a2.25 2.25 0 012.25 2.25v10.5A2.25 2.25 0 0118 19.5H6a2.25 2.25 0 01-2.25-2.25V6.75zM3.75 9h16.5M9 4.5v15"
                    />
                  </svg>
                  Templates
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleGenerateReel();
                  }}
                  disabled={!composition || renderInFlight}
                  aria-label={
                    isResume
                      ? "Re-generate Reel from current composition (saves as a new sibling row)"
                      : "Generate Reel from current composition"
                  }
                  className="inline-flex items-center rounded-md bg-gold-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-gold-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {renderInFlight
                    ? isResume
                      ? "Re-generating..."
                      : "Generating..."
                    : isResume
                      ? "Re-generate Reel"
                      : "Generate Reel"}
                </button>
              </div>
            ) : null}
          </header>

          {/* ---- (b) Body row: left rail · center stage · right rail -- */}
          <div className="flex min-h-0 flex-1 gap-2">
            {/* LEFT RAIL — whole-reel controls */}
            <div className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-[var(--studio-border)] bg-[var(--studio-panel)] p-3">
              {/* Transition (only with 2+ scenes) */}
              {hasMultipleScenes ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                    Transition
                  </h3>
                  <select
                    value={globalTransitionType}
                    onChange={(e) => {
                      const nextType = e.currentTarget.value as TransitionType;
                      applyGlobalTransition(
                        nextType,
                        globalTransitionMs ||
                          DEFAULT_TRANSITION_MS_BY_TYPE[nextType],
                      );
                    }}
                    aria-label="Transition style (applies to every slide)"
                    title="Transition style — applied to every slide in the Reel"
                    className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-2 py-1.5 text-xs font-medium text-[var(--studio-text)]"
                  >
                    {TRANSITION_STYLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={globalTransitionMs}
                    disabled={globalTransitionType === "cut"}
                    onChange={(e) =>
                      applyGlobalTransition(
                        globalTransitionType,
                        Number(e.currentTarget.value),
                      )
                    }
                    aria-label="Transition speed (applies to every slide)"
                    title="Transition speed — applied to every slide in the Reel"
                    className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-2 py-1.5 text-xs font-medium text-[var(--studio-text)] disabled:opacity-40"
                  >
                    {TRANSITION_SPEED_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[var(--studio-text-faint)]">
                    Applies to every slide.
                  </p>
                </div>
              ) : null}

              {/* Slide pace (only with photo scenes) */}
              {hasPhotoScenes ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                    Slide pace
                  </h3>
                  <div
                    role="group"
                    aria-label="Reel pace"
                    className="inline-flex w-full overflow-hidden rounded-md border border-[var(--studio-border)]"
                  >
                    {PACE_ORDER.map((p) => {
                      const active = pace === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => applyPace(p)}
                          aria-pressed={active}
                          title={`Set every photo slide to ${PACE_LABEL[p].toLowerCase()} pace`}
                          className={[
                            "flex-1 px-2.5 py-1.5 text-xs font-medium transition",
                            active
                              ? "bg-gold-600 text-white"
                              : "bg-[var(--studio-panel)] text-[var(--studio-text-muted)] hover:bg-[var(--studio-hover)]",
                          ].join(" ")}
                        >
                          {PACE_LABEL[p]}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[11px] tabular-nums text-[var(--studio-text-faint)]">
                    {totalDurationSec}
                  </span>
                </div>
              ) : null}

              {/* Beat (only with photo scenes) */}
              {hasPhotoScenes ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                    Beat
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={40}
                      max={220}
                      value={bpm}
                      onChange={(e) => setBpm(Number(e.currentTarget.value) || 0)}
                      aria-label="Beats per minute"
                      className="w-16 rounded border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-1.5 py-1.5 text-xs text-[var(--studio-text)]"
                    />
                    <button
                      type="button"
                      onClick={handleSnapToBeat}
                      disabled={!composition || bpm <= 0}
                      title="Snap every scene cut to the beat grid"
                      className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--studio-text)] transition hover:border-gold-400 hover:text-gold-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Snap
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Music — composition-level background track. MusicPicker
                  renders its own "Music" header, so no section label here. */}
              {composition ? (
                <MusicPicker
                  currentTrack={composition.audio}
                  onTrackChanged={handleAudioTrackChanged}
                />
              ) : null}
            </div>

            {/* CENTER STAGE — large preview */}
            <div
              ref={stageRef}
              className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg border border-[var(--studio-border)] bg-[#202021] p-4"
            >
              {composition && stageSize.h > 0 ? (
                <>
                  <ReelPreview
                    composition={composition}
                    availablePhotos={photosState.photos}
                    scrubToSceneId={selectedSceneId}
                    demoNonce={transitionDemoNonce}
                    maxWidth={stageW}
                    maxHeight={stageH}
                  />
                  <p className="mt-3 text-xs text-[var(--studio-text-muted)]">
                    Scene{" "}
                    {selectedScene
                      ? composition.scenes.findIndex(
                          (s) => s.id === selectedScene.id,
                        ) + 1
                      : 1}{" "}
                    of {composition.scenes.length}
                  </p>
                </>
              ) : null}
            </div>

            {/* RIGHT RAIL — selected-slide inspector */}
            <aside className="w-72 shrink-0 overflow-y-auto rounded-lg border border-[var(--studio-border)] bg-[var(--studio-panel)]">
              <ScenePropertiesPanel
                scene={selectedScene}
                onSceneChanged={handleSceneChanged}
              />
              {selectedScene === null ? (
                <div className="p-4 text-sm text-[var(--studio-text-faint)]">
                  Select a scene from the timeline below to edit its motion,
                  duration, and transition.
                </div>
              ) : null}
            </aside>
          </div>

          {/* ---- (c) Bottom timeline -------------------------------- */}
          <div className="flex h-[132px] shrink-0 flex-col rounded-lg border border-[var(--studio-border)] bg-[var(--studio-panel)]">
            <div className="flex items-center justify-between px-3 pt-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--studio-text-muted)]">
                Timeline
              </h3>
              <button
                type="button"
                onClick={handleAddEndCard}
                disabled={!composition || renderInFlight}
                aria-label="Add a closing CTA end-card scene"
                title="Add a closing call-to-action end-card"
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--studio-border)] bg-[var(--studio-input-bg)] px-2.5 py-1 text-xs font-medium text-[var(--studio-text)] transition hover:border-gold-400 hover:text-gold-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                + End card
              </button>
            </div>
            {composition ? (
              <div className="min-h-0 flex-1">
                <TimelineStrip
                  scenes={composition.scenes}
                  selectedSceneId={selectedSceneId}
                  onSelectScene={handleSelectScene}
                  onReorderScenes={handleReorderScenes}
                  onAddScene={handleAddScene}
                  onRemoveScene={handleRemoveScene}
                  onCycleTransition={handleCycleTransition}
                  allowEmpty={false}
                  maxScenes={REEL_CAPS.maxScenes}
                />
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Subcomponents
// ===========================================================================

interface ToastBarProps {
  toast: ToastState;
  onDismiss: () => void;
}

function ToastBar({ toast, onDismiss }: ToastBarProps) {
  const palette =
    toast.kind === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : toast.kind === "error"
        ? "border-red-200 bg-red-50 text-red-900"
        : "border-[var(--studio-border)] bg-[var(--studio-hover)] text-[var(--studio-text)]";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${palette}`}
    >
      <span>{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="ml-3 text-xs uppercase tracking-wider opacity-70 hover:opacity-100"
      >
        Dismiss
      </button>
    </div>
  );
}

interface RenderOverlayProps {
  state: Exclude<GenerateState, { phase: "idle" }>;
  onDismissError: () => void;
}

/**
 * Full-screen overlay shown while a Reel render is in flight. Three visual
 * modes:
 *   • submitting / polling / persisting — spinner + rotating status copy +
 *     progress bar (only shown when processing has a real progress_pct).
 *   • error — red panel with the worker / persist message + a Dismiss
 *     button that returns control to the user without a reload.
 *
 * why a fixed overlay (not an inline panel): once Generate is clicked, the
 * user shouldn't be able to mutate the composition mid-render — that would
 * desync from what the worker is actually rendering. Blocking the viewport
 * makes the contract obvious.
 */
function RenderOverlay({ state, onDismissError }: RenderOverlayProps) {
  if (state.phase === "error") {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reel-render-error-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 backdrop-blur-sm"
      >
        <div className="mx-4 max-w-md rounded-xl border border-red-200 bg-[var(--studio-panel)] p-6 shadow-xl">
          <h3
            id="reel-render-error-title"
            className="text-base font-semibold text-red-900"
          >
            Reel render failed
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-red-800">
            {state.message}
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onDismissError}
              className="inline-flex items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active-render UI (submitting / polling / persisting)
  const headline =
    state.phase === "submitting"
      ? "Submitting your Reel..."
      : state.phase === "persisting"
        ? "Saving your Reel..."
        : "Rendering your Reel...";

  const rotatingMessage =
    state.phase === "polling"
      ? (REEL_STATUS_MESSAGES[state.messageIndex] ?? REEL_STATUS_MESSAGES[0]!)
      : state.phase === "submitting"
        ? "Reaching the render worker..."
        : "Almost there...";

  // why: only show the progress bar once the worker is actively rendering
  // and reporting a non-zero percent. Queued jobs and the submit/persist
  // phases all show an indeterminate spinner instead — a 0% bar reads as
  // "stuck", which it isn't.
  const showProgressBar =
    state.phase === "polling" &&
    state.status === "processing" &&
    state.progressPct > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/70 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-[var(--studio-border)] bg-[var(--studio-panel)] p-8 text-center shadow-xl">
        {/* Spinner — Tailwind animate-spin on a bordered ring. Visible
            even when the progress bar is hidden so the user always sees
            motion. */}
        <div
          aria-hidden="true"
          className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[var(--studio-border)] border-t-gold-600"
        />
        <h3 className="mt-5 text-base font-semibold text-[var(--studio-text)]">
          {headline}
        </h3>
        <p className="mt-2 text-sm text-[var(--studio-text-muted)]">{rotatingMessage}</p>
        {showProgressBar ? (
          <div className="mt-5">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--studio-hover)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                state.phase === "polling" ? Math.round(state.progressPct) : 0
              }
            >
              <div
                className="h-full bg-gold-600 transition-[width] duration-500 ease-out"
                style={{
                  width: `${
                    state.phase === "polling"
                      ? Math.max(0, Math.min(100, state.progressPct))
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--studio-text-faint)]">
              {state.phase === "polling" ? Math.round(state.progressPct) : 0}%
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ListingPickerProps {
  listings: readonly PostBuilderListing[];
  onPick: (mls: string) => void;
}

function ListingPicker({ listings, onPick }: ListingPickerProps) {
  return (
    <section data-theme="dark" className="rounded-xl border border-[var(--studio-border)] bg-[var(--studio-bg)] p-6">
      <h3 className="text-lg font-semibold text-[var(--studio-text)]">Pick a listing</h3>
      <p className="mt-1 text-sm text-[var(--studio-text-muted)]">
        Choose the property this Reel will feature. The hero card + photos
        seed a 5-scene starting composition you can tune.
      </p>
      <ul
        role="list"
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {listings.map((l) => (
          <li key={l.mls_number}>
            <button
              type="button"
              onClick={() => onPick(l.mls_number)}
              className="flex w-full items-center gap-3 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-panel)] p-3 text-left transition hover:border-gold-500 hover:bg-gold-50/50 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            >
              {l.hero_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.hero_image_url}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-md bg-neutral-100 object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="h-16 w-16 shrink-0 rounded-md bg-[var(--studio-hover)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--studio-text)]">
                  {l.address ?? l.mls_number}
                </div>
                <div className="truncate text-xs text-[var(--studio-text-muted)]">
                  {[l.city, l.state].filter(Boolean).join(", ")}
                  {l.zip ? ` ${l.zip}` : ""}
                </div>
                {typeof l.list_price === "number" ? (
                  <div className="mt-1 text-xs font-medium text-gold-700">
                    ${l.list_price.toLocaleString()}
                  </div>
                ) : null}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Day-3 static preview helpers (ScenePreviewFrame + DesignScenePlaceholder)
// were removed when ReelPreview took over on Day 4 — the real-time canvas
// renders both photo and design scenes inline, so a separate static frame is
// redundant.
