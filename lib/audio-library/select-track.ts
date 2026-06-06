/**
 * Reel-builder audio SELECTION logic.
 * --------------------------------------------------------------------------
 *
 * Given a post type + target platform (and optionally an office), pick one
 * active audio track from `audio_tracks` to embed in the reel:
 *
 *   1. Active tracks whose `post_type` contains the requested type AND whose
 *      `platform_allowed` contains the target platform code.
 *   2. Among those, exclude any track this office used in the last 7 days
 *      (rotation — don't repeat the same track too often per office).
 *   3. Pick randomly among what remains (rotation).
 *   4. Fallback: if nothing matched the post type, any active track whose
 *      `platform_allowed` contains the platform (still apply the 7-day
 *      office exclusion when possible).
 *   5. Nothing active → null (caller renders the reel silent).
 *
 * Server-only: uses the service-role admin client so the selector is reliable
 * regardless of the caller's RLS context.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { PostType } from "@/lib/post-builder/types";
import {
  PLATFORM_CODE_BY_SCHEDULABLE,
  type AudioTrackRow,
  type PlatformCode,
} from "./types";
import type { SchedulablePlatform } from "@/lib/post-builder/types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface SelectAudioTrackParams {
  /** App post type the reel is for. */
  postType: PostType;
  /** Target platform — the track's `platform_allowed` must contain its code. */
  platform: SchedulablePlatform;
  /** Office the reel belongs to. Enables the 7-day rotation exclusion. */
  officeId?: string | null;
}

export interface AudioTrackSelection {
  track: AudioTrackRow | null;
  /** True when the chosen track matched on post type (vs a generic fallback). */
  matchedPostType: boolean;
}

/** Pick a random element, or null for an empty array. */
function pickRandom<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  const idx = Math.floor(Math.random() * items.length);
  return items[idx] ?? null;
}

/**
 * Track ids this office has used within the last 7 days — excluded from
 * selection so the same office doesn't repeat a track too often. Best-effort:
 * any query error returns an empty set (no exclusion) rather than blocking
 * selection.
 */
async function recentlyUsedTrackIds(
  officeId: string,
): Promise<Set<string>> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const { data, error } = await supabase
    .from("audio_track_usage")
    .select("audio_track_id")
    .eq("office_id", officeId)
    .gte("used_at", since);
  if (error || !data) return new Set<string>();
  return new Set(data.map((r) => r.audio_track_id));
}

/**
 * Select an audio track for a reel. See module docblock for the algorithm.
 */
export async function selectAudioTrack(
  params: SelectAudioTrackParams,
): Promise<AudioTrackSelection> {
  const { postType, platform, officeId } = params;
  const platformCode: PlatformCode = PLATFORM_CODE_BY_SCHEDULABLE[platform];
  const supabase = createAdminClient();

  // All active tracks allowed on the target platform. We filter post-type +
  // recency in JS so we can cleanly fall back without a second round trip.
  const { data, error } = await supabase
    .from("audio_tracks")
    .select("*")
    .eq("is_active", true)
    .contains("platform_allowed", [platformCode]);

  if (error || !data || data.length === 0) {
    return { track: null, matchedPostType: false };
  }

  const excluded =
    officeId && officeId.length > 0
      ? await recentlyUsedTrackIds(officeId)
      : new Set<string>();

  const allowed = data.filter((t) => !excluded.has(t.id));
  // If the office exclusion eliminated everything, ignore it rather than
  // render silent — a repeat is better than no music.
  const pool = allowed.length > 0 ? allowed : data;

  const matching = pool.filter(
    (t) => Array.isArray(t.post_type) && t.post_type.includes(postType),
  );

  if (matching.length > 0) {
    return { track: pickRandom(matching), matchedPostType: true };
  }

  // Fallback — any active track allowed on the platform.
  return { track: pickRandom(pool), matchedPostType: false };
}
