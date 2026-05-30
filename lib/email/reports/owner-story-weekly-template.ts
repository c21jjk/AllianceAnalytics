import "server-only";
import type { OwnerStoryEmailCandidate } from "./owner-story-weekly-data";

/**
 * HTML + plaintext renderer for the weekly Owner Story email.
 *
 * Two audiences (the page they link to is identical; only the framing differs):
 *
 *   - "agent"  → Monday nudge to the listing agent: "here's the live Owner
 *     Story for your listing — forward it to your seller (email or text)."
 *   - "seller" → the seller themselves, once the agent has shared it: a warm
 *     "here's how your home is performing" with no forwarding ask and an
 *     unsubscribe line.
 *
 * The story page (the CTA target) carries the full detail; this email is a
 * branded summary with the headline numbers (portal views + social reach).
 */

const BRAND_GREY = "#252526";
const BRAND_GOLD = "#C9A84C";

export interface RenderedOwnerStoryEmail {
  subject: string;
  html: string;
  text: string;
}

export interface SellerOnFile {
  name: string | null;
  email: string;
}

export interface OwnerStoryEmailOptions {
  audience?: "agent" | "seller";
  /** Seller's name(s) for the greeting, e.g. "John & Jane". Seller only. */
  recipientName?: string | null;
  /** One-click unsubscribe URL for seller sends (omitted for agents). */
  unsubscribeUrl?: string | null;
  /**
   * Sellers already captured for this listing. AGENT email only: when present,
   * the copy switches from "please forward this" to "this was just sent to
   * your seller" so the agent knows it's handled.
   */
  sellersOnFile?: SellerOnFile[];
}

function formatSellerList(sellers: SellerOnFile[]): string {
  return sellers
    .map((s) => (s.name?.trim() ? escapeHtml(s.name.trim()) : escapeHtml(s.email)))
    .join(", ");
}

function firstNameOf(name: string | null | undefined): string {
  const n = name?.trim();
  if (!n) return "there";
  // Keep "John & Jane" intact for sellers; for a single name take the first token.
  if (n.includes("&") || n.includes(" and ")) return n;
  return n.split(/\s+/)[0];
}

export function renderOwnerStoryEmail(
  c: OwnerStoryEmailCandidate,
  opts: OwnerStoryEmailOptions = {},
): RenderedOwnerStoryEmail {
  const audience = opts.audience ?? "agent";
  const isSeller = audience === "seller";
  const sellers = opts.sellersOnFile ?? [];
  const hasSellers = !isSeller && sellers.length > 0;
  const locationLine = c.city ? `${c.address}, ${c.city}` : c.address;

  const greetName = isSeller
    ? firstNameOf(opts.recipientName)
    : firstNameOf(c.agent_name);

  const subject = isSeller
    ? `Your home's Owner Story — ${c.address}`
    : `${c.address}: this week's Owner Story for your seller`;

  const intro = isSeller
    ? `Hi ${escapeHtml(greetName)}, here's the live Owner Story for your home at <strong>${escapeHtml(c.address)}</strong> — a page that shows every social post and portal working to sell it, updating automatically. It's been running for <strong>${c.days_running} ${c.days_running === 1 ? "day" : "days"}</strong>.`
    : `Hi ${escapeHtml(greetName)}, here's the live Owner Story for your listing — a status-aware page showing every social post and portal that's working behind <strong>${escapeHtml(c.address)}</strong>. It's been running for <strong>${c.days_running} ${c.days_running === 1 ? "day" : "days"}</strong> and updates automatically.`;

  const calloutBlock = isSeller
    ? `<div style="font-size:15px;color:#3f3f46;line-height:1.55;margin-top:12px;">
            Bookmark it and check back any time — the numbers grow as your home keeps getting exposure across Facebook, Instagram, TikTok, and the major listing portals.
          </div>`
    : hasSellers
      ? `<div style="font-size:15px;color:${BRAND_GREY};line-height:1.55;margin-top:14px;padding:12px 14px;background:#EAF6EE;border-left:3px solid #2E9E5B;border-radius:6px;">
            <strong>&#10003; This was just emailed directly to your seller</strong> (${formatSellerList(sellers)}). No need to forward it — they'll keep getting it automatically every Monday while the listing is active. You can still open and share the link yourself anytime.
          </div>`
      : `<div style="font-size:15px;color:${BRAND_GREY};line-height:1.55;margin-top:14px;padding:12px 14px;background:#FBF7E9;border-left:3px solid ${BRAND_GOLD};border-radius:6px;">
            <strong>Please forward this to your seller</strong> — paste the link into an email or a text message. It's a live page they can bookmark and re-open any time to watch their home's exposure build, week over week. You'll get this reminder every Monday while the listing is active.
          </div>`;

  const ctaLabel = isSeller
    ? "View your Owner Story &rarr;"
    : "View &amp; share the Owner Story &rarr;";

  const footerLine = isSeller
    ? `Sent from SocialMediaReport@c21anj.com · Alliance Social Analytics on behalf of your listing agent.${
        opts.unsubscribeUrl
          ? ` <a href="${escapeAttr(opts.unsubscribeUrl)}" style="color:#a1a1aa;text-decoration:underline;">Unsubscribe</a> from these weekly updates.`
          : ""
      }`
    : `Sent from SocialMediaReport@c21anj.com · Alliance Social Analytics. You're receiving this because you're the listing agent. The link is live and forwardable.`;

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
            ${intro}
          </div>
          ${calloutBlock}

          ${statsTable}

          <!-- CTA -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
            <tr><td align="center" bgcolor="${BRAND_GOLD}" style="border-radius:10px;">
              <a href="${escapeAttr(c.story_url)}" target="_blank" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:${BRAND_GREY};text-decoration:none;border-radius:10px;">
                ${ctaLabel}
              </a>
            </td></tr>
          </table>
          <div style="font-size:12px;color:#a1a1aa;margin-top:12px;word-break:break-all;">
            ${escapeHtml(c.story_url)}
          </div>
          ${
            isSeller
              ? ""
              : hasSellers
                ? `<div style="margin-top:18px;padding-top:16px;border-top:1px solid #f0f0f0;font-size:14px;color:#3f3f46;line-height:1.5;">
            Need to add another seller to the weekly send?
            <a href="${escapeAttr(c.story_url)}/share" target="_blank" style="color:#9a7d2e;font-weight:700;text-decoration:underline;">Add another email &rarr;</a>
          </div>`
                : `<div style="margin-top:18px;padding-top:16px;border-top:1px solid #f0f0f0;font-size:14px;color:#3f3f46;line-height:1.5;">
            Want it sent to your seller for you, every Monday automatically?
            <a href="${escapeAttr(c.story_url)}/share" target="_blank" style="color:#9a7d2e;font-weight:700;text-decoration:underline;">Add your seller&rsquo;s email &rarr;</a>
          </div>`
          }
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:18px 28px;border-top:1px solid #f0f0f0;">
          <div style="font-size:11px;color:#a1a1aa;line-height:1.5;">
            ${footerLine}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    `Owner Story — ${locationLine}`,
    ``,
    isSeller
      ? `Hi ${greetName}, here's the live Owner Story for your home at ${c.address} — every social post and portal working to sell it, updating automatically. It's been running ${c.days_running} ${c.days_running === 1 ? "day" : "days"}.`
      : `Hi ${greetName}, here's the live Owner Story for your listing — every social post and portal working behind ${c.address}. It's been running ${c.days_running} ${c.days_running === 1 ? "day" : "days"} and updates automatically.`,
    ``,
    `Portal views: ${formatNumber(c.portal_views)}`,
    `Social reach: ${formatNumber(c.social_reach)}`,
    `Posts: ${formatNumber(c.post_count)}`,
    ``,
    isSeller
      ? `Bookmark it and check back any time — the numbers grow as your home keeps getting exposure:`
      : hasSellers
        ? `THIS WAS JUST EMAILED DIRECTLY TO YOUR SELLER (${sellers.map((s) => s.name?.trim() || s.email).join(", ")}). No need to forward it — they'll keep getting it every Monday while the listing is active. You can still open and share it yourself here:`
        : `PLEASE FORWARD THIS TO YOUR SELLER — paste the link into an email or a text. It's a live page they can bookmark and re-open any time. You'll get this reminder every Monday while the listing is active:`,
    c.story_url,
    ``,
    isSeller && opts.unsubscribeUrl
      ? `Unsubscribe from these weekly updates: ${opts.unsubscribeUrl}`
      : ``,
    `Sent from SocialMediaReport@c21anj.com · Alliance Social Analytics`,
  ].filter((line, i, arr) => !(line === "" && arr[i - 1] === ""));

  return { subject, html, text: textLines.join("\n") };
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
