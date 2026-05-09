import clsx from "clsx";
import type { AiInsight } from "@/lib/types/group";

interface AiInsightStripProps {
  insight?: AiInsight;
  className?: string;
}

/**
 * Compact AI insight bar shown at the bottom of a GroupCard.
 *
 * Three render modes:
 *   - undefined or tone="quiet" → single muted gray line ("Tracking normal")
 *   - tone="info" → blue tinted strip with sparkle icon + headline + body + CTA
 *   - tone="success" → green tinted strip with sparkle icon + headline + body + CTA
 */
export default function AiInsightStrip({
  insight,
  className,
}: AiInsightStripProps) {
  if (!insight || insight.tone === "quiet") {
    const body = insight?.body ?? "Tracking normal.";
    return (
      <div
        className={clsx(
          "flex items-center gap-2 text-xs text-neutral-500",
          className,
        )}
      >
        <SparkleIcon className="text-neutral-400" />
        <span>{body}</span>
      </div>
    );
  }

  const tonedClasses =
    insight.tone === "success"
      ? "bg-green-50 ring-green-100 text-green-900"
      : "bg-blue-50 ring-blue-100 text-blue-900";
  const iconColor =
    insight.tone === "success" ? "text-green-700" : "text-blue-700";
  const linkColor =
    insight.tone === "success"
      ? "text-green-800 hover:text-green-900"
      : "text-blue-800 hover:text-blue-900";

  return (
    <div
      className={clsx(
        "flex items-start gap-2 rounded-lg ring-1 px-3 py-2 text-xs",
        tonedClasses,
        className,
      )}
    >
      <SparkleIcon className={clsx("mt-0.5 shrink-0", iconColor)} />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">{insight.headline}</span>{" "}
        <span className="text-neutral-700">{insight.body}</span>
      </div>
      {insight.action_label ? (
        <a
          href={insight.action_href ?? "#"}
          className={clsx(
            "shrink-0 inline-flex items-center gap-0.5 font-medium",
            linkColor,
          )}
        >
          {insight.action_label}
          <ArrowUpRight />
        </a>
      ) : null}
    </div>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={clsx("w-4 h-4", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path
        d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8L16.5 17.5l1.8-.7L19 15z"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowUpRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 17L17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
