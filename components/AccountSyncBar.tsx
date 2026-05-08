import type { AccountHealth } from "@/lib/types/post";
import PlatformHealthPill from "./PlatformHealthPill";

interface AccountSyncBarProps {
  health: AccountHealth[];
  className?: string;
}

export default function AccountSyncBar({
  health,
  className,
}: AccountSyncBarProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
          Sync
        </span>
        {health.map((h) => (
          <PlatformHealthPill key={h.platform} health={h} />
        ))}
      </div>
    </div>
  );
}
