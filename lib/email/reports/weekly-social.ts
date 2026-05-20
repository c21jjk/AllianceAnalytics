import "server-only";
import { sendEmail, type SendEmailResult } from "@/lib/email/send";
import { loadWeeklySocialReportData } from "./weekly-social-data";
import { renderWeeklySocialEmail } from "./weekly-social-template";

/**
 * Orchestrator for the weekly social media report email.
 *
 * Loads the prior-week analytics, renders the brand-styled HTML + plaintext
 * template, and posts to Resend via the shared sendEmail() helper.
 *
 * Distribution list is the caller's responsibility — for now this is
 * intentionally just a function (not a server endpoint with a hardcoded
 * recipient list) so the same code path can be invoked from:
 *   1. The /settings preview button (sends to John only — design iteration)
 *   2. The "Send to full distribution" admin button (sends to John, Larissa,
 *      Chuck — pre-flight before the cron is enabled)
 *   3. A future Monday-morning Vercel cron
 *
 * Returns the sendEmail result so the caller can show feedback.
 */
export async function sendWeeklySocialReport(opts: {
  to: string[];
  /** Override the "now" used to compute the week window. Defaults to new Date(). */
  now?: Date;
  /** Optional Resend tag for filtering in the dashboard. */
  tag?: string;
}): Promise<SendEmailResult & { subject?: string }> {
  if (opts.to.length === 0) {
    return { ok: false, error: "Empty recipient list." };
  }
  const data = await loadWeeklySocialReportData(opts.now ?? new Date());
  const { subject, html, text } = renderWeeklySocialEmail(data);

  const result = await sendEmail({
    to: opts.to,
    subject,
    html,
    text,
    tag: opts.tag ?? "weekly-social-report",
  });
  return { ...result, subject };
}
