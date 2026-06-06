/**
 * Convert an `audio_tracks` row into the worker's AudioTrack composition shape.
 *
 * Applies the spec's render defaults: fade-in 0.5s, fade-out 1.0s, and a
 * mix-context-aware volume (75% music-only, 25% under voiceover, 35% over
 * ambient property audio). The worker (compose-video.ts) loops/trims the
 * source to the reel duration and applies the fades.
 */

import type { AudioTrack } from "@/lib/post-builder/types";
import {
  AUDIO_FADE_IN_MS,
  AUDIO_FADE_OUT_MS,
  audioPublicUrl,
  resolveMusicVolume,
  type AudioMixContext,
  type AudioTrackRow,
} from "./types";

export function buildAudioTrackFromRow(
  row: AudioTrackRow,
  mix: AudioMixContext = {},
): AudioTrack {
  return {
    trackId: row.id,
    url: audioPublicUrl(row.file_path),
    displayName: row.track_name,
    volume: resolveMusicVolume(mix),
    fadeInMs: AUDIO_FADE_IN_MS,
    fadeOutMs: AUDIO_FADE_OUT_MS,
  };
}
