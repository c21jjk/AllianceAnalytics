import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getListingByMls } from "@/lib/listings";
import PageHeader from "@/components/PageHeader";
import PropertyForm from "@/components/PropertyForm";
import { updateListingAction } from "@/app/(app)/listings/actions";

interface PageProps {
  params: Promise<{ mls: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { mls } = await params;
  return { title: `Edit ${mls} — Alliance Social` };
}

/**
 * Standalone full-page version of property edit. Hit directly via URL or
 * via the "View full page ↗" link inside the drawer. Soft navigation from
 * inside the (app) shell renders the drawer
 * (`@modal/(.)properties/[mls]/edit`) instead.
 */
export default async function EditPropertyPage({ params }: PageProps) {
  await requireAdmin();
  const { mls } = await params;
  const decoded = decodeURIComponent(mls);
  const listing = await getListingByMls(decoded);
  if (!listing) notFound();

  const boundUpdate = updateListingAction.bind(null, decoded);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/properties" className="hover:text-neutral-800">
          Listings
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/properties/${encodeURIComponent(decoded)}`}
          className="hover:text-neutral-800 font-mono"
        >
          {decoded}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Edit</span>
      </div>

      <PageHeader
        title={`Edit ${decoded}`}
        description="Update price, status, hero photo, or agent attribution. Changes are replicated into the analytics properties row on save."
      />

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <PropertyForm mode="edit" initial={listing} action={boundUpdate} />
      </div>
    </div>
  );
}
