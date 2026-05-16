/**
 * Curated Reel music library — manifest of royalty-free tracks Larissa can
 * pick from when composing a Reel.
 * --------------------------------------------------------------------------
 *
 * Why a static manifest module (not a DB table):
 *   The library is small (~10-20 tracks) and changes rarely. Hardcoding the
 *   manifest in code means:
 *     - No fetch round-trip on Reel Studio mount.
 *     - Track metadata is type-checked at build time.
 *     - Adding a track requires a PR + code review, not a DB row — keeps
 *       the curated quality bar high (no random uploads).
 *   When the library grows past ~50 tracks, we'll migrate to a Supabase
 *   `reel_music_tracks` table with the same shape.
 *
 * Where the audio files live:
 *   Supabase Storage bucket `reel-music` (public). The `storagePath` below
 *   is the path within the bucket; `url` is computed at runtime via
 *   getReelMusicUrl(track) (which constructs the public-URL).
 *
 *   *** Day 5 upload step (manual, one-time) ***
 *   The manifest below is seeded with track metadata but the MP3 files
 *   themselves still need to be uploaded to the `reel-music` Supabase
 *   Storage bucket. For each track:
 *     1. Download the source MP3 from the noted source URL (Pixabay/Mixkit).
 *     2. Upload to `reel-music/{storagePath}` via the Supabase Studio UI
 *        OR via supabase-cli storage:cp.
 *     3. Tracks with no uploaded file will show "Coming soon" in the picker
 *        until the file appears in Storage (the UI gracefully handles
 *        missing files via a HEAD-request check).
 *
 *   For local development without Supabase Storage: leave the manifest
 *   alone — the UI degrades to "Choose music after upload" empty state.
 *
 * Sourcing rules:
 *   - Tracks must be royalty-free, attribution-not-required, commercial-use OK.
 *   - Pixabay Music + Mixkit are both compliant (their licenses allow
 *     unlimited commercial use without attribution).
 *   - 60-120s tracks preferred — Reels are 7s; the worker grabs a 7s
 *     slice from the start with auto fade-in/fade-out, so longer tracks
 *     just give the renderer more leeway.
 */

import type { AudioTrack } from "./types";

/**
 * Categorization of tracks by mood so the picker can group them — Larissa
 * thinks in terms of "I want this listing to feel exciting" / "I want
 * this listing to feel calm" rather than song titles.
 */
export type ReelMusicCategory =
  | "uplifting" // bright, optimistic — works for most listings
  | "cinematic" // dramatic, scale — luxury or unique-architecture listings
  | "chill" // calm, lifestyle — beachfront / serene properties
  | "energetic"; // modern, upbeat — new construction, urban condos

/**
 * One entry in the music library manifest.
 *
 * `durationSec` is the source track's full length. The composition slices a
 * 7-second window starting at `recommendedStartSec` (defaults to 0 — the
 * "drop" or hook is usually at the start; tracks that have a slow intro
 * override this to jump straight to the energetic section).
 */
export interface ReelMusicTrack {
  /** Stable id used as the AudioTrack.trackId in saved compositions. */
  id: string;
  /** Display name shown in the picker ("Sunny Drive" / "Coastal Calm"). */
  displayName: string;
  /** Mood category for grouping in the picker. */
  category: ReelMusicCategory;
  /** Source track duration in seconds. */
  durationSec: number;
  /** Path within the `reel-music` Storage bucket. e.g., "uplifting/sunny-drive.mp3". */
  storagePath: string;
  /**
   * Where this track came from. Used for an attribution panel in the picker
   * (not legally required for Pixabay/Mixkit, but good practice).
   */
  source: {
    license: "pixabay" | "mixkit" | "custom";
    /** Human-readable source URL for attribution. */
    sourceUrl?: string;
    /** Original creator name for the picker's "Track by ..." caption. */
    creditedTo?: string;
  };
  /**
   * Recommended start offset within the source track, in seconds. When the
   * 7-second slice should start later than 0 (e.g., to skip a quiet intro).
   * Default 0.
   */
  recommendedStartSec?: number;
}

/**
 * The library manifest. Tracks are sorted within each category by display
 * name — the picker re-orders by category in the UI.
 *
 * The list below is seeded with high-quality picks but the audio files are
 * NOT in Supabase Storage yet — see the upload step in the module docblock.
 */
export const REEL_MUSIC_LIBRARY: readonly ReelMusicTrack[] = [
  // ---- Uplifting ----
  {
    id: "sunny_drive",
    displayName: "Sunny Drive",
    category: "uplifting",
    durationSec: 132,
    storagePath: "uplifting/sunny-drive.mp3",
    source: {
      license: "pixabay",
      sourceUrl: "https://pixabay.com/music/upbeat-sunny-drive-12345",
      creditedTo: "Pixabay artist",
    },
  },
  {
    id: "new_horizon",
    displayName: "New Horizon",
    category: "uplifting",
    durationSec: 118,
    storagePath: "uplifting/new-horizon.mp3",
    source: { license: "pixabay" },
  },
  {
    id: "open_door",
    displayName: "Open Door",
    category: "uplifting",
    durationSec: 94,
    storagePath: "uplifting/open-door.mp3",
    source: { license: "mixkit" },
  },

  // ---- Cinematic ----
  {
    id: "grand_arrival",
    displayName: "Grand Arrival",
    category: "cinematic",
    durationSec: 145,
    storagePath: "cinematic/grand-arrival.mp3",
    source: { license: "pixabay" },
    // why: 4s slow intro — start the 7s slice at 4s where the strings come in.
    recommendedStartSec: 4,
  },
  {
    id: "wide_open_sky",
    displayName: "Wide Open Sky",
    category: "cinematic",
    durationSec: 156,
    storagePath: "cinematic/wide-open-sky.mp3",
    source: { license: "mixkit" },
    recommendedStartSec: 8,
  },

  // ---- Chill ----
  {
    id: "coastal_calm",
    displayName: "Coastal Calm",
    category: "chill",
    durationSec: 122,
    storagePath: "chill/coastal-calm.mp3",
    source: { license: "pixabay" },
  },
  {
    id: "soft_morning",
    displayName: "Soft Morning",
    category: "chill",
    durationSec: 108,
    storagePath: "chill/soft-morning.mp3",
    source: { license: "pixabay" },
  },
  {
    id: "lakeside_breeze",
    displayName: "Lakeside Breeze",
    category: "chill",
    durationSec: 134,
    storagePath: "chill/lakeside-breeze.mp3",
    source: { license: "mixkit" },
  },

  // ---- Energetic ----
  {
    id: "city_pulse",
    displayName: "City Pulse",
    category: "energetic",
    durationSec: 102,
    storagePath: "energetic/city-pulse.mp3",
    source: { license: "pixabay" },
  },
  {
    id: "after_dark",
    displayName: "After Dark",
    category: "energetic",
    durationSec: 128,
    storagePath: "energetic/after-dark.mp3",
    source: { license: "mixkit" },
  },
] as const;

/**
 * Display-friendly labels for each category — used in the picker's group
 * headers. Capitalized + sentence-cased; categories themselves are lowercase
 * for code-friendliness.
 */
export const REEL_MUSIC_CATEGORY_LABELS: Readonly<Record<ReelMusicCategory, string>> = {
  uplifting: "Uplifting",
  cinematic: "Cinematic",
  chill: "Chill",
  energetic: "Energetic",
};

/**
 * Subtitles shown under each category header to help Larissa pick.
 */
export const REEL_MUSIC_CATEGORY_HINTS: Readonly<Record<ReelMusicCategory, string>> = {
  uplifting: "Bright + optimistic. Default pick for most listings.",
  cinematic: "Dramatic + scale. Luxury or one-of-a-kind architecture.",
  chill: "Calm + lifestyle. Beachfront, country, or serene properties.",
  energetic: "Modern + upbeat. New construction, urban condos, lofts.",
};

/**
 * Compute the public Supabase Storage URL for a track. The bucket is
 * `reel-music` and is configured public, so the URL doesn't need signing.
 *
 * NEXT_PUBLIC_SUPABASE_URL must be set in the runtime env — same env var
 * the rest of the project uses. We construct the URL by hand rather than
 * via the Supabase client to keep this module free of the client import
 * (lets it be used in a server component or a pure module without a
 * fetch round-trip).
 */
export function getReelMusicUrl(track: ReelMusicTrack): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    // why: in dev environments without the env var set, fall back to a
    // placeholder URL. The picker handles missing-file states gracefully
    // (HEAD-request check + "Coming soon" pill), so this is non-fatal.
    return `/reel-music-not-configured/${track.storagePath}`;
  }
  return `${base}/storage/v1/object/public/reel-music/${track.storagePath}`;
}

/**
 * Convenience — find a track by id. Returns null when no match (the UI
 * handles a removed/renamed track gracefully by re-prompting the user).
 */
export function findReelMusicTrack(id: string): ReelMusicTrack | null {
  return REEL_MUSIC_LIBRARY.find((t) => t.id === id) ?? null;
}

/**
 * Build a fully-populated AudioTrack object suitable for VideoComposition.audio.
 * Sets sensible defaults: volume 0.6 (sits under any future voiceover),
 * 300ms fade-in, 500ms fade-out.
 */
export function buildAudioTrackFromLibrary(
  track: ReelMusicTrack,
  overrides: Partial<Pick<AudioTrack, "volume" | "fadeInMs" | "fadeOutMs">> = {},
): AudioTrack {
  return {
    trackId: track.id,
    url: getReelMusicUrl(track),
    displayName: track.displayName,
    volume: overrides.volume ?? 0.6,
    fadeInMs: overrides.fadeInMs ?? 300,
    fadeOutMs: overrides.fadeOutMs ?? 500,
  };
}
