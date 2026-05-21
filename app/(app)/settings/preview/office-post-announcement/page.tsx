import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { findEligibleAnnouncements } from "@/lib/email/reports/office-post-announcement-data";
import { renderOfficePostAnnouncement } from "@/lib/email/reports/office-post-announcement-template";

export const metadata = {
  title: "Office post announcement preview — Alliance Social",
};
export const dynamic = "force-dynamic";

/**
 * /settings/preview/office-post-announcement
 *
 * Admin in-browser preview of the office post announcement email. Picks
 * the first eligible candidate (category='property' + office or division
 * audience) and re-renders its email body so John can see what tomorrow's
 * cron would send.
 *
 * Falls back to a friendly empty state when nothing is currently
 * eligible — Larissa hasn't tagged a property post recently, or all the
 * eligible groups have already been announced.
 */
export default async function OfficePostAnnouncementPreviewPage() {
  await requireAdmin();

  // freshOnly=false so the preview works even when there's no
  // brand-new tagged post in the last 30 hours.
  const candidates = await findEligibleAnnouncements({ freshOnly: false });
  const candidate = candidates[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Office post announcement — preview"
        description="The exact email the daily 8 AM cron would send for the next eligible Property Promotion campaign."
      />

      <div className="text-sm text-neutral-600">
        <Link href="/settings" className="text-neutral-500 hover:text-gold-700">
          ← Back to Settings
        </Link>
      </div>

      {!candidate ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <p className="text-sm font-medium text-neutral-700">
            No eligible candidate right now.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            For a campaign to qualify it must have{" "}
            <strong className="text-neutral-700">category = Property Promotion</strong>{" "}
            and{" "}
            <strong className="text-neutral-700">
              audience set to an office or division
            </strong>
            . As soon as Larissa tags one, you&apos;ll see the preview here.
          </p>
        </div>
      ) : (
        <OfficeAnnouncementPreviewBody candidate={candidate} />
      )}
    </div>
  );
}

function OfficeAnnouncementPreviewBody({
  candidate,
}: {
  candidate: Awaited<ReturnType<typeof findEligibleAnnouncements>>[number];
}) {
  const { subject, html } = renderOfficePostAnnouncement(candidate);
  const listing =
    [candidate.listing.address, candidate.listing.city]
      .filter(Boolean)
      .join(", ") || "—";

  return (
    <>
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Subject
          </div>
          <div className="mt-1 text-neutral-800 font-medium">{subject}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Audience
          </div>
          <div className="mt-1 text-neutral-800 font-medium">
            {candidate.audience.label}
          </div>
          <div className="text-[11px] text-neutral-500 font-mono">
            {candidate.audience.scope_raw}
          </div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Recipients
          </div>
          <div className="mt-1 text-neutral-800 font-medium text-lg">
            {candidate.recipient_emails.length}
          </div>
          <div className="text-[11px] text-neutral-500">
            would receive on the next cron tick
          </div>
        </div>
        <div className="sm:col-span-3">
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Listing
          </div>
          <div className="mt-1 text-neutral-800 font-medium">{listing}</div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
        <div className="bg-neutral-50 border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">
          Email body
        </div>
        <iframe
          srcDoc={html}
          title="Office post announcement preview"
          sandbox="allow-same-origin"
          className="w-full"
          style={{ minHeight: 900, border: "none" }}
        />
      </div>
    </>
  );
}
