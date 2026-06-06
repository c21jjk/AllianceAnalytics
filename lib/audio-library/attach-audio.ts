/**
 * Reel-builder audio orchestration — selection + attach + usage logging.
 * --------------------------------------------------------------------------
 *
 * This is the single entry point the reel enqueue path calls to give a
 * composition its background music automatically:
 *
 *   1. If the composition ALREADY has audio (the user picked a track manually
 *      in the Studio MusicPicker), leave it untouched and don't log DB usage
 *      — manual picks use the legacy static music library, not `audio_tracks`.
 *   2. Otherwise select a DB track for the post type + target platform(s),
 *      attach it to the composition, and log one usage row per platform.
 *   3. If no track matches / none are active, return the composition unchanged
 *      (silent reel) with status `no_audio_available`.
 *
 * Server-only — pulls in the admin-client-backed selector + logger.
 */

import "server-only";

import type { PostType, SchedulablePlatform, VideoComposition } from "@/lib/post-builder/types";
import { selectAudioTrack } from "./select-track";
import { buildAudioTrackFromRow } from "./build-audio-track";
import { logAudioUsage } from "./log-usage";
import type { AudioMixContext, AudioStatus } from "./types";

export interface AutoAttachAudioParams {
  postType: PostType;
  /** Platforms this reel will publish to. First is used for track selection. */
  platforms: readonly SchedulablePlatform[];
  officeId?: string | null;
  /** generated_posts.id, when known, for the usage row. */
  postId?: string | null;
  /** Mix context for volume (voiceover / ambient). Defaults to music-only. */
  mix?: AudioMixContext;
}

export interface AutoAttachAudioResult {
  composition: VideoComposition;
  status: AudioStatus;
  /** Id of the attached DB track, when one was selected. */
  audioTrackId: string | null;
}

/**
 * Attach auto-selected music to a composition. Never throws — on any internal
 * error it returns the original composition with status `failed` so the reel
 * still renders (silently).
 */
export async function autoAttachAudio(
  composition: VideoComposition,
  params: AutoAttachAudioParams,
): Promise<AutoAttachAudioResult> {
  // Respect a manual pick — don't override or double-log.
  if (composition.audio) {
    return { composition, status: "embedded", audioTrackId: null };
  }

  const platforms =
    params.platforms.length > 0
      ? params.platforms
      : (["instagram"] as const satisfies readonly SchedulablePlatform[]);
  const selectionPlatform: SchedulablePlatform = platforms[0]!;

  try {
    const { track } = await selectAudioTrack({
      postType: params.postType,
      platform: selectionPlatform,
      officeId: params.officeId ?? null,
    });

    if (!track) {
      return { composition, status: "no_audio_available", audioTrackId: null };
    }

    const audio = buildAudioTrackFromRow(track, params.mix ?? {});
    const next: VideoComposition = {
      ...composition,
      audio,
      updatedAt: new Date().toISOString(),
    };

    // Best-effort usage log — failure must not block the render.
    await logAudioUsage({
      audioTrackId: track.id,
      postId: params.postId ?? null,
      officeId: params.officeId ?? null,
      postType: params.postType,
      platforms,
    });

    // Overall status: if any target is TikTok, surface the strip warning.
    const status: AudioStatus = platforms.includes("tiktok")
      ? "platform_may_strip"
      : "embedded";
    return { composition: next, status, audioTrackId: track.id };
  } catch (e) {
    console.error(
      "[audio-library] autoAttachAudio failed:",
      e instanceof Error ? e.message : String(e),
    );
    return { composition, status: "failed", audioTrackId: null };
  }
}
