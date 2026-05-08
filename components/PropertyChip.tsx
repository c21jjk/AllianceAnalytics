import clsx from "clsx";
import type { PropertyRef } from "@/lib/types/post";
import { formatCurrency } from "@/lib/format";

interface PropertyChipProps {
  property: PropertyRef;
  variant?: "compact" | "full";
  className?: string;
}

export default function PropertyChip({
  property,
  variant = "compact",
  className,
}: PropertyChipProps) {
  if (variant === "full") {
    return (
      <div
        className={clsx(
          "rounded-xl border border-neutral-200 bg-white px-4 py-3",
          className,
        )}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wide">
          <HouseIcon />
          MLS {property.mls}
        </div>
        <div className="mt-1 text-sm font-medium text-neutral-900">
          {property.address}
        </div>
        {property.list_price ? (
          <div className="mt-0.5 text-sm text-gold-700 font-semibold tabular-nums">
            {formatCurrency(property.list_price)}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md bg-gold-50 text-gold-800",
        "ring-1 ring-gold-100 pl-1.5 pr-2 py-0.5 text-[11px] font-medium",
        className,
      )}
      title={`${property.mls} · ${property.address}`}
    >
      <HouseIcon className="text-gold-700" />
      <span className="font-semibold">{property.mls}</span>
      <span className="text-gold-700/80 truncate max-w-[180px]">
        {property.address}
      </span>
    </span>
  );
}

function HouseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={clsx("w-3 h-3", className)}
      aria-hidden="true"
    >
      <path
        d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1v-9z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}
