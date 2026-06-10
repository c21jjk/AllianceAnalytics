import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { fetchOwnerStoryByToken } from "@/lib/data/owner-story-db";
import { removeSellerRecipientByEmail } from "@/lib/email/reports/owner-story-weekly-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_BASE_URL = "https://www.alliancesocialanalytics.com";

/** Where John gets the heads-up when a seller opts out. */
const UNSUBSCRIBE_NOTICE_TO = "c21jjk@gmail.com";

/**
 * GET /api/owner-story/[token]/unsubscribe?e=<email>
 *
 * why: this used to delete the recipient directly on GET, but corporate mail
 * scanners prefetch every link in an email, which silently unsubscribed
 * sellers who never clicked anything. GET is now side-effect free: it renders
 * a small branded confirm page whose button POSTs back to this same URL.
 *
 * POST performs the actual delete (and keeps the old GET's redirect UX).
 * POST also honors RFC 8058 one-click unsubscribe: a form body of
 * `List-Unsubscribe=One-Click` (sent by mail clients, no human page view)
 * deletes directly.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") ?? "").trim();

  const doneUrl = `${APP_BASE_URL}/home/${token}/unsubscribed`;

  // Nothing to confirm without an email — send them to the friendly page.
  if (!email) {
    return NextResponse.redirect(doneUrl);
  }

  // why: the form posts back to this exact URL so token + email survive the
  // round-trip without hidden fields.
  const postUrl = `${APP_BASE_URL}/api/owner-story/${token}/unsubscribe?e=${encodeURIComponent(
    email,
  )}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Unsubscribe</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Barlow,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:64px auto;padding:0 16px;">
    <div style="background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;padding:40px 32px;text-align:center;">
      <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#C9A84C;font-weight:600;margin-bottom:16px;">Century 21 Alliance</div>
      <h1 style="margin:0 0 12px;font-size:22px;color:#252526;">Unsubscribe from weekly updates?</h1>
      <p style="margin:0 0 28px;font-size:15px;line-height:1.5;color:#52525b;">
        ${escapeHtml(email)} will stop receiving the weekly Owner Story email for this listing.
      </p>
      <form method="POST" action="${escapeAttr(postUrl)}" style="margin:0;">
        <button type="submit" style="background:#252526;color:#ffffff;border:none;border-radius:8px;padding:12px 28px;font-size:15px;font-weight:600;font-family:Barlow,Helvetica,Arial,sans-serif;cursor:pointer;">
          Yes, unsubscribe me
        </button>
      </form>
      <p style="margin:24px 0 0;font-size:13px;color:#a1a1aa;">
        Changed your mind? Just close this page.
      </p>
    </div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * POST /api/owner-story/[token]/unsubscribe?e=<email>
 *
 * Performs the delete. Reached two ways:
 *   1. The confirm page's form button (browser POST).
 *   2. RFC 8058 one-click: mail client POSTs `List-Unsubscribe=One-Click`.
 * Both delete; both end at the same friendly confirmation page.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") ?? "").trim();

  const doneUrl = `${APP_BASE_URL}/home/${token}/unsubscribed`;

  if (!email) {
    return NextResponse.redirect(doneUrl, 303);
  }

  const story = await fetchOwnerStoryByToken(token);
  if (!story) {
    return NextResponse.redirect(doneUrl, 303);
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

  // why: 303 turns the browser's POST into a GET of the confirmation page.
  // One-click mail clients only care about the 2xx/3xx status.
  return NextResponse.redirect(doneUrl, 303);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
