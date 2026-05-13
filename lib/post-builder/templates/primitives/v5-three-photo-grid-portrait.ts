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
 * v5 · Three-Photo Grid · Portrait 4:5 · 1080×1350
 *
 * Magazine listing-spread, taller frame. Hero 700×900 left, two thumbnails
 * 376×448 stacked right (with 4px gold gaps). Data block 1080×450 bottom.
 */
export function renderV5ThreePhotoGridPortrait(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
  heroImageDataUris?: string[];
}): string {
  const { listing, theme } = args;
  const photos = ensurePhotos(args.heroImageDataUri, args.heroImageDataUris, 3);

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
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #FCFCFB; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1350px; overflow: hidden; }
  .photo-grid {
    position: absolute; top: 0; left: 0; right: 0; height: 900px;
    display: flex; gap: 5px; background: ${theme.accent};
  }
  .photo-hero {
    width: 700px; height: 900px;
    background-image: url("${photos[0]}");
    background-size: cover; background-position: center;
  }
  .photo-thumbs {
    flex: 1; display: flex; flex-direction: column; gap: 5px;
  }
  .photo-thumb {
    flex: 1;
    background-size: cover; background-position: center;
  }
  .photo-thumb-1 { background-image: url("${photos[1]}"); }
  .photo-thumb-2 { background-image: url("${photos[2]}"); }
  .photo-eyebrow {
    position: absolute; top: 56px; left: 56px;
    display: flex; align-items: center; gap: 18px; z-index: 3;
  }
  .photo-eyebrow-rule {
    width: 56px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .photo-eyebrow-text {
    font-size: 24px; font-weight: 700; letter-spacing: 0.32em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .data-row {
    position: absolute; top: 900px; left: 0; right: 0; bottom: 0;
    padding: 52px 60px 52px 60px;
    background: #FCFCFB;
    display: flex; flex-direction: column; justify-content: space-between;
    border-top: 5px solid ${theme.accent};
  }
  .open-house-strip {
    display: inline-block; align-self: flex-start; margin-bottom: 14px;
    padding: 11px 22px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 22px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .data-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; }
  .address-block { flex: 1; min-width: 0; }
  .address {
    font-size: 48px; font-weight: 700; line-height: 1.04; letter-spacing: -0.02em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 8px; font-size: 20px; font-weight: 500; letter-spacing: 0.10em;
    color: #525250; text-transform: uppercase;
  }
  .price-block { flex-shrink: 0; text-align: right; }
  .price-label {
    font-size: 12px; font-weight: 700; letter-spacing: 0.30em;
    text-transform: uppercase; color: ${theme.accent_dark};
    margin-bottom: 6px;
  }
  .price {
    font-size: 54px; font-weight: 900; letter-spacing: -0.03em;
    color: ${theme.accent_dark}; line-height: 1;
  }
  .price.label-mode { font-size: 36px; letter-spacing: 0.04em; text-transform: uppercase; }
  .stats {
    margin-top: 12px; display: flex; flex-wrap: wrap; gap: 16px;
    justify-content: flex-end;
  }
  .stat {
    font-size: 18px; font-weight: 600; letter-spacing: 0.12em;
    color: #525250; text-transform: uppercase;
  }
  .footer {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 22px; border-top: 1px solid #E5E5E2; gap: 18px;
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
  .badge-stamp { top: 100px; right: 410px; }
</style>
<body>
  <div class="frame">
    <div class="photo-grid">
      <div class="photo-hero"></div>
      <div class="photo-thumbs">
        <div class="photo-thumb photo-thumb-1"></div>
        <div class="photo-thumb photo-thumb-2"></div>
      </div>
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
