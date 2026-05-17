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
 * v9 · Just Sold Celebration · Story 9:16 · 1080×1920
 *
 * Story-format celebration. Sash drops below the 250px top safe zone;
 * address + footer stay above the 340px bottom band.
 */
export function renderV9JustSoldCelebrationStory(args: {
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
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #18181B; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #FCFCFB;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  .photo {
    position: absolute; inset: 0;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .scrim {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.7) 80%, rgba(0,0,0,0.9) 100%);
  }
  .sparkle {
    position: absolute; width: 16px; height: 16px;
    background: radial-gradient(circle, ${theme.accent} 0%, ${theme.accent} 30%, transparent 70%);
    border-radius: 50%;
  }
  .sparkle.s1 { top: ${STORY_SAFE_ZONE.top + 60}px; right: 120px; opacity: 0.8; }
  .sparkle.s2 { top: ${STORY_SAFE_ZONE.top + 220}px; right: 70px; opacity: 0.6; }
  .sparkle.s3 { top: ${STORY_SAFE_ZONE.top + 140}px; right: 420px; opacity: 0.5; }
  .sash {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 100}px; right: -60px;
    transform: rotate(-8deg);
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    padding: 30px 130px;
    border: 4px solid #FCFCFB;
    box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  }
  .sash-word {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 88px; font-weight: 800; line-height: 1;
    color: #FFFFFF; letter-spacing: 0.06em; text-transform: uppercase;
    text-shadow: 0 2px 6px rgba(0,0,0,0.35);
  }
  .center-block {
    position: absolute; left: 70px; right: 70px;
    bottom: ${STORY_SAFE_ZONE.bottom + 80}px;
    text-align: center;
  }
  .eyebrow {
    font-size: 24px; font-weight: 700; letter-spacing: 0.32em;
    color: ${theme.accent}; text-transform: uppercase;
    margin-bottom: 26px;
  }
  .address {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 80px; font-weight: 700; line-height: 1.04; letter-spacing: -0.01em;
    color: #FFFFFF; word-break: break-word;
    text-shadow: 0 4px 16px rgba(0,0,0,0.5);
  }
  .city {
    margin-top: 18px;
    font-size: 24px; font-weight: 600; letter-spacing: 0.24em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .price {
    margin-top: 22px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 60px; font-weight: 700; line-height: 1;
    color: ${theme.accent}; letter-spacing: -0.01em;
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 36px; font-weight: 800; letter-spacing: 0.20em; text-transform: uppercase;
  }
  .open-house {
    margin-top: 18px;
    font-style: italic; font-size: 24px; font-weight: 500;
    letter-spacing: 0.06em; color: ${theme.accent};
  }
  .chips {
    margin-top: 20px;
    display: flex; justify-content: center; gap: 28px;
    font-size: 16px; font-weight: 600; letter-spacing: 0.26em;
    color: rgba(252,252,251,0.78); text-transform: uppercase;
  }
  /* why: real C21 Alliance White lockup image — source of truth is
     lib/post-builder/canvas-editor/templates/brand-logos.ts (C21_ALLIANCE_WHITE_LOGO).
     URL hardcoded here because primitives are render-time strings, not modules.
     Anchored above the bottom safe zone so the IG sticker tray doesn't cover it. */
  .brand-logo {
    position: absolute; left: 0; right: 0;
    bottom: ${STORY_SAFE_ZONE.bottom + 78}px;
    display: flex; justify-content: center;
  }
  .brand-logo img {
    width: 240px; height: auto; object-fit: contain;
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: ${STORY_SAFE_ZONE.bottom + 30}px;
    text-align: center;
    font-size: 14px; font-weight: 600; letter-spacing: 0.26em;
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
