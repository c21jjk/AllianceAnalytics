import "server-only";
import type { OwnerStoryEmailCandidate } from "./owner-story-weekly-data";

/**
 * HTML + plaintext renderer for the weekly Owner Story email to listing agents.
 *
 * The email is a Monday-morning nudge: "here's the live, seller-facing Owner
 * Story for your listing — forward it to your seller." The story page itself
 * (the CTA target) carries the full detail; this email is a branded summary
 * with the two headline numbers (portal views + social reach) and one button.
 */

const BRAND_GREY = "#252526";
const BRAND_GOLD = "#C9A84C";

export interface RenderedOwnerStoryEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderOwnerStoryEmail(
  c: OwnerStoryEmailCandidate,
): RenderedOwnerStoryEmail {
  const firstName = c.agent_name?.trim().split(/\s+/)[0] ?? "there";
  const locationLine = c.city ? `${c.address}, ${c.city}` : c.address;
  const subject = `${c.address}: this week's Owner Story for your seller`;

  const heroBlock = c.hero_image_url
    ? `<tr><td style="padding:0;">
        <img src="${escapeAttr(c.hero_image_url)}" alt="${escapeAttr(c.address)}" style="display:block;width:100%;max-height:280px;object-fit:cover;background:#eeeeee;" />
      </td></tr>`
    : "";

  const stat = (value: string, label: string) => `
    <td align="center" style="width:33.33%;padding:0 6px;vertical-align:top;">
      <div style="border:1px solid #eeeeee;border-radius:12px;padding:16px 8px;background:#fafafa;">
        <div style="font-size:26px;font-weight:700;color:${BRAND_GREY};line-height:1;">${value}</div>
        <div style="font-size:10px;color:#71717a;margin-top:6px;letter-spacing:0.06em;text-transform:uppercase;">${label}</div>
      </div>
    </td>`;

  const statsTable = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:18px;">
    <tr>
      ${stat(formatNumber(c.portal_views), "Portal views")}
      ${stat(formatNumber(c.social_reach), "Social reach")}
      ${stat(`${formatNumber(c.post_count)}`, c.post_count === 1 ? "Post" : "Posts")}
    </tr>
  </table>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Barlow',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:${BRAND_GREY};padding:20px 28px;">
          <div style="font-size:12px;color:${BRAND_GOLD};letter-spacing:0.14em;text-transform:uppercase;font-weight:700;">Owner Story</div>
          <div style="font-size:20px;color:#ffffff;font-weight:700;margin-top:4px;line-height:1.2;">${escapeHtml(locationLine)}</div>
        </td></tr>

        ${heroBlock}

        <!-- Body -->
        <tr><td style="padding:24px 28px;">
          <div style="font-size:15px;color:#3f3f46;line-height:1.55;">
            Hi ${escapeHtml(firstName)}, here's the live Owner Story for your listing — a status-aware page showing every social post and portal that's working behind <strong>${escapeHtml(c.address)}</strong>. It's been running for <strong>${c.days_running} ${c.days_running === 1 ? "day" : "days"}</strong> and updates automatically.
          </div>
          <div style="font-size:15px;color:#3f3f46;line-height:1.55;margin-top:12px;">
            Forward it to your seller — they can bookmark it and watch the exposure build week over week.
          </div>

          ${statsTable}

          <!-- CTA -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
            <tr><td align="center" bgcolor="${BRAND_GOLD}" style="border-radius:10px;">
              <a href="${escapeAttr(c.story_url)}" target="_blank" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:${BRAND_GREY};text-decoration:none;border-radius:10px;">
                View &amp; share the Owner Story &rarr;
              </a>
            </td></tr>
          </table>
          <div style="font-size:12px;color:#a1a1aa;margin-top:12px;word-break:break-all;">
            ${escapeHtml(c.story_url)}
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:18px 28px;border-top:1px solid #f0f0f0;">
          <div style="font-size:11px;color:#a1a1aa;line-height:1.5;">
            Sent from SocialMediaReport@c21anj.com · Alliance Social Analytics. You're receiving this because you're the listing agent. The link is live and forwardable.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Owner Story — ${locationLine}`,
    ``,
    `Hi ${firstName}, here's the live Owner Story for your listing — a status-aware page showing every social post and portal working behind ${c.address}. It's been running ${c.days_running} ${c.days_running === 1 ? "day" : "days"} and updates automatically.`,
    ``,
    `Portal views: ${formatNumber(c.portal_views)}`,
    `Social reach: ${formatNumber(c.social_reach)}`,
    `Posts: ${formatNumber(c.post_count)}`,
    ``,
    `Forward it to your seller — they can bookmark it and watch the exposure build:`,
    c.story_url,
    ``,
    `Sent from SocialMediaReport@c21anj.com · Alliance Social Analytics`,
  ].join("\n");

  return { subject, html, text };
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
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
