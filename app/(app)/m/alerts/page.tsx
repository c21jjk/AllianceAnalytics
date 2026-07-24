import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import PushSubscribeCard from "@/components/PushSubscribeCard";
import { CheckCircle2, TrendingUp, XCircle, Bell } from "lucide-react";

export const metadata = { title: "Alerts — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Mobile Alerts — the in-app feed behind the push notifications.
 *
 * Reads the caller's `notifications` rows (written by lib/push/send.ts
 * whenever a publish result or performance alert fires), newest first.
 * Everything shown is marked read — the feed is the read receipt.
 * The push opt-in card sits on top so this page doubles as the place to
 * enable notifications on a freshly installed PWA.
 */

interface NotificationRow {
  id: string;
  title: string;
  message: string | null;
  type: string;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

function iconFor(type: string) {
  switch (type) {
    case "publish_result":
      return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />;
    case "publish_failure":
      return <XCircle className="h-5 w-5 shrink-0 text-red-500" />;
    case "performance":
      return <TrendingUp className="h-5 w-5 shrink-0 text-gold-600" />;
    default:
      return <Bell className="h-5 w-5 shrink-0 text-neutral-400" />;
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export default async function MobileAlertsPage() {
  const profile = await requireUser();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, message, type, metadata, is_read, created_at")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows: NotificationRow[] = error
    ? []
    : ((data ?? []) as unknown as NotificationRow[]);

  // Viewing the feed IS the read receipt — mark the unread ones read,
  // best-effort (a failure here just means they stay bold next visit).
  const unreadIds = rows.filter((r) => !r.is_read).map((r) => r.id);
  if (unreadIds.length > 0) {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", unreadIds);
  }

  return (
    <div className="mx-auto max-w-md pb-10">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900">Alerts</h1>

      <PushSubscribeCard />

      <div className="mt-5">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center">
            <Bell className="mx-auto mb-2 h-6 w-6 text-neutral-300" />
            <p className="text-sm text-neutral-600">
              Nothing yet. When a post goes live — or takes off — you&rsquo;ll
              see it here (and on your lock screen once notifications are on).
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const url =
                row.metadata &&
                typeof row.metadata === "object" &&
                typeof row.metadata.url === "string"
                  ? row.metadata.url
                  : null;
              const body = (
                <div className="flex gap-3 rounded-2xl border border-neutral-200 bg-white p-3.5">
                  {iconFor(row.type)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p
                        className={
                          row.is_read
                            ? "truncate text-sm font-medium text-neutral-800"
                            : "truncate text-sm font-semibold text-neutral-900"
                        }
                      >
                        {row.title}
                      </p>
                      <span className="shrink-0 text-[11px] text-neutral-400">
                        {timeAgo(row.created_at)}
                      </span>
                    </div>
                    {row.message ? (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                        {row.message}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
              return (
                <li key={row.id}>
                  {url ? (
                    url.startsWith("/") ? (
                      <Link href={url} className="block active:opacity-80">
                        {body}
                      </Link>
                    ) : (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block active:opacity-80"
                      >
                        {body}
                      </a>
                    )
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
