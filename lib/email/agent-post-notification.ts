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
import {
  createOutboxRowForPost,
  type PostUrlEntry as OutboxPostUrlEntry,
} from "@/lib/data/agent-outbox-db";

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
 * Send the engagement email for a just-created outbox row. Returns the
 * lowercase address the email was actually sent to (for caller-side
 * dedupe), or null on any guard miss. Never throws in practice; callers
 * still wrap in try/catch.
 *
 * `excludeEmails` (lowercase set): skip sending when this agent was
 * already emailed for the same publish — one agent with two listings in
 * the same multi-property post gets ONE email, not two. The skipped
 * row's sent_at stays null so the admin Outbox view can still surface it.
 */
export async function sendAgentEngagementEmail(args: {
  outboxRowId: string;
  excludeEmails?: ReadonlySet<string>;
}): Promise<string | null> {
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
    return null;
  }
  // Already notified (mailto click or a previous auto-send) — never respam.
  if (row.sent_at) return null;
  const agentEmail = (row.agent_email ?? "").trim();
  if (!agentEmail) return null;
  if (args.excludeEmails?.has(agentEmail.toLowerCase())) return null;

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
  if (urls.length === 0) return null;

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
    return null;
  }
  return agentEmail.toLowerCase();
}

/**
 * 2026-07-23 (John) — notify EVERY listing agent featured in a published
 * post, not just the anchor property's agent. The 7/23 multi-OH post (7
 * properties) emailed 1 of 7 agents; this closes that gap.
 *
 * For each property in the post (anchor ∪ linked_property_ids, deduped):
 *   1. create/refresh an outbox row (idempotent per post+property),
 *   2. send the engagement email — deduped by agent address, so an agent
 *      with two listings in the same post gets ONE email.
 *
 * Single-listing posts hit the same path with a one-element list, so
 * behavior is identical to before. `send_emails: false` still creates the
 * outbox rows (admin visibility) but skips the sends — used for
 * auto-generated reels, whose agents were already emailed for the source
 * photo post minutes earlier.
 *
 * Best-effort everywhere: failures log and never propagate to the publish
 * flow that called us.
 */
export async function notifyListingAgentsForPost(args: {
  generated_post_id: string;
  anchor_property_id: string;
  post_urls: OutboxPostUrlEntry[];
  caption: string | null;
  thumbnail_url: string | null;
  send_emails: boolean;
}): Promise<void> {
  const supabase = createAdminClient();

  // Resolve the full property set. linked_property_ids isn't in the
  // generated Database types yet — read through an untyped client, same
  // pattern as the publish routes.
  const propertyIds: string[] = [args.anchor_property_id];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any;
    const { data: gp } = await sbAny
      .from("generated_posts")
      .select("linked_property_ids")
      .eq("id", args.generated_post_id)
      .maybeSingle();
    if (gp && Array.isArray(gp.linked_property_ids)) {
      for (const pid of gp.linked_property_ids) {
        if (typeof pid === "string" && pid && !propertyIds.includes(pid)) {
          propertyIds.push(pid);
        }
      }
    }
  } catch (e) {
    console.error(
      "[agent-email] linked property lookup failed (anchor-only fallback):",
      e instanceof Error ? e.message : e,
    );
  }

  // 2026-08-15 — global pause switch (system_config.agent_emails_paused_until).
  // When that timestamp is in the future, outbox rows are still created (the
  // dashboard reshare workflow keeps working) but NO agent emails go out.
  // Built for the recreate-and-repost case: regenerated posts get new
  // generated_post_ids, so the outbox idempotency can't dedupe them and every
  // featured agent would be emailed again. Self-expiring — once the timestamp
  // passes, emails resume with no code or DB change. Fail-open: any read
  // error means emails send as normal. To pause again:
  //   update system_config set agent_emails_paused_until = now() + interval '24 hours' where id = 1;
  let emailsPaused = false;
  if (args.send_emails) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sbAny = supabase as any;
      const { data: cfg } = await sbAny
        .from("system_config")
        .select("agent_emails_paused_until")
        .eq("id", 1)
        .maybeSingle();
      const until = cfg?.agent_emails_paused_until
        ? new Date(cfg.agent_emails_paused_until as string)
        : null;
      if (until && !Number.isNaN(until.getTime()) && until.getTime() > Date.now()) {
        emailsPaused = true;
        console.log(
          `[agent-email] paused until ${until.toISOString()} — outbox rows created, emails skipped for post ${args.generated_post_id}`,
        );
      }
    } catch (e) {
      console.error(
        "[agent-email] pause check failed (sending anyway):",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const emailed = new Set<string>();
  for (const propertyId of propertyIds) {
    try {
      const outbox = await createOutboxRowForPost({
        generated_post_id: args.generated_post_id,
        property_id: propertyId,
        post_urls: args.post_urls,
        caption: args.caption,
        thumbnail_url: args.thumbnail_url,
      });
      if (!("id" in outbox)) {
        console.error(
          `[agent-email] outbox create failed for post ${args.generated_post_id} / property ${propertyId}: ${outbox.error}`,
        );
        continue;
      }
      if (args.send_emails && !emailsPaused) {
        const sentTo = await sendAgentEngagementEmail({
          outboxRowId: outbox.id,
          excludeEmails: emailed,
        });
        if (sentTo) emailed.add(sentTo);
      }
    } catch (e) {
      console.error(
        `[agent-email] notify loop failed for property ${propertyId}:`,
        e instanceof Error ? e.message : e,
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
