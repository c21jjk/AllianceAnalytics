import {
  buildChips,
  canonicalMlsHashtag,
  commonHead,
  escapeHtml,
  formatOpenHouse,
  resolvePriceText,
  type PostBuilderListingWithOH,
  type PostTypeTheme,
} from "./_shared";

/**
 * v3 · Excellence Collection · Square 1080×1080
 *
 * Premium-tier editorial layout — gold-trimmed framed photo, mixed-weight
 * eyebrow, Playfair price + tracked STREET | CITY address. Mirrors the
 * canvas factory's Excellence Collection design.
 *
 * Stylized "EXCELLENCE COLLECTION" wordmark (mixed Playfair italic + regular)
 * centered at top in place of the canvas factory's logo image.
 */
export function renderV3ExcellenceCollection(args: {
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

  // Split eyebrow into mixed-weight pair. "NEW LISTING" → ["NEW", "LISTING"]
  // For a single-word eyebrow we just render it solid (skip the split).
  const eyebrowParts = theme.eyebrow.trim().split(/\s+/);
  const wordA = eyebrowParts.length >= 2 ? eyebrowParts[0] : "";
  const wordB = eyebrowParts.length >= 2 ? eyebrowParts.slice(1).join(" ") : theme.eyebrow;

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${addressLine1}`)}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400;1,600&display=block" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: linear-gradient(180deg, #1A1A1B 0%, #252526 100%); }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FCFCFB;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1080px; overflow: hidden; }
  .wordmark {
    position: absolute; top: 56px; left: 0; right: 0;
    text-align: center;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 26px; letter-spacing: 0.32em;
    color: ${theme.accent};
  }
  .wordmark .excellence { font-style: italic; font-weight: 400; }
  .wordmark .collection { font-weight: 700; }
  .wordmark .pipe { display: inline-block; margin: 0 14px; opacity: 0.6; font-weight: 300; }
  .eyebrow {
    position: absolute; top: 130px; left: 0; right: 0;
    display: flex; align-items: baseline; justify-content: center;
    gap: 18px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 56px; line-height: 1;
  }
  .eyebrow .word-a {
    font-weight: 400;
    color: transparent;
    -webkit-text-stroke: 1.5px ${theme.accent};
    letter-spacing: 0.02em;
  }
  .eyebrow .word-b {
    font-weight: 800;
    color: #FCFCFB;
    letter-spacing: -0.01em;
  }
  .photo-wrap {
    position: absolute; left: 50%; top: 220px;
    transform: translateX(-50%);
    width: 820px; height: 510px;
    border: 4px solid ${theme.accent};
  }
  .photo {
    width: 100%; height: 100%;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .divider {
    position: absolute; left: 50%; top: 770px;
    transform: translateX(-50%);
    width: 480px; height: 2px;
    background: ${theme.accent};
  }
  .open-house {
    position: absolute; left: 80px; right: 80px; top: 800px;
    text-align: center;
    font-style: italic; font-size: 22px; font-weight: 500;
    letter-spacing: 0.08em; color: ${theme.accent};
  }
  .price {
    position: absolute; left: 80px; right: 80px;
    top: ${ohText ? 836 : 808}px;
    text-align: center;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 78px; font-weight: 700; line-height: 1;
    letter-spacing: -0.01em; color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 42px; font-weight: 800; letter-spacing: 0.24em; text-transform: uppercase;
  }
  .address-row {
    position: absolute; left: 0; right: 0; top: 940px;
    text-align: center;
    font-size: 22px; font-weight: 600; letter-spacing: 0.24em;
    color: #D9D9D5; text-transform: uppercase;
  }
  .address-row .pipe { margin: 0 14px; font-weight: 300; opacity: 0.6; }
  .chips {
    position: absolute; left: 0; right: 0; top: 990px;
    display: flex; justify-content: center; gap: 28px;
    font-size: 13px; font-weight: 600; letter-spacing: 0.30em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: 24px;
    text-align: center;
    font-size: 10px; font-weight: 600; letter-spacing: 0.30em;
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
