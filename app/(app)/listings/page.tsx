import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listListings } from "@/lib/listings";
import {
  formatCurrency,
  formatRelativeTime,
  formatShortDate,
} from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const metadata = { title: "Listings — Alliance Social" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  sold: "Sold",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  sold: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  expired: "bg-rose-50 text-rose-700 ring-rose-200",
  withdrawn: "bg-rose-50 text-rose-700 ring-rose-200",
};

const SOURCE_LABEL: Record<string, string> = {
  cmc: "CMC",
  sjsr: "SJSR",
  bright: "Bright",
  manual: "Manual",
};

export default async function ListingsPage() {
  await requireAdmin();

  let listings: Awaited<ReturnType<typeof listListings>> = [];
  let listingsError: string | null = null;
  try {
    listings = await listListings({ limit: 200 });
  } catch (e) {
    listingsError =
      e instanceof Error ? e.message : "Failed to load active listings";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Listings"
        description="Active listings powering property reports. Manual entry today; MLS feeds replace this in a later phase."
        actions={
          <Link href="/listings/new" className="btn-primary text-sm">
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5 mr-1.5"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              />
            </svg>
            Add listing
          </Link>
        }
      />

      {listingsError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="font-medium">Couldn&apos;t reach the Listings DB.</div>
          <div className="mt-1 text-rose-700">{listingsError}</div>
          <div className="mt-2 text-xs text-rose-600">
            Set <code>LISTINGS_SUPABASE_URL</code> and{" "}
            <code>LISTINGS_SUPABASE_SERVICE_ROLE_KEY</code> in Vercel.
          </div>
        </div>
      ) : null}

      {!listingsError && listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-10 text-center">
          <div className="text-sm font-medium text-neutral-900">
            No listings yet
          </div>
          <p className="mt-1 text-sm text-neutral-500 max-w-md mx-auto">
            Add your first active listing — agents can then link their posts to
            it on the post detail page, and seller reports will start populating.
          </p>
          <div className="mt-4">
            <Link href="/listings/new" className="btn-primary text-sm">
              Add a listing
            </Link>
          </div>
        </div>
      ) : null}

      {listings.length > 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Listing</th>
                <th className="text-left font-medium px-4 py-2.5">MLS #</th>
                <th className="text-left font-medium px-4 py-2.5">Source</th>
                <th className="text-right font-medium px-4 py-2.5">Price</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
                <th className="text-left font-medium px-4 py-2.5">Listed</th>
                <th className="text-left font-medium px-4 py-2.5">Synced</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {listings.map((l) => (
                <tr key={l.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-12 h-12 flex-shrink-0 rounded-md bg-neutral-100 overflow-hidden ring-1 ring-neutral-200">
                        {l.hero_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={l.hero_image_url}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-neutral-300">
                            <svg
                              viewBox="0 0 24 24"
                              className="w-5 h-5"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1v-9z"
                                stroke="currentColor"
                                strokeWidth={1.5}
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-neutral-900 truncate">
                          {l.address}
                        </div>
                        <div className="text-xs text-neutral-500 truncate">
                          {[l.city, l.state, l.zip].filter(Boolean).join(", ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                    {l.mls_number}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-600">
                    {SOURCE_LABEL[l.source_mls] ?? l.source_mls}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-800">
                    {l.list_price ? formatCurrency(Number(l.list_price)) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[11px] font-medium " +
                        (STATUS_TONE[l.status] ??
                          "bg-neutral-50 text-neutral-700 ring-neutral-200")
                      }
                    >
                      {STATUS_LABEL[l.status] ?? l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-600">
                    {l.listing_date ? formatShortDate(l.listing_date) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    {formatRelativeTime(l.synced_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/listings/${encodeURIComponent(l.mls_number)}/edit`}
                      className="text-xs font-medium text-gold-700 hover:text-gold-800"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
