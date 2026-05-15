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
 * v7 · Polaroid · Portrait 4:5 · 1080×1350
 *
 * Polaroid-framed hero on a kraft-paper background. Portrait gives the
 * polaroid an actual portrait crop (760×680 photo area) so the print
 * proportion reads as photo-album rather than postcard. Caption strip on
 * the polaroid carries the eyebrow; address, city/state/zip, price + chips
 * stack below the polaroid on the kraft surface.
 */
export function renderV7PolaroidPortrait(args: {
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Pacifico&display=block" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #F5EBCF; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1350px; overflow: hidden; }
  .polaroid {
    position: absolute; top: 70px; left: 50%;
    transform: translateX(-50%) rotate(-2deg);
    width: 824px;
    background: #FCFCFB;
    padding: 32px 32px 88px 32px;
    box-shadow: 0 18px 36px rgba(0,0,0,0.18);
  }
  .polaroid-photo {
    position: relative;
    width: 760px; height: 680px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .polaroid-caption {
    position: absolute; left: 0; right: 0; bottom: 0;
    height: 88px;
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; font-weight: 800; letter-spacing: 0.18em;
    color: #18181B; text-transform: uppercase;
  }
  .stack {
    position: absolute; left: 72px; right: 72px;
    top: 950px;
    text-align: center;
  }
  .address {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 56px; font-weight: 700; line-height: 1.05; letter-spacing: -0.01em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 10px;
    font-size: 20px; font-weight: 500; letter-spacing: 0.08em;
    color: #3F3F3D; text-transform: uppercase;
  }
  .open-house {
    margin-top: 12px;
    font-family: "Pacifico", "Brush Script MT", cursive;
    font-size: 32px; color: ${theme.accent_dark}; letter-spacing: 0.01em;
  }
  .price-row {
    margin-top: 22px;
    display: flex; align-items: baseline; justify-content: center;
    gap: 20px; flex-wrap: wrap;
  }
  .price {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 72px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
    color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 42px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
  }
  .chips { display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
  .chip {
    font-size: 16px; font-weight: 600; letter-spacing: 0.18em;
    color: #525250; text-transform: uppercase;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: 40px;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    font-size: 13px; font-weight: 600; letter-spacing: 0.18em;
    color: rgba(24,24,27,0.6); text-transform: uppercase;
  }
  ${BADGE_CSS}
  /* Badge sits ON the polaroid photo, slightly more rotated than default. */
  .badge-stamp { top: 160px; right: 220px; transform: rotate(-12deg); }
</style>
<body>
  <div class="frame">
    <div class="polaroid">
      <div class="polaroid-photo"></div>
      <div class="polaroid-caption">${escapeHtml(theme.eyebrow.toUpperCase())}</div>
    </div>
    ${renderBadge(theme)}
    <div class="stack">
      ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
      ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
      ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
      <div class="price-row">
        ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
        ${
          chips.length > 0
            ? `<div class="chips">${chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>`
            : ""
        }
      </div>
    </div>
    <div class="footer">
      <span>Century 21 Alliance</span>
      <span>${escapeHtml(mlsHashtag)}</span>
    </div>
  </div>
</body>
</html>`;
}
