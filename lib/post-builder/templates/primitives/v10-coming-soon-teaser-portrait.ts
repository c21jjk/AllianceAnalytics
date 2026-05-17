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
 * v10 · Coming Soon Teaser · Portrait 4:5 · 1080×1350
 *
 * Portrait variant of the teaser. Stack scales up to ~110pt and the rules
 * widen to match.
 */
export function renderV10ComingSoonTeaserPortrait(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
  heroImageDataUris?: string[];
}): string {
  const { listing, theme, heroImageDataUri } = args;

  const rawAddress = (listing.address ?? "").trim();
  const streetOnly = rawAddress.replace(/^\d+\s+/, "").toUpperCase();
  const cityUpper = (listing.city ?? "").trim().toUpperCase();
  const withheldAddress = [streetOnly, cityUpper].filter(Boolean).join(" · ");

  const priceText = resolvePriceText(listing, theme);
  const chips = buildChips(listing);
  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);
  const ohText = theme.show_open_house_datetime
    ? formatOpenHouse(listing.oh_start_at, listing.oh_end_at)
    : null;

  const eyebrowParts = theme.eyebrow.trim().split(/\s+/);
  const wordA = eyebrowParts.length >= 2 ? eyebrowParts[0] : "COMING";
  const wordB = eyebrowParts.length >= 2 ? eyebrowParts.slice(1).join(" ") : "SOON";
  const footerCta = theme.footer_cta ?? "Tour link in bio soon";

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${withheldAddress}`)}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@300;400;700;900&display=block" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; overflow: hidden; background: #18181B; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FCFCFB;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1350px; overflow: hidden; }
  .photo {
    position: absolute; inset: 0;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .veil {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(24,24,27,0.0) 0%, rgba(24,24,27,0.35) 50%, rgba(24,24,27,0.95) 100%);
  }
  .rule {
    position: absolute; left: 50%; transform: translateX(-50%);
    width: 320px; height: 1px;
    background: ${theme.accent};
    opacity: 0.85;
  }
  .rule.top { top: 460px; }
  .rule.bot { top: 880px; }
  .stack {
    position: absolute; left: 0; right: 0;
    top: 520px;
    text-align: center;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    line-height: 0.92;
  }
  .stack .a {
    display: block;
    font-size: 110px; font-weight: 700;
    color: #FCFCFB; letter-spacing: 0.04em;
  }
  .stack .b {
    display: block;
    margin-top: -6px;
    font-size: 110px; font-weight: 300;
    color: ${theme.accent}; letter-spacing: 0.08em;
    font-style: italic;
  }
  .address {
    position: absolute; left: 70px; right: 70px;
    top: 930px;
    text-align: center;
    font-size: 20px; font-weight: 600; letter-spacing: 0.30em;
    color: rgba(252,252,251,0.85); text-transform: uppercase;
  }
  .price {
    position: absolute; left: 70px; right: 70px;
    top: 980px;
    text-align: center;
    font-size: 18px; font-weight: 600; letter-spacing: 0.24em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .open-house {
    position: absolute; left: 70px; right: 70px;
    top: 1024px;
    text-align: center;
    font-style: italic; font-size: 18px; font-weight: 500;
    letter-spacing: 0.10em; color: ${theme.accent};
  }
  .chips {
    position: absolute; left: 0; right: 0; bottom: 140px;
    display: flex; justify-content: center; gap: 24px;
    font-size: 13px; font-weight: 600; letter-spacing: 0.30em;
    color: rgba(252,252,251,0.70); text-transform: uppercase;
  }
  .cta {
    position: absolute; left: 0; right: 0; bottom: 80px;
    text-align: center;
    font-size: 14px; font-weight: 700; letter-spacing: 0.30em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: 40px;
    text-align: center;
    font-size: 11px; font-weight: 600; letter-spacing: 0.30em;
    color: rgba(252,252,251,0.40); text-transform: uppercase;
  }
</style>
<body>
  <div class="frame">
    <div class="photo"></div>
    <div class="veil"></div>
    <div class="rule top"></div>
    <div class="stack">
      <span class="a">${escapeHtml(wordA)}</span>
      <span class="b">${escapeHtml(wordB)}</span>
    </div>
    <div class="rule bot"></div>
    ${withheldAddress ? `<div class="address">${escapeHtml(withheldAddress)}</div>` : ""}
    ${priceText ? `<div class="price">${escapeHtml(priceText)}</div>` : ""}
    ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
    ${
      chips.length > 0
        ? `<div class="chips">${chips.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>`
        : ""
    }
    <div class="cta">${escapeHtml(footerCta)}</div>
    <div class="footer">Century 21 Alliance · ${escapeHtml(mlsHashtag)}</div>
  </div>
</body>
</html>`;
}
