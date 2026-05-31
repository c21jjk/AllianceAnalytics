import "server-only";
import { sendEmail } from "@/lib/email/send";
import {
  findEligibleOwnerStoryEmails,
  recordOwnerStorySend,
  loadSellerRecipients,
  loadSellerSendKeysForWeek,
  recordSellerSend,
  buildUnsubscribeUrl,
  type OwnerStoryEmailCandidate,
} from "./owner-story-weekly-data";
import { renderOwnerStoryEmail } from "./owner-story-weekly-template";

/**
 * Orchestrator for the weekly Owner Story email to listing agents.
 *
 * Called by:
 *   1. The Monday-morning Vercel cron — finds + sends every eligible listing.
 *   2. The /settings preview button — renders ONE candidate to John only,
 *      without recording a send row (so it can be re-previewed).
 *
 * Behavior on the cron path: one email per eligible listing, sent to the
 * listing agent. A per-listing failure is logged + counted but never aborts
 * the rest of the run. After each successful (or attempted) send we write the
 * owner_story_email_sends row, which is the idempotency guard that keeps the
 * next pass — and the following Mondays' duplicate-protection — correct.
 */

export interface OwnerStoryRunResult {
  candidates: number;
  emails_sent: number;
  emails_failed: number;
  seller_emails_sent: number;
  seller_emails_failed: number;
  errors: string[];
}

/**
 * Go-live hold (2026-05-31, John): delay the Owner Story email launch one more
 * week while ListTrac portal coverage is being fixed. The Monday Vercel cron
 * stays scheduled but sends NOTHING before this date, then resumes
 * automatically on the first Monday on/after it. The /settings preview button
 * (sendOwnerStoryPreview) is intentionally NOT gated — John can still preview.
 * Delete this guard (or move the date) to launch.
 */
const OWNER_STORY_GO_LIVE = new Date("2026-06-08T00:00:00Z");

export async function runOwnerStoryWeeklyCron(opts?: {
  now?: Date;
}): Promise<OwnerStoryRunResult> {
  const now = opts?.now ?? new Date();

  if (now < OWNER_STORY_GO_LIVE) {
    console.log(
      `[owner-story-weekly] held until ${OWNER_STORY_GO_LIVE.toISOString()} — skipping send (now=${now.toISOString()})`,
    );
    return {
      candidates: 0,
      emails_sent: 0,
      emails_failed: 0,
      seller_emails_sent: 0,
      seller_emails_failed: 0,
      errors: [],
    };
  }

  const candidates = await findEligibleOwnerStoryEmails(now);

  const result: OwnerStoryRunResult = {
    candidates: candidates.length,
    emails_sent: 0,
    emails_failed: 0,
    seller_emails_sent: 0,
    seller_emails_failed: 0,
    errors: [],
  };

  // Seller-send dedupe set for the week, loaded once.
  const weekStart = candidates[0]?.week_start;
  const sellerSentKeys = weekStart
    ? await loadSellerSendKeysForWeek(weekStart)
    : new Set<string>();

  for (const c of candidates) {
    // Sellers captured for this listing — loaded first so the agent copy can
    // acknowledge them ("this was just sent to your seller") instead of
    // nudging the agent to forward.
    const sellers = await loadSellerRecipients(c.report_id);

    // --- Agent send -------------------------------------------------------
    const agentEmail = renderOwnerStoryEmail(c, {
      audience: "agent",
      sellersOnFile: sellers,
    });
    const send = await sendEmail({
      to: c.agent_email,
      subject: agentEmail.subject,
      html: agentEmail.html,
      text: agentEmail.text,
      tag: "owner-story-weekly",
    });

    if (send.ok) {
      result.emails_sent += 1;
    } else {
      result.emails_failed += 1;
      result.errors.push(`${c.address} (agent): ${send.error ?? "unknown error"}`);
    }

    await recordOwnerStorySend({
      report_id: c.report_id,
      property_id: c.property_id,
      week_start: c.week_start,
      recipient_email: c.agent_email,
      social_reach: c.social_reach,
      portal_views: c.portal_views,
      post_count: c.post_count,
      last_error: send.ok ? null : (send.error ?? "unknown error"),
    });

    // --- Direct-to-seller sends ------------------------------------------
    for (const seller of sellers) {
      const key = `${c.report_id}|${seller.email.toLowerCase()}`;
      if (sellerSentKeys.has(key)) continue;

      const sellerEmail = renderOwnerStoryEmail(c, {
        audience: "seller",
        recipientName: seller.name,
        unsubscribeUrl: buildUnsubscribeUrl(c.token, seller.email),
      });
      const sSend = await sendEmail({
        to: seller.email,
        subject: sellerEmail.subject,
        html: sellerEmail.html,
        text: sellerEmail.text,
        tag: "owner-story-weekly-seller",
      });

      if (sSend.ok) {
        result.seller_emails_sent += 1;
      } else {
        result.seller_emails_failed += 1;
        result.errors.push(
          `${c.address} (seller ${seller.email}): ${sSend.error ?? "unknown error"}`,
        );
      }

      await recordSellerSend({
        report_id: c.report_id,
        property_id: c.property_id,
        recipient_email: seller.email,
        week_start: c.week_start,
        social_reach: c.social_reach,
        portal_views: c.portal_views,
        post_count: c.post_count,
        last_error: sSend.ok ? null : (sSend.error ?? "unknown error"),
      });
      sellerSentKeys.add(key);
    }
  }

  return result;
}

/**
 * Preview path — render + send a single eligible candidate to one address
 * (John, during design iteration). Does NOT write an owner_story_email_sends
 * row, so the same listing can be previewed repeatedly and still go out on the
 * real Monday run.
 *
 * Returns a small status object for the /settings button to surface.
 */
export async function sendOwnerStoryPreview(opts: {
  to: string;
  now?: Date;
}): Promise<{ ok: boolean; address?: string; error?: string }> {
  const now = opts.now ?? new Date();
  const candidates = await findEligibleOwnerStoryEmails(now);
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        "No eligible Owner Stories right now (need an active listing with posts >= 7 days old).",
    };
  }
  const c: OwnerStoryEmailCandidate = candidates[0];
  const { subject, html, text } = renderOwnerStoryEmail(c);
  const send = await sendEmail({
    to: opts.to,
    subject: `[Preview] ${subject}`,
    html,
    text,
    tag: "owner-story-weekly-preview",
  });
  return send.ok
    ? { ok: true, address: c.address }
    : { ok: false, error: send.error ?? "unknown error" };
}
