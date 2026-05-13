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
 * v1 · Hero Editorial · Story 9:16 · 1080×1920
 *
 * Hero photo fills the frame. IG and FB Story UI overlays the top ~250px
 * (status bar, profile avatar) and bottom ~340px (Send box, reactions).
 * Critical content lives in the middle band (y=250 to y=1580).
 *
 * Layout differs from square: eyebrow moves down to y=290, content stack
 * weighted to the lower-middle so the footer brand+MLS sits above the
 * bottom safe zone. SOLD stamp anchors center-frame rather than top corner
 * so it isn't clipped by the safe zone.
 */
export function renderV1HeroEditorialStory(args: {
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
  .hero {
    position: absolute; inset: 0;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  .hero-tint {
    position: absolute; inset: 0;
    background: linear-gradient(180deg,
      rgba(24,24,27,0.75) 0%,                                    /* top safe band */
      rgba(24,24,27,0.45) ${(STORY_SAFE_ZONE.top / 1920) * 100}%,
      rgba(24,24,27,0.08) 22%,
      rgba(24,24,27,0.0) 38%,
      rgba(24,24,27,0.0) 52%,
      rgba(24,24,27,0.55) 70%,
      rgba(24,24,27,0.92) ${((1920 - STORY_SAFE_ZONE.bottom) / 1920) * 100}%,
      rgba(24,24,27,0.98) 100%);
  }
  /* Eyebrow sits just below the top safe zone */
  .eyebrow {
    position: absolute; top: ${STORY_SAFE_ZONE.top + 40}px; left: 72px;
    display: flex; align-items: center; gap: 22px; z-index: 3;
  }
  .eyebrow-rule {
    width: 72px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 32px; font-weight: 700; letter-spacing: 0.32em;
    text-transform: uppercase; color: #FBF7EE;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  /* Content stack sits in the lower-middle band, finishing above the bottom safe zone */
  .content {
    position: absolute; left: 72px; right: 72px;
    bottom: ${STORY_SAFE_ZONE.bottom + 40}px; z-index: 3;
  }
  .open-house-strip {
    display: inline-block; margin-bottom: 26px;
    padding: 14px 26px; border-radius: 8px;
    background: ${theme.accent}; color: #18181B;
    font-size: 28px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase; box-shadow: 0 6px 18px rgba(0,0,0,0.4);
  }
  .gold-rule {
    width: 84px; height: 5px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px; margin-bottom: 30px;
  }
  .address {
    font-size: 78px; font-weight: 700; line-height: 1.04; letter-spacing: -0.02em;
    color: #FFFFFF; text-shadow: 0 2px 14px rgba(0,0,0,0.45); word-break: break-word;
  }
  .citystate {
    margin-top: 12px; font-size: 32px; font-weight: 500; letter-spacing: 0.05em;
    color: #F1F1EF; text-transform: uppercase; text-shadow: 0 2px 8px rgba(0,0,0,0.35);
  }
  .price {
    margin-top: 38px; font-size: 96px; font-weight: 800; letter-spacing: -0.025em;
    color: ${theme.accent}; text-shadow: 0 3px 18px rgba(0,0,0,0.5); line-height: 1;
  }
  .price.label-mode { font-size: 56px; letter-spacing: 0.10em; text-transform: uppercase; }
  .chips { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 16px; }
  .chip {
    display: inline-flex; align-items: center; padding: 16px 28px;
    background: rgba(252,252,251,0.10);
    border: 2px solid rgba(201,169,97,0.55);
    border-radius: 999px;
    font-size: 26px; font-weight: 600; letter-spacing: 0.08em; color: #FCFCFB;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .footer {
    margin-top: 42px; padding-top: 28px;
    border-top: 1px solid rgba(252,252,251,0.20);
    display: flex; justify-content: space-between; align-items: center; gap: 18px;
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand-mark {
    width: 48px; height: 48px; border-radius: 10px;
    background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; font-weight: 800; color: #18181B; letter-spacing: -0.02em;
  }
  .brand-text {
    font-size: 22px; font-weight: 700; letter-spacing: 0.18em;
    color: #FCFCFB; text-transform: uppercase;
  }
  .mls-tag {
    font-size: 19px; font-weight: 600; letter-spacing: 0.16em;
    color: rgba(252,252,251,0.65); text-transform: uppercase;
    text-align: right; flex-shrink: 0;
  }
  ${BADGE_CSS}
  /* Override stamp position for story: anchor to the center band so the
     bottom safe zone doesn't clip the type. */
  .badge-stamp { top: 360px; right: 80px; }
  .badge-stamp span { font-size: 52px; padding: 18px 42px; border-width: 6px; }
</style>
<body>
  <div class="frame">
    <div class="hero"></div>
    <div class="hero-tint"></div>
    <div class="eyebrow">
      <span class="eyebrow-rule"></span>
      <span class="eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
    </div>
    ${renderBadge(theme)}
    <div class="content">
      ${ohText ? `<div class="open-house-strip">${escapeHtml(ohText)}</div>` : ""}
      <div class="gold-rule"></div>
      ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
      ${cityStateZip ? `<div class="citystate">${escapeHtml(cityStateZip)}</div>` : ""}
      ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
      ${
        chips.length > 0
          ? `<div class="chips">${chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>`
          : ""
      }
      <div class="footer">
        <div class="brand">
          <div class="brand-mark">21</div>
          <div class="brand-text">Century 21 Alliance</div>
        </div>
        <div class="mls-tag">${escapeHtml(mlsHashtag)}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
