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
 * v1 · Hero Editorial · Square 1080×1080
 *
 * Hero photo fills the frame. Top-left eyebrow rule + label. Bottom 38% is
 * a downward dark gradient that holds the type. Gold rule above the address.
 * Price + bed/bath chips + brand mark + MLS hashtag footer.
 *
 * Works for all 4 post types via the PostTypeTheme:
 *   - Just Listed: list_price, no badge
 *   - Just Sold: close_price (or SOLD label), SOLD stamp overlay
 *   - Under Contract: "Under Contract" label in the price slot, no badge
 *   - Open House: list_price + date/time chip above the address
 */
export function renderV1HeroEditorial(args: {
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
  .hero {
    position: absolute; inset: 0;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .hero-tint {
    position: absolute; inset: 0;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.55) 0%, rgba(24,24,27,0.18) 14%,
      rgba(24,24,27,0.0) 32%, rgba(24,24,27,0.0) 50%,
      rgba(24,24,27,0.55) 70%, rgba(24,24,27,0.92) 100%);
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
  .content {
    position: absolute; left: 56px; right: 56px; bottom: 56px; z-index: 3;
  }
  .open-house-strip {
    display: inline-block; margin-bottom: 18px;
    padding: 10px 20px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 22px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase; box-shadow: 0 4px 14px rgba(0,0,0,0.35);
  }
  .gold-rule {
    width: 64px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px; margin-bottom: 22px;
  }
  .address {
    font-size: 56px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em;
    color: #FFFFFF; text-shadow: 0 2px 12px rgba(0,0,0,0.4); word-break: break-word;
  }
  .citystate {
    margin-top: 8px; font-size: 26px; font-weight: 500; letter-spacing: 0.04em;
    color: #F1F1EF; text-transform: uppercase; text-shadow: 0 1px 6px rgba(0,0,0,0.3);
  }
  .price {
    margin-top: 28px; font-size: 64px; font-weight: 800; letter-spacing: -0.02em;
    color: ${theme.accent}; text-shadow: 0 2px 14px rgba(0,0,0,0.45); line-height: 1;
  }
  .price.label-mode {
    font-size: 38px; letter-spacing: 0.14em; text-transform: uppercase;
  }
  .chips { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 12px; }
  .chip {
    display: inline-flex; align-items: center; padding: 12px 22px;
    background: rgba(252,252,251,0.10);
    border: 1.5px solid rgba(201,169,97,0.55);
    border-radius: 999px;
    font-size: 22px; font-weight: 600; letter-spacing: 0.08em; color: #FCFCFB;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .footer {
    margin-top: 32px; padding-top: 22px;
    border-top: 1px solid rgba(252,252,251,0.18);
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
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
