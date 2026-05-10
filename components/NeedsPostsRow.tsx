import Link from "next/link";
import type { ListingNeedingPosts } from "@/lib/data/listings-needing-posts";
import NeedsPostsCard from "./NeedsPostsCard";

interface NeedsPostsRowProps {
  listings: ListingNeedingPosts[];
  /** Currently active office filter short_code, when one is set. */
  officeShortCode?: string | null;
  className?: string;
}

/**
 * Horizontal "needs Larissa's attention" strip on the dashboard.
 *
 * One card per listing — no digest, no rollup. Each card shows hero image,
 * address, list price, days-since-listed pill, missing-platform chips, MLS#
 * copy chip, and a Dismiss control for "Alliance won't promote this one"
 * (low price point, condition, owner request, etc.).
 *
 * Hides itself entirely when there's nothing to show, so the dashboard
 * doesn't grow a permanent empty section.
 */
export default function NeedsPostsRow({
  listings,
  officeShortCode,
  className,
}: NeedsPostsRowProps) {
  if (listings.length === 0) return null;

  const noun = listings.length === 1 ? "listing" : "listings";
  const scope = officeShortCode ? ` (${officeShortCode})` : "";

  return (
    <section
      className={`rounded-2xl border border-gold-200 bg-gold-50/40 p-4 shadow-card ${className ?? ""}`}
      aria-label="New listings that need posts"
    >
      <header className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">
            New listings — needs Larissa
          </h2>
          <p className="mt-0.5 text-xs text-neutral-600">
            {listings.length} {noun}
            {scope} listed in the last 14 days with at least one platform still
            uncovered. Cards drop off automatically when a hashtagged post auto-links.
          </p>
        </div>
        <Link
          href="/settings/promotions"
          className="shrink-0 text-[11px] font-medium text-neutral-600 hover:text-neutral-900 underline-offset-2 hover:underline"
        >
          Dismissed listings
        </Link>
      </header>

      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <ul className="flex gap-3 min-w-min">
          {listings.map((listing) => (
            <li key={listing.id} className="shrink-0 w-[320px]">
              <NeedsPostsCard listing={listing} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
