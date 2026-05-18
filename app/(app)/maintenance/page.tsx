import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import ThumbnailCacheBackfillCard from "./ThumbnailCacheBackfillCard";
import { getUncachedThumbnailCount } from "./thumbnail-cache-actions";

export const metadata = { title: "Maintenance — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Admin-only Maintenance page — one-off data cleanup tools and migrations.
 * Cards on this page are intentionally surfaced separately from Settings
 * so admins can find them without scrolling past credentials and feeds.
 */
export default async function MaintenancePage() {
  await requireAdmin();

  const uncachedThumbnails = await getUncachedThumbnailCount();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        description="One-off admin tools for data cleanup and migrations."
      />

      <section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ThumbnailCacheBackfillCard initialRemaining={uncachedThumbnails} />
        </div>
      </section>
    </div>
  );
}
