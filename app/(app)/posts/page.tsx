import PageHeader from "@/components/PageHeader";
import EmptyPlaceholder from "@/components/EmptyPlaceholder";

export const metadata = { title: "Posts — Alliance Social" };

export default function PostsPage() {
  return (
    <div>
      <PageHeader
        title="Posts"
        description="Social posts pulled from connected accounts will appear here, with engagement metrics and the property each post is linked to."
        phaseTag="Coming in Phase 3"
      />
      <EmptyPlaceholder
        title="No posts yet"
        body="Once API ingestion is wired up in Phase 2 and Phase 3, your synced posts will land here."
      />
    </div>
  );
}
