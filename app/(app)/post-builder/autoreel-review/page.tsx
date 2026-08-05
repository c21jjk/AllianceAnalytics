import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import PageHeader from "@/components/PageHeader";
import AutoReelReviewClient, { type ImportedReelData } from "./AutoReelReviewClient";

export const metadata = { title: "Review AutoReel — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * /post-builder/autoreel-review?gp=<id> — review + publish surface for reels
 * imported from AutoReel (template_id 'autoreel_import_v1').
 *
 * why this exists (2026-08-05 live test): these rows carry a FINISHED video,
 * not a native composition, so Reel Studio is the wrong surface — it would
 * auto-build a fresh scene composition from listing photos and its
 * "Re-generate" could overwrite the imported video. This page shows the
 * actual video with its captions and two buttons. One decision per screen.
 */
export default async function AutoReelReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ gp?: string | string[] }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const gpId = (Array.isArray(sp.gp) ? sp.gp[0] : sp.gp)?.trim();
  if (!gpId) notFound();

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;
  const { data } = await sbAny
    .from("generated_posts")
    .select(
      "id, mls_number, post_type, status, template_id, media_type, video_url, image_url, caption, hashtags, captions_by_platform, scheduled_for, posted_at",
    )
    .eq("id", gpId)
    .maybeSingle();
  if (
    !data ||
    data.template_id !== "autoreel_import_v1" ||
    data.media_type !== "reel"
  ) {
    notFound();
  }

  // Address line for the header — nice-to-have, fail open to the MLS number.
  let addressLine: string | null = null;
  if (data.mls_number) {
    const { data: prop } = await supabase
      .from("properties")
      .select("address, city")
      .ilike("mls_number", data.mls_number)
      .maybeSingle();
    if (prop) {
      addressLine = [
        (prop as { address: string | null }).address,
        (prop as { city: string | null }).city,
      ]
        .filter(Boolean)
        .join(", ");
    }
  }

  const byPlatform =
    (data.captions_by_platform as Record<
      string,
      { caption?: string; hashtags?: string[] }
    > | null) ?? {};

  const reel: ImportedReelData = {
    gp_id: data.id as string,
    mls_number: (data.mls_number as string | null) ?? "",
    status: data.status as string,
    video_url: (data.video_url as string | null) ?? null,
    cover_url: (data.image_url as string | null) ?? null,
    instagram_caption:
      byPlatform.instagram?.caption ?? (data.caption as string | null) ?? "",
    facebook_caption:
      byPlatform.facebook?.caption ?? (data.caption as string | null) ?? "",
    instagram_hashtags: byPlatform.instagram?.hashtags ??
      ((data.hashtags as string[] | null) ?? []),
    scheduled_for: (data.scheduled_for as Record<string, string> | null) ?? null,
    posted_at: (data.posted_at as string | null) ?? null,
  };

  return (
    <div>
      <PageHeader
        eyebrow={`AutoReel import${reel.mls_number ? ` · #${reel.mls_number}` : ""}`}
        title={addressLine ?? "Review AutoReel video"}
        description="This video was made in AutoReel and imported here. Check the captions, then send it to Facebook + Instagram through the normal publish flow."
      />
      <AutoReelReviewClient reel={reel} />
    </div>
  );
}
