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
 * v1 · Hero Editorial · Portrait 4:5 · 1080×1350
 *
 * Same conceptual layout as the square hero editorial, adapted for IG's
 * preferred portrait feed dimensions. The extra ~270px of vertical space
 * lets the gradient breathe longer and gives the type stack more room.
 */
export function renderV1HeroEditorialPortrait(args: {
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
  .hero {
    position: absolute; inset: 0;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .hero-tint {
    position: absolute; inset: 0;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.55) 0%, rgba(24,24,27,0.18) 12%,
      rgba(24,24,27,0.0) 28%, rgba(24,24,27,0.0) 46%,
      rgba(24,24,27,0.45) 64%, rgba(24,24,27,0.92) 100%);
  }
  .eyebrow {
    position: absolute; top: 60px; left: 60px;
    display: flex; align-items: center; gap: 18px; z-index: 3;
  }
  .eyebrow-rule {
    width: 56px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 24px; font-weight: 700; letter-spacing: 0.32em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.35);
  }
  .content {
    position: absolute; left: 60px; right: 60px; bottom: 60px; z-index: 3;
  }
  .open-house-strip {
    display: inline-block; margin-bottom: 20px;
    padding: 11px 22px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 24px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase; box-shadow: 0 4px 14px rgba(0,0,0,0.35);
  }
  .gold-rule {
    width: 72px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px; margin-bottom: 26px;
  }
  .address {
    font-size: 64px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em;
    color: #FFFFFF; text-shadow: 0 2px 12px rgba(0,0,0,0.4); word-break: break-word;
  }
  .citystate {
    margin-top: 10px; font-size: 28px; font-weight: 500; letter-spacing: 0.04em;
    color: #F1F1EF; text-transform: uppercase; text-shadow: 0 1px 6px rgba(0,0,0,0.3);
  }
  .price {
    margin-top: 32px; font-size: 72px; font-weight: 800; letter-spacing: -0.02em;
    color: ${theme.accent}; text-shadow: 0 2px 14px rgba(0,0,0,0.45); line-height: 1;
  }
  .price.label-mode { font-size: 44px; letter-spacing: 0.12em; text-transform: uppercase; }
  .chips { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 14px; }
  .chip {
    display: inline-flex; align-items: center; padding: 14px 24px;
    background: rgba(252,252,251,0.10);
    border: 1.5px solid rgba(201,169,97,0.55);
    border-radius: 999px;
    font-size: 24px; font-weight: 600; letter-spacing: 0.08em; color: #FCFCFB;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .footer {
    margin-top: 36px; padding-top: 24px;
    border-top: 1px solid rgba(252,252,251,0.18);
    display: flex; justify-content: space-between; align-items: center; gap: 18px;
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand-mark {
    width: 42px; height: 42px; border-radius: 8px;
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 800; color: #18181B; letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 20px; font-weight: 700; letter-spacing: 0.18em;
    color: #FCFCFB; text-transform: uppercase;
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
    <div class="hero"></div>
    <div class="hero-tint"></div>
    <div class="eyebrow">
      <span class="eyebrow-rule"></span>
      <span class="eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
    </div>
    ${renderBadge(theme)}
    <div class="content">
      ${ohText ? `<div class="open-house-strip">${escapeHtml(ohText)}</div>` : ""}
      <div class="gold-rule"></div>
      ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
      ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
      ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
      ${
        chips.length > 0
          ? `<div class="chips">${chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>`
          : ""
      }
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
