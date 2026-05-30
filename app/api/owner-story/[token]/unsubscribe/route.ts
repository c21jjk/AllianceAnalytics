import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { fetchOwnerStoryByToken } from "@/lib/data/owner-story-db";
import { removeSellerRecipientByEmail } from "@/lib/email/reports/owner-story-weekly-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_BASE_URL = "https://alliance-analytics.vercel.app";

/** Where John gets the heads-up when a seller opts out. */
const UNSUBSCRIBE_NOTICE_TO = "c21jjk@gmail.com";

/**
 * GET /api/owner-story/[token]/unsubscribe?e=<email>
 *
 * One-click unsubscribe from the seller's weekly Owner Story email. Removes the
 * report_recipients row (which stops all future Monday cron sends), emails John
 * a notice, then redirects to a friendly confirmation page. Token-gated; the
 * email to remove is passed in the query string.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") ?? "").trim();

  const doneUrl = `${APP_BASE_URL}/home/${token}/unsubscribed`;

  if (!email) {
    return NextResponse.redirect(doneUrl);
  }

  const story = await fetchOwnerStoryByToken(token);
  if (!story) {
    return NextResponse.redirect(doneUrl);
  }

  const result = await removeSellerRecipientByEmail(story.report_id, email);

  if (result.removed) {
    const address = story.listing.address ?? "a listing";
    const who = result.name?.trim() ? `${result.name} (${email})` : email;
    // Best-effort notice to John — never block the unsubscribe on it.
    await sendEmail({
      to: UNSUBSCRIBE_NOTICE_TO,
      subject: `A seller opted out — ${address}`,
      text: `${who} unsubscribed from the weekly Owner Story email for ${address}. They've been removed from future Monday sends.`,
      html: `<p>${escapeHtml(who)} unsubscribed from the weekly Owner Story email for <strong>${escapeHtml(
        address,
      )}</strong>.</p><p>They've been removed from future Monday sends.</p>`,
      tag: "owner-story-unsubscribe-notice",
    }).catch(() => {});
  }

  return NextResponse.redirect(doneUrl);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
