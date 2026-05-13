import {
  BADGE_CSS,
  buildChips,
  canonicalMlsHashtag,
  commonSquareHead,
  escapeHtml,
  formatOpenHouse,
  renderBadge,
  resolvePriceText,
  type PostBuilderListingWithOH,
  type PostTypeTheme,
} from "./_shared";

/**
 * v2 · Bold Stats · Square 1080×1080
 *
 * Photo top 60% (648px), data block bottom 40% (432px) on a near-black
 * surface. Address above a gold rule, OVERSIZED price, inline stat row.
 *
 * More magazine-like than v1 — type doesn't fight the photo, the photo
 * gets to breathe. Great for listings where the architecture/exterior is
 * the story.
 *
 * Works for all 4 post types via the PostTypeTheme.
 */
export function renderV2BoldStats(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
}): string {
  const { listing, theme, heroImageDataUri } = args;

  const addressLine1 = (listing.address ?? "").trim();
  const cityStateZip = [
    [listing.city, listing.state].filter(Boolean).join(", "),
    listing.zip,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const priceText = resolvePriceText(listing, theme);
  const chips = buildChips(listing);
  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);
  const ohText = theme.show_open_house_datetime
    ? formatOpenHouse(listing.oh_start_at, listing.oh_end_at)
    : null;

  return `<!doctype html>
<html lang="en">
${commonSquareHead(`${theme.eyebrow} · ${addressLine1}`)}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #18181B; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FCFCFB;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1080px; overflow: hidden; }
  .hero-pane {
    position: absolute; top: 0; left: 0; right: 0; height: 648px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .hero-tint {
    position: absolute; top: 0; left: 0; right: 0; height: 648px;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.45) 0%, rgba(24,24,27,0.05) 26%,
      rgba(24,24,27,0.0) 52%, rgba(24,24,27,0.35) 100%);
  }
  .eyebrow {
    position: absolute; top: 56px; left: 56px;
    display: flex; align-items: center; gap: 18px; z-index: 3;
  }
  .eyebrow-rule {
    width: 56px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 22px; font-weight: 700; letter-spacing: 0.32em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.35);
  }
  .data-pane {
    position: absolute; top: 648px; left: 0; right: 0; bottom: 0;
    padding: 48px 56px 44px 56px;
    background: #18181B;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .open-house-strip {
    display: inline-block; align-self: flex-start; margin-bottom: 14px;
    padding: 9px 18px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 20px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .address {
    font-size: 44px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em;
    color: #FFFFFF; word-break: break-word;
  }
  .citystate {
    margin-top: 6px; font-size: 20px; font-weight: 500; letter-spacing: 0.06em;
    color: #A3A3A0; text-transform: uppercase;
  }
  .gold-rule {
    margin-top: 18px; width: 72px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .price-row {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 24px; margin-top: 12px;
  }
  .price {
    font-size: 88px; font-weight: 900; line-height: 0.95; letter-spacing: -0.04em;
    color: ${theme.accent};
  }
  .price.label-mode { font-size: 54px; letter-spacing: 0.06em; text-transform: uppercase; }
  .stats {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding-bottom: 10px;
  }
  .stat {
    font-size: 19px; font-weight: 600; letter-spacing: 0.16em;
    color: #FCFCFB; text-transform: uppercase;
  }
  .stat-sep {
    width: 4px; height: 4px; border-radius: 50%;
    background: ${theme.accent}; flex-shrink: 0;
  }
  .footer {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 20px; border-top: 1px solid rgba(252,252,251,0.14);
    gap: 16px;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-mark {
    width: 38px; height: 38px; border-radius: 8px;
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 800; color: #18181B; letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 18px; font-weight: 700; letter-spacing: 0.18em;
    color: #FCFCFB; text-transform: uppercase;
  }
  .mls-tag {
    font-size: 16px; font-weight: 600; letter-spacing: 0.16em;
    color: rgba(252,252,251,0.65); text-transform: uppercase;
    text-align: right; flex-shrink: 0;
  }
  ${BADGE_CSS}
</style>
<body>
  <div class="frame">
    <div class="hero-pane"></div>
    <div class="hero-tint"></div>
    <div class="eyebrow">
      <span class="eyebrow-rule"></span>
      <span class="eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
    </div>
    ${renderBadge(theme)}
    <div class="data-pane">
      <div>
        ${ohText ? `<div class="open-house-strip">${escapeHtml(ohText)}</div>` : ""}
        ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
        ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
        <div class="gold-rule"></div>
        <div class="price-row">
          ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : "<div></div>"}
          ${
            chips.length > 0
              ? `<div class="stats">${chips
                  .map(
                    (c, i) =>
                      (i > 0 ? `<span class="stat-sep"></span>` : "") +
                      `<span class="stat">${escapeHtml(c)}</span>`,
                  )
                  .join("")}</div>`
              : ""
          }
        </div>
      </div>
      <div class="footer">
        <div class="brand">
          <div class="brand-mark">21</div>
          <div class="brand-text">Century 21 Alliance</div>
        </div>
        <div class="mls-tag">${escapeHtml(mlsHashtag)}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
