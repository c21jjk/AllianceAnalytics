import clsx from "clsx";

interface KpiInlineProps {
  label: string;
  value: string;
  /** Optional secondary line, e.g. "+12.4% vs prior 7 days" */
  delta?: {
    text: string;
    direction: "up" | "down" | "flat";
  };
  className?: string;
}

const DELTA_COLOR: Record<"up" | "down" | "flat", string> = {
  up: "text-emerald-600",
  down: "text-rose-600",
  flat: "text-neutral-500",
};

const DELTA_ARROW: Record<"up" | "down" | "flat", string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

export default function KpiInline({
  label,
  value,
  delta,
  className,
}: KpiInlineProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 bg-white px-4 py-3",
        "hover:border-neutral-300 transition",
        className,
      )}
    >
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tracking-tight text-neutral-900 tabular-nums">
          {value}
        </span>
        {delta ? (
          <span
            className={clsx(
              "text-xs font-medium tabular-nums",
              DELTA_COLOR[delta.direction],
            )}
          >
            {DELTA_ARROW[delta.direction]} {delta.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
