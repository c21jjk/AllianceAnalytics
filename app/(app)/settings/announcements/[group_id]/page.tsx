import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSingleCandidate } from "@/lib/email/reports/office-post-announcement-data";
import { renderOfficePostAnnouncement } from "@/lib/email/reports/office-post-announcement-template";
// Disable the no-restricted-syntax rule for the iframe srcDoc usage below —
// we trust the rendered HTML since it comes from our own template.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ group_id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { group_id } = await params;
  return {
    title: `Announcement ${group_id.slice(0, 8)} — Alliance Social`,
  };
}

/**
 * /settings/announcements/[group_id]
 *
 * Renders the exact same HTML email that went out to agents for this group.
 * Re-runs the data resolver in non-fresh mode and matches by group_id, then
 * passes the candidate through the same template renderer the cron uses —
 * so what shows here is byte-equivalent to the inbox view.
 *
 * Read-only. Includes a small metadata header (audience, recipient count,
 * sent timestamp) above the rendered HTML body in an iframe.
 */
export default async function AnnouncementDetailPage({ params }: PageProps) {
  await requireAdmin();
  const { group_id } = await params;

  const supabase = createAdminClient();

  // Pull the announcement row itself (audience, recipient count, sent_at).
  const { data: announcement } = await supabase
    .from("office_post_announcements")
    .select("group_id, audience_scope, recipient_count, sent_at, last_error")
    .eq("group_id", group_id)
    .maybeSingle();

  // Re-resolve the candidate (ignores the "already announced" filter so we
  // can re-render the email body even after the row was recorded).
  const candidate = await resolveSingleCandidate(group_id);
  if (!candidate) notFound();

  const rendered = renderOfficePostAnnouncement(candidate);

  return (
    <div className="space-y-6">
      <PageHeader
        title={rendered.subject}
        description="The exact email body that landed in subscribers' inboxes."
      />

      <div className="text-sm text-neutral-600">
        <Link
          href="/settings/announcements"
          className="text-neutral-500 hover:text-gold-700"
        >
          ← Back to Announcements
        </Link>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Audience
          </div>
          <div className="mt-1 text-neutral-800 font-medium">
            {candidate.audience.label}
          </div>
          <div className="text-[11px] text-neutral-500 font-mono">
            {announcement?.audience_scope ?? candidate.audience.scope_raw}
          </div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Recipients
          </div>
          <div className="mt-1 text-neutral-800 font-medium text-lg">
            {announcement?.recipient_count ??
              candidate.recipient_emails.length}
          </div>
          <div className="text-[11px] text-neutral-500">
            {announcement
              ? "delivered"
              : `${candidate.recipient_emails.length} would receive (preview)`}
          </div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            {announcement ? "Sent" : "Status"}
          </div>
          <div className="mt-1 text-neutral-800 font-medium">
            {announcement
              ? formatSentLabel(announcement.sent_at)
              : "Not yet announced"}
          </div>
          {announcement?.last_error ? (
            <div className="text-[11px] text-red-700 mt-1">
              ✗ {announcement.last_error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
        <div className="bg-neutral-50 border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">
          Email preview
        </div>
        <iframe
          srcDoc={rendered.html}
          title="Sent email body"
          sandbox="allow-same-origin"
          className="w-full"
          style={{ minHeight: 720, border: "none" }}
        />
      </div>
    </div>
  );
}

function formatSentLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

