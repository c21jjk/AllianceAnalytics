import PageHeader from "@/components/PageHeader";
import EmptyPlaceholder from "@/components/EmptyPlaceholder";

export const metadata = { title: "Reports — Alliance Social" };

export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Reports"
        description="Per-property performance reports for agents and sellers. Generated from the post and property data, with auto-send and locking once finalized."
        phaseTag="Coming in Phase 5"
      />
      <EmptyPlaceholder
        title="No reports yet"
        body="Report generation, the public token URL, and auto-send all come online in Phase 5."
      />
    </div>
  );
}
