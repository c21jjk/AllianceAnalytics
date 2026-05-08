import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ListingForm from "../ListingForm";
import { createListingAction } from "../actions";

export const metadata = { title: "New listing — Alliance Social" };

export default async function NewListingPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/listings" className="hover:text-neutral-800">
          Listings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">New</span>
      </div>

      <PageHeader
        title="Add a listing"
        description="Manually enter an active listing. The hero photo URL is used as the seller report cover. RETS feeds will replace this in a later phase."
      />

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <ListingForm mode="create" action={createListingAction} />
      </div>
    </div>
  );
}
