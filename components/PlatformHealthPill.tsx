import clsx from "clsx";
import type { AccountHealth } from "@/lib/types/post";
import { formatRelativeTime } from "@/lib/format";
import PlatformBadge, { platformLabel } from "./PlatformBadge";

interface PlatformHealthPillProps {
  health: AccountHealth;
  className?: string;
}

const STATUS_DOT: Record<AccountHealth["status"], string> = {
  connected: "bg-emerald-500",
  needs_attention: "bg-amber-500",
  disconnected: "bg-rose-500",
};

const STATUS_LABEL: Record<AccountHealth["status"], string> = {
  connected: "Connected",
  needs_attention: "Needs attention",
  disconnected: "Disconnected",
};

export default function PlatformHealthPill({
  health,
  className,
}: PlatformHealthPillProps) {
  const synced = formatRelativeTime(health.last_synced_at);
  const tooltip = `${platformLabel(health.platform)} · ${
    STATUS_LABEL[health.status]
  } · last synced ${synced}`;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full bg-white pl-1 pr-2.5 py-1",
        "ring-1 ring-neutral-200 text-xs font-medium text-neutral-700",
        "hover:ring-neutral-300 transition",
        className,
      )}
      title={tooltip}
    >
      <PlatformBadge platform={health.platform} size="sm" />
      <span
        className={clsx(
          "w-1.5 h-1.5 rounded-full",
          STATUS_DOT[health.status],
        )}
        aria-hidden="true"
      />
      <span className="text-neutral-500">{synced}</span>
    </span>
  );
}
