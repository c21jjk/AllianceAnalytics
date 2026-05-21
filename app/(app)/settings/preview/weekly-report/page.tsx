import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { loadWeeklySocialReportData } from "@/lib/email/reports/weekly-social-data";
import { generateWeeklyTakeaway } from "@/lib/email/reports/weekly-social-ai-takeaway";
import { renderWeeklySocialEmail } from "@/lib/email/reports/weekly-social-template";
import { getWeeklySocialReportRecipientEmails } from "@/lib/data/email-subscribers";

export const metadata = {
  title: "Weekly report preview — Alliance Social",
};
export const dynamic = "force-dynamic";

/**
 * /settings/preview/weekly-report
 *
 * Admin in-browser preview of the weekly social media report email body.
 * Re-runs the same data fetch + Claude takeaway + template renderer that
 * the Monday cron uses, then iframes the resulting HTML so John can
 * eyeball the email without firing a send to his inbox.
 *
 * Honest disclaimer: the data window is the most-recently-completed
 * Mon→Sun in America/New_York. Mid-week previews still show that prior
 * week's data — they don't change just because someone refreshes mid-week.
 */
export default async function WeeklyReportPreviewPage() {
  await requireAdmin();

  const [data, recipientEmails] = await Promise.all([
    loadWeeklySocialReportData(new Date()),
    getWeeklySocialReportRecipientEmails(),
  ]);
  const aiTakeaway = await generateWeeklyTakeaway(data);
  const { subject, html } = renderWeeklySocialEmail(data, aiTakeaway);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly social media report — preview"
        description="The exact email that would be sent if the Monday cron fired right now."
      />

      <div className="text-sm text-neutral-600">
        <Link href="/settings" className="text-neutral-500 hover:text-gold-700">
          ← Back to Settings
        </Link>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Subject
          </div>
          <div className="mt-1 text-neutral-800 font-medium">{subject}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Recipients (cron)
          </div>
          <div className="mt-1 text-neutral-800 font-medium text-lg">
            {recipientEmails.length}
          </div>
          <div className="text-[11px] text-neutral-500">
            subscribers opted into the weekly report
          </div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[10px] text-neutral-500 font-semibold">
            Window
          </div>
          <div className="mt-1 text-neutral-800 font-medium">
            {data.weekStartLabel}–{data.weekEndLabel}
          </div>
          <div className="text-[11px] text-neutral-500">
            most-recent completed Mon&ndash;Sun (ET)
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
        <div className="bg-neutral-50 border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">
          Email body
        </div>
        <iframe
          srcDoc={html}
          title="Weekly social report preview"
          sandbox="allow-same-origin"
          className="w-full"
          style={{ minHeight: 1200, border: "none" }}
        />
      </div>
    </div>
  );
}
