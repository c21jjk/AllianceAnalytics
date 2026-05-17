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
 * v8 · Standard NEW LISTING · Story 9:16 · 1080×1920
 *
 * Story-format Standard NEW LISTING. Top stack drops below the 250px safe
 * zone; bottom band ends above 1580 so the IG/FB sticker tray doesn't cover
 * the address.
 */
export function renderV8StandardListingStory(args: {
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
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #FCFCFB; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  .eyebrow {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 40}px; left: 70px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 64px; font-weight: 700; line-height: 1;
    color: ${theme.accent_dark}; letter-spacing: -0.01em;
  }
  .price-line {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 124}px; left: 70px;
    font-size: 22px; font-weight: 700; letter-spacing: 0.18em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .open-house {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 162}px; left: 70px;
    font-style: italic; font-size: 22px; font-weight: 500;
    letter-spacing: 0.06em; color: ${theme.accent_dark};
  }
  /* why: real C21 Alliance Grey lockup image — source of truth is
     lib/post-builder/canvas-editor/templates/brand-logos.ts (C21_ALLIANCE_GREY_LOGO).
     URL hardcoded here because primitives are render-time strings, not modules.
     Sized to mirror standard-listing-factory.ts story badgeImage (220×90,
     anchored below the 250px Story top safe zone). */
  .c21-badge {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 40}px; right: 70px;
    width: 220px; height: 90px;
    display: flex; align-items: center; justify-content: center;
  }
  .c21-badge img {
    max-width: 100%; max-height: 100%; height: auto; width: auto;
    object-fit: contain;
  }
  .photo {
    position: absolute; left: 0; top: 560px;
    width: 1080px; height: 960px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .bottom-band {
    position: absolute; left: 0; top: 1300px;
    width: 1080px; height: 280px;
    background: #252526;
    padding: 40px 70px;
    color: #FCFCFB;
    display: flex; flex-direction: column; justify-content: center; gap: 12px;
  }
  .bottom-band .address {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 32px; font-weight: 700; line-height: 1.04; letter-spacing: -0.01em;
    color: #FCFCFB;
  }
  .bottom-band .city {
    font-size: 30px; font-weight: 600; letter-spacing: 0.18em;
    color: rgba(252,252,251,0.78); text-transform: uppercase;
  }
  .bottom-band .chips {
    margin-top: 8px;
    display: flex; gap: 24px; flex-wrap: wrap;
    font-size: 16px; font-weight: 600; letter-spacing: 0.24em;
    color: ${theme.accent}; text-transform: uppercase;
  }
  .bottom-band .chip-sep {
    display: inline-block; opacity: 0.4; color: ${theme.accent};
  }
  ${BADGE_CSS}
  .badge-stamp { top: 600px; left: 50px; right: auto; }
  .badge-stamp span { font-size: 44px; padding: 14px 32px; border-width: 5px; }
</style>
<body>
  <div class="frame">
    <div class="eyebrow">${escapeHtml(theme.eyebrow)}</div>
    ${priceText ? `<div class="price-line">${escapeHtml(priceText)}</div>` : ""}
    ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
    <div class="c21-badge">
      <img src="https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/15c6c2ea-dc9f-45c1-8f65-3cd412ba8299.png" alt="Century 21 Alliance" />
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
