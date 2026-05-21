import "server-only";
import { sendEmail } from "@/lib/email/send";
import {
  findEligibleAnnouncements,
  recordAnnouncement,
  type AnnouncementCandidate,
} from "./office-post-announcement-data";
import { renderOfficePostAnnouncement } from "./office-post-announcement-template";

/**
 * Orchestrator for the office post announcement blast.
 *
 * Called by:
 *   1. The Vercel cron (every 15 min) — finds + sends every eligible group.
 *   2. The /settings preview button — sends ONE candidate to John only,
 *      without writing an announcement row (so it can be re-previewed).
 *
 * Behavior:
 *   - Per recipient, one Resend `send` call. Failures inside the per-recipient
 *     loop don't abort the rest of the run; they're logged and counted.
 *   - After a group's recipients are all attempted, we write a single
 *     announcement row via `recordAnnouncement` — that's the idempotency
 *     guard so the next cron pass skips the group.
 *   - Concurrency is intentionally low (sequential per recipient). Resend
 *     handles its own rate-limits; for our volume (<200 emails per fire)
 *     the difference vs parallel is negligible.
 */

export interface AnnouncementRunResult {
  groups_attempted: number;
  groups_sent: number;
  emails_sent: number;
  emails_failed: number;
  errors: string[];
}

export async function runOfficePostAnnouncementCron(): Promise<AnnouncementRunResult> {
  const candidates = await findEligibleAnnouncements({ freshOnly: true });
  return sendAnnouncementsForCandidates(candidates, { record: true });
}

/**
 * Preview helper used by the /settings diagnostics button. Builds the first
 * eligible candidate, renders it, and sends to a single override recipient.
 * Does NOT record the announcement — that means the preview can be re-fired
 * and the eventual real cron will still pick up the group.
 */
export async function previewOfficePostAnnouncement(opts: {
  to: string;
}): Promise<{
  ok: boolean;
  subject?: string;
  recipientCount?: number;
  candidateId?: string;
  message?: string;
}> {
  // Disable the freshness filter so a preview works even when there hasn't
  // been a brand-new tagged post recently — gives John a way to validate the
  // template against real data on demand.
  const candidates = await findEligibleAnnouncements({ freshOnly: false });
  if (candidates.length === 0) {
    return {
      ok: false,
      message:
        "No eligible groups found (need category='property' + audience='office:*' or 'division:*').",
    };
  }
  const candidate = candidates[0];
  const { subject, html, text } = renderOfficePostAnnouncement(candidate);
  const result = await sendEmail({
    to: opts.to,
    subject: `[PREVIEW] ${subject}`,
    html,
    text,
    tag: "office-post-announcement-preview",
  });
  return {
    ok: result.ok,
    subject,
    recipientCount: 1,
    candidateId: candidate.group_id,
    message: result.error,
  };
}

async function sendAnnouncementsForCandidates(
  candidates: AnnouncementCandidate[],
  opts: { record: boolean },
): Promise<AnnouncementRunResult> {
  const summary: AnnouncementRunResult = {
    groups_attempted: candidates.length,
    groups_sent: 0,
    emails_sent: 0,
    emails_failed: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    const { subject, html, text } = renderOfficePostAnnouncement(candidate);
    let successful = 0;
    let failed = 0;
    let lastError: string | null = null;

    for (const recipient of candidate.recipient_emails) {
      try {
        const result = await sendEmail({
          to: recipient,
          subject,
          html,
          text,
          tag: "office-post-announcement-cron",
        });
        if (result.ok) {
          successful++;
        } else {
          failed++;
          lastError = result.error ?? "Unknown send error";
        }
      } catch (e) {
        failed++;
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    summary.emails_sent += successful;
    summary.emails_failed += failed;
    if (lastError) summary.errors.push(`${candidate.group_id}: ${lastError}`);

    if (opts.record) {
      await recordAnnouncement({
        group_id: candidate.group_id,
        audience_scope: candidate.audience.scope_raw,
        recipient_count: successful,
        last_error: failed > 0 ? lastError : null,
      });
    }
    if (successful > 0) summary.groups_sent++;
  }

  return summary;
}
