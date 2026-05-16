"use client";

/**
 * MusicPicker — Phase 6 (Reel Studio), Day 5
 * ------------------------------------------
 *
 * Right-side sidebar card BELOW ScenePropertiesPanel. Lets Larissa pick a
 * background music track for the Reel from the curated library and tune its
 * volume + fade-in/fade-out durations.
 *
 * Two states:
 *   • Collapsed — shows the current track (or an "Add music" CTA) + the
 *     volume slider when a track is selected. One-click expand.
 *   • Expanded — category filter chips + scrollable list of tracks with
 *     per-row preview-play, "Selected" badge, "Coming soon" gating for
 *     not-yet-uploaded files, and a "Remove music" link.
 *
 * Architecture choices (the why):
 *   • The component is "dumb" — it never owns the AudioTrack itself.
 *     The parent (ReelStudioClient) owns composition.audio; every change
 *     fires onTrackChanged(...) with the next value. Mirrors how the
 *     ScenePropertiesPanel feeds back to the parent reducer.
 *   • Preview playback uses a SEPARATE HTMLAudioElement from the
 *     ReelPreview's playback audio — the picker's preview is "audition a
 *     track in isolation", which must never collide with the in-studio
 *     preview. Only one preview can play at a time inside the picker (we
 *     pause the prior element when starting a new one).
 *   • Track availability is checked via parallel HEAD requests on mount.
 *     Files may not be uploaded yet (the manifest is seeded ahead of
 *     uploads — see reel-music-library.ts). Unavailable tracks become
 *     dimmed rows with a "Coming soon" pill instead of a play button, but
 *     remain SELECTABLE — the worker handles missing files with a clear
 *     error rather than silently failing.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  REEL_MUSIC_CATEGORY_HINTS,
  REEL_MUSIC_CATEGORY_LABELS,
  REEL_MUSIC_LIBRARY,
  buildAudioTrackFromLibrary,
  findReelMusicTrack,
  getReelMusicUrl,
  type ReelMusicCategory,
  type ReelMusicTrack,
} from "../../reel-music-library";
import type { AudioTrack } from "../../types";

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface MusicPickerProps {
  /** Currently-selected track on the composition. Null = no music. */
  currentTrack: AudioTrack | null;
  /** Called when the user picks a new track or clears the current one. */
  onTrackChanged: (track: AudioTrack | null) => void;
}

// ---------------------------------------------------------------------------
// Local types + constants
// ---------------------------------------------------------------------------

/** Category filter values surfaced as chips. "all" is a synthetic catch-all. */
type CategoryFilter = "all" | ReelMusicCategory;

/**
 * Display order for category chips. "all" leads so the default expanded
 * state shows every track; the four real categories follow library order.
 */
const CATEGORY_FILTER_ORDER = [
  "all",
  "uplifting",
  "cinematic",
  "chill",
  "energetic",
] as const satisfies ReadonlyArray<CategoryFilter>;

/** Human label per category chip. "all" gets a clean override. */
const CATEGORY_FILTER_LABEL: Readonly<Record<CategoryFilter, string>> = {
  all: "All",
  uplifting: REEL_MUSIC_CATEGORY_LABELS.uplifting,
  cinematic: REEL_MUSIC_CATEGORY_LABELS.cinematic,
  chill: REEL_MUSIC_CATEGORY_LABELS.chill,
  energetic: REEL_MUSIC_CATEGORY_LABELS.energetic,
};

/**
 * License → display string. Mirrors the manifest's source.license values.
 * Capitalized for the row tag.
 */
const LICENSE_LABEL: Readonly<Record<ReelMusicTrack["source"]["license"], string>> = {
  pixabay: "Pixabay",
  mixkit: "Mixkit",
  custom: "Custom",
};

/** Default volume the picker exposes when a fresh track is selected (0..1). */
const DEFAULT_VOLUME = 0.6;
/** Default fade durations (ms). Match buildAudioTrackFromLibrary defaults. */
const DEFAULT_FADE_IN_MS = 300;
const DEFAULT_FADE_OUT_MS = 500;
/** Max preview-sample duration (ms). 5s mirrors the Reel's typical length. */
const PREVIEW_SAMPLE_MAX_MS = 5_000;
/** Range cap for the fade sliders (ms). */
const FADE_MAX_MS = 1_500;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Format durationSec as "M:SS" — same convention as the ReelPreview clock so
 * the two surfaces feel consistent.
 */
function formatTrackDuration(durationSec: number): string {
  const total = Math.max(0, Math.floor(durationSec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Sort tracks so they group cleanly by category in the "All" view. */
function sortTracksForDisplay(
  tracks: readonly ReelMusicTrack[],
): readonly ReelMusicTrack[] {
  const categoryOrder: Readonly<Record<ReelMusicCategory, number>> = {
    uplifting: 0,
    cinematic: 1,
    chill: 2,
    energetic: 3,
  };
  return [...tracks].sort((a, b) => {
    const ca = categoryOrder[a.category];
    const cb = categoryOrder[b.category];
    if (ca !== cb) return ca - cb;
    return a.displayName.localeCompare(b.displayName);
  });
}

// ---------------------------------------------------------------------------
// Availability hook — parallel HEAD requests, status map keyed by trackId
// ---------------------------------------------------------------------------

/**
 * Per-track availability state. "unknown" while the HEAD probe is in flight,
 * "available" / "unavailable" once it resolves. Errors (network failure)
 * count as "unavailable" — better UX to surface "Coming soon" than to spin
 * indefinitely on a flaky probe.
 */
type AvailabilityStatus = "unknown" | "available" | "unavailable";

/**
 * Probe each track's storage URL with a HEAD request in parallel. why HEAD:
 * doesn't pull the audio body (each MP3 is ~1-3MB), which keeps the picker
 * lightweight. The Supabase Storage public-URL endpoint responds to HEAD
 * with 200 if the object exists, 400/404 if not.
 *
 * Returns a stable Map (trackId → status). The map identity changes when ANY
 * probe completes so React re-renders the row UI.
 */
function useTrackAvailability(): Map<string, AvailabilityStatus> {
  const [statuses, setStatuses] = useState<Map<string, AvailabilityStatus>>(() => {
    const initial = new Map<string, AvailabilityStatus>();
    for (const t of REEL_MUSIC_LIBRARY) initial.set(t.id, "unknown");
    return initial;
  });

  useEffect(() => {
    let cancelled = false;

    // why Promise.all + map mutate: we update statuses incrementally so the
    // first-resolving track lights up immediately rather than waiting for
    // the slowest probe. Each probe commits via a functional setState that
    // copies + mutates a NEW Map so React notices the change.
    const probes = REEL_MUSIC_LIBRARY.map(async (track) => {
      const url = getReelMusicUrl(track);
      let next: AvailabilityStatus;
      try {
        const res = await fetch(url, { method: "HEAD" });
        next = res.ok ? "available" : "unavailable";
      } catch {
        // why catch-all: network failure, CORS edge case, or aborted fetch
        // all converge on "treat as unavailable". The picker still allows
        // selection — the worker is the final arbiter at render time.
        next = "unavailable";
      }
      if (cancelled) return;
      setStatuses((prev) => {
        const copy = new Map(prev);
        copy.set(track.id, next);
        return copy;
      });
    });

    // why void: we don't await — the effect returns its cleanup synchronously
    // and the probes commit their results via setState above.
    void Promise.all(probes);

    return () => {
      cancelled = true;
    };
  }, []);

  return statuses;
}

// ---------------------------------------------------------------------------
// Preview-audio hook — ONE shared HTMLAudioElement for in-picker auditions
// ---------------------------------------------------------------------------

/**
 * Manage a single hidden HTMLAudioElement used to preview tracks inside the
 * picker. Only one preview plays at a time — starting a new one pauses any
 * prior playback automatically.
 *
 * Returns:
 *   playingTrackId — id of the track currently auditioning, or null.
 *   togglePreview(trackId, url) — start that track from 0 (or stop it if
 *     already playing). Auto-stops after PREVIEW_SAMPLE_MAX_MS.
 *   stopPreview() — force-stop. Called on unmount + on row selection so the
 *     preview clip doesn't keep playing after the user confirms a pick.
 */
function usePreviewAudio(): {
  playingTrackId: string | null;
  togglePreview: (trackId: string, url: string) => void;
  stopPreview: () => void;
} {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // why lazy init via ref + effect: the HTMLAudioElement can't be created
  // during SSR (no document). We instantiate inside an effect that runs
  // only client-side.
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.preload = "none";
    return () => {
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const stopPreview = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    setPlayingTrackId(null);
  }, []);

  const togglePreview = useCallback(
    (trackId: string, url: string) => {
      const a = audioRef.current;
      if (!a) return;

      // Same track currently playing → stop it (toggle off).
      if (playingTrackId === trackId) {
        stopPreview();
        return;
      }

      // Different (or no) track playing → swap source + start.
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      // why force a load: setting src on the same Audio element doesn't
      // always trigger a fresh play — explicit load() resets the playback
      // pipeline so the next play() starts at 0.
      a.pause();
      a.src = url;
      a.currentTime = 0;
      a.load();
      // why catch: autoplay rejections + user-pause-mid-load promises both
      // surface here. We don't surface the failure — the row's "Coming
      // soon" pill or a generic UI hint would have already told the user
      // about availability concerns.
      a.play().catch(() => {
        setPlayingTrackId(null);
      });
      setPlayingTrackId(trackId);

      // Auto-stop after the max preview window so the audition feels short.
      stopTimerRef.current = window.setTimeout(() => {
        stopPreview();
      }, PREVIEW_SAMPLE_MAX_MS);
    },
    [playingTrackId, stopPreview],
  );

  return { playingTrackId, togglePreview, stopPreview };
}

// ---------------------------------------------------------------------------
// Inline icons — same approach the rest of canvas-editor uses
// ---------------------------------------------------------------------------

function PlayIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 5.5v13a.5.5 0 0 0 .77.42l10-6.5a.5.5 0 0 0 0-.84l-10-6.5A.5.5 0 0 0 8 5.5z" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

/** Small purely-decorative waveform glyph for the collapsed-with-track card. */
function WaveformGlyph({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <rect x="1" y="6" width="2" height="4" rx="1" />
      <rect x="5" y="3" width="2" height="10" rx="1" />
      <rect x="9" y="1" width="2" height="14" rx="1" />
      <rect x="13" y="4" width="2" height="8" rx="1" />
      <rect x="17" y="2" width="2" height="12" rx="1" />
      <rect x="21" y="5" width="2" height="6" rx="1" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MusicPicker({
  currentTrack,
  onTrackChanged,
}: MusicPickerProps): JSX.Element {
  // ---- expansion state ------------------------------------------------
  // why default-collapsed when a track is set: matches the spec — the
  // collapsed card with "Now: <displayName>" is the resting view, and the
  // user opts in to expand for re-selection.
  const [expanded, setExpanded] = useState<boolean>(currentTrack === null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [showFadeControls, setShowFadeControls] = useState<boolean>(false);

  // ---- preview audio + availability ----------------------------------
  const { playingTrackId, togglePreview, stopPreview } = usePreviewAudio();
  const availability = useTrackAvailability();

  // ---- derived: filtered + sorted track list -------------------------
  const filteredTracks = useMemo<readonly ReelMusicTrack[]>(() => {
    const filtered =
      categoryFilter === "all"
        ? REEL_MUSIC_LIBRARY
        : REEL_MUSIC_LIBRARY.filter((t) => t.category === categoryFilter);
    return sortTracksForDisplay(filtered);
  }, [categoryFilter]);

  // ---- derived: current library track (if any) -----------------------
  /**
   * Re-resolve the manifest entry for the current AudioTrack so we can show
   * its license + category in the collapsed card. Returns null if the track
   * id is no longer in the library (renamed / removed) — the collapsed card
   * still works off the AudioTrack's own displayName in that case.
   */
  const currentLibraryTrack = useMemo<ReelMusicTrack | null>(() => {
    if (!currentTrack) return null;
    return findReelMusicTrack(currentTrack.trackId);
  }, [currentTrack]);

  // ---- handlers ------------------------------------------------------

  const handleSelectTrack = useCallback(
    (track: ReelMusicTrack) => {
      // why stopPreview FIRST: if the user was auditioning a different
      // track when they click a row, kill the audition so it doesn't
      // overlap the in-studio playback that may start moments later.
      stopPreview();
      onTrackChanged(buildAudioTrackFromLibrary(track));
      setExpanded(false);
    },
    [onTrackChanged, stopPreview],
  );

  const handleRemoveTrack = useCallback(() => {
    stopPreview();
    onTrackChanged(null);
    setExpanded(false);
    setShowFadeControls(false);
  }, [onTrackChanged, stopPreview]);

  const handleVolumeChange = useCallback(
    (next: number) => {
      if (!currentTrack) return;
      onTrackChanged({ ...currentTrack, volume: next });
    },
    [currentTrack, onTrackChanged],
  );

  const handleFadeInChange = useCallback(
    (next: number) => {
      if (!currentTrack) return;
      onTrackChanged({ ...currentTrack, fadeInMs: next });
    },
    [currentTrack, onTrackChanged],
  );

  const handleFadeOutChange = useCallback(
    (next: number) => {
      if (!currentTrack) return;
      onTrackChanged({ ...currentTrack, fadeOutMs: next });
    },
    [currentTrack, onTrackChanged],
  );

  // ---- cleanup: stop the preview if the picker unmounts --------------
  useEffect(() => stopPreview, [stopPreview]);

  // ---- render --------------------------------------------------------

  return (
    <section className="flex flex-col" aria-label="Reel music picker">
      {/* ===== Header ==================================================== */}
      <div className="px-4 pt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Music
        </h3>
      </div>

      {/* ===== Collapsed card OR expanded list =========================== */}
      <div className="px-4 pb-4 pt-2">
        {!expanded ? (
          <CollapsedCard
            currentTrack={currentTrack}
            currentLibraryTrack={currentLibraryTrack}
            onExpand={() => setExpanded(true)}
            onRemoveTrack={handleRemoveTrack}
          />
        ) : (
          <ExpandedPicker
            tracks={filteredTracks}
            currentTrackId={currentTrack?.trackId ?? null}
            categoryFilter={categoryFilter}
            availability={availability}
            playingTrackId={playingTrackId}
            onCategoryChange={setCategoryFilter}
            onPreviewToggle={togglePreview}
            onSelectTrack={handleSelectTrack}
            onCollapse={() => setExpanded(false)}
            onRemoveTrack={handleRemoveTrack}
            hasCurrentTrack={currentTrack !== null}
          />
        )}
      </div>

      {/* ===== Volume + fades — only when a track is selected ============ */}
      {currentTrack ? (
        <div className="border-t border-neutral-100 px-4 py-4">
          <VolumeAndFadeControls
            volume={currentTrack.volume}
            fadeInMs={currentTrack.fadeInMs}
            fadeOutMs={currentTrack.fadeOutMs}
            showFadeControls={showFadeControls}
            onVolumeChange={handleVolumeChange}
            onFadeInChange={handleFadeInChange}
            onFadeOutChange={handleFadeOutChange}
            onToggleFadeControls={() => setShowFadeControls((v) => !v)}
          />
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface CollapsedCardProps {
  currentTrack: AudioTrack | null;
  currentLibraryTrack: ReelMusicTrack | null;
  onExpand: () => void;
  onRemoveTrack: () => void;
}

/**
 * The collapsed state. Two visuals:
 *   • currentTrack === null → gold-tinted "tap to add" CTA card.
 *   • currentTrack != null  → neutral card with displayName + waveform glyph
 *     + a remove X button. Clicking the card body (not the X) expands.
 */
function CollapsedCard({
  currentTrack,
  currentLibraryTrack,
  onExpand,
  onRemoveTrack,
}: CollapsedCardProps): JSX.Element {
  if (!currentTrack) {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-gold-300 bg-gold-50/40 px-3 py-3 text-left text-sm font-medium text-gold-800 transition-colors hover:border-gold-500 hover:bg-gold-50 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
        aria-label="Add background music"
      >
        <span className="inline-flex items-center gap-2">
          <PlayIcon className="h-4 w-4" />
          <span>No music — tap to add</span>
        </span>
        <ChevronDownIcon className="h-4 w-4 text-gold-700" />
      </button>
    );
  }

  // currentTrack present — neutral card.
  const subtitle = currentLibraryTrack
    ? `${REEL_MUSIC_CATEGORY_LABELS[currentLibraryTrack.category]} · ${LICENSE_LABEL[currentLibraryTrack.source.license]}`
    : "Selected track";

  return (
    <div className="flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-sm">
      <button
        type="button"
        onClick={onExpand}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
        aria-label={`Change music — currently ${currentTrack.displayName}`}
      >
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gold-50 text-gold-700"
        >
          <WaveformGlyph className="h-3.5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Now playing
          </span>
          <span className="block truncate text-sm font-medium text-neutral-900">
            {currentTrack.displayName}
          </span>
          <span className="block truncate text-[11px] text-neutral-500">
            {subtitle}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemoveTrack}
        aria-label="Remove music"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface ExpandedPickerProps {
  tracks: readonly ReelMusicTrack[];
  currentTrackId: string | null;
  categoryFilter: CategoryFilter;
  availability: Map<string, AvailabilityStatus>;
  playingTrackId: string | null;
  hasCurrentTrack: boolean;
  onCategoryChange: (filter: CategoryFilter) => void;
  onPreviewToggle: (trackId: string, url: string) => void;
  onSelectTrack: (track: ReelMusicTrack) => void;
  onCollapse: () => void;
  onRemoveTrack: () => void;
}

/**
 * The expanded state — category chips + scrollable track list + remove link.
 */
function ExpandedPicker({
  tracks,
  currentTrackId,
  categoryFilter,
  availability,
  playingTrackId,
  hasCurrentTrack,
  onCategoryChange,
  onPreviewToggle,
  onSelectTrack,
  onCollapse,
  onRemoveTrack,
}: ExpandedPickerProps): JSX.Element {
  // why a subtitle when a category is picked: gives Larissa the same "what's
  // this mood for" hint that the category constants document — keeps the
  // picker from feeling like a bare grid.
  const categoryHint =
    categoryFilter !== "all"
      ? REEL_MUSIC_CATEGORY_HINTS[categoryFilter]
      : null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      {/* ----- Category chips ------------------------------------------- */}
      <div className="border-b border-neutral-100 px-2 py-2">
        <div
          className="flex flex-wrap items-center gap-1"
          role="toolbar"
          aria-label="Filter music by mood"
        >
          {CATEGORY_FILTER_ORDER.map((filter) => {
            const isActive = categoryFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={isActive}
                onClick={() => onCategoryChange(filter)}
                className={[
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  isActive
                    ? "bg-gold-500 text-neutral-900"
                    : "bg-neutral-100 text-neutral-600 hover:bg-gold-50 hover:text-neutral-900",
                ].join(" ")}
              >
                {CATEGORY_FILTER_LABEL[filter]}
              </button>
            );
          })}
          <div className="ml-auto">
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Close picker"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </div>
        </div>
        {categoryHint ? (
          <p className="mt-1.5 px-1 text-[11px] leading-snug text-neutral-500">
            {categoryHint}
          </p>
        ) : null}
      </div>

      {/* ----- Track list ----------------------------------------------- */}
      <ul
        role="listbox"
        aria-label="Music tracks"
        className="max-h-72 divide-y divide-neutral-100 overflow-y-auto"
      >
        {tracks.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-neutral-500">
            No tracks in this mood yet.
          </li>
        ) : (
          tracks.map((track) => {
            const isSelected = currentTrackId === track.id;
            const status = availability.get(track.id) ?? "unknown";
            const isUnavailable = status === "unavailable";
            const isPreviewPlaying = playingTrackId === track.id;
            const url = getReelMusicUrl(track);
            return (
              <li key={track.id}>
                <TrackRow
                  track={track}
                  isSelected={isSelected}
                  isUnavailable={isUnavailable}
                  isPreviewPlaying={isPreviewPlaying}
                  onPreviewToggle={() => onPreviewToggle(track.id, url)}
                  onSelect={() => onSelectTrack(track)}
                />
              </li>
            );
          })
        )}
      </ul>

      {/* ----- Remove music link ---------------------------------------- */}
      {hasCurrentTrack ? (
        <div className="border-t border-neutral-100 px-3 py-2 text-right">
          <button
            type="button"
            onClick={onRemoveTrack}
            className="text-[11px] font-medium text-neutral-500 underline-offset-2 hover:text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-gold-500/40"
          >
            Remove music
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface TrackRowProps {
  track: ReelMusicTrack;
  isSelected: boolean;
  isUnavailable: boolean;
  isPreviewPlaying: boolean;
  onPreviewToggle: () => void;
  onSelect: () => void;
}

/**
 * One track in the expanded list. Clickable EXCEPT inside the preview
 * button — that one is isolated via stopPropagation so auditioning a
 * track doesn't accidentally select it.
 */
function TrackRow({
  track,
  isSelected,
  isUnavailable,
  isPreviewPlaying,
  onPreviewToggle,
  onSelect,
}: TrackRowProps): JSX.Element {
  const duration = formatTrackDuration(track.durationSec);
  const license = LICENSE_LABEL[track.source.license];
  const category = REEL_MUSIC_CATEGORY_LABELS[track.category];

  return (
    <div
      role="option"
      aria-current={isSelected ? "true" : undefined}
      aria-selected={isSelected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        // why Enter/Space → select: keyboard parity with click. Same pattern
        // as the listing picker rows in ReelStudioClient.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-gold-500/40",
        isSelected
          ? "bg-gold-50"
          : "hover:bg-neutral-50",
        isUnavailable ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={[
              "truncate text-sm font-medium",
              isSelected ? "text-gold-900" : "text-neutral-900",
            ].join(" ")}
          >
            {track.displayName}
          </span>
          <span className="inline-flex shrink-0 items-center rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            {category}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
          <span className="tabular-nums">{duration}</span>
          <span className="text-neutral-300" aria-hidden="true">
            ·
          </span>
          <span>{license}</span>
        </div>
      </div>

      {isSelected ? (
        <span className="inline-flex shrink-0 items-center rounded bg-gold-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-900">
          Selected
        </span>
      ) : isUnavailable ? (
        // why "Coming soon" instead of a play button: the file doesn't exist
        // in Storage yet (the manifest is seeded ahead of uploads). User can
        // still select the row — the worker errors clearly at render time.
        <span className="inline-flex shrink-0 items-center rounded bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          Coming soon
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            // why stopPropagation: the parent row's onClick selects the track.
            // The preview button must audition the track WITHOUT triggering
            // a parent select — those are separate intents.
            e.stopPropagation();
            onPreviewToggle();
          }}
          aria-label={
            isPreviewPlaying
              ? `Stop preview of ${track.displayName}`
              : `Preview ${track.displayName}`
          }
          aria-pressed={isPreviewPlaying}
          className={[
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gold-500/40",
            isPreviewPlaying
              ? "bg-gold-600 text-white hover:bg-gold-700"
              : "bg-neutral-100 text-neutral-700 hover:bg-gold-100",
          ].join(" ")}
        >
          {isPreviewPlaying ? (
            <StopIcon className="h-3 w-3" />
          ) : (
            <PlayIcon className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

interface VolumeAndFadeControlsProps {
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  showFadeControls: boolean;
  onVolumeChange: (next: number) => void;
  onFadeInChange: (next: number) => void;
  onFadeOutChange: (next: number) => void;
  onToggleFadeControls: () => void;
}

/**
 * Volume slider + collapsible fade controls. Lives below the picker card
 * whenever a track is selected.
 */
function VolumeAndFadeControls({
  volume,
  fadeInMs,
  fadeOutMs,
  showFadeControls,
  onVolumeChange,
  onFadeInChange,
  onFadeOutChange,
  onToggleFadeControls,
}: VolumeAndFadeControlsProps): JSX.Element {
  const volumePct = Math.round(volume * 100);
  return (
    <div>
      {/* Volume */}
      <div>
        <label
          htmlFor="reel-music-volume"
          className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
        >
          Volume
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="reel-music-volume"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePct}
            onChange={(e) =>
              onVolumeChange(Number(e.currentTarget.value) / 100)
            }
            aria-label="Music volume"
            aria-valuetext={`${volumePct}%`}
            className="flex-1 accent-gold-500"
          />
          <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-900">
            {volumePct}%
          </span>
        </div>
      </div>

      {/* Fade controls toggle */}
      <div className="mt-3">
        <button
          type="button"
          onClick={onToggleFadeControls}
          aria-expanded={showFadeControls}
          aria-controls="reel-music-fade-controls"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-500/40"
        >
          <ChevronDownIcon
            className={[
              "h-3 w-3 transition-transform",
              showFadeControls ? "rotate-0" : "-rotate-90",
            ].join(" ")}
          />
          {showFadeControls ? "Hide fade controls" : "Show fade controls"}
        </button>
      </div>

      {showFadeControls ? (
        <div id="reel-music-fade-controls" className="mt-3 space-y-3">
          {/* Fade in */}
          <div>
            <label
              htmlFor="reel-music-fade-in"
              className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
            >
              Fade in
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="reel-music-fade-in"
                type="range"
                min={0}
                max={FADE_MAX_MS}
                step={50}
                value={fadeInMs}
                onChange={(e) => onFadeInChange(Number(e.currentTarget.value))}
                aria-label="Music fade-in duration"
                aria-valuetext={`${fadeInMs} milliseconds`}
                className="flex-1 accent-gold-500"
              />
              <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-900">
                {fadeInMs}ms
              </span>
            </div>
          </div>
          {/* Fade out */}
          <div>
            <label
              htmlFor="reel-music-fade-out"
              className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
            >
              Fade out
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="reel-music-fade-out"
                type="range"
                min={0}
                max={FADE_MAX_MS}
                step={50}
                value={fadeOutMs}
                onChange={(e) => onFadeOutChange(Number(e.currentTarget.value))}
                aria-label="Music fade-out duration"
                aria-valuetext={`${fadeOutMs} milliseconds`}
                className="flex-1 accent-gold-500"
              />
              <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-900">
                {fadeOutMs}ms
              </span>
            </div>
          </div>
          <p className="text-[11px] leading-snug text-neutral-500">
            Defaults: {DEFAULT_FADE_IN_MS}ms in, {DEFAULT_FADE_OUT_MS}ms out at{" "}
            {Math.round(DEFAULT_VOLUME * 100)}% volume.
          </p>
        </div>
      ) : null}
    </div>
  );
}
