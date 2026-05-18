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
 * v6 · Magazine Cover · Story 9:16 · 1080×1920
 *
 * Editorial magazine-cover layout adapted to the 9:16 story frame.
 * Hero photo fills the top ~62% of the canvas; the lower cream panel
 * holds the eyebrow, large 130pt city headline, address, OH chip,
 * price + stat dots, and a small brand mark + MLS line. The whole type
 * block sits inside the story's safe band so platform UI doesn't clip
 * the headline or footer.
 */
export function renderV6MagazineCoverStory(args: {
  listing: PostBuilderListingWithOH;
  theme: PostTypeTheme;
  heroImageDataUri: string;
}): string {
  const { listing, theme, heroImageDataUri } = args;

  const addressLine1 = (listing.address ?? "").trim();
  const cityName = (listing.city ?? "City Unknown").trim();
  const priceText = resolvePriceText(listing, theme);
  const chips = buildChips(listing);
  const mlsHashtag = canonicalMlsHashtag(listing.mls_number, listing.source_mls);
  const ohText = theme.show_open_house_datetime
    ? formatOpenHouse(listing.oh_start_at, listing.oh_end_at)
    : null;

  return `<!doctype html>
<html lang="en">
${commonHead(`${theme.eyebrow} · ${cityName}`)}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; overflow: hidden; background: #FBF7EE; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  .hero {
    position: absolute; top: 0; left: 0; right: 0; height: 1180px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  /* why: gold hairline seam — opacity 0.55 → 0.75 per design review 2026-05-17. */
  .seam-rule {
    position: absolute; top: 1179px; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    opacity: 0.75;
    z-index: 2;
  }
  /* why: story-only top-right C21 brand anchor — the editorial cream panel
     lives at y=1180 and gets cropped by IG/FB Story UI on some devices.
     Sits at top:290 (STORY_SAFE_ZONE.top 250 + 40 buffer) so it's never
     clipped. Mirrors layer_c21_badge_story in magazine-cover-factory. */
  .c21-badge-top {
    position: absolute; top: 290px; right: 40px;
    width: 220px; height: 90px; z-index: 3;
    display: flex; align-items: center; justify-content: center;
    opacity: 0.92;
  }
  .c21-badge-top img {
    max-width: 100%; max-height: 100%; height: auto; width: auto;
    object-fit: contain;
  }
  .panel {
    position: absolute; top: 1180px; left: 0; right: 0; bottom: 0;
    background: #FBF7EE;
    padding: 80px 80px ${STORY_SAFE_ZONE.bottom + 40}px 80px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .eyebrow {
    display: flex; align-items: center; gap: 22px;
  }
  .eyebrow-rule {
    width: 72px; height: 4px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 26px; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: ${theme.accent_dark};
  }
  /* why: address is now the editorial anchor (was city); long addresses
     wrap to 2 lines via line-height 1.02 + generous container height. */
  .address {
    margin-top: 26px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 130px; font-weight: 700; line-height: 1.02; letter-spacing: -0.02em;
    color: #18181B; word-break: break-word;
    min-height: 286px;
  }
  .city {
    margin-top: 20px;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 32px; font-weight: 600; letter-spacing: 0.24em;
    text-transform: uppercase; color: #3F3F3D; word-break: break-word;
  }
  .open-house {
    display: inline-block; align-self: flex-start; margin-top: 22px;
    padding: 12px 24px; border-radius: 8px;
    background: ${theme.accent}; color: #18181B;
    font-size: 24px; font-weight: 800; letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .bottom-row {
    display: flex; justify-content: space-between; align-items: flex-end;
    gap: 28px;
  }
  .price-chips { display: flex; align-items: baseline; gap: 28px; flex-wrap: wrap; }
  .price {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 78px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
    color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 46px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
  }
  .chips { display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; }
  .chip {
    font-size: 18px; font-weight: 600; letter-spacing: 0.18em;
    color: #525250; text-transform: uppercase;
  }
  .chip-sep {
    display: inline-block; width: 4px; height: 4px; border-radius: 50%;
    background: ${theme.accent};
  }
  /* why: footer brand-mark area — real C21 Alliance Grey lockup, canonical
     source ./canvas-editor/templates/brand-logos.ts. Opacity 0.6 → 0.75. */
  .corner-mark {
    display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
    opacity: 0.75; flex-shrink: 0;
  }
  .corner-mark img {
    height: 48px; width: auto; object-fit: contain;
  }
  .corner-mark .mls {
    font-size: 13px; font-weight: 600; letter-spacing: 0.18em;
    color: rgba(24,24,27,0.85); text-transform: uppercase; line-height: 1;
  }
  ${BADGE_CSS}
  /* Badge anchors on the hero photo, upper-right; nudged below the
     story top safe zone so platform UI doesn't clip it. */
  .badge-stamp { top: ${STORY_SAFE_ZONE.top + 60}px; right: 80px; }
  .badge-stamp span { font-size: 48px; padding: 16px 36px; border-width: 5px; }
</style>
<body>
  <div class="frame">
    <div class="hero"></div>
    <div class="seam-rule"></div>
    <div class="c21-badge-top">
      <img src="https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/15c6c2ea-dc9f-45c1-8f65-3cd412ba8299.png" alt="Century 21 Alliance" />
    </div>
    ${renderBadge(theme)}
    <div class="panel">
      <div>
        <div class="eyebrow">
          <span class="eyebrow-rule"></span>
          <span class="eyebrow-text">${escapeHtml(theme.eyebrow)}</span>
        </div>
        ${addressLine1 ? `<div class="address">${escapeHtml(addressLine1)}</div>` : ""}
        ${cityName ? `<div class="city">${escapeHtml(cityName)}</div>` : ""}
        ${ohText ? `<div class="open-house">${escapeHtml(ohText)}</div>` : ""}
      </div>
      <div class="bottom-row">
        <div class="price-chips">
          ${priceText ? `<div class="price${theme.price_mode === "label" ? " label-mode" : ""}">${escapeHtml(priceText)}</div>` : ""}
          ${
            chips.length > 0
              ? `<div class="chips">${chips
                  .map(
                    (c, i) =>
                      (i > 0 ? `<span class="chip-sep"></span>` : "") +
                      `<span class="chip">${escapeHtml(c)}</span>`,
                  )
                  .join("")}</div>`
              : ""
          }
        </div>
        <div class="corner-mark">
          <img src="https://rhkgowpjfpqbrdmgsccx.supabase.co/storage/v1/object/public/brand-assets/manual/logos/15c6c2ea-dc9f-45c1-8f65-3cd412ba8299.png" alt="Century 21 Alliance" />
          <span class="mls">${escapeHtml(mlsHashtag)}</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
