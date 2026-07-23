/**
 * lib/email/agent-post-notification.ts (2026-07-23)
 * ---------------------------------------------------------------------------
 *
 * Immediate "your listing just went live" email to the listing agent.
 *
 * WHY: feed ranking rewards early engagement. Posts published via the API
 * start with zero signals; a like/comment/share from the listing agent in
 * the first hour is the cheapest distribution lever we have (see the
 * auto-reel module header for the full feed-distribution investigation).
 * Previously the outbox was mailto-only — a notification went out ONLY
 * when someone remembered to click "Notify" in the admin view. This sends
 * automatically the moment a post publishes.
 *
 * Guard rails:
 *   • One email per outbox row, ever — sent_at is checked before sending
 *     and stamped after, so a partial-failure republish can't respam.
 *   • Auto-reel rows are EXCLUDED at the call sites (the agent already got
 *     the photo-post email minutes earlier; two pings in an hour is spam).
 *   • Best-effort: a failed send logs to last_error and never blocks
 *     publishing.
 *
 * Caption content rules do not apply here (this is an internal agent email,
 * not a social caption). Per John's standing style rule: no em dashes.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

interface PostUrlEntry {
  platform: string;
  url: string;
}

/**
 * Send the engagement email for a just-created outbox row. Returns quietly
 * on every guard miss; callers fire-and-forget inside a try/catch.
 */
export async function sendAgentEngagementEmail(args: {
  outboxRowId: string;
}): Promise<void> {
  const supabase = createAdminClient();

  const { data: row, error } = await supabase
    .from("agent_post_outbox")
    .select(
      "id, agent_name, agent_email, sent_at, caption_snippet, post_urls, story_url_path, properties(address, mls_number)",
    )
    .eq("id", args.outboxRowId)
    .maybeSingle();
  if (error || !row) {
    console.error(
      `[agent-email] outbox lookup failed for ${args.outboxRowId}:`,
      error?.message ?? "not found",
    );
    return;
  }
  // Already notified (mailto click or a previous auto-send) — never respam.
  if (row.sent_at) return;
  const agentEmail = (row.agent_email ?? "").trim();
  if (!agentEmail) return;

  const urls: PostUrlEntry[] = [];
  if (Array.isArray(row.post_urls)) {
    for (const raw of row.post_urls) {
      const entry = raw as unknown;
      if (
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as { url?: unknown }).url === "string" &&
        typeof (entry as { platform?: unknown }).platform === "string"
      ) {
        urls.push(entry as PostUrlEntry);
      }
    }
  }
  if (urls.length === 0) return;

  // properties(...) join comes back as an object for a many-to-one FK.
  const prop = row.properties as unknown as {
    address: string | null;
    mls_number: string | null;
  } | null;
  const address = prop?.address?.trim() || `MLS ${prop?.mls_number ?? ""}`.trim();
  const firstName = (row.agent_name ?? "").trim().split(/\s+/)[0] || "there";

  const platformNames = urls.map(
    (u) => PLATFORM_LABELS[u.platform] ?? u.platform,
  );
  const platformsText =
    platformNames.length > 1
      ? `${platformNames.slice(0, -1).join(", ")} and ${platformNames[platformNames.length - 1]}`
      : (platformNames[0] ?? "social");

  // Subject style per John's standing rule: lead with the real result,
  // keep it real, no em dashes.
  const subject = `${address} is live on ${platformsText}`;

  const linksHtml = urls
    .map(
      (u) =>
        `<li style="margin:4px 0;"><a href="${escapeAttr(u.url)}" style="color:#C9A84C;font-weight:600;">View the ${escapeHtml(PLATFORM_LABELS[u.platform] ?? u.platform)} post</a></li>`,
    )
    .join("");

  // 2026-07-23 (John) — NO Owner Story link in this email. Minutes after a
  // post goes live the report's reach/engagement numbers are zero or near
  // zero, which undercuts the email's one job: "go engage with the post
  // right now." The weekly Monday Owner Story email remains the metrics
  // surface, by which point there are real numbers to show.
  const html = `
  <div style="font-family:Barlow,Helvetica,Arial,sans-serif;color:#252526;max-width:560px;margin:0 auto;padding:24px;">
    <p style="margin:0 0 12px;">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 12px;">Your listing at <strong>${escapeHtml(address)}</strong> just went live on ${escapeHtml(platformsText)}:</p>
    <ul style="margin:0 0 4px;padding-left:20px;">${linksHtml}</ul>
    <p style="margin:16px 0 0;"><strong>One quick favor: open the post and like, comment, or share it now.</strong> Engagement in the first hour tells Facebook and Instagram to show the post to far more people, so a 10 second tap directly buys your seller more exposure.</p>
    <p style="margin:24px 0 0;color:#6b6b6b;font-size:13px;">Century 21 Alliance | Alliance Social Analytics</p>
  </div>`;

  const result = await sendEmail({
    to: agentEmail,
    subject,
    html,
    tag: "agent-post-live",
  });

  if (result.ok) {
    const { error: updErr } = await supabase
      .from("agent_post_outbox")
      .update({
        sent_at: new Date().toISOString(),
        delivery_method: "resend",
      })
      .eq("id", row.id);
    if (updErr) {
      console.error(
        `[agent-email] sent but failed to stamp sent_at on ${row.id}: ${updErr.message}`,
      );
    }
  } else {
    console.error(
      `[agent-email] send failed for ${row.id} (${agentEmail}): ${result.error}`,
    );
    const { error: updErr } = await supabase
      .from("agent_post_outbox")
      .update({ last_error: (result.error ?? "send failed").slice(0, 500) })
      .eq("id", row.id);
    if (updErr) {
      console.error(
        `[agent-email] failed to record last_error on ${row.id}: ${updErr.message}`,
      );
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
