import { requireAdmin } from "@/lib/auth";
import DetailDrawer from "@/components/DetailDrawer";
import PropertyForm from "@/components/PropertyForm";
import { createListingAction } from "@/app/(app)/listings/actions";

/**
 * Intercepted "Add property" — opens as a right-side drawer on top of
 * /properties when admin clicks "+ Add property". On hard navigation the
 * standalone page at `app/(app)/properties/new/page.tsx` renders instead.
 */
export default async function InterceptedNewPropertyPage() {
  await requireAdmin();
  return (
    <DetailDrawer
      title="Add property"
      fullPagePath="/properties/new"
      fallbackPath="/properties"
    >
      <div className="px-5 py-5">
        <PropertyForm mode="create" action={createListingAction} />
      </div>
    </DetailDrawer>
  );
}
