import {
  BADGE_CSS,
  buildChips,
  canonicalMlsHashtag,
  commonHead,
  escapeHtml,
  formatOpenHouse,
  renderBadge,
  resolvePriceText,
  STORY_SAFE_ZONE,
  type PostBuilderListingWithOH,
  type PostTypeTheme,
} from "./_shared";

/**
 * v2 · Bold Stats · Story 9:16 · 1080×1920
 *
 * Photo top 1100px (~57%), data block bottom 480px landing above the
 * bottom safe zone. Eyebrow sits below the top safe zone. The data block
 * uses a narrower vertical price + stat stack since 1080 width with
 * generous letter spacing limits horizontal real estate at the larger
 * type sizes the story needs.
 */
export function renderV2BoldStatsStory(args: {
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

  // Data pane height = remaining after photo, minus bottom safe zone
  const photoHeight = 1100;
  const dataPaneHeight = 1920 - photoHeight; // 820px
  const dataPaneBottomPad = STORY_SAFE_ZONE.bottom + 30; // ~370px reserved at bottom

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${addressLine1}`)}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #18181B; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FCFCFB;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  .hero-pane {
    position: absolute; top: 0; left: 0; right: 0; height: ${photoHeight}px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .hero-tint {
    position: absolute; top: 0; left: 0; right: 0; height: ${photoHeight}px;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.65) 0%, rgba(24,24,27,0.30) 14%,
      rgba(24,24,27,0.0) 32%, rgba(24,24,27,0.30) 100%);
  }
  .eyebrow {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 40}px; left: 72px;
    display: flex; align-items: center; gap: 22px; z-index: 3;
  }
  .eyebrow-rule {
    width: 72px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 32px; font-weight: 700; letter-spacing: 0.32em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .data-pane {
    position: absolute; top: ${photoHeight}px; left: 0; right: 0; bottom: 0;
    height: ${dataPaneHeight}px;
    padding: 60px 72px ${dataPaneBottomPad}px 72px;
    background: #18181B;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .open-house-strip {
    display: inline-block; align-self: flex-start; margin-bottom: 18px;
    padding: 14px 26px; border-radius: 8px;
    background: ${theme.accent}; color: #18181B;
    font-size: 26px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .address {
    font-size: 60px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em;
    color: #FFFFFF; word-break: break-word;
  }
  .citystate {
    margin-top: 10px; font-size: 26px; font-weight: 500; letter-spacing: 0.06em;
    color: #A3A3A0; text-transform: uppercase;
  }
  .gold-rule {
    margin-top: 24px; width: 88px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .price {
    margin-top: 22px; font-size: 132px; font-weight: 900; line-height: 0.95;
    letter-spacing: -0.04em; color: ${theme.accent};
  }
  .price.label-mode { font-size: 72px; letter-spacing: 0.06em; text-transform: uppercase; }
  .stats { margin-top: 18px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .stat {
    font-size: 26px; font-weight: 600; letter-spacing: 0.16em;
    color: #FCFCFB; text-transform: uppercase;
  }
  .stat-sep {
    width: 6px; height: 6px; border-radius: 50%;
    background: ${theme.accent}; flex-shrink: 0;
  }
  .footer {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 28px; border-top: 1px solid rgba(252,252,251,0.18);
    gap: 18px;
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand-mark {
    width: 48px; height: 48px; border-radius: 10px;
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 800; color: #18181B; letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 22px; font-weight: 700; letter-spacing: 0.18em;
    color: #FCFCFB; text-transform: uppercase;
  }
  .mls-tag {
    font-size: 19px; font-weight: 600; letter-spacing: 0.16em;
    color: rgba(252,252,251,0.65); text-transform: uppercase;
    text-align: right; flex-shrink: 0;
  }
  ${BADGE_CSS}
  /* Story: anchor SOLD stamp inside the photo area, well above the data pane. */
  .badge-stamp { top: 380px; right: 80px; }
  .badge-stamp span { font-size: 52px; padding: 18px 42px; border-width: 6px; }
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
        ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
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
