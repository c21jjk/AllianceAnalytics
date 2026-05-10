import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import PropertyForm from "@/components/PropertyForm";
import { createListingAction } from "@/app/(app)/listings/actions";

export const metadata = { title: "Add property — Alliance Social" };

/**
 * Standalone full-page version of "Add property". Hit directly via URL or
 * via the "View full page ↗" link inside the drawer. Soft navigation from
 * inside the (app) shell renders the drawer (`@modal/(.)properties/new`)
 * instead.
 */
export default async function NewPropertyPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/properties" className="hover:text-neutral-800">
          Properties
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Add</span>
      </div>

      <PageHeader
        title="Add a property"
        description="Manual entry — for properties that aren't in the MLS feeds yet, or one-off pocket listings. CMC, SJSR, and Bright listings auto-populate via RETS sync."
      />

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <PropertyForm mode="create" action={createListingAction} />
      </div>
    </div>
  );
}
