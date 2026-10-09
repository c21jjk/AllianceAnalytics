import Link from "next/link";

/**
 * 2026-10-09 (John) — gold "Build Roundup" header CTA for the Recently
 * Listed and Recently Sold cards. Same look as the Under Contract / Price
 * Changes / Open Houses CTAs (multi-house glyph, gold chip, count badge) so
 * "this builds a multi-property post" reads the same everywhere. The single
 * post buttons on each row are untouched; the roundup sits alongside them.
 */
export default function BuildRoundupLink({
  href,
  label,
  count,
}: {
  href: string;
  /** Used in the title + aria-label, e.g. "Just Listed". */
  label: string;
  /** Unposted rows on the card. Badge hidden at 0. */
  count: number;
}) {
  return (
    <Link
      href={href}
      className="shrink-0 inline-flex items-center gap-2 rounded-md border border-gold-300 bg-gold-50 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-gold-800 transition hover:border-gold-500 hover:bg-gold-100"
      title={`Build a ${label} roundup post`}
      aria-label={`Build ${label} roundup${count > 0 ? ` (${count} unposted)` : ""}`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 14h12" />
        <path d="M3 14V9l2-1.5L7 9v5" />
        <path d="M9 14V9l2-1.5L13 9v5" />
      </svg>
      <span className="hidden sm:inline">Build Roundup</span>
      {count > 0 ? (
        <span className="rounded-full bg-gold-200/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-900 tabular-nums">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
