import "server-only";
import {
  type WeeklySocialReportData,
  type WeeklyPlatform,
  type WeeklyTopPost,
  type WeeklyListingMention,
  type WeeklyPlatformStats,
} from "./weekly-social-data";

/**
 * HTML + plaintext renderer for the weekly social media email report.
 *
 * Pure function over WeeklySocialReportData — no I/O. Brand-styled to match
 * the dashboard: Obsessed Grey header, Relentless Gold eyebrow, Barlow with
 * system-font fallbacks (Barlow won't render in most email clients without
 * an embedded font, which we intentionally avoid for deliverability).
 *
 * Top-post and listing links point at the live app
 * (https://alliance-analytics.vercel.app/posts/{id} and /listings/{id}) so
 * recipients can drill in.
 */

const APP_BASE_URL = "https://alliance-analytics.vercel.app";

const PLATFORM_LABEL: Record<WeeklyPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

const PLATFORM_COLOR: Record<WeeklyPlatform, string> = {
  facebook: "#1877F2",
  instagram: "#E1306C",
  tiktok: "#000000",
};

export interface RenderedWeeklyReport {
  subject: string;
  html: string;
  text: string;
}

export function renderWeeklySocialEmail(
  data: WeeklySocialReportData,
): RenderedWeeklyReport {
  const subject = `Alliance Social — Week of ${data.weekStartLabel}–${data.weekEndLabel}`;
  const html = renderHtml(data);
  const text = renderText(data);
  return { subject, html, text };
}

function renderHtml(d: WeeklySocialReportData): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Barlow',Helvetica,Arial,sans-serif;color:#252526;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">
      ${renderHeader(d)}
      ${renderHeadline(d)}
      ${renderPlatformRow(d)}
      ${renderTopPosts(d)}
      ${renderListings(d)}
      ${renderInsight()}
      ${renderFooter()}
    </div>
  </body>
</html>`;
}

function renderHeader(d: WeeklySocialReportData): string {
  return `<div style="background:#252526;padding:24px 28px;">
    <div style="color:#C9A84C;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">
      Alliance Social Analytics
    </div>
    <div style="color:#ffffff;font-size:22px;font-weight:600;margin-top:6px;line-height:1.2;">
      Weekly Recap — Week of ${escapeHtml(d.weekStartLabel)}–${escapeHtml(d.weekEndLabel)}
    </div>
  </div>`;
}

function renderHeadline(d: WeeklySocialReportData): string {
  const delta = deltaParts(d.totals.reach, d.prevTotals.reach);
  return `<div style="padding:28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">
      Total reach this week
    </div>
    <div style="font-size:44px;font-weight:700;color:#252526;margin-top:4px;line-height:1;">
      ${formatNumber(d.totals.reach)}
    </div>
    <div style="margin-top:10px;font-size:13px;color:${delta.color};font-weight:600;">
      ${delta.arrow} ${escapeHtml(delta.label)} vs. last week (${formatNumber(d.prevTotals.reach)})
    </div>
    <div style="margin-top:6px;font-size:12px;color:#71717a;">
      ${d.totals.posts} ${pluralize(d.totals.posts, "post")} published across Facebook, Instagram, and TikTok.
    </div>
  </div>`;
}

function renderPlatformRow(d: WeeklySocialReportData): string {
  const platforms: WeeklyPlatform[] = ["facebook", "instagram", "tiktok"];
  const cells = platforms
    .map((p) =>
      platformCell(p, d.byPlatform[p], d.prevByPlatform[p]),
    )
    .join("");
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:14px;">
      By platform
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
      <tr>${cells}</tr>
    </table>
  </div>`;
}

function platformCell(
  platform: WeeklyPlatform,
  current: WeeklyPlatformStats,
  prev: WeeklyPlatformStats,
): string {
  const delta = deltaParts(current.reach, prev.reach);
  return `<td style="width:33.33%;padding:0 6px;vertical-align:top;" align="left">
    <div style="border:1px solid #eeeeee;border-radius:10px;padding:14px;background:#fafafa;">
      <div style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;color:#ffffff;background:${PLATFORM_COLOR[platform]};letter-spacing:0.05em;">
        ${escapeHtml(PLATFORM_LABEL[platform].toUpperCase())}
      </div>
      <div style="font-size:22px;font-weight:700;color:#252526;margin-top:10px;line-height:1;">
        ${formatNumber(current.reach)}
      </div>
      <div style="font-size:11px;color:#71717a;margin-top:4px;">reach</div>
      <div style="font-size:12px;color:#3f3f46;margin-top:10px;">
        ${current.posts} ${pluralize(current.posts, "post")}
      </div>
      <div style="font-size:11px;color:${delta.color};font-weight:600;margin-top:6px;">
        ${delta.arrow} ${escapeHtml(delta.label)}
      </div>
    </div>
  </td>`;
}

function renderTopPosts(d: WeeklySocialReportData): string {
  if (d.topPosts.length === 0) {
    return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
      <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">
        Top posts this week
      </div>
      <div style="font-size:13px;color:#71717a;">No posts in this window yet.</div>
    </div>`;
  }
  const rows = d.topPosts
    .map((post, idx) => topPostRow(post, idx + 1))
    .join("");
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:14px;">
      Top posts this week
    </div>
    ${rows}
  </div>`;
}

function topPostRow(post: WeeklyTopPost, rank: number): string {
  const url = `${APP_BASE_URL}/posts/${post.id}`;
  const captionSnippet = truncate(post.caption ?? "", 140);
  const place =
    [post.property_address, post.property_city].filter(Boolean).join(", ") ||
    "—";
  const thumbCell = post.thumbnail_url
    ? `<td style="width:64px;padding-right:14px;vertical-align:top;">
         <a href="${escapeAttr(url)}" style="text-decoration:none;">
           <img src="${escapeAttr(post.thumbnail_url)}" width="64" height="64" alt="" style="display:block;border-radius:8px;object-fit:cover;background:#eeeeee;" />
         </a>
       </td>`
    : `<td style="width:64px;padding-right:14px;vertical-align:top;">
         <div style="width:64px;height:64px;border-radius:8px;background:#eeeeee;"></div>
       </td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:14px;">
    <tr>
      ${thumbCell}
      <td style="vertical-align:top;">
        <div style="font-size:11px;letter-spacing:0.05em;color:#71717a;text-transform:uppercase;font-weight:600;">
          #${rank} · <span style="color:${PLATFORM_COLOR[post.platform]};">${escapeHtml(PLATFORM_LABEL[post.platform])}</span> · ${formatNumber(post.reach)} reach
        </div>
        <div style="font-size:13px;color:#252526;margin-top:4px;line-height:1.45;">
          ${escapeHtml(captionSnippet) || "<span style=\"color:#a1a1aa;\">No caption</span>"}
        </div>
        <div style="font-size:11px;color:#71717a;margin-top:6px;">
          ${escapeHtml(place)} · <a href="${escapeAttr(url)}" style="color:#C9A84C;text-decoration:none;font-weight:600;">View on dashboard →</a>
        </div>
      </td>
    </tr>
  </table>`;
}

function renderListings(d: WeeklySocialReportData): string {
  if (d.listingsTotal === 0) {
    return "";
  }
  const items = d.listings
    .map((l) => listingRow(l))
    .join("");
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
      Listings represented
    </div>
    <div style="font-size:13px;color:#252526;margin-bottom:12px;">
      <strong>${d.listingsTotal}</strong> ${pluralize(d.listingsTotal, "listing")} featured in posts this week.
    </div>
    ${items}
  </div>`;
}

function listingRow(l: WeeklyListingMention): string {
  const url = `${APP_BASE_URL}/listings/${l.property_id}`;
  const place =
    [l.address, l.city].filter(Boolean).join(", ") || "Unaddressed listing";
  return `<div style="font-size:12px;color:#3f3f46;padding:6px 0;">
    <a href="${escapeAttr(url)}" style="color:#252526;text-decoration:none;font-weight:600;">${escapeHtml(place)}</a>
    <span style="color:#a1a1aa;"> · ${l.post_count} ${pluralize(l.post_count, "post")}</span>
  </div>`;
}

function renderInsight(): string {
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;background:#fdfaf2;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">
      AI takeaway
    </div>
    <div style="font-size:13px;color:#252526;line-height:1.5;">
      <em style="color:#71717a;">Wiring Claude into this slot next — preview placeholder.</em>
    </div>
  </div>`;
}

function renderFooter(): string {
  return `<div style="padding:18px 28px;background:#fafafa;">
    <div style="font-size:12px;color:#71717a;line-height:1.5;">
      Reply to this email to talk to John about the report.
    </div>
    <div style="font-size:11px;color:#a1a1aa;margin-top:6px;">
      Sent from SocialMediaReport@c21anj.com · Alliance Social Analytics
    </div>
  </div>`;
}

function renderText(d: WeeklySocialReportData): string {
  const lines: string[] = [
    `Alliance Social — Weekly Recap`,
    `Week of ${d.weekStartLabel}–${d.weekEndLabel}`,
    ``,
    `TOTAL REACH: ${formatNumber(d.totals.reach)}`,
    `  vs. last week: ${formatNumber(d.prevTotals.reach)} (${signedPct(d.totals.reach, d.prevTotals.reach)})`,
    `  ${d.totals.posts} ${pluralize(d.totals.posts, "post")} published.`,
    ``,
    `BY PLATFORM:`,
  ];
  for (const p of ["facebook", "instagram", "tiktok"] as WeeklyPlatform[]) {
    const c = d.byPlatform[p];
    const pr = d.prevByPlatform[p];
    lines.push(
      `  ${PLATFORM_LABEL[p].padEnd(10)} reach ${formatNumber(c.reach).padStart(8)}  posts ${String(c.posts).padStart(3)}  (${signedPct(c.reach, pr.reach)} WoW)`,
    );
  }
  lines.push("");
  if (d.topPosts.length > 0) {
    lines.push(`TOP POSTS:`);
    d.topPosts.forEach((post, idx) => {
      const place =
        [post.property_address, post.property_city].filter(Boolean).join(", ") ||
        "—";
      lines.push(
        `  ${idx + 1}. [${PLATFORM_LABEL[post.platform]}] ${formatNumber(post.reach)} reach`,
      );
      lines.push(`     ${truncate(post.caption ?? "", 100) || "(no caption)"}`);
      lines.push(`     ${place}`);
      lines.push(`     ${APP_BASE_URL}/posts/${post.id}`);
    });
    lines.push("");
  }
  if (d.listingsTotal > 0) {
    lines.push(
      `LISTINGS: ${d.listingsTotal} ${pluralize(d.listingsTotal, "listing")} featured.`,
    );
    for (const l of d.listings) {
      const place =
        [l.address, l.city].filter(Boolean).join(", ") || "Unaddressed";
      lines.push(`  - ${place} (${l.post_count} ${pluralize(l.post_count, "post")})`);
    }
    lines.push("");
  }
  lines.push(`Reply to this email to talk to John about the report.`);
  lines.push(`Sent from SocialMediaReport@c21anj.com`);
  return lines.join("\n");
}

/* -------- formatting helpers -------- */

function deltaParts(
  current: number,
  prev: number,
): { label: string; arrow: string; color: string } {
  if (prev === 0 && current === 0) {
    return { label: "flat", arrow: "→", color: "#71717a" };
  }
  if (prev === 0) {
    return { label: "new this week", arrow: "↑", color: "#15803d" };
  }
  const diff = current - prev;
  const pct = (diff / prev) * 100;
  if (Math.abs(pct) < 1) {
    return { label: "flat", arrow: "→", color: "#71717a" };
  }
  const sign = pct > 0 ? "+" : "";
  const label = `${sign}${pct.toFixed(0)}%`;
  if (pct > 0) return { label, arrow: "↑", color: "#15803d" };
  return { label, arrow: "↓", color: "#b91c1c" };
}

function signedPct(current: number, prev: number): string {
  if (prev === 0 && current === 0) return "flat";
  if (prev === 0) return "new";
  const pct = ((current - prev) / prev) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function pluralize(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
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
