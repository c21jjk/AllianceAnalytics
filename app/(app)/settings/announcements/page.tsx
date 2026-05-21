import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { listRecentAnnouncements } from "@/lib/data/office-post-announcements";

export const metadata = { title: "Announcements sent — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * /settings/announcements — admin history view for the office post
 * announcement blasts. Lists the most recent 30 sends with audience,
 * listing, recipient count, and a "View email" link that re-renders the
 * exact HTML that landed in agents' inboxes.
 *
 * Read-only. No delete / no resend actions — the announcements table is
 * the idempotency record, so altering it would risk re-sending.
 */
export default async function AnnouncementsHistoryPage() {
  await requireAdmin();
  const rows = await listRecentAnnouncements({ limit: 30 });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Office post announcements"
        description="Every email blast fired by the daily 8 AM ET office-post-alert cron. Click View email to see exactly what landed in agents' inboxes."
      />

      <div className="text-sm text-neutral-600">
        <Link href="/settings" className="text-neutral-500 hover:text-gold-700">
          ← Back to Settings
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <p className="text-sm font-medium text-neutral-700">
            No announcements have fired yet.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            The cron runs every 15 minutes. As soon as a Property-Promotion
            post with an office or division audience is grouped, the next tick
            will email the roster and log the send here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-[10px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Sent</th>
                  <th className="text-left px-4 py-2 font-semibold">
                    Audience
                  </th>
                  <th className="text-left px-4 py-2 font-semibold">Listing</th>
                  <th className="text-right px-2 py-2 font-semibold">
                    Recipients
                  </th>
                  <th className="text-left px-2 py-2 font-semibold">Status</th>
                  <th className="text-right px-3 py-2 font-semibold sr-only">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => {
                  const listing =
                    [r.listing_address, r.listing_city]
                      .filter(Boolean)
                      .join(", ") || "—";
                  return (
                    <tr key={r.group_id}>
                      <td className="px-4 py-2 text-neutral-700 whitespace-nowrap">
                        {formatSentLabel(r.sent_at)}
                      </td>
                      <td className="px-4 py-2 text-neutral-700">
                        {r.audience_label ?? r.audience_scope}
                      </td>
                      <td className="px-4 py-2 text-neutral-700">{listing}</td>
                      <td className="text-right px-2 py-2 font-medium text-neutral-900">
                        {r.recipient_count}
                      </td>
                      <td className="px-2 py-2">
                        {r.last_error ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-[10px] font-medium border border-red-100"
                            title={r.last_error}
                          >
                            ✗ Errors
                          </span>
                        ) : r.recipient_count > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-medium border border-emerald-100">
                            ✓ Sent
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/settings/announcements/${r.group_id}`}
                          className="text-[11px] text-gold-700 hover:text-gold-800 whitespace-nowrap"
                        >
                          View email →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSentLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
