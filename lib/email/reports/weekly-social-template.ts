import "server-only";
import {
  type WeeklySocialReportData,
  type WeeklyPlatform,
  type WeeklyTopCampaign,
  type WeeklyListingMention,
  type WeeklyPlatformStats,
  type AggregateWindow,
  type WeeklyOfficeSpotlight,
  type WeeklyAgentLeader,
} from "./weekly-social-data";

/**
 * HTML + plaintext renderer for the weekly social media email report.
 *
 * Layout (top → bottom):
 *   1. Header — Obsessed Grey + gold "Weekly Recap"
 *   2. Big-picture YTD banner — leadership headline
 *   3. This-week headline (WoW + YoY)
 *   4. Per-platform 3-card row
 *   5. Top campaigns (merged across platforms)
 *   6. Year-to-date stats (3 stats with YoY deltas)
 *   7. Office spotlight (if office_id data exists)
 *   8. Agent leaderboard (if agent_name data exists)
 *   9. Listings represented
 *  10. AI takeaway (Claude-generated one-liner; safe fallback)
 *  11. Manager call-to-action
 *  12. Footer
 *
 * All sections degrade gracefully when their data is missing (empty windows,
 * no office tags, no agents) — the section either hides or shows a friendly
 * placeholder rather than rendering a half-broken row.
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

const BRAND_GREY = "#252526";
const BRAND_GOLD = "#C9A84C";

export interface RenderedWeeklyReport {
  subject: string;
  html: string;
  text: string;
}

export function renderWeeklySocialEmail(
  data: WeeklySocialReportData,
  aiTakeaway: string,
): RenderedWeeklyReport {
  const subject = `Alliance Social — Week of ${data.weekStartLabel}–${data.weekEndLabel}`;
  return {
    subject,
    html: renderHtml(data, aiTakeaway),
    text: renderText(data, aiTakeaway),
  };
}

/* --------------------------------------------------------------------- */
/* HTML                                                                  */
/* --------------------------------------------------------------------- */

function renderHtml(d: WeeklySocialReportData, aiTakeaway: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Barlow',Helvetica,Arial,sans-serif;color:${BRAND_GREY};">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">
      ${renderHeader(d)}
      ${renderBigPictureBanner(d)}
      ${renderHeadline(d)}
      ${renderPlatformRow(d)}
      ${renderTopCampaigns(d)}
      ${renderYtd(d)}
      ${renderOfficeSpotlight(d)}
      ${renderAgentLeaderboard(d)}
      ${renderListings(d)}
      ${renderInsight(aiTakeaway)}
      ${renderManagerCta()}
      ${renderFooter()}
    </div>
  </body>
</html>`;
}

function renderHeader(d: WeeklySocialReportData): string {
  return `<div style="background:${BRAND_GREY};padding:24px 28px;">
    <div style="color:${BRAND_GOLD};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">
      Alliance Social Analytics
    </div>
    <div style="color:#ffffff;font-size:22px;font-weight:600;margin-top:6px;line-height:1.2;">
      Weekly Recap — Week of ${escapeHtml(d.weekStartLabel)}–${escapeHtml(d.weekEndLabel)}
    </div>
  </div>`;
}

function renderBigPictureBanner(d: WeeklySocialReportData): string {
  const yoy = deltaParts(d.ytd.reach, d.ytdYoY.reach);
  const compareLabel =
    d.ytdYoY.reach > 0
      ? `${yoy.arrow} ${escapeHtml(yoy.label)} vs. ${escapeHtml(d.ytdYoYYearLabel)} year-to-date`
      : `First full year tracking this metric — baseline year`;
  return `<div style="padding:28px;background:linear-gradient(135deg,#fdfaf2 0%,#ffffff 100%);border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">
      The big picture · ${escapeHtml(d.ytdYearLabel)} year-to-date
    </div>
    <div style="font-size:48px;font-weight:700;color:${BRAND_GREY};margin-top:6px;line-height:1;">
      ${formatNumber(d.ytd.reach)}
    </div>
    <div style="font-size:12px;color:#71717a;margin-top:4px;letter-spacing:0.04em;text-transform:uppercase;">
      Total reach
    </div>
    <div style="margin-top:14px;font-size:13px;color:${yoy.color};font-weight:600;">
      ${escapeHtml(compareLabel)}
    </div>
    <div style="margin-top:10px;font-size:12px;color:#3f3f46;">
      ${formatNumber(d.ytd.posts)} ${pluralize(d.ytd.posts, "post")} ·
      ${formatNumber(d.ytd.listings)} ${pluralize(d.ytd.listings, "listing")} featured
    </div>
  </div>`;
}

function renderHeadline(d: WeeklySocialReportData): string {
  const wow = deltaParts(d.totals.reach, d.prevTotals.reach);
  const yoy = deltaParts(d.totals.reach, d.weekYoY.reach);
  const yoyLine =
    d.weekYoY.reach > 0
      ? `${yoy.arrow} <span style="color:${yoy.color};font-weight:600;">${escapeHtml(yoy.label)}</span> vs. same week ${escapeHtml(d.ytdYoYYearLabel)}`
      : `<span style="color:#71717a;">No comparable week last year.</span>`;
  return `<div style="padding:24px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">
      This week's reach
    </div>
    <div style="font-size:36px;font-weight:700;color:${BRAND_GREY};margin-top:4px;line-height:1;">
      ${formatNumber(d.totals.reach)}
    </div>
    <div style="margin-top:10px;font-size:13px;color:${wow.color};font-weight:600;">
      ${wow.arrow} ${escapeHtml(wow.label)} vs. last week (${formatNumber(d.prevTotals.reach)})
    </div>
    <div style="margin-top:4px;font-size:12px;">${yoyLine}</div>
    <div style="margin-top:8px;font-size:12px;color:#71717a;">
      ${d.totals.posts} ${pluralize(d.totals.posts, "post")} across Facebook, Instagram, and TikTok.
    </div>
  </div>`;
}

function renderPlatformRow(d: WeeklySocialReportData): string {
  const platforms: WeeklyPlatform[] = ["facebook", "instagram", "tiktok"];
  const cells = platforms
    .map((p) => platformCell(p, d.byPlatform[p], d.prevByPlatform[p]))
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
      <div style="font-size:22px;font-weight:700;color:${BRAND_GREY};margin-top:10px;line-height:1;">
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

function renderTopCampaigns(d: WeeklySocialReportData): string {
  if (d.topCampaigns.length === 0) {
    return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
      <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">
        Top campaigns this week
      </div>
      <div style="font-size:13px;color:#71717a;">No posts in this window yet.</div>
    </div>`;
  }
  const rows = d.topCampaigns
    .map((c, idx) => topCampaignRow(c, idx + 1))
    .join("");
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:6px;">
      Top campaigns this week
    </div>
    <div style="font-size:12px;color:#71717a;margin-bottom:14px;">
      Reach merged across every platform the campaign ran on.
    </div>
    ${rows}
  </div>`;
}

function topCampaignRow(campaign: WeeklyTopCampaign, rank: number): string {
  const url = `${APP_BASE_URL}${campaign.linkPath}`;
  const captionSnippet = truncate(campaign.caption ?? "", 140);
  const place =
    [campaign.property_address, campaign.property_city]
      .filter(Boolean)
      .join(", ") || "";
  const platformBadges = campaign.platforms
    .map((p) => {
      const stats = campaign.perPlatform[p];
      const reach = stats?.reach ?? 0;
      return `<span style="display:inline-block;margin-right:6px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;color:#ffffff;background:${PLATFORM_COLOR[p]};letter-spacing:0.04em;">${escapeHtml(PLATFORM_LABEL[p])} ${formatNumber(reach)}</span>`;
    })
    .join("");

  const thumbCell = campaign.thumbnail_url
    ? `<td style="width:72px;padding-right:14px;vertical-align:top;">
         <a href="${escapeAttr(url)}" style="text-decoration:none;">
           <img src="${escapeAttr(campaign.thumbnail_url)}" width="72" height="72" alt="" style="display:block;border-radius:8px;object-fit:cover;background:#eeeeee;" />
         </a>
       </td>`
    : `<td style="width:72px;padding-right:14px;vertical-align:top;">
         <div style="width:72px;height:72px;border-radius:8px;background:#eeeeee;"></div>
       </td>`;

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <tr>
      ${thumbCell}
      <td style="vertical-align:top;">
        <div style="display:flex;align-items:baseline;gap:8px;">
          <span style="font-size:11px;letter-spacing:0.05em;color:#71717a;text-transform:uppercase;font-weight:700;">#${rank}</span>
          <span style="font-size:20px;font-weight:700;color:${BRAND_GREY};line-height:1;">${formatNumber(campaign.mergedReach)}</span>
          <span style="font-size:11px;color:#71717a;">merged reach</span>
        </div>
        <div style="margin-top:6px;">${platformBadges}</div>
        <div style="font-size:13px;color:${BRAND_GREY};margin-top:8px;line-height:1.45;">
          ${escapeHtml(captionSnippet) || "<span style=\"color:#a1a1aa;\">No caption</span>"}
        </div>
        <div style="font-size:11px;color:#71717a;margin-top:6px;">
          ${place ? escapeHtml(place) + " · " : ""}<a href="${escapeAttr(url)}" style="color:${BRAND_GOLD};text-decoration:none;font-weight:600;">View on dashboard →</a>
        </div>
      </td>
    </tr>
  </table>`;
}

function renderYtd(d: WeeklySocialReportData): string {
  const reachSplit = platformSplitRows(d.ytdByPlatform, "reach");
  const postsSplit = platformSplitRows(d.ytdByPlatform, "posts");
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:14px;">
      Year-to-date · ${escapeHtml(d.ytdYearLabel)} vs. ${escapeHtml(d.ytdYoYYearLabel)}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
      <tr>
        ${ytdCell("Reach", d.ytd.reach, d.ytdYoY.reach, reachSplit)}
        ${ytdCell("Posts", d.ytd.posts, d.ytdYoY.posts, postsSplit)}
        ${ytdCell("Listings", d.ytd.listings, d.ytdYoY.listings, null)}
      </tr>
    </table>
  </div>`;
}

function ytdCell(
  label: string,
  current: number,
  prev: number,
  miniSplitHtml: string | null,
): string {
  const delta = deltaParts(current, prev);
  const yoyText =
    prev > 0
      ? `${delta.arrow} ${escapeHtml(delta.label)} YoY`
      : "<span style=\"color:#71717a;\">No YoY baseline yet</span>";
  return `<td style="width:33.33%;padding:0 6px;vertical-align:top;" align="left">
    <div style="border:1px solid #eeeeee;border-radius:10px;padding:14px;background:#ffffff;">
      <div style="font-size:11px;color:#71717a;letter-spacing:0.05em;text-transform:uppercase;font-weight:600;">${escapeHtml(label)}</div>
      <div style="font-size:24px;font-weight:700;color:${BRAND_GREY};margin-top:4px;line-height:1;">${formatNumber(current)}</div>
      <div style="font-size:11px;color:${prev > 0 ? delta.color : "#71717a"};margin-top:8px;font-weight:600;">${yoyText}</div>
      <div style="font-size:11px;color:#a1a1aa;margin-top:2px;">${formatNumber(prev)} in prior year</div>
      ${miniSplitHtml ?? ""}
    </div>
  </td>`;
}

/**
 * Renders a tiny 3-row platform split (FB / IG / TT) below the headline number
 * in a YTD cell. `field` selects which platform stat (`reach` or `posts`) to show.
 */
function platformSplitRows(
  byPlatform: Record<WeeklyPlatform, WeeklyPlatformStats>,
  field: "reach" | "posts",
): string {
  const platforms: WeeklyPlatform[] = ["facebook", "instagram", "tiktok"];
  const rows = platforms
    .map((p) => {
      const value = byPlatform[p][field];
      return `<tr>
        <td style="padding:2px 0;width:14px;vertical-align:middle;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${PLATFORM_COLOR[p]};"></span>
        </td>
        <td style="padding:2px 0;font-size:11px;color:#3f3f46;">${escapeHtml(PLATFORM_LABEL[p])}</td>
        <td style="padding:2px 0;font-size:11px;color:${BRAND_GREY};font-weight:600;text-align:right;">${formatNumber(value)}</td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:10px;border-top:1px solid #f5f5f5;padding-top:6px;">
    ${rows}
  </table>`;
}

function renderOfficeSpotlight(d: WeeklySocialReportData): string {
  const office = d.officeSpotlight;
  if (!office) return "";
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
      Office spotlight
    </div>
    <div style="border:1px solid ${BRAND_GOLD};border-radius:10px;padding:16px;background:#fdfaf2;">
      <div style="font-size:11px;color:${BRAND_GOLD};letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">
        Top office this week
      </div>
      <div style="font-size:20px;font-weight:700;color:${BRAND_GREY};margin-top:4px;line-height:1.2;">
        ${escapeHtml(office.name)}
      </div>
      <div style="font-size:13px;color:#3f3f46;margin-top:8px;">
        <strong>${formatNumber(office.reach)}</strong> reach · ${office.posts} ${pluralize(office.posts, "post")}
      </div>
    </div>
  </div>`;
}

function renderAgentLeaderboard(d: WeeklySocialReportData): string {
  if (d.agentLeaderboard.length === 0) return "";
  const rows = d.agentLeaderboard
    .map((agent, idx) => agentRow(agent, idx + 1))
    .join("");
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:12px;">
      Agent leaderboard
    </div>
    ${rows}
  </div>`;
}

function agentRow(agent: WeeklyAgentLeader, rank: number): string {
  return `<div style="display:flex;align-items:baseline;gap:12px;padding:6px 0;border-bottom:1px solid #f5f5f5;">
    <span style="font-size:11px;color:#71717a;letter-spacing:0.05em;font-weight:700;width:24px;">#${rank}</span>
    <span style="font-size:14px;color:${BRAND_GREY};font-weight:600;flex:1;">${escapeHtml(agent.display_name)}</span>
    <span style="font-size:13px;color:${BRAND_GREY};font-weight:700;">${formatNumber(agent.reach)}</span>
    <span style="font-size:11px;color:#71717a;">reach · ${agent.posts}p</span>
  </div>`;
}

function renderListings(d: WeeklySocialReportData): string {
  if (d.listingsTotal === 0) return "";
  const items = d.listings.map((l) => listingRow(l)).join("");
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
      Listings represented
    </div>
    <div style="font-size:13px;color:${BRAND_GREY};margin-bottom:12px;">
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
    <a href="${escapeAttr(url)}" style="color:${BRAND_GREY};text-decoration:none;font-weight:600;">${escapeHtml(place)}</a>
    <span style="color:#a1a1aa;"> · ${l.post_count} ${pluralize(l.post_count, "post")}</span>
  </div>`;
}

function renderInsight(line: string): string {
  return `<div style="padding:20px 28px;border-bottom:1px solid #f0f0f0;background:#fdfaf2;">
    <div style="font-size:11px;color:#71717a;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">
      AI takeaway
    </div>
    <div style="font-size:13px;color:${BRAND_GREY};line-height:1.5;">
      ${escapeHtml(line)}
    </div>
  </div>`;
}

function renderManagerCta(): string {
  return `<div style="padding:24px 28px;background:${BRAND_GREY};color:#ffffff;">
    <div style="font-size:11px;color:${BRAND_GOLD};letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">
      How to amplify next week
    </div>
    <div style="font-size:14px;color:#ffffff;margin-top:8px;line-height:1.55;">
      When agents engage with each other's posts — likes, shares, comments —
      Alliance's combined reach multiplies. Forward this to your office team
      and ask them to support each other's content. Every interaction makes
      every listing's commercial bigger.
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

/* --------------------------------------------------------------------- */
/* Plaintext                                                             */
/* --------------------------------------------------------------------- */

function renderText(d: WeeklySocialReportData, aiTakeaway: string): string {
  const lines: string[] = [];
  lines.push(`Alliance Social — Weekly Recap`);
  lines.push(`Week of ${d.weekStartLabel}–${d.weekEndLabel}`);
  lines.push(``);

  lines.push(`THE BIG PICTURE · ${d.ytdYearLabel} year-to-date`);
  lines.push(`  ${formatNumber(d.ytd.reach)} reach · ${formatNumber(d.ytd.posts)} posts · ${formatNumber(d.ytd.listings)} listings featured`);
  if (d.ytdYoY.reach > 0) {
    lines.push(
      `  vs. ${d.ytdYoYYearLabel}: ${formatNumber(d.ytdYoY.reach)} reach (${signedPct(d.ytd.reach, d.ytdYoY.reach)})`,
    );
  } else {
    lines.push(`  vs. ${d.ytdYoYYearLabel}: baseline year (no comparable data)`);
  }
  lines.push(``);

  lines.push(`THIS WEEK`);
  lines.push(
    `  ${formatNumber(d.totals.reach)} reach · ${d.totals.posts} ${pluralize(d.totals.posts, "post")}`,
  );
  lines.push(
    `  vs. last week: ${formatNumber(d.prevTotals.reach)} (${signedPct(d.totals.reach, d.prevTotals.reach)})`,
  );
  if (d.weekYoY.reach > 0) {
    lines.push(
      `  vs. same week ${d.ytdYoYYearLabel}: ${formatNumber(d.weekYoY.reach)} (${signedPct(d.totals.reach, d.weekYoY.reach)})`,
    );
  } else {
    lines.push(`  vs. same week ${d.ytdYoYYearLabel}: no comparable week`);
  }
  lines.push(``);

  lines.push(`BY PLATFORM`);
  for (const p of ["facebook", "instagram", "tiktok"] as WeeklyPlatform[]) {
    const c = d.byPlatform[p];
    const pr = d.prevByPlatform[p];
    lines.push(
      `  ${PLATFORM_LABEL[p].padEnd(10)} reach ${formatNumber(c.reach).padStart(8)}  posts ${String(c.posts).padStart(3)}  (${signedPct(c.reach, pr.reach)} WoW)`,
    );
  }
  lines.push(``);

  if (d.topCampaigns.length > 0) {
    lines.push(`TOP CAMPAIGNS (merged reach across platforms)`);
    d.topCampaigns.forEach((c, idx) => {
      const place =
        [c.property_address, c.property_city].filter(Boolean).join(", ") || "—";
      const platformBreakdown = c.platforms
        .map((p) => `${PLATFORM_LABEL[p]} ${formatNumber(c.perPlatform[p]?.reach ?? 0)}`)
        .join(" · ");
      lines.push(`  ${idx + 1}. ${formatNumber(c.mergedReach)} merged reach`);
      lines.push(`     ${platformBreakdown}`);
      lines.push(`     ${truncate(c.caption ?? "", 100) || "(no caption)"}`);
      lines.push(`     ${place}`);
      lines.push(`     ${APP_BASE_URL}${c.linkPath}`);
    });
    lines.push(``);
  }

  lines.push(`YEAR-TO-DATE`);
  lines.push(
    `  Reach    ${formatNumber(d.ytd.reach).padStart(10)} · prior year ${formatNumber(d.ytdYoY.reach)} (${signedPct(d.ytd.reach, d.ytdYoY.reach)})`,
  );
  for (const p of ["facebook", "instagram", "tiktok"] as WeeklyPlatform[]) {
    lines.push(
      `      ${PLATFORM_LABEL[p].padEnd(10)} ${formatNumber(d.ytdByPlatform[p].reach).padStart(8)}`,
    );
  }
  lines.push(
    `  Posts    ${String(d.ytd.posts).padStart(10)} · prior year ${d.ytdYoY.posts} (${signedPct(d.ytd.posts, d.ytdYoY.posts)})`,
  );
  for (const p of ["facebook", "instagram", "tiktok"] as WeeklyPlatform[]) {
    lines.push(
      `      ${PLATFORM_LABEL[p].padEnd(10)} ${String(d.ytdByPlatform[p].posts).padStart(8)}`,
    );
  }
  lines.push(
    `  Listings ${String(d.ytd.listings).padStart(10)} · prior year ${d.ytdYoY.listings} (${signedPct(d.ytd.listings, d.ytdYoY.listings)})`,
  );
  lines.push(``);

  if (d.officeSpotlight) {
    lines.push(`OFFICE SPOTLIGHT`);
    lines.push(
      `  ${d.officeSpotlight.name} · ${formatNumber(d.officeSpotlight.reach)} reach · ${d.officeSpotlight.posts} ${pluralize(d.officeSpotlight.posts, "post")}`,
    );
    lines.push(``);
  }

  if (d.agentLeaderboard.length > 0) {
    lines.push(`AGENT LEADERBOARD`);
    d.agentLeaderboard.forEach((a, idx) => {
      lines.push(
        `  ${idx + 1}. ${a.display_name} — ${formatNumber(a.reach)} reach (${a.posts} ${pluralize(a.posts, "post")})`,
      );
    });
    lines.push(``);
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
    lines.push(``);
  }

  lines.push(`AI TAKEAWAY`);
  lines.push(`  ${aiTakeaway}`);
  lines.push(``);

  lines.push(`HOW TO AMPLIFY NEXT WEEK`);
  lines.push(
    `  When agents engage with each other's posts — likes, shares, comments`,
  );
  lines.push(
    `  — Alliance's combined reach multiplies. Forward this to your office`,
  );
  lines.push(
    `  team and ask them to support each other's content. Every interaction`,
  );
  lines.push(`  makes every listing's commercial bigger.`);
  lines.push(``);

  lines.push(`Reply to this email to talk to John about the report.`);
  lines.push(`Sent from SocialMediaReport@c21anj.com`);
  return lines.join("\n");
}

/* --------------------------------------------------------------------- */
/* Formatting helpers                                                    */
/* --------------------------------------------------------------------- */

function deltaParts(
  current: number,
  prev: number,
): { label: string; arrow: string; color: string } {
  if (prev === 0 && current === 0) {
    return { label: "flat", arrow: "→", color: "#71717a" };
  }
  if (prev === 0) {
    return { label: "new", arrow: "↑", color: "#15803d" };
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

// Suppress "unused type import" warnings for types only referenced in JSDoc.
// (Kept here so the public types remain re-exportable from this file.)
export type {
  WeeklyTopCampaign,
  WeeklyListingMention,
  WeeklyPlatformStats,
  AggregateWindow,
  WeeklyOfficeSpotlight,
  WeeklyAgentLeader,
};
