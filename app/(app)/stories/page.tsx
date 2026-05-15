import { requireUser } from "@/lib/auth";
import { fetchOwnerStoryIndex } from "@/lib/data/owner-story-index";
import PageHeader from "@/components/PageHeader";
import OwnerStoryIndexTable from "@/components/OwnerStoryIndexTable";

export const metadata = { title: "Owner Stories — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Owner Stories — top-level surface for the seller-facing /home/[token]
 * pages. Promoted to its own nav slot in Phase 4 because the story is the
 * headline output of the system and needs to be one click from anywhere.
 *
 * The page is intentionally focused: one index table, with search, status
 * filter, sort, and per-row copy/preview. The aggregate analytics (reports
 * sent, view rate, etc.) live on /reports.
 */
export default async function StoriesPage() {
  await requireUser();
  const rows = await fetchOwnerStoryIndex();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Owner Stories"
        description="One link per listing — the seller-facing story page. Copy, preview, or open any campaign in a single click. Tracks views automatically."
      />
      <OwnerStoryIndexTable rows={rows} />
    </div>
  );
}
