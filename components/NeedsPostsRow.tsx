import Link from "next/link";
import type { ListingNeedingPosts } from "@/lib/data/listings-needing-posts";
import ListingsFilterChips from "./ListingsFilterChips";
import NeedsPostsCard from "./NeedsPostsCard";

interface NeedsPostsRowProps {
  listings: ListingNeedingPosts[];
  /** Currently active office filter short_code, when one is set. */
  officeShortCode?: string | null;
  /**
   * Active status filter — drives both the heading copy and which chip is
   * highlighted. Defaults to "needs_only" when omitted.
   */
  statusFilter?: "needs_only" | "all";
  className?: string;
}

/**
 * Dashboard "Recent listings (14d)" strip.
 *
 * Each row shows hero thumb, address, price, days, missing-platform chips,
 * MLS# copy chip, and a Status menu (Mark as posted / Dismiss / Reset).
 *
 * Filter chip lets the user toggle between "Needs attention" (default —
 * only listings still requiring action) and "All" (every recent listing
 * with its status banner). The chip rewrites the ?listings= URL param so
 * the server-side fetch happens with the right status_filter value.
 */
export default function NeedsPostsRow({
  listings,
  officeShortCode,
  statusFilter = "needs_only",
  className,
}: NeedsPostsRowProps) {
  // Hide entirely when there's nothing to show in "needs_only" view —
  // dashboard doesn't grow a permanent empty section. In "all" view we
  // always render the chrome so the toggle stays accessible.
  if (statusFilter === "needs_only" && listings.length === 0) return null;

  const noun = listings.length === 1 ? "listing" : "listings";
  const scope = officeShortCode ? ` (${officeShortCode})` : "";

  return (
    <section
      className={`rounded-2xl border border-gold-200 bg-gold-50/40 p-4 shadow-card ${className ?? ""}`}
      aria-label="Recent listings"
    >
      <header className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">
            Recent listings
            <span className="text-neutral-400 font-normal"> · last 14 days{scope}</span>
          </h2>
          <p className="mt-0.5 text-xs text-neutral-600">
            {statusFilter === "needs_only"
              ? `${listings.length} ${noun} still need at least one platform's coverage. Cards drop off automatically when a hashtagged post auto-links.`
              : `${listings.length} recent ${noun}. Banners across the thumbnail show whether each one has been posted, dismissed, or still needs attention.`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ListingsFilterChips current={statusFilter} />
          <Link
            href="/settings/promotions"
            className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
          >
            Dismissed
          </Link>
        </div>
      </header>

      {listings.length === 0 ? (
        <div className="rounded-md bg-white/60 border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
          No recent listings to show.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {listings.map((listing) => (
            <li key={listing.id}>
              <NeedsPostsCard listing={listing} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

