/**
 * Office short_code strip overlaid on the bottom edge of a property
 * thumbnail. Extracted from NeedsPostsCard's office badge so every
 * dashboard section (Recently Listed, Wins to Celebrate, Open Houses,
 * Under Contract, Recently Sold) renders office attribution identically.
 *
 * Parent element must be `position: relative` with overflow hidden.
 * Renders nothing when no office is resolved on the row.
 */
export default function OfficeThumbBadge({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <span className="absolute bottom-0 left-0 right-0 bg-neutral-900/80 text-[8px] font-semibold uppercase tracking-wide text-white text-center leading-tight py-0.5">
      {code}
    </span>
  );
}
