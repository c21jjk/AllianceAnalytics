import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/send";
import {
  buildOwnerStoryCandidateFromToken,
  addSellerRecipient,
  recordSellerSend,
  buildUnsubscribeUrl,
} from "@/lib/email/reports/owner-story-weekly-data";
import { renderOwnerStoryEmail } from "@/lib/email/reports/owner-story-weekly-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/owner-story/[token]/share
 *
 * Public, token-gated (the story token is the bearer credential — same model
 * as the /home/[token] page). Called from the agent-facing capture form: the
 * agent enters their seller's name(s) + email, and we:
 *   1. store the seller as a report_recipient (idempotent on report+email),
 *   2. send the seller their first Owner Story email immediately (seller copy),
 *   3. record the send so the Monday cron doesn't double-send this week.
 *
 * From then on the Monday cron emails the seller automatically every week
 * until the listing leaves "active".
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    email?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const candidate = await buildOwnerStoryCandidateFromToken(token);
  if (!candidate) {
    return NextResponse.json(
      { ok: false, error: "This Owner Story link wasn't found." },
      { status: 404 },
    );
  }

  await addSellerRecipient({
    report_id: candidate.report_id,
    email,
    name: name || null,
  });

  const rendered = renderOwnerStoryEmail(candidate, {
    audience: "seller",
    recipientName: name || null,
    unsubscribeUrl: buildUnsubscribeUrl(token, email),
  });
  const send = await sendEmail({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tag: "owner-story-seller-capture",
  });

  // Record even on failure so a hard-bouncing address isn't retried by the
  // cron this week; the recipient row persists so future weeks still try.
  await recordSellerSend({
    report_id: candidate.report_id,
    property_id: candidate.property_id,
    recipient_email: email,
    week_start: candidate.week_start,
    social_reach: candidate.social_reach,
    portal_views: candidate.portal_views,
    post_count: candidate.post_count,
    last_error: send.ok ? null : (send.error ?? "unknown error"),
  });

  if (!send.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "We saved your seller but couldn't send the first email. They'll get it Monday.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, address: candidate.address });
}
