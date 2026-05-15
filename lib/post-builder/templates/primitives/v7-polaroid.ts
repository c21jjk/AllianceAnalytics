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
 * v7 · Polaroid · Square 1080×1080
 *
 * Casual Pinterest/kraft-paper aesthetic. The photo lives inside a white
 * polaroid frame (thin top/sides, thick bottom strip) with a slight tilt
 * and soft drop shadow. The polaroid's bottom strip carries the eyebrow
 * label as the iconic caption line. Below the polaroid sits the address,
 * city/state/zip, price + chips, and a small brand mark + MLS line.
 *
 * Vibe: warmth + share-ability. Less corporate than v1; great for
 * under-contract / just-listed posts where you want a hand-curated feel.
 * Works for all 5 post types via the PostTypeTheme — SOLD-style badge
 * stamps land on the photo at a slight rotation, polaroid-and-stamp style.
 */
export function renderV7Polaroid(args: {
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Pacifico&display=block" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #F5EBCF; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1080px; overflow: hidden; }
  .polaroid {
    position: absolute; top: 56px; left: 50%;
    transform: translateX(-50%) rotate(-2deg);
    width: 804px;
    background: #FCFCFB;
    padding: 32px 32px 88px 32px;
    box-shadow: 0 18px 36px rgba(0,0,0,0.18);
  }
  .polaroid-photo {
    position: relative;
    width: 740px; height: 540px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .polaroid-caption {
    position: absolute; left: 0; right: 0; bottom: 0;
    height: 88px;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 800; letter-spacing: 0.18em;
    color: #18181B; text-transform: uppercase;
  }
  .stack {
    position: absolute; left: 56px; right: 56px;
    top: 740px;
    text-align: center;
  }
  .address {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 48px; font-weight: 700; line-height: 1.05; letter-spacing: -0.01em;
    color: #18181B; word-break: break-word;
  }
  .citystate {
    margin-top: 8px;
    font-size: 18px; font-weight: 500; letter-spacing: 0.08em;
    color: #3F3F3D; text-transform: uppercase;
  }
  .open-house {
    margin-top: 10px;
    font-family: "Pacifico", "Brush Script MT", cursive;
    font-size: 28px; color: ${theme.accent_dark}; letter-spacing: 0.01em;
  }
  .price-row {
    margin-top: 18px;
    display: flex; align-items: baseline; justify-content: center;
    gap: 18px; flex-wrap: wrap;
  }
  .price {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 64px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
    color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 38px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
  }
  .chips { display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
  .chip {
    font-size: 15px; font-weight: 600; letter-spacing: 0.18em;
    color: #525250; text-transform: uppercase;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: 32px;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    font-size: 12px; font-weight: 600; letter-spacing: 0.18em;
    color: rgba(24,24,27,0.6); text-transform: uppercase;
  }
  ${BADGE_CSS}
  /* Badge sits ON the polaroid photo, slightly more rotated than default
     so it reads like a hand-stamped souvenir. */
  .badge-stamp { top: 140px; right: 220px; transform: rotate(-12deg); }
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
