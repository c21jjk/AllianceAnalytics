import Link from "next/link";
import clsx from "clsx";
import type { Recommendation } from "@/lib/types/strategy";
import { formatCompactNumber, formatCurrency, formatPercent } from "@/lib/format";

interface StrategySnapshotCardProps {
  recommendation: Recommendation;
  className?: string;
}

/**
 * Compact dashboard tile surfacing the top recommendation with a CTA to /coach.
 *
 * Uses the same gold-tinted gradient treatment as AiInsightCard.
 * Renders: header, headline, rationale snippet, spend + lift, and "See all →" link.
 */
export default function StrategySnapshotCard({
  recommendation,
  className,
}: StrategySnapshotCardProps) {
  const projectionSummary = recommendation.projection ? (
    <span className="text-xs text-neutral-500">
      {recommendation.projection.reach_lift ? (
        <>
          Projected reach lift{" "}
          <span className="font-semibold text-emerald-600">
            +{formatCompactNumber(recommendation.projection.reach_lift)}
          </span>
        </>
      ) : (
        "Projected impact pending"
      )}
    </span>
  ) : null;

  return (
    <div
      className={clsx(
        "relative rounded-xl border border-gold-200 overflow-hidden",
        "bg-gradient-to-br from-gold-50 via-white to-white",
        "shadow-card",
        className,
      )}
    >
      {/* Decorative corner glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gold-200/40 blur-3xl"
      />

      <div className="relative p-5">
        {/* Header row: label + coming soon pill */}
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-lg bg-white text-gold-700 ring-1 ring-gold-200">
            <SparkleIcon />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-gold-700">
            Coach snapshot
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/80 ring-1 ring-gold-200 px-2 py-0.5 text-[10px] font-medium text-gold-700">
            <PulseDot />
            Coming soon
          </span>
        </div>

        {/* Headline */}
        <h3 className="text-base font-semibold tracking-tight text-neutral-900 mb-1.5">
          Your top move this week
        </h3>

        {/* Rationale (1–2 sentences) */}
        <p className="text-sm text-neutral-600 leading-relaxed mb-4">
          {recommendation.rationale}
        </p>

        {/* Footer row: spend + projection + CTA */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {recommendation.spend_usd ? (
              <span className="text-xs font-medium text-neutral-600">
                Suggested spend{" "}
                <span className="font-semibold text-neutral-900">
                  {formatCurrency(recommendation.spend_usd)}
                </span>
              </span>
            ) : null}
            {projectionSummary}
          </div>

          {/* "See all →" link */}
          <Link
            href="/coach"
            className={clsx(
              "shrink-0 text-sm font-medium text-gold-700",
              "hover:text-gold-800 transition-colors",
              "underline underline-offset-2",
            )}
          >
            See all →
          </Link>
        </div>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
      <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" />
      <path
        d="M19 14l.7 1.8L21 16l-1.3.6L19 18l-.7-1.4L17 16l1.3-.5L19 14z"
        opacity="0.6"
      />
    </svg>
  );
}

function PulseDot() {
  return (
    <span className="relative inline-flex w-1.5 h-1.5">
      <span className="absolute inset-0 rounded-full bg-gold-500 animate-ping opacity-60" />
      <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-gold-500" />
    </span>
  );
}
