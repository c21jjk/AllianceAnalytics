import type { ListingMilestone } from "@/lib/data/recently-sold";
import MilestoneListingRow from "./MilestoneListingRow";

interface RecentlySoldRowProps {
  listings: ListingMilestone[];
  /** Window in days the parent fetched against. Surfaced in the header copy. */
  windowDays?: number;
  officeShortCode?: string | null;
  className?: string;
}

/**
 * Dashboard card listing recently-settled Alliance properties. Lives in the
 * bottom-right of the milestones grid, beside RecentlyListedRow.
 *
 * Each row shows the sold price (NOT list price) and the close date. Deep-
 * links to the listing detail. Larissa uses this surface to decide which
 * sold listings deserve a "Just Sold" celebration post.
 *
 * Window is configurable via the parent's getRecentlySoldListings call,
 * defaults to 30 days.
 */
export default function RecentlySoldRow({
  listings,
  windowDays = 30,
  officeShortCode,
  className,
}: RecentlySoldRowProps) {
  const noun = listings.length === 1 ? "listing" : "listings";
  const scope = officeShortCode ? ` (${officeShortCode})` : "";

  return (
    <section
      className={`rounded-2xl border border-emerald-200/70 bg-emerald-50/30 p-4 shadow-card ${className ?? ""}`}
      aria-label="Recently sold listings"
    >
      <header>
        <h2 className="text-sm font-semibold text-neutral-900">
          Recently Sold
          <span className="text-neutral-400 font-normal">
            {" "}· last {windowDays} days · {listings.length} {noun}{scope}
          </span>
        </h2>
        <p className="mt-0.5 text-xs text-neutral-600">
          {listings.length === 0
            ? "Nothing settled in the last " + windowDays + " days."
            : "Click any listing to make a Just-Sold post. Price shown is the settled price."}
        </p>
      </header>

      <div className="mt-3">
        {listings.length === 0 ? (
          <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
            No settlements in the last {windowDays} days.
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {listings.map((listing, idx) => (
              <li key={listing.id}>
                <MilestoneListingRow
                  listing={listing}
                  eyebrowPrefix="Sold"
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
