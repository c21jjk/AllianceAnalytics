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
 * v4 · Two-Photo Diptych · Square 1080×1080
 *
 * Two-photo lookbook composition. Side-by-side photos (540×700 each)
 * across the top 700px, unified data block on a light surface across the
 * bottom 380px. Photos get a 4px gold seam between them.
 *
 * Works for all 4 post types via the PostTypeTheme — SOLD stamp moves to
 * the left photo (overlay), Open House strip lives in the data band.
 *
 * Falls back to placeholder gradient if a photo slot is missing.
 */
export function renderV4TwoPhotoDiptych(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
  heroImageDataUris?: string[];
}): string {
  const { listing, theme } = args;
  const photos = ensurePhotos(args.heroImageDataUri, args.heroImageDataUris, 2);

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
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #FCFCFB; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1080px; overflow: hidden; }
  .photo-row {
    position: absolute; top: 0; left: 0; right: 0; height: 700px;
    display: flex; gap: 4px; background: ${theme.accent};
  }
  .photo-cell {
    flex: 1; height: 700px;
    background-size: cover; background-position: center;
    position: relative;
  }
  .photo-cell-1 { background-image: url("${photos[0]}"); }
  .photo-cell-2 { background-image: url("${photos[1]}"); }
  .photo-eyebrow {
    position: absolute; top: 48px; left: 48px;
    display: flex; align-items: center; gap: 16px; z-index: 3;
  }
  .photo-eyebrow-rule {
    width: 52px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .photo-eyebrow-text {
    font-size: 20px; font-weight: 700; letter-spacing: 0.30em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .data-row {
    position: absolute; top: 700px; left: 0; right: 0; bottom: 0;
    padding: 44px 56px 44px 56px;
    background: #FCFCFB;
    display: flex; flex-direction: column; justify-content: space-between;
    border-top: 4px solid ${theme.accent};
  }
  .open-house-strip {
    display: inline-block; align-self: flex-start; margin-bottom: 12px;
    padding: 9px 18px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 20px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .data-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; }
  .address-block { flex: 1; min-width: 0; }
  .address {
    font-size: 42px; font-weight: 700; line-height: 1.04; letter-spacing: -0.02em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 6px; font-size: 18px; font-weight: 500; letter-spacing: 0.10em;
    color: #525250; text-transform: uppercase;
  }
  .price-block { flex-shrink: 0; text-align: right; }
  .price-label {
    font-size: 11px; font-weight: 700; letter-spacing: 0.30em;
    text-transform: uppercase; color: ${theme.accent_dark};
    margin-bottom: 4px;
  }
  .price {
    font-size: 44px; font-weight: 900; letter-spacing: -0.03em;
    color: ${theme.accent_dark}; line-height: 1;
  }
  .price.label-mode { font-size: 30px; letter-spacing: 0.04em; text-transform: uppercase; }
  .stats {
    margin-top: 8px; display: flex; flex-wrap: wrap; gap: 14px;
    justify-content: flex-end;
  }
  .stat {
    font-size: 16px; font-weight: 600; letter-spacing: 0.12em;
    color: #525250; text-transform: uppercase;
  }
  .footer {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 18px; border-top: 1px solid #E5E5E2; gap: 16px;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-mark {
    width: 38px; height: 38px; border-radius: 8px;
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 800; color: #18181B; letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 16px; font-weight: 700; letter-spacing: 0.18em;
    color: #18181B; text-transform: uppercase;
  }
  .mls-tag {
    font-size: 15px; font-weight: 600; letter-spacing: 0.16em;
    color: #737370; text-transform: uppercase;
    text-align: right; flex-shrink: 0;
  }
  ${BADGE_CSS}
  /* v4: SOLD stamp anchors on the LEFT photo to avoid covering both. */
  .badge-stamp { top: 90px; right: 580px; }
</style>
<body>
  <div class="frame">
    <div class="photo-row">
      <div class="photo-cell photo-cell-1"></div>
      <div class="photo-cell photo-cell-2"></div>
    </div>
    <div class="photo-eyebrow">
      <span class="photo-eyebrow-rule"></span>
      <span class="photo-eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
    </div>
    ${renderBadge(theme)}
    <div class="data-row">
      ${ohText ? `<div class="open-house-strip">${escapeHtml(ohText)}</div>` : ""}
      <div class="data-top">
        <div class="address-block">
          ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
          ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
        </div>
        <div class="price-block">
          <div class="price-label">${escapeHtml(theme.eyebrow)}</div>
          ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
          ${
            chips.length > 0
              ? `<div class="stats">${chips.map((c) => `<span class="stat">${escapeHtml(c)}</span>`).join("")}</div>`
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

/**
 * Ensure the photos array has exactly `wanted` entries. Repeats the last
 * URL if the caller provided fewer than expected — beats failing the
 * render outright.
 */
function ensurePhotos(
  primary: string,
  all: string[] | undefined,
  wanted: number,
): string[] {
  const source = all && all.length > 0 ? all : [primary];
  const out: string[] = [];
  for (let i = 0; i < wanted; i++) {
    out.push(source[Math.min(i, source.length - 1)]);
  }
  return out;
}
