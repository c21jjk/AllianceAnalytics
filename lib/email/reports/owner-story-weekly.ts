import "server-only";
import { sendEmail } from "@/lib/email/send";
import {
  findEligibleOwnerStoryEmails,
  recordOwnerStorySend,
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
  errors: string[];
}

export async function runOwnerStoryWeeklyCron(opts?: {
  now?: Date;
}): Promise<OwnerStoryRunResult> {
  const now = opts?.now ?? new Date();
  const candidates = await findEligibleOwnerStoryEmails(now);

  const result: OwnerStoryRunResult = {
    candidates: candidates.length,
    emails_sent: 0,
    emails_failed: 0,
    errors: [],
  };

  for (const c of candidates) {
    const { subject, html, text } = renderOwnerStoryEmail(c);
    const send = await sendEmail({
      to: c.agent_email,
      subject,
      html,
      text,
      tag: "owner-story-weekly",
    });

    if (send.ok) {
      result.emails_sent += 1;
    } else {
      result.emails_failed += 1;
      result.errors.push(`${c.address}: ${send.error ?? "unknown error"}`);
    }

    // Record regardless of send outcome so a hard-failing recipient doesn't
    // get retried every cron tick within the same week; last_error preserves
    // the reason for the admin view.
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
