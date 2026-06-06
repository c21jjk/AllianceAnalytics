/**
 * Audio track usage logging.
 * --------------------------------------------------------------------------
 *
 * Writes a row to `audio_track_usage` for each platform a reel render targets
 * with a DB audio track. Drives the per-office 7-day rotation exclusion in
 * select-track.ts and gives us an audit trail of where each track was used.
 *
 * TikTok rows are stamped `platform_may_strip` because Meta Sound Collection
 * audio embedded in an MP4 may be stripped, muted, or replaced by TikTok.
 *
 * Server-only: uses the service-role admin client. Best-effort — a logging
 * failure must never fail a render, so callers should not await-throw on it.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { PostType, SchedulablePlatform } from "@/lib/post-builder/types";
import {
  PLATFORM_CODE_BY_SCHEDULABLE,
  type AudioStatus,
  type AudioTrackUsageInsert,
} from "./types";

export interface LogAudioUsageParams {
  audioTrackId: string;
  postId?: string | null;
  officeId?: string | null;
  postType: PostType;
  /** Platforms this reel targets. One usage row is written per platform. */
  platforms: readonly SchedulablePlatform[];
  /**
   * Override the per-platform status. By default each platform is logged as
   * `embedded`, except TikTok which is logged as `platform_may_strip`.
   */
  statusOverride?: AudioStatus;
}

/** Per-platform status: TikTok may strip embedded audio. */
function statusForPlatform(
  platform: SchedulablePlatform,
  override?: AudioStatus,
): AudioStatus {
  if (override) return override;
  return platform === "tiktok" ? "platform_may_strip" : "embedded";
}

/**
 * Insert one `audio_track_usage` row per target platform. Returns true on
 * success, false on any error (logged, never thrown).
 */
export async function logAudioUsage(
  params: LogAudioUsageParams,
): Promise<boolean> {
  const { audioTrackId, postId, officeId, postType, platforms } = params;
  if (platforms.length === 0) return true;

  const supabase = createAdminClient();
  const rows: AudioTrackUsageInsert[] = platforms.map((platform) => ({
    audio_track_id: audioTrackId,
    post_id: postId ?? null,
    office_id: officeId ?? null,
    post_type: postType,
    platform: PLATFORM_CODE_BY_SCHEDULABLE[platform],
    audio_status: statusForPlatform(platform, params.statusOverride),
  }));

  const { error } = await supabase.from("audio_track_usage").insert(rows);
  if (error) {
    console.error("[audio-library] logAudioUsage failed:", error.message);
    return false;
  }
  return true;
}
