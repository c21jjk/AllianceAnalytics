import Link from "next/link";
import clsx from "clsx";
import type { ReportDelivery } from "@/lib/types/report";
import { formatRelativeTime } from "@/lib/format";
import DeliveryStatusPill from "./DeliveryStatusPill";

interface RecentDeliveriesTableProps {
  deliveries: ReportDelivery[];
  addressByMls: Record<string, string>;
  className?: string;
}

/**
 * Clean table of recent property report deliveries.
 * Renders address, recipient (masked email), sent time, status, and action link.
 */
export default function RecentDeliveriesTable({
  deliveries,
  addressByMls,
  className,
}: RecentDeliveriesTableProps) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden",
        "overflow-x-auto",
        className,
      )}
    >
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50">
          <tr>
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Address
            </th>
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Recipient
            </th>
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Sent
            </th>
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Status
            </th>
            <th className="px-5 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {deliveries.map((delivery) => (
            <tr
              key={delivery.id}
              className="hover:bg-neutral-50/50 transition-colors"
            >
              {/* Address + MLS */}
              <td className="px-5 py-3">
                <div>
                  <div className="text-sm font-medium text-neutral-900">
                    {addressByMls[delivery.mls] || "—"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-neutral-500 muted">
                    MLS {delivery.mls}
                  </div>
                </div>
              </td>

              {/* Recipient (masked email) */}
              <td className="px-5 py-3">
                <span className="text-sm text-neutral-700 font-medium">
                  {maskEmail(delivery.recipient_email)}
                </span>
              </td>

              {/* Sent time */}
              <td className="px-5 py-3">
                <span className="text-sm text-neutral-600">
                  {delivery.sent_at
                    ? formatRelativeTime(delivery.sent_at)
                    : "—"}
                </span>
              </td>

              {/* Status pill */}
              <td className="px-5 py-3">
                <DeliveryStatusPill
                  status={delivery.status}
                  viewCount={delivery.view_count}
                />
              </td>

              {/* Action link */}
              <td className="px-5 py-3">
                <Link
                  href={`/r/${delivery.share_token}`}
                  className={clsx(
                    "text-sm font-medium text-gold-600",
                    "hover:text-gold-700 hover:underline",
                    "transition-colors",
                  )}
                >
                  View report
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Empty state */}
      {deliveries.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-neutral-500">No deliveries yet</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Mask an email address: keep first letter and domain, mask the middle.
 * e.g., "john.doe@gmail.com" → "j****@gmail.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;

  const firstChar = local[0];
  const masked = `${firstChar}${"*".repeat(Math.max(1, local.length - 1))}`;
  return `${masked}@${domain}`;
}
