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
 * v6 · Magazine Cover · Story 9:16 · 1080×1920
 *
 * Editorial magazine-cover layout adapted to the 9:16 story frame.
 * Hero photo fills the top ~62% of the canvas; the lower cream panel
 * holds the eyebrow, large 130pt city headline, address, OH chip,
 * price + stat dots, and a small brand mark + MLS line. The whole type
 * block sits inside the story's safe band so platform UI doesn't clip
 * the headline or footer.
 */
export function renderV6MagazineCoverStory(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
}): string {
  const { listing, theme, heroImageDataUri } = args;

  const addressLine1 = (listing.address ?? "").trim();
  const cityName = (listing.city ?? "City Unknown").trim();
  const priceText = resolvePriceText(listing, theme);
  const chips = buildChips(listing);
  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);
  const ohText = theme.show_open_house_datetime
    ? formatOpenHouse(listing.oh_start_at, listing.oh_end_at)
    : null;

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${cityName}`)}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #FBF7EE; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  .hero {
    position: absolute; top: 0; left: 0; right: 0; height: 1180px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .panel {
    position: absolute; top: 1180px; left: 0; right: 0; bottom: 0;
    background: #FBF7EE;
    padding: 80px 80px ${STORY_SAFE_ZONE.bottom + 40}px 80px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .eyebrow {
    display: flex; align-items: center; gap: 22px;
  }
  .eyebrow-rule {
    width: 72px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 26px; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: ${theme.accent_dark};
  }
  .city {
    margin-top: 26px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 130px; font-weight: 700; line-height: 0.98; letter-spacing: -0.02em;
    color: #18181B; word-break: break-word;
  }
  .address {
    margin-top: 20px;
    font-size: 30px; font-weight: 500; letter-spacing: 0.08em;
    text-transform: uppercase; color: #3F3F3D; word-break: break-word;
  }
  .open-house {
    display: inline-block; align-self: flex-start; margin-top: 22px;
    padding: 12px 24px; border-radius: 8px;
    background: ${theme.accent}; color: #18181B;
    font-size: 24px; font-weight: 800; letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .bottom-row {
    display: flex; justify-content: space-between; align-items: flex-end;
    gap: 28px;
  }
  .price-chips { display: flex; align-items: baseline; gap: 28px; flex-wrap: wrap; }
  .price {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 78px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
    color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 46px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
  }
  .chips { display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; }
  .chip {
    font-size: 18px; font-weight: 600; letter-spacing: 0.18em;
    color: #525250; text-transform: uppercase;
  }
  .chip-sep {
    display: inline-block; width: 4px; height: 4px; border-radius: 50%;
    background: ${theme.accent};
  }
  .corner-mark {
    text-align: right;
    font-size: 13px; font-weight: 600; letter-spacing: 0.18em;
    color: rgba(24,24,27,0.6); text-transform: uppercase; line-height: 1.45;
    flex-shrink: 0;
  }
  .corner-mark .mls { display: block; }
  ${BADGE_CSS}
  /* Badge anchors on the hero photo, upper-right; nudged below the
     story top safe zone so platform UI doesn't clip it. */
  .badge-stamp { top: ${STORY_SAFE_ZONE.top + 60}px; right: 80px; }
  .badge-stamp span { font-size: 48px; padding: 16px 36px; border-width: 5px; }
</style>
<body>
  <div class="frame">
    <div class="hero"></div>
    ${renderBadge(theme)}
    <div class="panel">
      <div>
        <div class="eyebrow">
          <span class="eyebrow-rule"></span>
          <span class="eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
        </div>
        <div class="city">${escapeHtml(cityName)}</div>
        ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
        ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
      </div>
      <div class="bottom-row">
        <div class="price-chips">
          ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
          ${
            chips.length > 0
              ? `<div class="chips">${chips
                  .map(
                    (c, i) =>
                      (i > 0 ? `<span class="chip-sep"></span>` : "") +
                      `<span class="chip">${escapeHtml(c)}</span>`,
                  )
                  .join("")}</div>`
              : ""
          }
        </div>
        <div class="corner-mark">
          <span>Century 21 Alliance</span>
          <span class="mls">${escapeHtml(mlsHashtag)}</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
