import clsx from "clsx";
import type { DeliveryStatus } from "@/lib/types/report";

interface DeliveryStatusPillProps {
  status: DeliveryStatus;
  viewCount?: number;
  className?: string;
}

/**
 * Small pill rendering delivery status with appropriate color and icon.
 */
export default function DeliveryStatusPill({
  status,
  viewCount = 0,
  className,
}: DeliveryStatusPillProps) {
  const isViewed = status === "viewed" && viewCount > 0;

  const config = {
    viewed: {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      ring: "ring-emerald-200",
      icon: CheckIcon,
    },
    sent: {
      bg: "bg-neutral-100",
      text: "text-neutral-700",
      ring: "ring-neutral-200",
      icon: PaperPlaneIcon,
    },
    pending: {
      bg: "bg-amber-50",
      text: "text-amber-700",
      ring: "ring-amber-200",
      icon: ClockIcon,
    },
  };

  const { bg, text, ring, icon: IconComponent } = config[status];

  return (
    <div className={clsx("inline-flex items-center gap-1", className)}>
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full",
          "px-2 py-0.5 text-[10px] font-medium",
          "ring-1",
          bg,
          text,
          ring,
        )}
      >
        <IconComponent />
        <span className="capitalize">{status}</span>
      </span>

      {isViewed && viewCount > 1 ? (
        <span
          className={clsx(
            "ml-1 text-[10px] font-medium text-emerald-700",
            "bg-emerald-50 px-1.5 py-0.5 rounded-full ring-1 ring-emerald-200",
          )}
        >
          {viewCount}x
        </span>
      ) : null}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor" aria-hidden="true">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}

function PaperPlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 9-18 9V13l12-4-12-4v4z"
        fill="currentColor"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.5} />
      <path
        d="M12 6v6l4 2.4"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
