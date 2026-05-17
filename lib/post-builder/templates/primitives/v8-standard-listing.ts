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
 * v8 · Standard NEW LISTING · Square 1080×1080
 *
 * Cream surface, photo-dominant composition. Gold eyebrow top-left, dark
 * "C21 ALLIANCE" badge top-right, full-width hero photo in the middle,
 * Obsessed Grey bottom band with white address + city + bed/bath/feature
 * chips. Replaces the earlier Minimal Frame layout.
 */
export function renderV8StandardListing(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
  heroImageDataUris?: string[];
}): string {
  const { listing, theme, heroImageDataUri } = args;

  const addressLine1 = (listing.address ?? "").trim();
  const cityUpper = [
    [listing.city, listing.state].filter(Boolean).join(", "),
    listing.zip,
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toUpperCase();

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
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #FCFCFB; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1080px; overflow: hidden; }
  .eyebrow {
    position: absolute; top: 56px; left: 56px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 48px; font-weight: 700; line-height: 1;
    color: ${theme.accent_dark}; letter-spacing: -0.01em;
  }
  .price-line {
    position: absolute; top: 118px; left: 56px;
    font-size: 18px; font-weight: 700; letter-spacing: 0.18em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .open-house {
    position: absolute; top: 148px; left: 56px;
    font-style: italic; font-size: 18px; font-weight: 500;
    letter-spacing: 0.06em; color: ${theme.accent_dark};
  }
  .c21-badge {
    position: absolute; top: 56px; right: 56px;
    display: flex; align-items: center; gap: 10px;
    background: #252526; padding: 14px 18px; border-radius: 6px;
    border: 1.5px solid ${theme.accent};
  }
  .c21-badge .seal {
    width: 28px; height: 28px; border-radius: 50%;
    background: ${theme.accent}; color: #252526;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 900; letter-spacing: -0.04em;
  }
  .c21-badge .wordmark {
    font-size: 13px; font-weight: 700; letter-spacing: 0.22em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .photo {
    position: absolute; left: 0; top: 220px;
    width: 1080px; height: 660px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .bottom-band {
    position: absolute; left: 0; top: 880px;
    width: 1080px; height: 200px;
    background: #252526;
    padding: 28px 56px;
    color: #FCFCFB;
    display: flex; flex-direction: column; justify-content: center; gap: 8px;
  }
  .bottom-band .address {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 30px; font-weight: 700; line-height: 1.04; letter-spacing: -0.01em;
    color: #FCFCFB;
  }
  .bottom-band .city {
    font-size: 16px; font-weight: 600; letter-spacing: 0.18em;
    color: rgba(252,252,251,0.78); text-transform: uppercase;
  }
  .bottom-band .chips {
    margin-top: 6px;
    display: flex; gap: 20px; flex-wrap: wrap;
    font-size: 13px; font-weight: 600; letter-spacing: 0.24em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .bottom-band .chip-sep {
    display: inline-block; opacity: 0.4; color: ${theme.accent};
  }
  ${BADGE_CSS}
  .badge-stamp { top: 240px; left: 40px; right: auto; }
</style>
<body>
  <div class="frame">
    <div class="eyebrow">${escapeHtml(theme.eyebrow)}</div>
    ${priceText ? `<div class="price-line">${escapeHtml(priceText)}</div>` : ""}
    ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
    <div class="c21-badge">
      <span class="seal">21</span>
      <span class="wordmark">Alliance</span>
    </div>
    <div class="photo"></div>
    ${renderBadge(theme)}
    <div class="bottom-band">
      ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
      ${cityUpper ? `<div class="city">${escapeHtml(cityUpper)}</div>` : ""}
      ${
        chips.length > 0
          ? `<div class="chips">${chips
              .map(
                (c, i) =>
                  `${i > 0 ? `<span class="chip-sep">|</span>` : ""}<span>${escapeHtml(c)}</span>`,
              )
              .join("")}</div>`
          : ""
      }
    </div>
  </div>
</body>
</html>`;
}
