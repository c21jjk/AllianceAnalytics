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
 * v3 · Side-by-Side · Square 1080×1080
 *
 * Asymmetric 55/45 split. Photo left (594px), type column right (486px)
 * on the warm neutral surface with a vertical gold accent rule on the
 * divider. Magazine/listing-card feel — best for properties where the
 * photo composition is portrait-leaning (vertical entrance shot, narrow
 * facades, etc.) or for listings with a long address that benefits from
 * a column rather than a banner.
 *
 * Works for all 4 post types via the PostTypeTheme.
 */
export function renderV3SideBySide(args: {
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
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #FCFCFB; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1080px; overflow: hidden; display: flex; }
  .photo-col {
    position: relative;
    width: 594px; height: 1080px; flex-shrink: 0;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .photo-tint {
    position: absolute; inset: 0;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.35) 0%, rgba(24,24,27,0.0) 22%,
      rgba(24,24,27,0.0) 80%, rgba(24,24,27,0.25) 100%);
  }
  .photo-eyebrow {
    position: absolute; top: 56px; left: 48px;
    display: flex; align-items: center; gap: 16px; z-index: 3;
  }
  .photo-eyebrow-rule {
    width: 50px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .photo-eyebrow-text {
    font-size: 20px; font-weight: 700; letter-spacing: 0.30em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .data-col {
    position: relative;
    width: 486px; height: 1080px; flex-shrink: 0;
    padding: 84px 56px 56px 48px;
    background: #FCFCFB;
    display: flex; flex-direction: column;
    justify-content: space-between;
    border-left: 4px solid ${theme.accent};
  }
  .open-house-strip {
    display: inline-block; align-self: flex-start; margin-bottom: 18px;
    padding: 9px 18px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 19px; font-weight: 800; letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .data-eyebrow {
    font-size: 14px; font-weight: 700; letter-spacing: 0.30em;
    text-transform: uppercase; color: ${theme.accent_dark};
    margin-bottom: 16px;
  }
  .address {
    font-size: 44px; font-weight: 700; line-height: 1.05; letter-spacing: -0.02em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 8px; font-size: 18px; font-weight: 500; letter-spacing: 0.10em;
    color: #525250; text-transform: uppercase;
  }
  .gold-rule {
    margin: 30px 0; width: 64px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .price {
    font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -0.03em;
    color: ${theme.accent_dark};
  }
  .price.label-mode {
    font-size: 36px; letter-spacing: 0.06em; text-transform: uppercase;
  }
  .stats { margin-top: 26px; display: flex; flex-direction: column; gap: 14px; }
  .stat-row {
    display: flex; justify-content: space-between; align-items: center;
    padding-bottom: 12px; border-bottom: 1px solid #E5E5E2;
  }
  .stat-row:last-child { border-bottom: none; padding-bottom: 0; }
  .stat-label {
    font-size: 12px; font-weight: 700; letter-spacing: 0.20em;
    text-transform: uppercase; color: #737370;
  }
  .stat-value {
    font-size: 22px; font-weight: 700; color: #18181B; letter-spacing: -0.01em;
  }
  .footer { display: flex; flex-direction: column; gap: 14px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-mark {
    width: 36px; height: 36px; border-radius: 8px;
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 17px; font-weight: 800; color: #18181B; letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 15px; font-weight: 700; letter-spacing: 0.18em;
    color: #18181B; text-transform: uppercase;
  }
  .mls-tag {
    font-size: 14px; font-weight: 600; letter-spacing: 0.16em;
    color: #737370; text-transform: uppercase;
  }
  .cta {
    font-size: 14px; font-weight: 600; letter-spacing: 0.10em;
    color: ${theme.accent_dark}; text-transform: uppercase;
  }
  ${BADGE_CSS}
  /* Override default stamp position for the side-by-side layout */
  .badge-stamp { top: 90px; right: 540px; }
</style>
<body>
  <div class="frame">
    <div class="photo-col">
      <div class="photo-tint"></div>
      <div class="photo-eyebrow">
        <span class="photo-eyebrow-rule"></span>
        <span class="photo-eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
      </div>
    </div>
    ${renderBadge(theme)}
    <div class="data-col">
      <div>
        ${ohText ? `<div class="open-house-strip">${escapeHtml(ohText)}</div>` : ""}
        <div class="data-eyebrow">${escapeHtml(theme.eyebrow)}</div>
        ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
        ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
        <div class="gold-rule"></div>
        ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
        ${
          chips.length > 0
            ? `<div class="stats">${chips
                .map((c) => {
                  const [value, ...labelParts] = c.split(/\s+/);
                  const label = labelParts.join(" ") || c;
                  return `<div class="stat-row">
                <span class="stat-label">${escapeHtml(label)}</span>
                <span class="stat-value">${escapeHtml(value)}</span>
              </div>`;
                })
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
        ${theme.footer_cta ? `<div class="cta">${escapeHtml(theme.footer_cta)}</div>` : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}
