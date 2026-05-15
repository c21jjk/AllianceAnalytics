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
 * v8 · Minimal Frame · Story 9:16 · 1080×1920
 *
 * Gallery-poster minimalism adapted to the 9:16 story frame. Eyebrow +
 * gold rules just below the top safe zone, gold-rule-framed hero photo
 * centered in the upper-middle, address + price stack centered below.
 * The footer brand mark + MLS hashtag finish above the bottom safe band.
 */
export function renderV8MinimalFrameStory(args: {
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=block" />
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
  .eyebrow-row {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 30}px; left: 0; right: 0;
    display: flex; align-items: center; justify-content: center;
    gap: 22px;
  }
  .eyebrow-rule {
    width: 90px; height: 1.5px;
    background: ${theme.accent};
  }
  .eyebrow-text {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 18px; font-weight: 700; letter-spacing: 0.24em;
    text-transform: uppercase; color: ${theme.accent_dark};
  }
  .photo-wrap {
    position: absolute; left: 50%; top: 420px;
    transform: translateX(-50%);
    width: 880px; height: 680px;
    border: 2px solid ${theme.accent};
    padding: 14px;
  }
  .photo {
    width: 100%; height: 100%;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .type-stack {
    position: absolute; left: 90px; right: 90px;
    top: 1200px;
    text-align: center;
  }
  .address {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 88px; font-weight: 700; line-height: 1.02; letter-spacing: -0.01em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 20px;
    font-size: 22px; font-weight: 500; letter-spacing: 0.06em;
    color: #525250; text-transform: uppercase;
  }
  .open-house {
    margin-top: 16px;
    font-style: italic;
    font-size: 22px; font-weight: 500; letter-spacing: 0.04em;
    color: ${theme.accent_dark};
  }
  .price-row {
    margin-top: 30px;
    display: flex; align-items: baseline; justify-content: center;
    gap: 24px; flex-wrap: wrap;
  }
  .price {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 68px; font-weight: 700; line-height: 1; letter-spacing: -0.01em;
    color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 42px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
  }
  .price-sep {
    display: inline-block; width: 1px; height: 36px;
    background: ${theme.accent};
  }
  .chips { display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; }
  .chip {
    font-size: 17px; font-weight: 600; letter-spacing: 0.20em;
    color: #525250; text-transform: uppercase;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: ${STORY_SAFE_ZONE.bottom + 30}px;
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px; font-weight: 600; letter-spacing: 0.20em;
    color: rgba(24,24,27,0.55); text-transform: uppercase;
  }
  ${BADGE_CSS}
  .badge-stamp { top: ${STORY_SAFE_ZONE.top + 50}px; right: 56px; }
  .badge-stamp span {
    background: rgba(184,60,60,0.95);
    border-color: #FCFCFB;
    font-size: 44px; padding: 14px 32px; border-width: 5px;
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
