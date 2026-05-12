import type { ListingMilestone } from "@/lib/data/recently-sold";
import MilestoneListingRow from "./MilestoneListingRow";

interface UnderContractRowProps {
  listings: ListingMilestone[];
  officeShortCode?: string | null;
  className?: string;
}

const EMPTY_BODY = "Nothing under contract right now.";

/**
 * Dashboard card listing currently-pending (under contract) Alliance
 * listings. Lives in the top-right of the milestones grid, beside
 * RecentlyListedRow. Status updates via RETS sync — when Paragon flips a
 * listing from active → pending, it lands here on the next sync.
 *
 * Sorted newest-first by listing_date; no recency cutoff (pending is a
 * current state, not a windowed event). Each row deep-links to the listing
 * detail page.
 */
export default function UnderContractRow({
  listings,
  officeShortCode,
  className,
}: UnderContractRowProps) {
  const noun = listings.length === 1 ? "listing" : "listings";
  const scope = officeShortCode ? ` (${officeShortCode})` : "";

  return (
    <section
      className={`rounded-2xl border border-amber-200/70 bg-amber-50/40 p-4 shadow-card ${className ?? ""}`}
      aria-label="Under contract listings"
    >
      <header>
        <h2 className="text-sm font-semibold text-neutral-900">
          Under Contract
          <span className="text-neutral-400 font-normal">
            {" "}· {listings.length} {noun}{scope}
          </span>
        </h2>
        <p className="mt-0.5 text-xs text-neutral-600">
          {listings.length === 0
            ? "Nothing currently under contract."
            : "Status reflects Paragon RETS. Click a listing to make an Under-Contract post."}
        </p>
      </header>

      <div className="mt-3">
        {listings.length === 0 ? (
          <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
            {EMPTY_BODY}
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {listings.map((listing, idx) => (
              <li key={listing.id}>
                <MilestoneListingRow
                  listing={listing}
                  eyebrowPrefix="Listed"
                  isFirst={idx === 0}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
