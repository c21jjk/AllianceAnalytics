import Link from "next/link";
import type { RecentStatusFlip } from "@/lib/data/recent-status-flips";
import { formatCurrency, formatRelativeTime } from "@/lib/format";
import OfficeThumbBadge from "./OfficeThumbBadge";

interface Props {
  flips: RecentStatusFlip[];
}

/**
 * Dashboard card surfacing listings that just flipped to pending or sold
 * within the configured window (default 3 days).
 *
 * Phase 6 — closes the loop where a UC or Sold listing today silently
 * appears in the milestone strip but never prompts a celebration post.
 * Each row has a single primary CTA: "Celebrate" deep-links into Post
 * Builder with the listing and the right post type pre-selected.
 *
 * Hides entirely when there are no recent flips, so an inactive week
 * doesn't leave an empty card sitting on the dashboard.
 */
export default function WinsToCelebrateCard({ flips }: Props) {
  if (flips.length === 0) return null;

  const uncelebrated = flips.filter((f) => !f.has_celebration_post);
  // If everything has already been celebrated, the card stays collapsed
  // (still hidden) to keep the dashboard light.
  if (uncelebrated.length === 0) return null;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 via-white to-amber-50/60 ring-1 ring-amber-200 shadow-card p-5 md:p-6">
      <div
        aria-hidden="true"
        className="absolute top-0 left-6 right-6 h-0.5 rounded-full bg-gradient-to-r from-amber-300/0 via-amber-500/70 to-amber-300/0"
      />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
            Wins to celebrate
          </div>
          <h2 className="mt-1 text-xl md:text-2xl font-semibold tracking-tight text-neutral-900">
            {uncelebrated.length}{" "}
            {uncelebrated.length === 1 ? "listing flipped" : "listings flipped"}
            {" "}in the last few days
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Each one is a celebration post waiting to happen. One click to draft.
          </p>
        </div>
      </div>

      <ul className="mt-5 divide-y divide-amber-200/60 rounded-lg ring-1 ring-amber-200/60 bg-white/70 overflow-hidden">
        {uncelebrated.slice(0, 6).map((flip) => (
          <li
            key={flip.property_id}
            className="flex items-center gap-3 px-3 py-2.5"
          >
            <div className="relative w-12 h-12 shrink-0 rounded bg-neutral-100 overflow-hidden">
              {flip.hero_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={flip.hero_image_url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : null}
              <OfficeThumbBadge code={flip.office_short_code} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <StatusPill status={flip.status} />
                <Link
                  href={`/properties/${flip.mls_number}`}
                  className="text-sm font-medium text-neutral-900 hover:text-amber-700 truncate"
                >
                  {flip.address ?? flip.mls_number}
                </Link>
              </div>
              <div className="mt-0.5 text-xs text-neutral-500 truncate">
                {flip.display_price !== null
                  ? formatCurrency(flip.display_price)
                  : null}
                {flip.agent_name ? (
                  <>
                    {flip.display_price !== null ? " · " : null}
                    {flip.agent_name}
                  </>
                ) : null}
                {flip.office_short_code ? (
                  <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-gold-700">
                    · {flip.office_short_code}
                  </span>
                ) : null}
                <span className="ml-2 text-amber-700">
                  {formatRelativeTime(flip.status_changed_at)}
                </span>
              </div>
            </div>
            <Link
              href={`/post-builder?mls=${encodeURIComponent(flip.mls_number)}&postType=${
                flip.status === "sold" ? "just_sold" : "under_contract"
              }`}
              className="shrink-0 inline-flex items-center rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5"
            >
              Celebrate
            </Link>
          </li>
        ))}
      </ul>

      {uncelebrated.length > 6 ? (
        <div className="mt-2 text-xs text-amber-800">
          + {uncelebrated.length - 6} more — see the Under Contract and Recently
          Sold cards below.
        </div>
      ) : null}
    </section>
  );
}

function StatusPill({ status }: { status: "pending" | "sold" }) {
  const isPending = status === "pending";
  return (
    <span
      className={
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
        (isPending
          ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300/70"
          : "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300/70")
      }
    >
      {isPending ? "Under contract" : "Sold"}
    </span>
  );
}
