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
 * v2 · Bold Stats · Portrait 4:5 · 1080×1350
 *
 * Photo top 60% (810px), oversized data block bottom 40% (540px) on a
 * near-black surface. Larger type than the square variant because the
 * extra vertical room lets the price treatment expand without crowding
 * the bed/bath stats.
 */
export function renderV2BoldStatsPortrait(args: {
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
${commonHead(`${theme.eyebrow} · ${addressLine1}`)}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #18181B; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FCFCFB;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1350px; overflow: hidden; }
  .hero-pane {
    position: absolute; top: 0; left: 0; right: 0; height: 810px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .hero-tint {
    position: absolute; top: 0; left: 0; right: 0; height: 810px;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.50) 0%, rgba(24,24,27,0.08) 24%,
      rgba(24,24,27,0.0) 56%, rgba(24,24,27,0.35) 100%);
  }
  .eyebrow {
    position: absolute; top: 64px; left: 60px;
    display: flex; align-items: center; gap: 18px; z-index: 3;
  }
  .eyebrow-rule {
    width: 56px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 24px; font-weight: 700; letter-spacing: 0.26em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.35);
  }
  .data-pane {
    position: absolute; top: 810px; left: 0; right: 0; bottom: 0;
    padding: 56px 60px 52px 60px;
    background: #18181B;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .open-house-strip {
    display: inline-block; align-self: flex-start; margin-bottom: 16px;
    padding: 10px 20px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 22px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .address {
    font-size: 52px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em;
    color: #FFFFFF; word-break: break-word;
  }
  .citystate {
    margin-top: 8px; font-size: 22px; font-weight: 500; letter-spacing: 0.06em;
    color: #A3A3A0; text-transform: uppercase;
  }
  .gold-rule {
    margin-top: 22px; width: 80px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .price-row {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 28px; margin-top: 16px;
  }
  .price {
    font-size: 108px; font-weight: 900; line-height: 0.95; letter-spacing: -0.04em;
    color: ${theme.accent};
  }
  .price.label-mode { font-size: 64px; letter-spacing: 0.06em; text-transform: uppercase; }
  .stats {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding-bottom: 12px;
  }
  .stat {
    font-size: 22px; font-weight: 600; letter-spacing: 0.16em;
    color: #FCFCFB; text-transform: uppercase;
  }
  .stat-sep {
    width: 5px; height: 5px; border-radius: 50%;
    background: ${theme.accent}; flex-shrink: 0;
  }
  .footer {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 24px; border-top: 1px solid rgba(252,252,251,0.14);
    gap: 18px;
  }
  .brand { display: flex; align-items: center; }
  /* why: real C21 Alliance White lockup — canonical source
     ./canvas-editor/templates/brand-logos.ts (C21_ALLIANCE_WHITE_LOGO). */
  .brand img {
    height: 40px; width: auto; object-fit: contain;
  }
  .mls-tag {
    font-size: 17px; font-weight: 600; letter-spacing: 0.16em;
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
          <img src="https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/1243286b-f208-47fb-a8f3-7fa1367951a2.png" alt="Century 21 Alliance" />
        </div>
        ${/* why: MLS hashtag hidden on square + portrait per design review 2026-05-17 —
              lives in caption + hashtags; keeps footer clean. Story keeps it. */ ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}
