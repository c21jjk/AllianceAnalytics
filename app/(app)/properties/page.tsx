import PageHeader from "@/components/PageHeader";
import EmptyPlaceholder from "@/components/EmptyPlaceholder";

export const metadata = { title: "Properties — Alliance Social" };

export default function PropertiesPage() {
  return (
    <div>
      <PageHeader
        title="Properties"
        description="Listings being marketed. Each property is the linking key between MLS records and the social posts that promote it."
        phaseTag="Coming in Phase 2"
      />
      <EmptyPlaceholder
        title="No properties yet"
        body="MLS sync from Paragon and Bright will populate this list in Phase 2."
      />
    </div>
  );
}
