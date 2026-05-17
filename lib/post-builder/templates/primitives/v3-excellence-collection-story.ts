import {
  buildChips,
  canonicalMlsHashtag,
  commonHead,
  escapeHtml,
  formatOpenHouse,
  resolvePriceText,
  STORY_SAFE_ZONE,
  type PostBuilderListingWithOH,
  type PostTypeTheme,
} from "./_shared";

/**
 * v3 · Excellence Collection · Story 9:16 · 1080×1920
 *
 * Story-format Excellence Collection. Wordmark + eyebrow drop below the
 * 250px top safe zone; address row sits above the 340px bottom safe band
 * (content must end above y=1580).
 */
export function renderV3ExcellenceCollectionStory(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
  heroImageDataUris?: string[];
}): string {
  const { listing, theme, heroImageDataUri } = args;

  const addressLine1 = (listing.address ?? "").trim().toUpperCase();
  const cityUpper = (listing.city ?? "").trim().toUpperCase();
  const priceText = resolvePriceText(listing, theme);
  const chips = buildChips(listing);
  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);
  const ohText = theme.show_open_house_datetime
    ? formatOpenHouse(listing.oh_start_at, listing.oh_end_at)
    : null;

  const eyebrowParts = theme.eyebrow.trim().split(/\s+/);
  const wordA = eyebrowParts.length >= 2 ? eyebrowParts[0] : "";
  const wordB = eyebrowParts.length >= 2 ? eyebrowParts.slice(1).join(" ") : theme.eyebrow;

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${addressLine1}`)}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400;1,600&display=block" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: linear-gradient(180deg, #1A1A1B 0%, #252526 100%); }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FCFCFB;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  .wordmark {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 40}px; left: 0; right: 0;
    text-align: center;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 34px; letter-spacing: 0.34em;
    color: ${theme.accent};
  }
  .wordmark .excellence { font-style: italic; font-weight: 400; }
  .wordmark .collection { font-weight: 700; }
  .wordmark .pipe { display: inline-block; margin: 0 18px; opacity: 0.6; font-weight: 300; }
  .eyebrow {
    position: absolute; top: 420px; left: 0; right: 0;
    display: flex; align-items: baseline; justify-content: center;
    gap: 26px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 84px; line-height: 1;
  }
  .eyebrow .word-a {
    font-weight: 400;
    color: transparent;
    -webkit-text-stroke: 2px ${theme.accent};
    letter-spacing: 0.02em;
  }
  .eyebrow .word-b {
    font-weight: 800;
    color: #FCFCFB;
    letter-spacing: -0.01em;
  }
  .photo-wrap {
    position: absolute; left: 50%; top: 580px;
    transform: translateX(-50%);
    width: 920px; height: 720px;
    border: 5px solid ${theme.accent};
  }
  .photo {
    width: 100%; height: 100%;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .divider {
    position: absolute; left: 50%; top: 1340px;
    transform: translateX(-50%);
    width: 560px; height: 2px;
    background: ${theme.accent};
  }
  .open-house {
    position: absolute; left: 80px; right: 80px; top: 1370px;
    text-align: center;
    font-style: italic; font-size: 26px; font-weight: 500;
    letter-spacing: 0.08em; color: ${theme.accent};
  }
  .price {
    position: absolute; left: 80px; right: 80px;
    top: ${ohText ? 1414 : 1380}px;
    text-align: center;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 104px; font-weight: 700; line-height: 1;
    letter-spacing: -0.01em; color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 56px; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase;
  }
  .address-row {
    position: absolute; left: 0; right: 0; top: 1540px;
    text-align: center;
    font-size: 26px; font-weight: 600; letter-spacing: 0.24em;
    color: #D9D9D5; text-transform: uppercase;
  }
  .address-row .pipe { margin: 0 18px; font-weight: 300; opacity: 0.6; }
  .chips {
    position: absolute; left: 0; right: 0; top: ${STORY_SAFE_ZONE.contentBottom - 60}px;
    display: flex; justify-content: center; gap: 32px;
    font-size: 15px; font-weight: 600; letter-spacing: 0.30em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: ${STORY_SAFE_ZONE.bottom + 30}px;
    text-align: center;
    font-size: 12px; font-weight: 600; letter-spacing: 0.30em;
    color: rgba(252,252,251,0.40); text-transform: uppercase;
  }
</style>
<body>
  <div class="frame">
    <div class="wordmark">
      <span class="excellence">Excellence</span><span class="pipe">|</span><span class="collection">COLLECTION</span>
    </div>
    <div class="eyebrow">
      ${wordA ? `<span class="word-a">${escapeHtml(wordA)}</span>` : ""}
      <span class="word-b">${escapeHtml(wordB)}</span>
    </div>
    <div class="photo-wrap"><div class="photo"></div></div>
    <div class="divider"></div>
    ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
    ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
    ${
      addressLine1 || cityUpper
        ? `<div class="address-row">${escapeHtml(addressLine1)}${addressLine1 && cityUpper ? `<span class="pipe">|</span>` : ""}${escapeHtml(cityUpper)}</div>`
        : ""
    }
    ${
      chips.length > 0
        ? `<div class="chips">${chips.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>`
        : ""
    }
    <div class="footer">Century 21 Alliance · ${escapeHtml(mlsHashtag)}</div>
  </div>
</body>
</html>`;
}
