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
 * v6 · Magazine Cover · Square 1080×1080
 *
 * Editorial real-estate-magazine cover. Hero photo fills the top ~62% of
 * the canvas, clean-edged into a warm cream lower panel that holds the
 * type stack: eyebrow + gold rule, city headline in display serif,
 * address subhead, price + chip row, brand mark + MLS in the corner.
 *
 * Architectural Digest / Dwell vibe — photo dominant on top, type
 * confident and editorial below. Use when the listing's exterior or
 * interior shot is striking enough to carry the top half on its own.
 *
 * Works for all 5 post types via the PostTypeTheme. Badge stamp anchors
 * to the upper-right of the hero photo (sits ON the photo, not the
 * cream panel).
 */
export function renderV6MagazineCover(args: {
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
${commonSquareHead(`${theme.eyebrow} · ${cityName}`)}
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1080px; overflow: hidden; background: #FBF7EE; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    color: #18181B;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .frame { position: relative; width: 1080px; height: 1080px; overflow: hidden; }
  .hero {
    position: absolute; top: 0; left: 0; right: 0; height: 670px;
    background-image: url("${heroImageDataUri}");
    background-size: cover; background-position: center;
  }
  /* why: gold hairline at the photo / cream-panel seam — opacity bumped
     0.55 → 0.75 per design review 2026-05-17 (mirrors magazine-cover-factory). */
  .seam-rule {
    position: absolute; top: 669px; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    opacity: 0.75;
    z-index: 2;
  }
  .panel {
    position: absolute; top: 670px; left: 0; right: 0; bottom: 0;
    background: #FBF7EE;
    padding: 48px 56px 56px 56px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .eyebrow {
    display: flex; align-items: center; gap: 16px;
  }
  .eyebrow-rule {
    width: 60px; height: 3px;
    background: linear-gradient(90deg, ${theme.accent} 0%, ${theme.accent_dark} 100%);
    border-radius: 2px;
  }
  .eyebrow-text {
    font-size: 18px; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: ${theme.accent_dark};
  }
  /* why: address is now the editorial anchor (was city); long addresses
     wrap to 2 lines via line-height 1.02 + generous container height. */
  .address {
    margin-top: 18px;
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 96px; font-weight: 700; line-height: 1.02; letter-spacing: -0.02em;
    color: #18181B; word-break: break-word;
    min-height: 211px;
  }
  .city {
    margin-top: 14px;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 28px; font-weight: 600; letter-spacing: 0.24em;
    text-transform: uppercase; color: #3F3F3D; word-break: break-word;
  }
  .open-house {
    display: inline-block; align-self: flex-start; margin-top: 16px;
    padding: 8px 18px; border-radius: 6px;
    background: ${theme.accent}; color: #18181B;
    font-size: 18px; font-weight: 800; letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .bottom-row {
    display: flex; justify-content: space-between; align-items: flex-end;
    gap: 24px;
  }
  .price-chips { display: flex; align-items: baseline; gap: 22px; flex-wrap: wrap; }
  .price {
    font-family: "Playfair Display", "Times New Roman", Georgia, serif;
    font-size: 56px; font-weight: 700; line-height: 1; letter-spacing: -0.02em;
    color: ${theme.accent};
  }
  .price.label-mode {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 34px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase;
  }
  .chips { display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
  .chip {
    font-size: 14px; font-weight: 600; letter-spacing: 0.18em;
    color: #525250; text-transform: uppercase;
  }
  .chip-sep {
    display: inline-block; width: 3px; height: 3px; border-radius: 50%;
    background: ${theme.accent};
  }
  /* why: footer brand-mark area — real C21 Alliance Grey lockup, canonical
     source ./canvas-editor/templates/brand-logos.ts. Opacity bumped 0.6 → 0.75
     per design review 2026-05-17 (was reading too dusty against cream). */
  .corner-mark {
    display: flex; align-items: center; justify-content: flex-end;
    opacity: 0.75; flex-shrink: 0;
  }
  .corner-mark img {
    height: 36px; width: auto; object-fit: contain;
  }
  ${BADGE_CSS}
  /* Badge anchors on the hero photo, upper-right. */
  .badge-stamp { top: 88px; right: 56px; }
</style>
<body>
  <div class="frame">
    <div class="hero"></div>
    <div class="seam-rule"></div>
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
        </div>
        ${/* why: MLS hashtag hidden on square + portrait per design review 2026-05-17 —
              it lives in caption + hashtags; the magazine layout reads cleaner without
              a numeric stub in the footer. Story format keeps the hashtag visible. */ ""}
      </div>
    </div>
  </div>
</body>
</html>`;
}
