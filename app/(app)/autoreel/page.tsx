import { requireUser } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import AutoReelEmbed from "@/components/AutoReelEmbed";

export const metadata = { title: "AutoReel — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * /autoreel — AutoReel embedded inside Alliance Social (experiment).
 *
 * Reached from the AccountMenu. See components/AutoReelEmbed.tsx for the
 * embed caveats; the per-listing launch buttons (dashboard rows, property
 * page, Post Builder) are the primary AutoReel entry points either way.
 */
export default async function AutoReelPage() {
  await requireUser();
  return (
    <div>
      <PageHeader
        eyebrow="autoreelapp.com · embedded"
        title="AutoReel"
        description="Create photo-to-video reel projects without leaving Alliance Social. When a video finishes, use the AutoReel button on the listing (or the Post Builder) to import it as a ready-to-publish reel."
      />
      <AutoReelEmbed />
    </div>
  );
}
