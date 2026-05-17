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
 * v9 · Just Sold Celebration · Portrait 4:5 · 1080×1350
 *
 * Portrait variant of the celebration layout. Sash + center block scaled
 * up for the taller canvas.
 */
export function renderV9JustSoldCelebrationPortrait(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
  heroImageDataUris?: string[];
}): string {
  const { listing, theme, heroImageDataUri } = args;

  const addressLine1 = (listing.address ?? "").trim();
  const cityUpper = (listing.city ?? "").trim().toUpperCase();
  const priceText = resolvePriceText(listing, theme);
  const chips = buildChips(listing);
  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);
  const ohText = theme.show_open_house_datetime
    ? formatOpenHouse(listing.oh_start_at, listing.oh_end_at)
    : null;

  const sashWord = theme.badge?.text ?? theme.eyebrow.split(/\s+/).pop() ?? "SOLD";

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${addressLine1}`)}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700;800;900&display=block" />
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
  .scrim {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.65) 75%, rgba(0,0,0,0.9) 100%);
  }
  .sparkle {
    position: absolute; width: 14px; height: 14px;
    background: radial-gradient(circle, ${theme.accent} 0%, ${theme.accent} 30%, transparent 70%);
    border-radius: 50%;
  }
  .sparkle.s1 { top: 130px; right: 120px; opacity: 0.8; }
  .sparkle.s2 { top: 280px; right: 80px; opacity: 0.6; }
  .sparkle.s3 { top: 190px; right: 420px; opacity: 0.5; }
  .sash {
    position: absolute; top: 160px; right: -60px;
    transform: rotate(-8deg);
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    padding: 26px 110px;
    border: 3px solid #FCFCFB;
    box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  }
  .sash-word {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 68px; font-weight: 800; line-height: 1;
    color: #FFFFFF; letter-spacing: 0.06em; text-transform: uppercase;
    text-shadow: 0 2px 6px rgba(0,0,0,0.35);
  }
  .center-block {
    position: absolute; left: 60px; right: 60px; bottom: 140px;
    text-align: center;
  }
  .eyebrow {
    font-size: 20px; font-weight: 700; letter-spacing: 0.32em;
    color: ${theme.accent}; text-transform: uppercase;
    margin-bottom: 20px;
  }
  .address {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 64px; font-weight: 700; line-height: 1.04; letter-spacing: -0.01em;
    color: #FFFFFF; word-break: break-word;
    text-shadow: 0 4px 16px rgba(0,0,0,0.5);
  }
  .city {
    margin-top: 14px;
    font-size: 20px; font-weight: 600; letter-spacing: 0.24em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .price {
    margin-top: 18px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 48px; font-weight: 700; line-height: 1;
    color: ${theme.accent}; letter-spacing: -0.01em;
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 30px; font-weight: 800; letter-spacing: 0.20em; text-transform: uppercase;
  }
  .open-house {
    margin-top: 14px;
    font-style: italic; font-size: 20px; font-weight: 500;
    letter-spacing: 0.06em; color: ${theme.accent};
  }
  .chips {
    margin-top: 16px;
    display: flex; justify-content: center; gap: 24px;
    font-size: 14px; font-weight: 600; letter-spacing: 0.26em;
    color: rgba(252,252,251,0.78); text-transform: uppercase;
  }
  /* why: real C21 Alliance White lockup image — source of truth is
     lib/post-builder/canvas-editor/templates/brand-logos.ts (C21_ALLIANCE_WHITE_LOGO).
     URL hardcoded here because primitives are render-time strings, not modules. */
  .brand-logo {
    position: absolute; left: 0; right: 0; bottom: 88px;
    display: flex; justify-content: center;
  }
  .brand-logo img {
    width: 220px; height: auto; object-fit: contain;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: 48px;
    text-align: center;
    font-size: 13px; font-weight: 600; letter-spacing: 0.26em;
    color: rgba(252,252,251,0.55); text-transform: uppercase;
  }
</style>
<body>
  <div class="frame">
    <div class="photo"></div>
    <div class="scrim"></div>
    <div class="sparkle s1"></div>
    <div class="sparkle s2"></div>
    <div class="sparkle s3"></div>
    <div class="sash"><div class="sash-word">${escapeHtml(sashWord)}</div></div>
    <div class="center-block">
      <div class="eyebrow">${escapeHtml(theme.eyebrow)}</div>
      ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
      ${cityUpper ? `<div class="city">${escapeHtml(cityUpper)}</div>` : ""}
      ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
      ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
      ${
        chips.length > 0
          ? `<div class="chips">${chips.map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</div>`
          : ""
      }
    </div>
    <div class="brand-logo">
      <img src="https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/1243286b-f208-47fb-a8f3-7fa1367951a2.png" alt="Century 21 Alliance" />
    </div>
    <div class="footer">${escapeHtml(mlsHashtag)}</div>
  </div>
</body>
</html>`;
}
