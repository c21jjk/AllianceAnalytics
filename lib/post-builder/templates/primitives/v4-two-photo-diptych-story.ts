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
 * v4 · Two-Photo Diptych · Story 9:16 · 1080×1920
 *
 * Side-by-side photos 540×1200 in the top region, data block 1080×380
 * landing above the bottom safe zone. Eyebrow sits at y=290 just below
 * the top safe zone. Diptych identity preserved despite the tall format.
 */
export function renderV4TwoPhotoDiptychStory(args: {
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

  const photoHeight = 1200;
  const dataPaneBottomPad = STORY_SAFE_ZONE.bottom + 30;

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${addressLine1}`)}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #FCFCFB; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  .photo-row {
    position: absolute; top: 0; left: 0; right: 0; height: ${photoHeight}px;
    display: flex; gap: 5px; background: ${theme.accent};
  }
  .photo-cell {
    flex: 1; height: ${photoHeight}px;
    background-size: cover; background-position: center;
  }
  .photo-cell-1 { background-image: url("${photos[0]}"); }
  .photo-cell-2 { background-image: url("${photos[1]}"); }
  .photo-tint {
    position: absolute; top: 0; left: 0; right: 0; height: ${photoHeight}px;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.50) 0%, rgba(24,24,27,0.10) 16%,
      rgba(24,24,27,0.0) 36%, rgba(24,24,27,0.0) 100%);
    pointer-events: none;
  }
  .photo-eyebrow {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 40}px; left: 72px;
    display: flex; align-items: center; gap: 22px; z-index: 3;
  }
  .photo-eyebrow-rule {
    width: 72px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .photo-eyebrow-text {
    font-size: 32px; font-weight: 700; letter-spacing: 0.32em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .data-row {
    position: absolute; top: ${photoHeight}px; left: 0; right: 0; bottom: 0;
    padding: 60px 72px ${dataPaneBottomPad}px 72px;
    background: #FCFCFB;
    display: flex; flex-direction: column; justify-content: space-between;
    border-top: 6px solid ${theme.accent};
  }
  .open-house-strip {
    display: inline-block; align-self: flex-start; margin-bottom: 16px;
    padding: 14px 26px; border-radius: 8px;
    background: ${theme.accent}; color: #18181B;
    font-size: 26px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .data-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; }
  .address-block { flex: 1; min-width: 0; }
  .address {
    font-size: 56px; font-weight: 700; line-height: 1.04; letter-spacing: -0.02em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 10px; font-size: 24px; font-weight: 500; letter-spacing: 0.10em;
    color: #525250; text-transform: uppercase;
  }
  .price-block { flex-shrink: 0; text-align: right; }
  .price-label {
    font-size: 14px; font-weight: 700; letter-spacing: 0.30em;
    text-transform: uppercase; color: ${theme.accent_dark};
    margin-bottom: 8px;
  }
  .price {
    font-size: 64px; font-weight: 900; letter-spacing: -0.03em;
    color: ${theme.accent_dark}; line-height: 1;
  }
  .price.label-mode { font-size: 42px; letter-spacing: 0.04em; text-transform: uppercase; }
  .stats {
    margin-top: 14px; display: flex; flex-wrap: wrap; gap: 18px;
    justify-content: flex-end;
  }
  .stat {
    font-size: 20px; font-weight: 600; letter-spacing: 0.12em;
    color: #525250; text-transform: uppercase;
  }
  .footer {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 24px; border-top: 1px solid #E5E5E2; gap: 18px;
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand-mark {
    width: 48px; height: 48px; border-radius: 10px;
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 800; color: #18181B; letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 20px; font-weight: 700; letter-spacing: 0.18em;
    color: #18181B; text-transform: uppercase;
  }
  .mls-tag {
    font-size: 18px; font-weight: 600; letter-spacing: 0.16em;
    color: #737370; text-transform: uppercase;
    text-align: right; flex-shrink: 0;
  }
  ${BADGE_CSS}
  /* Story v4: anchor stamp on the LEFT photo, mid-frame to dodge safe zones. */
  .badge-stamp { top: 480px; right: 580px; }
  .badge-stamp span { font-size: 48px; padding: 16px 36px; border-width: 5px; }
</style>
<body>
  <div class="frame">
    <div class="photo-row">
      <div class="photo-cell photo-cell-1"></div>
      <div class="photo-cell photo-cell-2"></div>
    </div>
    <div class="photo-tint"></div>
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
