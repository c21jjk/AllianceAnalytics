import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getListingByMls } from "@/lib/listings";
import DetailDrawer from "@/components/DetailDrawer";
import PropertyForm from "@/components/PropertyForm";
import { updateListingAction } from "@/app/(app)/listings/actions";

interface PageProps {
  params: Promise<{ mls: string }>;
}

/**
 * Intercepted "Edit property" — opens as a right-side drawer on top of
 * /properties when admin clicks Edit. On hard navigation the standalone
 * page at `app/(app)/properties/[mls]/edit/page.tsx` renders instead.
 */
export default async function InterceptedEditPropertyPage({ params }: PageProps) {
  await requireAdmin();
  const { mls } = await params;
  const decoded = decodeURIComponent(mls);
  const listing = await getListingByMls(decoded);
  if (!listing) notFound();

  const boundUpdate = updateListingAction.bind(null, decoded);

  return (
    <DetailDrawer
      title={`Edit ${decoded}`}
      subtitle={listing.address ?? undefined}
      fullPagePath={`/properties/${encodeURIComponent(decoded)}/edit`}
      fallbackPath="/properties"
    >
      <div className="px-5 py-5">
        <PropertyForm mode="edit" initial={listing} action={boundUpdate} />
      </div>
    </DetailDrawer>
  );
}
