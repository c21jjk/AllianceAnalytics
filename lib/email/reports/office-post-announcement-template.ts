import "server-only";
import type {
  AnnouncementCandidate,
  AnnouncementPostVariant,
  Platform,
} from "./office-post-announcement-data";

/**
 * Mobile-first HTML + plaintext renderer for the office post announcement
 * email. Single-column, big tap targets, hero photo, 2–3 platform cards
 * (whichever platforms actually ran for the campaign). Brand band header
 * matches the Owner Story styling.
 *
 * Subject: `New listing post is live — share it to your pages`
 *   (the CTA — reposting to the agent's own pages — is the whole point, so
 *   it leads the subject rather than the address.)
 */

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const PLATFORM_COLOR: Record<Platform, string> = {
  facebook: "#1877F2",
  instagram: "#E1306C",
  tiktok: "#000000",
};

const APP_BASE_URL = "https://www.alliancesocialanalytics.com";

const GOLD = "#C9A84C";
const GOLD_SOFT_BG = "#FBF7EE";
const GOLD_BORDER = "#E0C271";
const INK = "#252526";
const INK_SOFT = "#52525B";
const INK_MUTED = "#9A9A9C";
const PAGE_BG = "#FAFAF7";
const CARD_BG = "#FFFFFF";
const RULE = "#ECECEC";

export interface RenderedAnnouncement {
  subject: string;
  html: string;
  text: string;
}

export function renderOfficePostAnnouncement(
  c: AnnouncementCandidate,
): RenderedAnnouncement {
  const addressLine = (c.listing.address ?? "your listing").trim();
  const subject = `New listing post is live — share it to your pages`;
  return {
    subject,
    html: renderHtml(c, addressLine),
    text: renderText(c, addressLine),
  };
}

/* --------------------------------------------------------------------- */
/* HTML                                                                  */
/* --------------------------------------------------------------------- */

function renderHtml(c: AnnouncementCandidate, addressLine: string): string {
  // Email-safe centering: Gmail historically ignores `margin:0 auto` on a
  // div wrapper, anchoring the card to the left edge of the viewport with
  // empty space to the right. Wrapping in a `<table align="center">` is the
  // canonical fix — Gmail / Outlook / Apple Mail all honor it.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${PAGE_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Barlow',Helvetica,Arial,sans-serif;color:${INK};">
    <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background:${PAGE_BG};">
      <tr>
        <td align="center" style="padding:16px;">
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;background:${CARD_BG};border:1px solid ${RULE};border-radius:14px;overflow:hidden;">
            <tr><td>${renderBrandBand(c)}</td></tr>
            <tr><td>${renderHero(c, addressLine)}</td></tr>
            <tr><td>${renderCta()}</td></tr>
            <tr><td>${renderPlatformCards(c)}</td></tr>
            <tr><td>${renderFooter(c)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderBrandBand(c: AnnouncementCandidate): string {
  const eyebrow = c.audience.label;
  return `<div style="background:${GOLD_SOFT_BG};border-bottom:1px solid ${GOLD_BORDER};padding:16px 20px;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:${GOLD};">
      Century 21<sup style="font-size:7px;">®</sup> <span style="color:${INK_SOFT};font-weight:500;">Alliance</span>
    </div>
    <div style="margin-top:4px;font-size:13px;font-weight:600;color:${INK};letter-spacing:0.02em;">
      New post — ${escapeHtml(eyebrow)}
    </div>
  </div>`;
}

function renderHero(c: AnnouncementCandidate, addressLine: string): string {
  const heroUrl = c.listing.hero_image_url ?? firstThumb(c.posts);
  const placeLine = [c.listing.city, c.listing.state, c.listing.zip]
    .filter(Boolean)
    .join(" ")
    .trim();
  const heroBlock = heroUrl
    ? `<img src="${escapeAttr(heroUrl)}" alt="${escapeAttr(addressLine)}" style="display:block;width:100%;max-height:280px;object-fit:cover;" />`
    : `<div style="width:100%;height:200px;background:#eeeeee;"></div>`;
  return `${heroBlock}
    <div style="padding:18px 20px 0;">
      <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${INK_MUTED};font-weight:600;">
        New listing post
      </div>
      <div style="margin-top:4px;font-size:22px;font-weight:700;color:${INK};line-height:1.2;">
        ${escapeHtml(addressLine)}
      </div>
      ${
        placeLine
          ? `<div style="margin-top:2px;font-size:13px;color:${INK_SOFT};">${escapeHtml(placeLine)}</div>`
          : ""
      }
      ${
        c.listing.agent_name
          ? `<div style="margin-top:8px;font-size:13px;color:${INK_SOFT};">Listed by <strong style="color:${INK};font-weight:600;">${escapeHtml(c.listing.agent_name)}</strong></div>`
          : ""
      }
    </div>`;
}

function renderCta(): string {
  // The CTA is the whole point of this email — sized large, bold, gold-tinted
  // background, full-width, sits above the platform cards so it's the first
  // thing read after the listing identity.
  return `<div style="margin:18px 20px 16px;padding:18px 20px;background:${GOLD_SOFT_BG};border:1px solid ${GOLD_BORDER};border-radius:12px;">
    <p style="margin:0;font-size:17px;font-weight:600;color:${INK};line-height:1.5;text-align:left;">
      <strong style="color:${GOLD};text-transform:uppercase;letter-spacing:0.04em;">Share this to your own pages.</strong> Reposting to your Facebook and Instagram puts the listing in front of your sphere — every repost grows its reach and sends leads back to <strong style="color:${GOLD};text-transform:uppercase;letter-spacing:0.04em;">you</strong>.
    </p>
  </div>`;
}

function renderPlatformCards(c: AnnouncementCandidate): string {
  const cards = c.posts.map(platformCard).join("");
  return `<div style="padding:16px 20px 20px;">
    ${cards}
  </div>`;
}

function platformCard(post: AnnouncementPostVariant): string {
  const label = PLATFORM_LABEL[post.platform];
  const color = PLATFORM_COLOR[post.platform];
  const dateLabel = post.posted_at ? formatShortDate(post.posted_at) : "";
  const thumb = post.thumbnail_url
    ? `<a href="${escapeAttr(post.permalink ?? "#")}" target="_blank" rel="noopener noreferrer" style="display:block;text-decoration:none;">
         <img src="${escapeAttr(post.thumbnail_url)}" alt="${escapeAttr(label)} post thumbnail" style="display:block;width:100%;max-height:240px;object-fit:cover;background:#eeeeee;border-top-left-radius:10px;border-top-right-radius:10px;" />
       </a>`
    : `<div style="width:100%;height:160px;background:#eeeeee;border-top-left-radius:10px;border-top-right-radius:10px;"></div>`;
  return `<div style="background:#ffffff;border:1px solid ${RULE};border-radius:12px;overflow:hidden;margin-bottom:14px;box-shadow:0 1px 2px rgba(24,24,27,0.04),0 1px 3px rgba(24,24,27,0.06);">
    ${thumb}
    <div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="width:24px;height:24px;border-radius:50%;background:${color};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">
          ${platformInitial(post.platform)}
        </span>
        <div>
          <div style="font-size:13px;font-weight:600;color:${INK};line-height:1.1;">${escapeHtml(label)}</div>
          ${
            dateLabel
              ? `<div style="font-size:11px;color:${INK_MUTED};margin-top:2px;">Posted ${escapeHtml(dateLabel)}</div>`
              : ""
          }
        </div>
      </div>
      <a href="${escapeAttr(post.permalink ?? "#")}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;padding:10px 14px;border-radius:999px;background:${GOLD};color:#ffffff;font-weight:600;font-size:13px;text-decoration:none;white-space:nowrap;min-height:36px;">
        Open & repost →
      </a>
    </div>
  </div>`;
}

function platformInitial(platform: Platform): string {
  if (platform === "facebook") return "f";
  if (platform === "instagram") return "IG";
  return "TT";
}

function renderFooter(c: AnnouncementCandidate): string {
  const rosterPhrase =
    c.audience.kind === "office"
      ? `Sent because you&apos;re on the ${escapeHtml(c.audience.label)} roster.`
      : `Sent because you&apos;re on the ${escapeHtml(c.audience.label)} roster.`;
  const subscribersUrl = `${APP_BASE_URL}/settings/subscribers`;
  return `<div style="padding:16px 20px;background:${PAGE_BG};border-top:1px solid ${RULE};font-size:11px;color:${INK_MUTED};line-height:1.5;">
    ${rosterPhrase}<br />
    <a href="${escapeAttr(subscribersUrl)}" style="color:${INK_SOFT};text-decoration:underline;">Manage your alert preferences</a>
  </div>`;
}

function firstThumb(posts: AnnouncementPostVariant[]): string | null {
  for (const p of posts) {
    if (p.thumbnail_url) return p.thumbnail_url;
  }
  return null;
}

/* --------------------------------------------------------------------- */
/* Plaintext                                                             */
/* --------------------------------------------------------------------- */

function renderText(c: AnnouncementCandidate, addressLine: string): string {
  const lines: string[] = [];
  lines.push(`New ${c.audience.label} post`);
  lines.push(``);
  lines.push(addressLine);
  const placeLine = [c.listing.city, c.listing.state, c.listing.zip]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (placeLine) lines.push(placeLine);
  if (c.listing.agent_name) lines.push(`Listed by ${c.listing.agent_name}`);
  lines.push(``);
  lines.push(
    `SHARE THIS TO YOUR OWN PAGES. Reposting to your Facebook and Instagram puts the listing in front of your sphere — every repost grows its reach and sends leads back to YOU.`,
  );
  lines.push(``);
  for (const p of c.posts) {
    const date = p.posted_at ? formatShortDate(p.posted_at) : "";
    lines.push(`${PLATFORM_LABEL[p.platform]}${date ? ` · Posted ${date}` : ""}`);
    if (p.permalink) lines.push(`  ${p.permalink}`);
    lines.push(``);
  }
  lines.push(`—`);
  lines.push(
    `Sent because you're on the ${c.audience.label} roster. Manage preferences:`,
  );
  lines.push(`${APP_BASE_URL}/settings/subscribers`);
  return lines.join("\n");
}

/* --------------------------------------------------------------------- */
/* Helpers                                                               */
/* --------------------------------------------------------------------- */

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
