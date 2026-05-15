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
 * v8 · Minimal Frame · Square 1080×1080
 *
 * Gallery-poster minimalism. Hero photo sits on a near-white surface in a
 * thin gold-rule frame with breathing room on all sides. All type lives
 * below the photo, centered and tightly stacked. Maximum negative space,
 * refined typography — the listing-as-print-ad treatment.
 *
 * Works for all 5 post types via the PostTypeTheme. Badge stamp anchors
 * to the top-right of the canvas (outside the frame) so it reads like a
 * hand-stamped notice on the gallery placard.
 */
export function renderV8MinimalFrame(args: {
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=block" />
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
  .eyebrow-row {
    position: absolute; top: 110px; left: 0; right: 0;
    display: flex; align-items: center; justify-content: center;
    gap: 18px;
  }
  .eyebrow-rule {
    width: 70px; height: 1px;
    background: ${theme.accent};
  }
  .eyebrow-text {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 13px; font-weight: 700; letter-spacing: 0.24em;
    text-transform: uppercase; color: ${theme.accent_dark};
  }
  .photo-wrap {
    position: absolute; left: 50%; top: 240px;
    transform: translateX(-50%);
    width: 760px; height: 500px;
    border: 2px solid ${theme.accent};
    padding: 12px;
  }
  .photo {
    width: 100%; height: 100%;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .type-stack {
    position: absolute; left: 80px; right: 80px;
    top: 800px;
    text-align: center;
  }
  .address {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 64px; font-weight: 700; line-height: 1.04; letter-spacing: -0.01em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 14px;
    font-size: 18px; font-weight: 500; letter-spacing: 0.06em;
    color: #525250; text-transform: uppercase;
  }
  .open-house {
    margin-top: 12px;
    font-style: italic;
    font-size: 18px; font-weight: 500; letter-spacing: 0.04em;
    color: ${theme.accent_dark};
  }
  .price-row {
    margin-top: 22px;
    display: flex; align-items: baseline; justify-content: center;
    gap: 18px; flex-wrap: wrap;
  }
  .price {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 48px; font-weight: 700; line-height: 1; letter-spacing: -0.01em;
    color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 32px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
  }
  .price-sep {
    display: inline-block; width: 1px; height: 28px;
    background: ${theme.accent};
  }
  .chips { display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
  .chip {
    font-size: 14px; font-weight: 600; letter-spacing: 0.20em;
    color: #525250; text-transform: uppercase;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: 36px;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 11px; font-weight: 600; letter-spacing: 0.20em;
    color: rgba(24,24,27,0.55); text-transform: uppercase;
  }
  ${BADGE_CSS}
  /* Badge sits OUTSIDE the gold frame, top-right of the canvas. */
  .badge-stamp { top: 60px; right: 40px; }
  .badge-stamp span {
    background: rgba(184,60,60,0.95);
    border-color: #FCFCFB;
  }
</style>
<body>
  <div class="frame">
    <div class="eyebrow-row">
      <span class="eyebrow-rule"></span>
      <span class="eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
      <span class="eyebrow-rule"></span>
    </div>
    <div class="photo-wrap"><div class="photo"></div></div>
    ${renderBadge(theme)}
    <div class="type-stack">
      ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
      ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
      ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
      <div class="price-row">
        ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
        ${priceText && chips.length > 0 ? `<span class="price-sep"></span>` : ""}
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
