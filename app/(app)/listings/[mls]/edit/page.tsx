import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getListingByMls } from "@/lib/listings";
import PageHeader from "@/components/PageHeader";
import ListingForm from "../../ListingForm";
import { updateListingAction } from "../../actions";

interface PageProps {
  params: Promise<{ mls: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { mls } = await params;
  return { title: `Edit ${mls} — Alliance Social` };
}

export default async function EditListingPage({ params }: PageProps) {
  await requireAdmin();
  const { mls } = await params;
  const decoded = decodeURIComponent(mls);
  const listing = await getListingByMls(decoded);
  if (!listing) notFound();

  const boundUpdate = updateListingAction.bind(null, decoded);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/listings" className="hover:text-neutral-800">
          Listings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700 font-mono">{decoded}</span>
      </div>

      <PageHeader
        title={`Edit listing ${decoded}`}
        description="Update price, status, hero photo, or agent attribution. Changes are pushed back into the analytics properties row on save."
      />

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <ListingForm mode="edit" initial={listing} action={boundUpdate} />
      </div>
    </div>
  );
}
