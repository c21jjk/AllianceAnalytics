import "server-only";
import { getWeeklySocialReportRecipientEmails } from "@/lib/data/email-subscribers";

/**
 * Weekly social media report distribution list.
 *
 * As of 2026-05-19 this is sourced from the `email_subscribers` table (admin
 * UI at /settings/subscribers) — the hardcoded constant was retired. Both the
 * "Send to full distribution" admin button and the Monday-morning Vercel cron
 * resolve recipients through this function.
 *
 * Returns an empty array if the DB query fails — callers should treat that
 * as a no-op rather than an error so a transient Supabase blip doesn't 500
 * the cron route.
 */
export async function recipientEmails(): Promise<string[]> {
  try {
    return await getWeeklySocialReportRecipientEmails();
  } catch (e) {
    console.error("[weekly-social-distribution] recipient query failed:", e);
    return [];
  }
}
