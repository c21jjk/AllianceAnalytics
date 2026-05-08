import clsx from "clsx";

interface MetricCellProps {
  label: string;
  value: string;
  /** Optional small icon to the left */
  icon?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}

export default function MetricCell({
  label,
  value,
  icon,
  align = "left",
  className,
}: MetricCellProps) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-0.5 min-w-0",
        align === "right" && "items-end text-right",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {icon ? (
          <span className="text-neutral-400" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span>{label}</span>
      </div>
      <div className="text-sm font-semibold tabular-nums text-neutral-900 truncate">
        {value}
      </div>
    </div>
  );
}
