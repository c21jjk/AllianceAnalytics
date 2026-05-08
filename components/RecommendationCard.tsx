import clsx from "clsx";
import type {
  Recommendation,
  RecommendationPriority,
  RecommendationKind,
} from "@/lib/types/strategy";
import {
  formatCompactNumber,
  formatCurrency,
  formatPercent,
} from "@/lib/format";
import PlatformBadge from "./PlatformBadge";

interface RecommendationCardProps {
  recommendation: Recommendation;
  propertyAddress?: string;
  className?: string;
}

/**
 * Renders a single Recommendation as a styled card.
 *
 * Displays:
 * - Priority pill (high/medium/low with tinted colors)
 * - Kind icon (boost/reallocate/pause/publish_more/target_change)
 * - "Coming soon" pill
 * - Headline and rationale
 * - Action bullets if present
 * - Footer chips: spend, window, platforms, property
 * - Projection block: reach lift + confidence
 * - Disabled action buttons (Mark done / Snooze / Dismiss)
 */
export default function RecommendationCard({
  recommendation,
  propertyAddress,
  className,
}: RecommendationCardProps) {
  const priorityColors: Record<
    RecommendationPriority,
    { bg: string; ring: string; text: string }
  > = {
    high: {
      bg: "bg-rose-50",
      ring: "ring-rose-200",
      text: "text-rose-700",
    },
    medium: {
      bg: "bg-gold-50",
      ring: "ring-gold-200",
      text: "text-gold-700",
    },
    low: {
      bg: "bg-neutral-100",
      ring: "ring-neutral-200",
      text: "text-neutral-700",
    },
  };

  const priorityMeta = priorityColors[recommendation.priority];

  return (
    <div
      className={clsx(
        "relative rounded-xl border border-neutral-200 bg-white",
        "shadow-card",
        className,
      )}
    >
      <div className="p-5">
        {/* Header row: priority, kind icon, coming soon pill */}
        <div className="flex items-center gap-2 mb-4">
          {/* Priority pill */}
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
              "text-[10px] font-medium uppercase tracking-wider",
              "ring-1",
              priorityMeta.bg,
              priorityMeta.ring,
              priorityMeta.text,
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
            {recommendation.priority} priority
          </span>

          {/* Kind icon */}
          <span className="text-neutral-400" aria-hidden="true">
            <KindIcon kind={recommendation.kind} />
          </span>

          {/* Coming soon pill */}
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/80 ring-1 ring-gold-200 px-2 py-0.5 text-[10px] font-medium text-gold-700">
            <PulseDot />
            Coming soon
          </span>
        </div>

        {/* Headline */}
        <h3 className="text-base font-semibold tracking-tight text-neutral-900 mb-1.5">
          {recommendation.headline}
        </h3>

        {/* Rationale */}
        <p className="text-sm text-neutral-600 leading-relaxed mb-3">
          {recommendation.rationale}
        </p>

        {/* Actions bullets if present */}
        {recommendation.actions && recommendation.actions.length > 0 ? (
          <ul className="mb-4 space-y-1.5">
            {recommendation.actions.map((action, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-neutral-700"
              >
                <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0" />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Footer row: spend, window, platforms, property, projection */}
        <div className="flex flex-col gap-4 pb-4 border-b border-neutral-200">
          {/* Chips row */}
          <div className="flex flex-wrap items-center gap-2">
            {recommendation.spend_usd ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-gold-50 text-gold-800 ring-1 ring-gold-100 px-2 py-0.5 text-xs font-medium">
                <span className="text-gold-600">$</span>
                Suggested spend {formatCurrency(recommendation.spend_usd)}
              </span>
            ) : null}

            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 text-neutral-800 ring-1 ring-neutral-200 px-2 py-0.5 text-xs font-medium">
              <span className="text-neutral-500">📅</span>
              {recommendation.window}
            </span>

            {recommendation.platforms.length > 0 ? (
              <div className="flex items-center gap-1.5 pl-0.5">
                {recommendation.platforms.map((platform) => (
                  <PlatformBadge
                    key={platform}
                    platform={platform}
                    size="sm"
                  />
                ))}
              </div>
            ) : null}

            {recommendation.mls && propertyAddress ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-gold-50 text-gold-800 ring-1 ring-gold-100 px-1.5 py-0.5 text-[11px] font-medium">
                <span className="text-gold-700">🏠</span>
                <span className="font-semibold">{recommendation.mls}</span>
              </span>
            ) : null}
          </div>

          {/* Projection row (right-aligned) */}
          {recommendation.projection && (
            <div className="flex items-center justify-end gap-2 text-xs text-neutral-600">
              {recommendation.projection.reach_lift ? (
                <span>
                  Projected reach lift{" "}
                  <span className="font-semibold text-emerald-600">
                    +{formatCompactNumber(recommendation.projection.reach_lift)}
                  </span>
                </span>
              ) : null}
              {recommendation.projection.confidence ? (
                <span className="flex items-center gap-1">
                  <span>·</span>
                  <span>
                    {formatPercent(recommendation.projection.confidence)} confidence
                  </span>
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Action buttons row */}
        <div className="flex gap-2 justify-end pt-3">
          <button
            disabled
            title="Coming soon"
            className={clsx(
              "rounded-md px-3 py-1.5 text-xs font-medium",
              "border border-neutral-200 bg-white text-neutral-700",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            Mark done
          </button>
          <button
            disabled
            title="Coming soon"
            className={clsx(
              "rounded-md px-3 py-1.5 text-xs font-medium",
              "border border-neutral-200 bg-white text-neutral-700",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            Snooze
          </button>
          <button
            disabled
            title="Coming soon"
            className={clsx(
              "rounded-md px-3 py-1.5 text-xs font-medium",
              "border border-neutral-200 bg-white text-neutral-700",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: RecommendationKind }) {
  const baseClasses = "w-4 h-4";

  switch (kind) {
    case "boost":
      return (
        <svg
          viewBox="0 0 24 24"
          className={baseClasses}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "reallocate":
      return (
        <svg
          viewBox="0 0 24 24"
          className={baseClasses}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 16H4a1 1 0 01-1-1V9a1 1 0 011-1h3M17 8h3a1 1 0 011 1v6a1 1 0 01-1 1h-3M9 9l-2 2m2-2l2 2M15 15l2-2m-2 2l-2-2"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "pause":
      return (
        <svg
          viewBox="0 0 24 24"
          className={baseClasses}
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      );
    case "publish_more":
      return (
        <svg
          viewBox="0 0 24 24"
          className={baseClasses}
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="2"
            stroke="currentColor"
            strokeWidth={1.6}
          />
          <path
            d="M12 8v8m4-4h-8"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </svg>
      );
    case "target_change":
      return (
        <svg
          viewBox="0 0 24 24"
          className={baseClasses}
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.6} />
          <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth={1.6} />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth={1.6} />
        </svg>
      );
  }
}

function PulseDot() {
  return (
    <span className="relative inline-flex w-1.5 h-1.5">
      <span className="absolute inset-0 rounded-full bg-gold-500 animate-ping opacity-60" />
      <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-gold-500" />
    </span>
  );
}
