/**
 * Audio Library — shared types + matching rules.
 * --------------------------------------------------------------------------
 *
 * The Audio Library is a Supabase-backed (`audio_tracks` table) collection of
 * approved Meta Sound Collection tracks an admin uploads via the Audio Library
 * admin page. The reel builder auto-selects a track by post type + target
 * platform and the render worker embeds it into the MP4.
 *
 * Files live in the existing public `reel-music` Storage bucket (same bucket
 * the legacy static music manifest uses) at `file_path`. We reuse that bucket
 * rather than a new private one so the worker's existing public-URL audio
 * fetch (worker/src/render/compose-video.ts → downloadAudio) keeps working
 * with no signed-URL plumbing.
 *
 * Post-type taxonomy: reconciled to the app's REAL post types
 * (lib/post-builder/types.ts PostType) rather than the spec's marketing
 * taxonomy — so `audio_tracks.post_type` values join cleanly with
 * `generated_posts.post_type`. Mapping applied at design time:
 *   new_listing  → just_listed
 *   sold         → just_sold
 *   luxury_listing / recruiting → dropped (no app post type)
 *   open_house   → added (no rule in the spec; sensible default below)
 */

import type { PostType, SchedulablePlatform } from "@/lib/post-builder/types";
import type { Database } from "@/lib/supabase/types";

/** Row / Insert / Update aliases off the generated Database type. */
export type AudioTrackRow = Database["public"]["Tables"]["audio_tracks"]["Row"];
export type AudioTrackInsert =
  Database["public"]["Tables"]["audio_tracks"]["Insert"];
export type AudioTrackUpdate =
  Database["public"]["Tables"]["audio_tracks"]["Update"];
export type AudioTrackUsageRow =
  Database["public"]["Tables"]["audio_track_usage"]["Row"];
export type AudioTrackUsageInsert =
  Database["public"]["Tables"]["audio_track_usage"]["Insert"];

/**
 * Platform CODE as stored in `platform_allowed` / `platform_blocked`. These
 * are the spec's short codes, distinct from the app's lowercase
 * SchedulablePlatform ("facebook" | "instagram" | "tiktok").
 */
export type PlatformCode = "FB" | "IG" | "TikTok";

/** Defaults applied to every new admin upload (mirrors the spec). */
export const AUDIO_SOURCE_DEFAULT = "Meta Sound Collection";
export const LICENSE_SCOPE_DEFAULT =
  "Facebook / Instagram / TikTok internal workflow only. TikTok may strip or mute audio.";
export const PLATFORM_ALLOWED_DEFAULT: readonly PlatformCode[] = [
  "FB",
  "IG",
  "TikTok",
];
export const PLATFORM_BLOCKED_DEFAULT: readonly string[] = [
  "YouTube",
  "LinkedIn",
];

/** Storage bucket the audio files live in (reused public bucket). */
export const AUDIO_BUCKET = "reel-music";
/** Path prefix inside the bucket for Meta Sound Collection uploads. */
export const AUDIO_PATH_PREFIX = "meta-sound-collection";

/**
 * Audio status written to `audio_track_usage.audio_status` on every render
 * that used (or attempted) a DB audio track.
 *   embedded            — track muxed into the MP4 for this platform.
 *   platform_may_strip  — embedded, but the platform (TikTok) may strip/mute it.
 *   no_audio_available  — no matching/active track; the reel rendered silent.
 *   failed              — selection/attach failed unexpectedly.
 */
export type AudioStatus =
  | "embedded"
  | "no_audio_available"
  | "platform_may_strip"
  | "failed";

/**
 * Map the app's lowercase SchedulablePlatform to the stored PlatformCode used
 * in `platform_allowed`.
 */
export const PLATFORM_CODE_BY_SCHEDULABLE: Readonly<
  Record<SchedulablePlatform, PlatformCode>
> = {
  facebook: "FB",
  instagram: "IG",
  tiktok: "TikTok",
};

/**
 * Per-post-type preferred mood + genres. Used by the admin UI as authoring
 * hints and (optionally) by the selector to bias toward better-fitting
 * tracks. Reconciled from the spec's taxonomy to the app's PostType set.
 *
 * `open_house` has no rule in the spec — the values below are a sensible
 * default (inviting, upbeat) and can be tuned later.
 */
export interface PostTypeAudioRule {
  /** Human label for the admin hint. */
  label: string;
  /** Preferred mood keyword (matched against audio_tracks.mood, case-insensitive). */
  preferredMood: string;
  /** Preferred genre keywords (matched against audio_tracks.genre, case-insensitive). */
  preferredGenres: readonly string[];
}

export const AUDIO_POST_TYPE_RULES: Readonly<
  Record<PostType, PostTypeAudioRule>
> = {
  just_listed: {
    label: "Just Listed",
    preferredMood: "upbeat coastal",
    preferredGenres: ["acoustic", "pop", "light electronic", "beach", "lifestyle"],
  },
  just_sold: {
    label: "Just Sold",
    preferredMood: "celebratory",
    preferredGenres: ["upbeat", "pop", "feel-good"],
  },
  under_contract: {
    label: "Under Contract",
    preferredMood: "upbeat short",
    preferredGenres: ["pop", "upbeat", "light electronic"],
  },
  price_reduction: {
    label: "Price Reduction",
    preferredMood: "quick attention track",
    preferredGenres: ["upbeat", "electronic", "pop", "short beat"],
  },
  open_house: {
    label: "Open House",
    // No spec rule — sensible default (inviting + upbeat).
    preferredMood: "inviting upbeat",
    preferredGenres: ["pop", "lifestyle", "light electronic", "acoustic"],
  },
};

/** Every valid post-type tag, in display order. */
export const AUDIO_POST_TYPES: readonly PostType[] = [
  "just_listed",
  "just_sold",
  "under_contract",
  "open_house",
  "price_reduction",
];

/**
 * Music volume defaults (0..1) by mix context. From the spec:
 *   music only                    → 75%
 *   music + voiceover             → 25%
 *   music + property ambient      → 35%
 *   no voiceover and no ambient   → 75%
 */
export interface AudioMixContext {
  hasVoiceover?: boolean;
  hasAmbientAudio?: boolean;
}

export function resolveMusicVolume(ctx: AudioMixContext = {}): number {
  if (ctx.hasVoiceover) return 0.25;
  if (ctx.hasAmbientAudio) return 0.35;
  return 0.75;
}

/** Spec render defaults: fade in 0.5s, fade out 1.0s. */
export const AUDIO_FADE_IN_MS = 500;
export const AUDIO_FADE_OUT_MS = 1_000;

/**
 * Compliance notice shown near the admin upload button (verbatim from spec).
 */
export const AUDIO_COMPLIANCE_NOTICE =
  "Only upload tracks downloaded from Meta Sound Collection or another approved commercial-use source. Meta Sound Collection tracks are intended for Facebook and Instagram usage. TikTok is included for workflow testing, but TikTok may strip, mute, or replace the audio.";

/** Build the public URL for a track's stored file. */
export function audioPublicUrl(filePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return `/audio-not-configured/${filePath}`;
  return `${base}/storage/v1/object/public/${AUDIO_BUCKET}/${filePath}`;
}

/**
 * Build the storage path for a new upload:
 *   meta-sound-collection/{track_id}/{clean-track-name}.{ext}
 */
export function buildAudioStoragePath(
  trackId: string,
  trackName: string,
  ext: "mp3" | "wav",
): string {
  const clean =
    trackName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "track";
  return `${AUDIO_PATH_PREFIX}/${trackId}/${clean}.${ext}`;
}
