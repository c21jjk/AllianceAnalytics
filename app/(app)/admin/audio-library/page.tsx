import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AudioTrackRow } from "@/lib/audio-library/types";
import AudioLibraryClient from "./AudioLibraryClient";

export const metadata = { title: "Audio Library — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Audio Library — admin list + upload view.
 *
 * Server boundary gates on admin role and fetches every track (active and
 * inactive) via the service-role client, then hands them to the client for
 * upload / preview / edit / archive. Files live in the public `reel-music`
 * Storage bucket; the reel builder auto-selects from active tracks by post
 * type + platform at render time.
 */
export default async function AudioLibraryPage() {
  await requireAdmin();

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("audio_tracks")
    .select("*")
    .order("created_at", { ascending: false });

  const tracks = (data ?? []) as AudioTrackRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Audio Library"
        description="Upload approved Meta Sound Collection tracks, tag them by post type, and the reel builder will embed a fitting track into each generated Reel before posting to Facebook, Instagram, and TikTok."
      />

      <AudioLibraryClient tracks={tracks} />
    </div>
  );
}
