import {
  BADGE_CSS,
  buildChips,
  canonicalMlsHashtag,
  commonHead,
  escapeHtml,
  formatOpenHouse,
  renderBadge,
  resolvePriceText,
  type PostBuilderListingWithOH,
  type PostTypeTheme,
} from "./_shared";

/**
 * v3 · Side-by-Side · Portrait 4:5 · 1080×1350
 *
 * In portrait the 55/45 horizontal split doesn't work — photo + data
 * column would be too cramped. Instead this rotates the composition:
 * photo top 50% (1080×675), light-surface data block bottom 50% (1080×675)
 * with a horizontal gold accent rule at the seam. Keeps the magazine /
 * listing-card feel of the square version.
 */
export function renderV3SideBySidePortrait(args: {
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

  const photoHeight = 675;

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${addressLine1}`)}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #FCFCFB; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1350px; overflow: hidden; }
  .photo-row {
    position: absolute; top: 0; left: 0; right: 0; height: ${photoHeight}px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .photo-tint {
    position: absolute; top: 0; left: 0; right: 0; height: ${photoHeight}px;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.40) 0%, rgba(24,24,27,0.0) 22%,
      rgba(24,24,27,0.0) 78%, rgba(24,24,27,0.20) 100%);
  }
  .photo-eyebrow {
    position: absolute; top: 60px; left: 56px;
    display: flex; align-items: center; gap: 18px; z-index: 3;
  }
  .photo-eyebrow-rule {
    width: 56px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .photo-eyebrow-text {
    font-size: 22px; font-weight: 700; letter-spacing: 0.32em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .seam-rule {
    position: absolute; top: ${photoHeight}px; left: 0; right: 0;
    height: 5px; background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    z-index: 4;
  }
  .data-row {
    position: absolute; top: ${photoHeight + 5}px; left: 0; right: 0; bottom: 0;
    padding: 52px 64px 52px 64px;
    background: #FCFCFB;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .open-house-strip {
    display: inline-block; align-self: flex-start; margin-bottom: 16px;
    padding: 10px 20px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 22px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .data-eyebrow {
    font-size: 14px; font-weight: 700; letter-spacing: 0.30em;
    text-transform: uppercase; color: ${theme.accent_dark};
    margin-bottom: 14px;
  }
  .address {
    font-size: 56px; font-weight: 700; line-height: 1.04; letter-spacing: -0.02em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 10px; font-size: 22px; font-weight: 500; letter-spacing: 0.08em;
    color: #525250; text-transform: uppercase;
  }
  .price-row {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 32px; margin-top: 28px;
  }
  .price {
    font-size: 76px; font-weight: 900; line-height: 1; letter-spacing: -0.03em;
    color: ${theme.accent_dark};
  }
  .price.label-mode { font-size: 46px; letter-spacing: 0.06em; text-transform: uppercase; }
  .stats { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding-bottom: 10px; }
  .stat {
    font-size: 20px; font-weight: 600; letter-spacing: 0.14em;
    color: #18181B; text-transform: uppercase;
  }
  .stat-sep {
    width: 5px; height: 5px; border-radius: 50%;
    background: ${theme.accent}; flex-shrink: 0;
  }
  .footer {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 22px; border-top: 1px solid #E5E5E2;
    gap: 16px;
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand-mark {
    width: 42px; height: 42px; border-radius: 8px;
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 800; color: #18181B; letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 18px; font-weight: 700; letter-spacing: 0.18em;
    color: #18181B; text-transform: uppercase;
  }
  .mls-tag {
    font-size: 16px; font-weight: 600; letter-spacing: 0.16em;
    color: #737370; text-transform: uppercase;
    text-align: right; flex-shrink: 0;
  }
  ${BADGE_CSS}
  /* The default top-corner stamp position works for portrait; just tweak slightly. */
  .badge-stamp { top: 100px; right: 64px; }
</style>
<body>
  <div class="frame">
    <div class="photo-row"></div>
    <div class="photo-tint"></div>
    <div class="photo-eyebrow">
      <span class="photo-eyebrow-rule"></span>
      <span class="photo-eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
    </div>
    ${renderBadge(theme)}
    <div class="seam-rule"></div>
    <div class="data-row">
      <div>
        ${ohText ? `<div class="open-house-strip">${escapeHtml(ohText)}</div>` : ""}
        <div class="data-eyebrow">${escapeHtml(theme.eyebrow)}</div>
        ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
        ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
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
